import {httpUrl, classify} from './core/media.js';
import {groupMedia} from './core/grouping.js';
import {createDownloadManager} from './core/download-manager.js';
import {canvasAsset,canvasSource,canvasBrowserFetcher,observeCanvasRedirect,resolveCanvasMedia} from './core/canvas-media.js';
import {requestContext} from './core/request-context.js';

const downloadManager = createDownloadManager(chrome);
const xMedia = globalThis.StreamCatchX;
const pageMedia=globalThis.StreamCatchPage;
const mediaMetadata = value => {
  const metadata = {};
  const poster = httpUrl(value?.poster);
  if (poster && poster.length <= 16000) metadata.poster = poster;
  if (Number.isFinite(value?.duration) && value.duration > 0) metadata.duration = value.duration;
  return metadata;
};

const queues = new Map();
const requestContexts=new Map();
function forgetContexts(tabId){for(const key of requestContexts.keys())if(key.startsWith(tabId+':'))requestContexts.delete(key);}
chrome.webRequest.onBeforeSendHeaders?.addListener(details=>{
  if(details.tabId<0||details.method!=='GET'||!classify(details.url))return;
  const context=requestContext(details.requestHeaders);
  requestContexts.set(`${details.tabId}:${details.url}`,context);
  if(requestContexts.size>300)requestContexts.delete(requestContexts.keys().next().value);
},{urls:['http://*/*','https://*/*']},['requestHeaders']);
const canvasRefreshes = new Map(), canvasRefreshTimes = new Map();
function update(tabId, mutate) {
  const key = `tab:${tabId}`;
  const run = (queues.get(tabId) || Promise.resolve()).catch(() => {}).then(async () => {
    const previous = (await chrome.storage.session.get(key))[key] || {items: [], drm: false};
    const state = await mutate(previous);
    await chrome.storage.session.set({[key]: state});
    const count = groupMedia(state.items).length;
    await chrome.action.setBadgeText({tabId, text: count ? String(count) : ''}).catch(() => {});
    await chrome.action.setBadgeBackgroundColor({tabId, color: '#246E5C'}).catch(() => {});
  });
  queues.set(tabId, run);
  run.finally(() => { if (queues.get(tabId) === run) queues.delete(tabId); }).catch(() => {});
  return run;
}

async function collect(tabId, raw, page = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  return update(tabId, state => {
    if (page.title) state.title = String(page.title).slice(0, 250);
    if (httpUrl(page.url)) state.pageUrl = httpUrl(page.url);
    if (page.drm) state.drm = true;
    if (xMedia.isPage(page.url) && Array.isArray(page.mediaContexts)) {
      state.assetMetadata ||= {};
      for (const value of Object.values(state.assetMetadata)) value.inViewport = false;
      for (const context of page.mediaContexts.slice(0,100)) {
        const asset = xMedia.posterAsset(context.poster);
        if (!asset) continue;
        const details = mediaMetadata(context);
        for (const [key,limit] of [['title',250],['author',120]]) {
          if (typeof context[key] === 'string' && context[key].trim()) details[key] = context[key].trim().slice(0,limit);
        }
        const postUrl = xMedia.postUrl(context.postUrl);
        if (postUrl) details.postUrl = postUrl;
        state.assetMetadata[asset.key] = {...state.assetMetadata[asset.key],...details,
          inViewport:Boolean(context.inViewport),seen:Date.now()};
      }
      const entries = Object.entries(state.assetMetadata).sort((a,b)=>b[1].seen-a[1].seen).slice(0,100);
      state.assetMetadata = Object.fromEntries(entries);
    }
    if (page.metadata && Number.isInteger(page.frameId)) {
      state.metadataByFrame ||= {};
      state.metadataByFrame[page.frameId] = mediaMetadata(page.metadata);
      const frames = Object.values(state.metadataByFrame).slice(0,100);
      // A top-level Open Graph poster and an iframe player's duration commonly
      // arrive separately. Prefer the main frame per field, without dropping
      // useful metadata contributed by the player frame.
      state.metadata = Object.assign({},...frames,state.metadataByFrame[0] || {});
    }
    for (const candidate of raw.slice(0, 100)) {
      const url = httpUrl(candidate.url);
      const canvas = canvasAsset(url) || canvasAsset(page.frameUrl);
      const kind = candidate.kind==='page' && pageMedia.asset(url) ? 'page' : canvasAsset(url) ? 'canvas' : classify(url, candidate.mime) || (candidate.fromVideo && url ? 'file' : null);
      if (!url || url.length > 16000 || !kind) continue;
      const x = xMedia.asset(url);
      if (x?.audio || x?.segment) continue;
      const old = state.items.find(item => item.url === url);
      if (old) {
        old.time = Date.now();
        if (candidate.mime) { old.mime = candidate.mime; old.kind = kind; }
        if (candidate.size > 0) old.size = candidate.size;
        if (candidate.height > 0) old.height = candidate.height;
        Object.assign(old,mediaMetadata(candidate));
        if(candidate.requestContext)old.requestContext=candidate.requestContext;
        if(kind==='page'&&candidate.title)old.title=String(candidate.title).slice(0,250);
        if (canvas) old.canvasSource = canvas.infoUrl;
        continue;
      }
      if (state.items.length >= 100) state.items.shift();
      state.items.push({id: crypto.randomUUID(), url, kind, mime: candidate.mime || '', size: Number(candidate.size) || 0, height: Number(candidate.height) || 0, source: candidate.source || '网页', time: Date.now(), ...mediaMetadata(candidate),...(candidate.requestContext?{requestContext:candidate.requestContext}:{}),...(kind==='page'&&candidate.title?{title:String(candidate.title).slice(0,250)}:{}),...(canvas ? {canvasSource:canvas.infoUrl} : {})});
    }
    return state;
  });
}

