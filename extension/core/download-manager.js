import {httpUrl, classify} from './media.js';
import {groupMedia} from './grouping.js';
import {recoverySources} from './source-recovery.js';
import {canvasAsset,canvasBrowserFetcher,resolveCanvasMedia} from './canvas-media.js';
import {requestContext} from './request-context.js';

const HOST = 'com.streamcatch.helper';
const ACTIVE = new Set(['queued','starting','downloading']);
const COMMANDS = new Set(['NATIVE_STATUS','START_DOWNLOAD','CANCEL_DOWNLOAD','REVEAL_DOWNLOAD','OPEN_DOWNLOADS','REMOVE_DOWNLOAD','CLEAR_HISTORY']);
const PAYLOAD_PREFIX = 'native-job:';
const HEIGHTS = new Set([0,480,720,1080,2160]);
const cleanText = (value, limit = 1000) => String(value || '')
  .replace(/https?:\/\/\S+/gi, '[视频来源]')
  .replace(/\b(?:cookie|authorization|signature|token|policy|ks)\s*[:=]\s*[^\s,;]+/gi, '[已隐藏]')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0,limit);
const validFiles = files => (Array.isArray(files) ? files : [])
  .filter(path => typeof path === 'string' && path.length < 4096 && /^\/.+\/Downloads\/StreamCatch\/.+/.test(path) && !/[\r\n\u0000]/.test(path)).slice(0,20);

// The identity of a generic video is its full URL. Store only its hash in local
// history; signed media URLs and cookies belong in short-lived session storage.
export async function historyGroupKey(key) {
  const value = String(key || '');
  if (/^kaltura:\d+:[a-zA-Z0-9_-]{1,128}$/.test(value) || /^media:[a-f0-9]{64}$/.test(value)) return value;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return 'media:' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

export function publicPageUrl(value) {
  const valid = httpUrl(value);
  if (!valid) return '';
  const url = new URL(valid);
  url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/(ks|token|signature|authorization|policy)\/[^/]+/gi, '/$1/[hidden]');
  return url.href;
}

