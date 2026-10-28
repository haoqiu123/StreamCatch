import {httpUrl, classify, safeFilename, fileExtension, formatBytes, durationText} from './core/media.js';
import {loadPlaylist, downloadHls} from './core/hls.js';
import {recoverySources, canRetrySource} from './core/source-recovery.js';
const $ = id => document.getElementById(id);
const show = (id, yes = true) => $(id).classList.toggle('hidden', !yes);
const errorAt = (id, e) => { $(id).textContent = e.message || String(e); show(id); };
let job, playlist, variants = [], master, inspectAbort, downloadAbort, inspecting = false, busy = false, nativeBusy = false, nativePort, nativeReady = false, inspectionError;
function lock() {
  const working = busy || nativeBusy || inspecting;
  $('quality').disabled = working;
  $('filename').disabled = working;
  $('manual-go').disabled = working;
  $('refresh-source').disabled = working || !httpUrl(job?.url);
  $('open-page').disabled = !httpUrl(job?.pageUrl);
  $('native-download').disabled = working || !nativeReady || !httpUrl(job?.url);
  $('save').disabled = working || !(job?.kind === 'file' || playlist && !playlist.live && !playlist.issues.length && playlist.segments.length);
}
function setNote(message) { $('browser-note').textContent = message; show('browser-note', Boolean(message)); }
function sourceStatus(message) { $('source-status').textContent = message; show('source-status', Boolean(message)); }
function label(v) { return `${v.height ? v.height + 'p' : v.name || '原始画质'}${v.bandwidth ? ' · ' + (v.bandwidth / 1e6).toFixed(1) + ' Mbps' : ''}`; }
async function sourceTabs() {
  const pageUrl = httpUrl(job?.pageUrl);
  if (!pageUrl) return [];
  return (await chrome.tabs.query({})).filter(tab => httpUrl(tab.url) === pageUrl)
    .sort((a,b) => Number(b.id === job.sourceTabId) - Number(a.id === job.sourceTabId));
}
async function currentSources() {
  const tabs = await sourceTabs();
  const keys = tabs.map(tab => `tab:${tab.id}`);
  const states = await chrome.storage.session.get(keys);
  return recoverySources(job, keys.map(key => states[key]).filter(Boolean));
}
async function rememberSource(url) {
  job = {...job,url}; $('source').textContent = url;
  const id = new URL(location.href).searchParams.get('job');
  if (id) await chrome.storage.session.set({[`job:${id}`]:job});
}
function preferredIndex(choices, preferred) {
  if (!preferred) return 0;
  const exact = choices.findIndex(v => v.url === preferred.url);
  if (exact >= 0) return exact;
  const equivalent = choices.findIndex(v => v.height === preferred.height && v.width === preferred.width && v.bandwidth === preferred.bandwidth);
  if (equivalent >= 0) return equivalent;
  throw new Error('来源已更新，但原来选择的清晰度已不可用。请重新获取来源并选择画质。');
}
async function resolveChoice(choice, top, signal, loaded) {
  let url = choice.url, p = loaded, separateAudio = top.audio.some(a => a['GROUP-ID'] === choice.audioGroup);
  const seen = new Set();
  for (let depth = 0; depth < 5; depth++) {
    if (seen.has(url)) throw new Error('播放列表存在循环引用。');
    seen.add(url); p = p || await loadPlaylist(url,signal);
    if (!p.variants.length) break;
    separateAudio ||= p.audio.some(a => a['GROUP-ID'] === p.variants[0].audioGroup);
    url = p.variants[0].url; p = null;
  }
  if (!p || p.variants.length) throw new Error('播放列表嵌套过深，请使用本地助手。');
  const issues = [...top.issues, ...p.issues];
  if (separateAudio) issues.push('此清晰度的声音与画面分开存储。请使用右侧本地助手下载并合并。');
  return {...p,issues:[...new Set(issues)]};
}
function renderPlaylist() {
  const p = playlist;
  $('duration').textContent = p.live ? '直播 / 未结束' : durationText(p.duration);
  $('format').textContent = p.extension.toUpperCase();
  if (p.issues.length) setNote(p.issues.join(' '));
  else if (p.live) setNote('这是直播或尚未结束的视频。浏览器模式不支持；本地助手可尝试下载，停止时可能留下未封装的临时文件。');
  else if (!p.segments.length) setNote('播放列表中没有完整分段。请使用本地助手。');
  else if (p.extension === 'ts') setNote('将保存为原始 TS 视频。需要 MP4 时，请使用右侧本地助手。');
}
async function inspect({preferred, keepFilename = false, refresh = false, signal: parentSignal} = {}) {
  inspectAbort?.abort(); inspectAbort = new AbortController();
  const signal = inspectAbort.signal;
  const abort = () => inspectAbort?.abort();
  parentSignal?.addEventListener('abort',abort,{once:true});
  if (parentSignal?.aborted) inspectAbort.abort();
  playlist = null; master = null; variants = []; inspectionError = null; inspecting = true;
  show('browser-content',false); show('browser-error',false); show('browser-success',false); setNote(''); sourceStatus(''); lock();
  $('title').textContent = job.title || '网页视频'; $('source').textContent = job.url;
  if (!keepFilename) $('filename').value = safeFilename(job.title);
  $('kind').textContent = job.kind.toUpperCase(); $('quality').replaceChildren(); show('inspecting');
  try {
    if (job.kind === 'file') {
      $('quality').add(new Option('原始视频文件','0')); $('duration').textContent = '原始文件'; $('format').textContent = fileExtension(job.url).toUpperCase();
      show('browser-content'); return true;
    }
    if (job.kind !== 'hls') {
      setNote(job.kind === 'dash' ? 'DASH 视频通常需要合并音轨和画面。请使用右侧本地助手。' : '这是网页地址。请使用右侧本地助手解析，或返回视频页面播放后，从插件里选择检测到的视频。'); return true;
    }
    const original = job.url;
    const candidates = await currentSources(); signal.throwIfAborted();
    for (let i = 0; i < candidates.length; i++) {
      try {
        const url = candidates[i];
        const top = await loadPlaylist(url,signal);
        const choices = top.variants.length ? top.variants : [{url,name:'原始画质'}];
        const index = preferredIndex(choices,preferred);
        const resolved = await resolveChoice(choices[index],top,signal,top.variants.length ? null : top);
        signal.throwIfAborted();
        master = top; variants = choices; playlist = resolved;
        await rememberSource(url); signal.throwIfAborted();
        choices.forEach((v,j) => $('quality').add(new Option(label(v),String(j))));
        $('quality').value = String(index); show('browser-content'); renderPlaylist();
        if (url !== original) sourceStatus('已换用原网页新获取的视频入口。');
        else if (refresh) sourceStatus('已重新检查视频入口。如果仍失败，请打开原网页，刷新并播放几秒，再回来重新获取来源。');
        return true;
      } catch(e) {
        if (signal.aborted || !canRetrySource(e) || i === candidates.length - 1) throw e;
      }
    }
    throw new Error('没有可用的视频来源。请返回原网页播放后重试。');
  } catch(e) {
    inspectionError = e;
    if (!signal.aborted) {
      errorAt('browser-error',e);
      if (canRetrySource(e)) sourceStatus('请打开原网页，刷新并播放几秒，再回到这里点击「重新获取来源」。');
    }
    return false;
  } finally {
    parentSignal?.removeEventListener('abort',abort);
    if (inspectAbort.signal === signal) { inspecting = false; show('inspecting',false); lock(); }
  }
}
$('quality').addEventListener('change', () => inspect({preferred:variants[Number($('quality').value)],keepFilename:true}));
$('refresh-source').addEventListener('click', () => inspect({keepFilename:true,refresh:true}));
$('open-page').addEventListener('click', async () => {
  try {
    const [tab] = await sourceTabs();
    if (tab) { await chrome.tabs.update(tab.id,{active:true}); await chrome.windows.update(tab.windowId,{focused:true}); }
    else await chrome.tabs.create({url:job.pageUrl});
  } catch(e) { errorAt('browser-error',e); }
});
$('save').addEventListener('click', async () => {
  if (busy || inspecting || nativeBusy) return;
  show('browser-error',false); show('browser-success',false);
  if (job.kind === 'file') {
    try {
      await chrome.downloads.download({url:job.url,filename:safeFilename($('filename').value,fileExtension(job.url)),saveAs:true,conflictAction:'uniquify'});
      $('browser-success').textContent = '已交给浏览器下载。可在浏览器的下载记录中查看进度和结果。'; show('browser-success');
    } catch(e) { errorAt('browser-error',e); } return;
  }
  let writable;
  const preferred = variants[Number($('quality').value)], extension = playlist?.extension;
  try {
    if (!playlist) throw new Error('请先重新获取来源。');
    if (!window.showSaveFilePicker) throw new Error('此浏览器不支持流式文件保存，请使用 Chrome / Edge 120+ 或本地助手。');
    // Keep the picker in the click gesture, then refresh signed playlists before writing.
    const handle = await window.showSaveFilePicker({suggestedName:safeFilename($('filename').value,extension)});
    busy = true; lock(); downloadAbort = new AbortController();
    show('browser-progress'); $('progress').value = 0; $('progress-text').textContent = '正在更新视频入口…';
    if (!await inspect({preferred,keepFilename:true,signal:downloadAbort.signal})) throw inspectionError;
    if (!playlist || playlist.live || playlist.issues.length || !playlist.segments.length) throw new Error('更新后的视频需要本地助手处理，请查看上方说明。');
    if (playlist.extension !== extension) throw new Error('来源的保存格式已改变，请重新选择保存位置。');
    downloadAbort.signal.throwIfAborted();
    writable = await handle.createWritable(); $('progress-text').textContent = '正在下载第一个分段…';
    const bytes = await downloadHls(playlist,writable,{signal:downloadAbort.signal,onProgress:p => {
      $('progress').value = p.completed / p.total * 100;
      $('progress-text').textContent = `${p.completed} / ${p.total} 分段 · ${formatBytes(p.bytes)}`;
    }});
    downloadAbort.signal.throwIfAborted();
    await writable.close(); writable = null;
    $('browser-success').textContent = `下载完成 · ${formatBytes(bytes)}。文件已保存到你选择的位置。`; show('browser-success');
  } catch(e) {
    if (writable) await writable.abort().catch(() => {});
    if (e.name !== 'AbortError') {
      errorAt('browser-error',e);
      if ([401,403,404,410].includes(e.status)) sourceStatus('本次未提交未完成的视频。请刷新原网页并播放，再重新获取来源下载。');
    } else if (busy) { $('browser-success').textContent = '已取消下载，未提交未完成的视频内容。'; show('browser-success'); }
  } finally { busy = false; lock(); show('browser-progress',false); }
});
$('cancel').addEventListener('click', () => downloadAbort?.abort());
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(job.url); $('copy').textContent = '已复制 ✓'; } catch(e) { errorAt('global-error',e); }
});

