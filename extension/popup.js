import {httpUrl, fileExtension, durationText} from './core/media.js';
import {groupMedia} from './core/grouping.js';
import {historyGroupKey} from './core/download-manager.js';
const $ = id => document.getElementById(id);
const icons = {
  settings:'<path d="m9 3 .6 2.4 2.8 1.6 2.4-.7 3 5.2-1.8 1.7v3.2l1.8 1.7-3 5.2-2.4-.7-2.8 1.6L9 26"/>',
  gear:'<path d="m9 3-.6 2.3-2 .9-2.2-.6-2 3.5 1.6 1.7v2.4l-1.6 1.7 2 3.5 2.2-.6 2 .9L9 21h4l.6-2.3 2-.9 2.2.6 2-3.5-1.6-1.7v-2.4l1.6-1.7-2-3.5-2.2.6-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
  folder:'<path d="M3 6h6l2 2h10v11H3Z"/><path d="M3 9V5h6l2 2"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2.5M12 17h.01"/>',
  edit:'<path d="m4 16-1 5 5-1L20 8l-4-4ZM13 7l4 4"/>',
  download:'<circle cx="12" cy="12" r="10"/><path d="M12 5v13m-5-5 5 5 5-5"/>',
  video:'<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 8 6 4-6 4Z"/>',
  cancel:'<path d="m6 6 12 12M6 18 18 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
};
function svg(name) { const holder = document.createElement('span'); holder.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`; return holder.firstElementChild; }
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function iconButton(name, title, callback) { const button = element('button','icon-button'); button.title = title; button.setAttribute('aria-label',title); button.append(svg(name)); action(button,callback); return button; }
function show(id, value = true) { $(id).classList.toggle('hidden',!value); }
const fail = error => { $('error').textContent = error?.message || String(error); show('error'); };
function action(button, callback) { button.addEventListener('click',async () => { try { await callback(); } catch (e) { fail(e); } }); }
async function message(type, data = {}) {
  const response = await chrome.runtime.sendMessage({type,...data});
  if (!response?.ok) throw new Error(response?.error || '操作未完成，请重试。');
  return response;
}
let tab, state = {items:[]}, downloads = {helper:{},jobs:[]}, cards = [], showHistory = null, renderVersion = 0;
const preferences = new Map(), hiddenGroups = new Set(), pending = new Set();
const activeStatuses = new Set(['queued','starting','downloading']);
function preference(item) {
  const x = globalThis.StreamCatchX.asset(item.url);
  const resource=globalThis.StreamCatchPage.resource(item.url);
  const title = item.title || (x ? `${item.author || 'X 视频'} · ${x.id}` : resource?`YouTube 视频 · ${resource.id.slice(0,14)}`:tab?.title || state.title || '网页视频');
  if (!preferences.has(item.groupKey)) preferences.set(item.groupKey,{title,height:0});
  const pref = preferences.get(item.groupKey);
  if (!pref.renamed) pref.title = title;
  return pref;
}
function activeJob(card) { return downloads.jobs.find(job => job.groupKey === card.identity && activeStatuses.has(job.status)); }
function updateHelper() {
  const ready = downloads.helper?.ready;
  $('helper-status').classList.toggle('ready',Boolean(ready));
  $('helper-status').lastElementChild.textContent = ready ? '本地助手已连接' : downloads.helper?.status === 'missing' ? '本地助手未连接' : '正在连接助手…';
  show('helper-missing',downloads.helper?.status === 'missing');
}
async function start(item) {
  if (pending.has(item.groupKey)) return;
  pending.add(item.groupKey); updateActions(); show('error',false);
  try {
    const useCookies = $('use-cookies').checked;
    if (useCookies && !await chrome.permissions.request({permissions:['cookies']})) throw new Error('未授予登录状态权限。可在设置中关闭此选项后重试。');
    const pref = preference(item);
    await message('START_DOWNLOAD',{tabId:tab.id,groupKey:item.groupKey,url:item.url,kind:item.kind,canvasSource:item.canvasSource,sources:item.sources || [],pageUrl:tab.url,title:pref.title,maxHeight:pref.height,useCookies});
    showHistory = true; await loadDownloads();
  } finally { pending.delete(item.groupKey); updateActions(); }
}
function rename(card) {
  if (card.main.querySelector('.rename-field')) return;
  const pref = preference(card.item), input = element('input','rename-field');
  input.type='text'; input.value=pref.title; input.maxLength=150; input.setAttribute('aria-label','视频文件名');
  card.titleRow.classList.add('hidden'); card.titleRow.after(input);
  let finished=false;
  const finish = save => {
    if (finished) return; finished=true;
    if (save && input.value.trim()) { pref.title=input.value.trim(); pref.renamed=true; }
    card.title.textContent=pref.title; card.title.title=pref.title;
    input.remove(); card.titleRow.classList.remove('hidden');
  };
  input.addEventListener('keydown',event => { if (event.key==='Enter') finish(true); if (event.key==='Escape') finish(false); });
  input.addEventListener('blur',()=>finish(true)); input.focus(); input.select();
}
function updateActions() {
  for (const card of cards) {
    const job = activeJob(card), waiting = pending.has(card.item.groupKey), active = Boolean(job || waiting);
    card.download.disabled=active;
    card.download.replaceChildren(svg(active ? 'check' : 'download'),document.createTextNode(waiting ? '正在开始' : job?.status==='queued' ? '排队中' : job ? '下载中' : '下载'));
    card.quality.disabled=active; card.edit.disabled=active;
  }
  $('page-download').disabled = !httpUrl(tab?.url);
}
async function renderCards() {
  const version=++renderVersion;
  const grouped=groupMedia(state.items,state.assetMetadata).filter(item=>!hiddenGroups.has(item.groupKey));
  grouped.sort((a,b)=>Number(Boolean(b.inViewport))-Number(Boolean(a.inViewport)));
  const identities=await Promise.all(grouped.map(item=>historyGroupKey(item.groupKey)));
  if (version!==renderVersion) return;
  cards=[]; $('cards').replaceChildren(); $('count').textContent=String(grouped.length);
  show('warning',Boolean(state.drm)); $('warning').textContent='播放器报告了受保护的媒体；本地助手不支持 DRM 视频。';
  if (!grouped.length) {
    const empty=element('div','empty'); empty.append(svg('video'),element('b','', '等待视频出现'),element('span','', '播放视频后，点右上角「重新检测」。也可以直接让助手解析当前网页。')); $('cards').append(empty);
  }
  grouped.forEach((item,index)=>{
    const pref=preference(item), card={item,identity:identities[index]};
    const article=element('article','card'), thumb=element('div','thumbnail'), placeholder=svg('video'); placeholder.classList.add('placeholder-icon');thumb.append(placeholder);
    const metadata=grouped.length===1 && !globalThis.StreamCatchX.isPage(tab?.url) ? state.metadata || {} : {};
    const poster=httpUrl(item.poster || metadata.poster);
    const fallback=element('span','thumb-label',poster ? '正在加载封面' : '暂无封面'); thumb.append(fallback);
    if (poster) {
      const img=element('img'); img.alt=`视频封面：${pref.title}`; img.referrerPolicy='no-referrer'; img.loading='lazy'; img.decoding='async';
      img.addEventListener('load',()=>{placeholder.remove();fallback.remove();});
      img.addEventListener('error',()=>{img.remove();fallback.textContent='封面暂不可用';}); img.src=poster; thumb.append(img);
    }
    const duration=Number(item.duration || metadata.duration); if (Number.isFinite(duration) && duration>0) thumb.append(element('span','duration',durationText(duration)));
    card.main=element('div','card-main');card.titleRow=element('div','title-row');
    const tag=element('span','format-tag',item.kind==='page'?'VIDEO':item.kind==='file' ? fileExtension(item.url,item.mime).toUpperCase() : item.kind.toUpperCase());
    card.title=element('h2','',pref.title);card.title.title=pref.title;
    const remove=element('button','remove-source','×'); remove.title='隐藏此视频';remove.setAttribute('aria-label','隐藏此视频');action(remove,()=>{hiddenGroups.add(item.groupKey);return renderCards();});
    card.titleRow.append(tag,card.title,remove);
    const meta=element('div','card-meta');
    const source=element('span','card-source',`${item.author || new URL(item.url).hostname}${item.sources.length>1 ? ` · 已合并 ${item.sources.length} 个来源` : ''}`); source.title=source.textContent;
    meta.append(source);
    if (item.inViewport) meta.append(element('span','visible-tag','当前可见'));
    const postUrl=globalThis.StreamCatchX.postUrl(item.postUrl);
    if (postUrl) { const link=element('a','post-link','查看推文 ↗');link.href=postUrl;link.target='_blank';link.rel='noopener noreferrer';meta.append(link); }
    const actions=element('div','card-actions'); card.edit=iconButton('edit','修改文件名',()=>rename(card));card.edit.classList.add('edit-button');
    const quality=element('label','quality-control');quality.title='最高画质，默认使用最佳可用画质'; quality.append(element('span','','MP4'));
    card.quality=element('select'); card.quality.setAttribute('aria-label','最高画质');
    for (const [value,label] of [[0,'最佳画质'],[2160,'最高 4K'],[1080,'最高 1080p'],[720,'最高 720p'],[480,'最高 480p']]) card.quality.add(new Option(label,String(value)));
    card.quality.value=String(pref.height);card.quality.addEventListener('change',()=>{pref.height=Number(card.quality.value);});quality.append(card.quality);
    card.download=element('button','download-button'); action(card.download,()=>start(item));
    actions.append(card.edit,quality,card.download);card.main.append(card.titleRow,meta,actions); article.append(thumb,card.main);$('cards').append(article); cards.push(card);
  });
  updateActions();
}
function renderHistory() {
  const jobs=[...(downloads.jobs || [])].sort((a,b)=>b.created-a.created);
  const active=jobs.some(job=>activeStatuses.has(job.status));
  const visible=(showHistory ?? Boolean(jobs.length)) || active;
  show('history-section',visible);$('history-toggle').setAttribute('aria-expanded',String(visible));$('history-count').textContent=String(jobs.length);
  $('history').replaceChildren();
  if (!jobs.length) { $('history').append(element('div','history-item muted','还没有下载记录。')); return; }
  for (const job of jobs) {
    const row=element('div','history-item'),info=element('div','history-info'),title=element('div','history-title',job.title || '网页视频');title.title=job.title;
    const labels={queued:'已加入队列',starting:'正在解析视频…',downloading:'正在下载…',done:`已完成 · ${(job.files?.[0]?.match(/\.([a-z0-9]+)$/i)?.[1] || '').toUpperCase()} · 已保存到下载文件夹`,cancelled:'已取消',error:'下载失败'};
    let detail=job.status==='error' ? job.error || '下载失败，请刷新视频网页后重试。' : job.status==='downloading' ? job.progress || labels.downloading : labels[job.status] || job.status;
    const status=element('div',`history-message ${job.status}`,detail);info.append(title,status);
    if (activeStatuses.has(job.status)) { const progress=element('progress');progress.max=100;if (Number.isFinite(job.percent)) progress.value=job.percent;info.append(progress); }
    const actions=element('div','history-actions');
    if (activeStatuses.has(job.status)) actions.append(iconButton('cancel','取消下载',()=>message('CANCEL_DOWNLOAD',{id:job.id})));
    else {
      if (job.status==='done' && job.files?.length) actions.append(iconButton('folder','在 Finder 中显示',()=>message('REVEAL_DOWNLOAD',{id:job.id})));
      actions.append(iconButton('trash','移除此条记录（保留文件）',()=>message('REMOVE_DOWNLOAD',{id:job.id})));
    }
    row.append(info,actions);$('history').append(row);
  }
}
async function loadDownloads() { downloads=(await chrome.storage.local.get('downloadState')).downloadState || {helper:{},jobs:[]}; downloads.jobs ||= [];updateHelper();updateActions();renderHistory(); }
async function loadPage() {
  if (!tab) return;
  state=(await chrome.storage.session.get(`tab:${tab.id}`))[`tab:${tab.id}`] || {items:[]}; await renderCards();
}
async function scan(reset = true) {
  if (!httpUrl(tab?.url)) throw new Error('请先打开一个视频网页。');
  hiddenGroups.clear();
  if(reset)await message('RESCAN',{tabId:tab.id}).catch(()=>{});
  await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['core/x-media.js','core/page-media.js','content.js']}).catch(()=>{});
  await chrome.tabs.sendMessage(tab.id,{type:'SCAN'}).catch(()=>{});
  await message('CANVAS_REFRESH',{tabId:tab.id}).catch(()=>{});
  await loadPage();
}
for (const [id,name] of [['settings','gear'],['history-toggle','history'],['downloads','folder'],['clear','trash'],['help','help']]) $(id).append(svg(name));
action($('scan'),scan);
action($('settings'),()=>{const expanded=$('settings').getAttribute('aria-expanded')!=='true';$('settings').setAttribute('aria-expanded',String(expanded));show('settings-panel',expanded);if(expanded)$('settings-panel').scrollIntoView({block:'nearest'});});
action($('history-toggle'),()=>{showHistory=$('history-toggle').getAttribute('aria-expanded')!=='true';renderHistory();if(showHistory)$('history-section').scrollIntoView({block:'nearest'});});
action($('downloads'),()=>message('OPEN_DOWNLOADS'));
action($('clear'),async()=>{await message('CLEAR',{tabId:tab.id});hiddenGroups.clear();await loadPage();});
action($('help'),()=>chrome.runtime.openOptionsPage());
action($('install-help'),()=>chrome.runtime.openOptionsPage());
action($('reconnect'),async()=>{await message('NATIVE_STATUS');await loadDownloads();});
action($('page-download'),()=>start({url:tab.url,kind:'page',groupKey:`page:${tab.url}`,sources:[]}));
$('use-cookies').addEventListener('change',()=>chrome.storage.local.set({popupUseCookies:$('use-cookies').checked}));
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local' && changes.downloadState) loadDownloads().catch(fail);
  if(area==='session' && changes[`tab:${tab?.id}`]) loadPage().catch(fail);
});
try {
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  $('site').textContent=httpUrl(tab?.url) ? new URL(tab.url).hostname : '请先打开一个视频网页';
  $('scan').disabled=!httpUrl(tab?.url);$('clear').disabled=!httpUrl(tab?.url);
  $('use-cookies').checked=Boolean((await chrome.storage.local.get('popupUseCookies')).popupUseCookies);
  await Promise.all([loadPage(),loadDownloads()]);
  message('NATIVE_STATUS').then(loadDownloads).catch(fail);
  if(httpUrl(tab?.url)) await scan(false);
} catch(e) { fail(e); }