// This module has no global side effects: popup code may import identity helpers.
// Only the service worker constructs a manager and owns its native ports.
export function createDownloadManager(api, {statusTimeout = 10000, cancelTimeout = 10000, progressInterval = 500, now = Date.now} = {}) {
  let state = {helper:{ready:false,status:'checking',message:'正在连接 Mac 助手…'},jobs:[]};
  let active = null, statusCheck = null, progressTimer = null, lastProgressWrite = 0;
  let writes = Promise.resolve(), operations = Promise.resolve();
  const persist = () => {
    const snapshot = structuredClone(state);
    writes = writes.catch(() => {}).then(() => api.storage.local.set({downloadState:snapshot}));
    return writes;
  };
  const helper = (ready, message) => {
    state.helper = {ready,status:ready ? 'ready' : 'missing',message};
  };
  const progressWrite = () => {
    if (progressTimer) return;
    const delay = Math.max(0, progressInterval - (now() - lastProgressWrite));
    progressTimer = setTimeout(() => {
      progressTimer = null; lastProgressWrite = now(); persist().catch(() => {});
    },delay);
  };
  const trimHistory = () => {
    const live = state.jobs.filter(job => ACTIVE.has(job.status));
    const past = state.jobs.filter(job => !ACTIVE.has(job.status));
    state.jobs = [...live,...past.slice(0, Math.max(0,30 - live.length))].sort((a,b) => b.created - a.created);
  };
  const ready = (async () => {
    const old = (await api.storage.local.get('downloadState')).downloadState;
    for (const job of (Array.isArray(old?.jobs) ? old.jobs : []).slice(0,60)) {
      if (!job || typeof job.id !== 'string') continue;
      const interrupted = ACTIVE.has(job.status);
      state.jobs.push({id:job.id,groupKey:await historyGroupKey(job.groupKey),pageUrl:publicPageUrl(job.pageUrl),
        title:cleanText(job.title,250),status:interrupted ? 'error' : ['done','error','cancelled'].includes(job.status) ? job.status : 'error',
        progress:interrupted ? '下载连接已中断，请重新点击下载。' : cleanText(job.progress),
        percent:Number.isFinite(job.percent) ? Math.max(0,Math.min(100,job.percent)) : null,
        maxHeight:HEIGHTS.has(job.maxHeight) ? job.maxHeight : 0,files:validFiles(job.files),
        error:interrupted ? '浏览器或插件已重启，未确认下载完成。请重新点击下载。' : cleanText(job.error),
        created:Number(job.created) || now(),updated:interrupted ? now() : Number(job.updated) || now()});
    }
    trimHistory();
    const session = await api.storage.session.get(null);
    const stale = Object.keys(session).filter(key => key.startsWith(PAYLOAD_PREFIX));
    if (stale.length) await api.storage.session.remove(stale);
    await persist();
  })();
  // Register listeners synchronously in background.js; each request awaits this.
  ready.catch(() => {});

  function shortCommand(command) {
    return new Promise((resolve,reject) => {
      let port, settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer);
        try { port?.disconnect(); } catch {}
        error ? reject(new Error(cleanText(error))) : resolve(result);
      };
      const timer = setTimeout(() => finish('Mac 助手没有响应，请重新运行安装脚本。'),statusTimeout);
      try {
        port = api.runtime.connectNative(HOST);
        port.onMessage.addListener(message => {
          if (message.type === 'error' || message.type === 'commandError') finish(message.error || 'Mac 助手执行失败。');
          else if (message.type === 'status' || message.type === 'revealed' || message.type === 'opened') finish(null,message);
        });
        port.onDisconnect.addListener(() => { const error = api.runtime.lastError; finish(error?.message || 'Mac 助手连接中断。'); });
        port.postMessage(command);
      } catch (error) { finish(error.message); }
    });
  }

  async function checkStatus() {
    if (active?.started) return;
    if (statusCheck) return statusCheck;
    state.helper = {ready:false,status:'checking',message:'正在连接 Mac 助手…'};
    await persist();
    statusCheck = (async () => {
      try {
        const result = await shortCommand({cmd:'status'});
        const connected = Boolean(result.ytdlp && result.ffmpeg);
        helper(connected,connected ? 'Mac 助手已连接' : 'Mac 助手缺少 yt-dlp 或 FFmpeg，请重新运行安装脚本。');
      } catch { helper(false,'未连接 Mac 助手，请运行安装脚本后重试。'); }
      await persist();
    })();
    try { await statusCheck; } finally { statusCheck = null; }
  }

  async function sourcePayload(payload) {
    let states = [];
    if (Number.isInteger(payload.tabId) && payload.tabId >= 0) {
      try {
        const tab = await api.tabs.get(payload.tabId);
        if (httpUrl(tab.url) === payload.pageUrl) {
          const page = (await api.storage.session.get(`tab:${payload.tabId}`))[`tab:${payload.tabId}`];
          if (page && httpUrl(page.pageUrl) === payload.pageUrl) states = [page];
        }
      } catch {}
    }
    let source = recoverySources(payload,states)[0] || payload.url, dashManifest;
    if (payload.canvasSource) {
      const resolved=await resolveCanvasMedia(payload.canvasSource,{maxHeight:payload.maxHeight,includeManifest:true,
        fetcher:canvasBrowserFetcher(api,payload.tabId,payload.canvasSource)});
      source=resolved.url;dashManifest=resolved.dashManifest;
    }
    let cookies = [];
    if (payload.useCookies) {
      if (!await api.permissions.contains({permissions:['cookies']})) throw new Error('请在插件中允许使用当前登录状态后重试。');
      const unique = new Map();
      for (const url of new Set([source,payload.pageUrl].filter(Boolean))) {
        for (const cookie of await api.cookies.getAll({url})) unique.set(`${cookie.domain}|${cookie.path}|${cookie.name}`,cookie);
      }
      cookies = [...unique.values()];
    }
    const context=states.flatMap(state=>state.items || []).find(item=>item.url===source)?.requestContext || {};
    const headers=requestContext([{name:'Referer',value:context.referer},{name:'Origin',value:context.origin},
      {name:'User-Agent',value:context.userAgent || globalThis.navigator?.userAgent}]);
    return {cmd:'download',url:source,pageUrl:payload.pageUrl,title:payload.title,maxHeight:payload.maxHeight,cookies,requestHeaders:headers,
      ...(dashManifest !== undefined ? {dashManifest} : {})};
  }

  async function finish(run, status, message = {}) {
    if (run.finished) return;
    run.finished = true; clearTimeout(run.timer); clearTimeout(run.cancelTimer);
    const job = run.job;
    job.status = status; job.updated = now();
    job.files = status === 'done' ? validFiles(message.files) : [];
    job.error = status === 'error' ? cleanText(message.error || '下载未完成，请重新检测原网页后重试。') : '';
    job.progress = status === 'done' ? '下载完成 · 已保存到 下载 / StreamCatch' : status === 'cancelled' ? '已停止下载' : job.error;
    if (status === 'done') job.percent = 100;
    // Disconnect after a terminal message. A new job always gets a fresh host
    // process, so the host's previous worker cleanup cannot race the next job.
    try { run.port?.disconnect(); } catch {}
    if (active === run) active = null;
    await api.storage.session.remove(PAYLOAD_PREFIX + job.id);
    trimHistory(); await persist();
    pump().catch(() => {});
  }

  async function pump() {
    if (active) return;
    const job = [...state.jobs].reverse().find(item => item.status === 'queued');
    if (!job) return;
    const run = {job,port:null,finished:false,cancelled:false,started:false};
    active = run; job.status = 'starting'; job.progress = '正在连接 Mac 助手…'; job.updated = now();
    await persist();
    try {
      const payload = (await api.storage.session.get(PAYLOAD_PREFIX + job.id))[PAYLOAD_PREFIX + job.id];
      if (!payload) throw new Error('临时视频来源已失效，请在原网页重新检测。');
      const request = await sourcePayload(payload);
      if (run.finished) return;
      if (run.cancelled) return finish(run,'cancelled');
      const port = api.runtime.connectNative(HOST); run.port = port;
      run.timer = setTimeout(() => finish(run,'error',{error:'Mac 助手没有响应，请重新运行安装脚本。'}),statusTimeout);
      port.onDisconnect.addListener(() => {
        const error = api.runtime.lastError;
        if (run.finished) return;
        helper(false,'Mac 助手连接已中断');
        finish(run,run.cancelled ? 'cancelled' : 'error',{error:error?.message || 'Mac 助手连接中断，未确认下载完成。'}).catch(() => {});
      });
      port.onMessage.addListener(message => {
        if (run.finished) return;
        if (message.type === 'status' && !run.started) {
          clearTimeout(run.timer);
          const connected = Boolean(message.ytdlp && message.ffmpeg);
          helper(connected,connected ? 'Mac 助手已连接' : 'Mac 助手缺少 yt-dlp 或 FFmpeg，请重新运行安装脚本。');
          if (!connected) return void finish(run,'error',{error:state.helper.message}).catch(() => {});
          if(request.dashManifest !== undefined && !message.browserManifest) return void finish(run,'error',{error:'请更新 Mac 助手：当前 Canvas 视频需要浏览器清单支持。'}).catch(()=>{});
          if (run.cancelled) return void finish(run,'cancelled').catch(() => {});
          run.started = true; job.status = 'downloading'; job.progress = '开始解析与下载…'; job.updated = now();
          persist().catch(() => {});
          try { port.postMessage(request); } catch (error) { finish(run,'error',{error:error.message}).catch(() => {}); }
        } else if (message.type === 'progress' || message.type === 'log') {
          if (!run.started || run.cancelled) return;
          job.progress = cleanText(message.text,600); job.updated = now();
          const percent = message.type === 'progress' && job.progress.match(/(\d+(?:\.\d+)?)\s*%/);
          if (percent) job.percent = Math.max(0,Math.min(100,Number(percent[1])));
          progressWrite();
        } else if (['done','error','cancelled'].includes(message.type)) {
          const type = message.type === 'done' && !validFiles(message.files).length ? 'error' : message.type;
          finish(run,type,message).catch(() => {});
        }
      });
      port.postMessage({cmd:'status'});
    } catch (error) { await finish(run,run.cancelled ? 'cancelled' : 'error',{error:error.message}); }
  }

  async function start(message) {
    const raw = message.payload || message;
    const url = httpUrl(raw.url), pageUrl = httpUrl(raw.pageUrl);
    const maxHeight = Number(raw.maxHeight || 0);
    if (!url || url.length > 20000 || !pageUrl || !HEIGHTS.has(maxHeight)) throw new Error('视频来源或清晰度无效，请重新检测。');
    const canvas = canvasAsset(raw.canvasSource) || canvasAsset(url);
    const selected = groupMedia([{url,kind:raw.kind || classify(url) || 'page',...(canvas ? {canvasSource:canvas.infoUrl} : {})}])[0];
    const groupKey = await historyGroupKey(selected?.groupKey || url);
    const pageKey = publicPageUrl(pageUrl);
    const duplicate = state.jobs.find(job => ACTIVE.has(job.status) && job.groupKey === groupKey && job.pageUrl === pageKey);
    if (duplicate) return {ok:true,jobId:duplicate.id,groupKey,duplicate:true};
    if (state.jobs.filter(job => ACTIVE.has(job.status)).length >= 20) throw new Error('下载队列已满，请等待当前下载完成。');
    const id = crypto.randomUUID();
    const title = cleanText(raw.title || 'video',250);
    const payload = {url,pageUrl,title,maxHeight,tabId:raw.tabId,groupKey:raw.groupKey || selected?.groupKey || url,
      kind:['hls','dash','file','page'].includes(raw.kind) ? raw.kind : classify(url) || 'page',useCookies:raw.useCookies === true,
      ...(canvas ? {canvasSource:canvas.infoUrl} : {}),
      sources:(Array.isArray(raw.sources) ? raw.sources : []).slice(0,100).filter(item => httpUrl(item?.url)).map(item => ({url:item.url,kind:item.kind,time:Number(item.time) || 0}))};
    const job = {id,groupKey,pageUrl:pageKey,title,status:'queued',progress:'等待下载',percent:null,maxHeight,files:[],error:'',created:now(),updated:now()};
    await api.storage.session.set({[PAYLOAD_PREFIX + id]:payload});
    state.jobs.unshift(job); trimHistory(); await persist();
    pump().catch(() => {});
    return {ok:true,jobId:id,groupKey};
  }

  async function dispatch(message) {
    switch (message.type) {
      case 'NATIVE_STATUS': await checkStatus(); return {ok:true};
      case 'START_DOWNLOAD': return start(message);
      case 'CANCEL_DOWNLOAD': {
        const job = state.jobs.find(item => item.id === message.id);
        if (!job || !ACTIVE.has(job.status)) return {ok:true};
        if (active?.job === job) {
          const run = active; run.cancelled = true;
          if (!run.started) await finish(run,'cancelled');
          else {
            job.progress = '正在停止…'; job.updated = now(); await persist();
            try { run.port.postMessage({cmd:'cancel'}); } catch { await finish(run,'cancelled'); }
            if (!run.finished) run.cancelTimer = setTimeout(() => finish(run,'cancelled').catch(() => {}),cancelTimeout);
          }
        } else {
          job.status = 'cancelled'; job.progress = '已取消排队'; job.updated = now();
          await api.storage.session.remove(PAYLOAD_PREFIX + job.id); await persist();
        }
        return {ok:true};
      }
      case 'REVEAL_DOWNLOAD': {
        const job = state.jobs.find(item => item.id === message.id);
        if (!job || job.status !== 'done' || !job.files.length) throw new Error('文件尚未下载完成。');
        await shortCommand({cmd:'revealFile',path:job.files[0]}); return {ok:true};
      }
      case 'OPEN_DOWNLOADS': await shortCommand({cmd:'openDownloads'}); return {ok:true};
      case 'REMOVE_DOWNLOAD': {
        const job = state.jobs.find(item => item.id === message.id);
        if (job && ACTIVE.has(job.status)) throw new Error('请先停止下载，再移除记录。');
        state.jobs = state.jobs.filter(item => item.id !== message.id); await persist(); return {ok:true};
      }
      case 'CLEAR_HISTORY': state.jobs = state.jobs.filter(job => ACTIVE.has(job.status)); await persist(); return {ok:true};
    }
  }

  function handle(message, sender) {
    if (!COMMANDS.has(message?.type)) return null;
    if (sender?.id !== api.runtime.id || !sender.url?.startsWith(api.runtime.getURL(''))) return Promise.resolve({ok:false,error:'只有插件界面可以执行下载操作。'});
    const result = operations.catch(() => {}).then(async () => { await ready; return dispatch(message); })
      .catch(error => ({ok:false,error:cleanText(error.message || error)}));
    operations = result;
    return result;
  }

  return {handle,ready};
}