function connectHelper() {
  const port = chrome.runtime.connectNative('com.streamcatch.helper');
  nativePort = port;
  port.onMessage.addListener(message => {
    if (message.type === 'status') {
      nativeReady = Boolean(message.ytdlp && message.ffmpeg);
      $('helper-status').textContent = nativeReady ? '● 已连接 · yt-dlp + FFmpeg 就绪' : '已连接，但缺少 yt-dlp 或 FFmpeg。请重新运行安装脚本。';
      lock();
      show('install-help',!nativeReady);
    } else if (message.type === 'log' || message.type === 'progress') {
      show('native-log');
      const lines = ($('native-log').textContent + '\n' + message.text).trim().split('\n').slice(-14);
      $('native-log').textContent = lines.join('\n'); $('native-log').scrollTop = $('native-log').scrollHeight;
    } else if (['done','error','cancelled'].includes(message.type)) {
      nativeBusy = false; $('native-download').disabled = !nativeReady; show('native-cancel',false); lock();
      $('native-result').textContent = message.type === 'done' ? `下载完成：\n${(message.files || []).join('\n')}` : message.type === 'cancelled' ? '已停止下载。未完成的 .part 文件可能保留，重新下载可尝试续传。' : `下载失败：${message.error || '请检查上方日志。'}`;
      show('reveal',message.type === 'done' && message.files?.length > 0);
    }
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    if (nativePort !== port) return;
    nativePort = null; nativeReady = false; $('native-download').disabled = true;
    $('helper-status').textContent = '本地助手未连接。安装后刷新本页即可。'; show('install-help');
    if (nativeBusy) {
      $('native-result').textContent = `助手连接中断，下载未确认完成。${error?.message || ''}`;
      nativeBusy = false; show('native-cancel',false); lock();
    }
  });
  port.postMessage({cmd:'status'});
}
$('native-download').addEventListener('click', async () => {
  if (nativeBusy || busy || inspecting || !httpUrl(job?.url)) return;
  nativeBusy = true; lock();
  try {
    let cookies = [];
    const useCookies = $('use-cookies').checked;
    if (useCookies) {
      const permitted = await chrome.permissions.request({permissions:['cookies']});
      if (!permitted) throw new Error('未授予 Cookie 权限。可取消勾选登录状态后重试。');
    }
    // yt-dlp handles playlists the browser parser cannot; do not make a
    // successful browser inspection a prerequisite for using the helper.
    if (job.kind === 'hls') {
      const [fresh] = await currentSources();
      if (fresh && fresh !== job.url) {
        await rememberSource(fresh);
        sourceStatus('已换用原网页新获取的视频入口。');
      }
    }
    if (useCookies) {
      const unique = new Map();
      for (const url of new Set([job.url,job.pageUrl].filter(url => httpUrl(url)))) {
        for (const cookie of await chrome.cookies.getAll({url})) unique.set(`${cookie.domain}|${cookie.path}|${cookie.name}`,cookie);
      }
      cookies = [...unique.values()];
    }
    if (!nativePort || !nativeReady) throw new Error('本地助手未连接，请安装后刷新本页。');
    show('native-cancel'); show('reveal',false);
    $('native-result').textContent = ''; $('native-log').textContent = '开始解析与下载…'; show('native-log');
    nativePort.postMessage({cmd:'download',url:job.url,pageUrl:job.pageUrl,title:job.title,maxHeight:Number($('native-quality').value),cookies});
  } catch(e) { errorAt('global-error',e); nativeBusy = false; show('native-cancel',false); lock(); }
});
$('native-cancel').addEventListener('click', () => nativePort?.postMessage({cmd:'cancel'}));
$('reveal').addEventListener('click', () => nativePort?.postMessage({cmd:'reveal',index:0}));
$('manual-go').addEventListener('click', async () => {
  const url = httpUrl($('manual-url').value.trim());
  if (!url) return errorAt('global-error',new Error('请输入有效的 http 或 https 视频 / 网页链接。'));
  show('global-error',false);
  const id = crypto.randomUUID();
  job = {url,kind:classify(url) || 'page',title:'video',pageUrl:url,created:Date.now()};
  await chrome.storage.session.set({[`job:${id}`]:job});
  history.replaceState(null,'',`?job=${id}`); await inspect();
});
window.addEventListener('beforeunload', event => {
  if (busy || nativeBusy) { event.preventDefault(); event.returnValue = ''; }
});
try {
  const id = new URL(location.href).searchParams.get('job');
  job = (await chrome.storage.session.get(`job:${id}`))[`job:${id}`];
  connectHelper();
  if (!job || !httpUrl(job.url)) {
    $('title').textContent = '粘贴链接，或者从视频网页的插件图标进入。'; show('inspecting',false); setNote('请在下方输入视频或网页地址。');
  } else await inspect();
} catch(e) { errorAt('global-error',e); }