async function refreshCanvas(tabId, force = false) {
  await queues.get(tabId)?.catch(()=>{});
  const state = (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`];
  const targets = new Map((state?.items || []).map(canvasSource).filter(Boolean).map(asset=>[asset.key,asset]));
  await Promise.allSettled([...targets.values()].slice(0,20).map(asset=>{
    const key=`${tabId}:${asset.key}`;
    if (canvasRefreshes.has(key)) return canvasRefreshes.get(key);
    if (!force && Date.now()-(canvasRefreshTimes.get(key) || 0)<30000) return;
    canvasRefreshTimes.set(key,Date.now());
    const task=resolveCanvasMedia(asset.infoUrl,{fetcher:canvasBrowserFetcher(chrome,tabId,asset.infoUrl)}).then(item=>update(tabId,current=>{
      if (current.pageUrl !== state.pageUrl) return current;
      current.items=current.items.filter(old=>!(old.canvasResolved && canvasSource(old)?.key===asset.key));
      current.items.push({id:crypto.randomUUID(),...item});
      if (current.canvasErrors) delete current.canvasErrors[asset.key];
      return current;
    })).catch(error=>update(tabId,current=>{
      if (current.pageUrl !== state.pageUrl) return current;
      current.canvasErrors ||= {};
      current.canvasErrors[asset.key]=String(error.message || 'Canvas 请求失败').replace(/https?:\/\/\S+/g,'[视频来源]').slice(0,500);
      return current;
    })).finally(()=>canvasRefreshes.delete(key));
    canvasRefreshes.set(key,task);
    return task;
  }));
}

chrome.webRequest.onHeadersReceived.addListener(details => {
  observeCanvasRedirect(details);
  if (details.tabId < 0 || details.statusCode >= 400 || details.method !== 'GET') return;
  const header = name => details.responseHeaders?.find(h => h.name.toLowerCase() === name)?.value || '';
  const mime = header('content-type');
  if (!classify(details.url, mime)) return;
  const range = header('content-range').match(/\/(\d+)$/);
  const size = range ? Number(range[1]) : Number(header('content-length'));
  const frame = /\.instructuremedia\.com$/.test(new URL(details.url).hostname)
    ? chrome.webNavigation.getFrame({tabId:details.tabId,frameId:details.frameId}).catch(()=>null) : Promise.resolve(null);
  frame.then(frame=>collect(details.tabId, [{url: details.url, mime, size, source: '网络请求',requestContext:requestContexts.get(`${details.tabId}:${details.url}`)}],{frameUrl:frame?.url}))
    .then(()=>refreshCanvas(details.tabId)).catch(() => {});
}, {urls: ['http://*/*', 'https://*/*']}, ['responseHeaders']);

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0) {forgetContexts(details.tabId);update(details.tabId, () => ({items: [], drm: false, pageUrl: details.url})).catch(() => {});}
});
chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId !== 0) return;
  update(details.tabId, state => {
    const previous=pageMedia.asset(state.pageUrl),next=pageMedia.asset(details.url);
    return state.pageUrl===details.url || previous && previous.key===next?.key ? {...state,pageUrl:details.url} : {items:[],drm:false,pageUrl:details.url};
  })
    .then(()=>chrome.tabs.sendMessage(details.tabId,{type:'SCAN'})).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(tabId => {
  forgetContexts(tabId);
  for (const key of canvasRefreshTimes.keys()) if (key.startsWith(`${tabId}:`)) canvasRefreshTimes.delete(key);
  (queues.get(tabId) || Promise.resolve()).finally(() => chrome.storage.session.remove(`tab:${tabId}`)).catch(() => {});
});

// Refresh badges after an update even when the session still holds the old
// list of raw URLs. Storage stays backward-compatible with existing jobs.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.get(null).then(all => Promise.all(Object.keys(all)
    .filter(key => /^tab:\d+$/.test(key))
    .map(key => update(Number(key.slice(4)), state => state)))).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const downloadRequest = downloadManager.handle(message,sender);
  if (downloadRequest) {
    downloadRequest.then(reply);
    return true;
  }
  if (message?.type === 'FOUND' && sender.tab) {
    if(sender.frameId===0 && message.documentUrl && httpUrl(message.documentUrl)!==httpUrl(sender.tab.url))return;
    const items=(Array.isArray(message.items)?message.items:[]).map(({requestContext:ignored,...item})=>item);
    collect(sender.tab.id, items, {title: sender.frameId === 0 ? message.title : '', url: sender.tab.url,frameUrl:sender.url, drm: Boolean(message.drm),frameId:sender.frameId,metadata:message.metadata,mediaContexts:message.mediaContexts}).then(() => {
      reply({ok:true}); refreshCanvas(sender.tab.id).catch(()=>{});
    }).catch(() => reply({ok: false}));
    return true;
  }
  // Privileged operations are available only to the extension's own UI.
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (message?.type === 'CANVAS_REFRESH' && Number.isInteger(message.tabId)) {
    refreshCanvas(message.tabId,true).then(()=>reply({ok:true})).catch(()=>reply({ok:false}));
    return true;
  }
  if (['CLEAR','RESCAN'].includes(message?.type) && Number.isInteger(message.tabId)) {
    update(message.tabId, state => ({...state, items: [], drm:message.type==='RESCAN'&&state.drm || false, assetMetadata:{}})).then(() => reply({ok: true}));
    return true;
  }
});
