import {httpUrl, classify} from './media.js';
const redirects=new Map();

// Canvas's authenticated player URLs are wrappers, not downloadable MP4s.
// These routes are defined by Canvas's MediaObjectsController.
export function canvasAsset(value) {
  const valid = httpUrl(value);
  if (!valid) return null;
  const u = new URL(valid);
  if (!u.hostname.endsWith('.instructure.com')) return null;
  const match = u.pathname.match(/^\/(media_attachments|media_objects)(?:_iframe)?\/([a-zA-Z0-9_-]+)(?:\/(?:info|redirect|thumbnail))?\/?$/);
  if (!match || (match[1] === 'media_attachments' && !/^\d+$/.test(match[2]))) return null;
  const base = `${u.origin}/${match[1]}/${match[2]}`;
  return {key:`canvas:${u.hostname}:${match[1]}:${match[2]}`,infoUrl:base+'/info',poster:base+'/thumbnail'};
}

export function canvasSource(item) {
  return canvasAsset(item?.canvasSource) || canvasAsset(item?.url);
}

// Signed queries stay intact for downloads. The exact origin/path lets a
// refreshed representation annotate an older network observation safely.
export function canvasTarget(value) {
  const valid = httpUrl(value);
  if (!valid) return null;
  const u = new URL(valid);
  return u.origin + u.pathname;
}

export function observeCanvasRedirect(details) {
  if (details.tabId<0 || details.statusCode<300 || details.statusCode>=400 || !canvasAsset(details.url)) return;
  const location=details.responseHeaders?.find(header=>header.name.toLowerCase()==='location')?.value;
  const target=httpUrl(location,details.url);
  if (!target) return;
  const key=`${details.tabId}:${details.url}`;
  redirects.set(key,target);
  if (redirects.size>200) redirects.delete(redirects.keys().next().value);
}

// A service-worker fetch cannot rely on Canvas's SameSite login cookie. Run
// Canvas's own GETs in the already-open Canvas document; no Cookie is read or
// exported. CDN requests use the extension's existing host access instead.
export function canvasBrowserFetcher(api, tabId, value) {
  const asset=canvasAsset(value), origin=asset && new URL(asset.infoUrl).origin;
  return async (url, options) => {
    if (!origin || !Number.isInteger(tabId)) throw new Error('请保持原 Canvas 标签页打开，再重新检测视频。');
    if (new URL(url).origin !== origin) return fetch(url,{...options,credentials:'omit'});
    const redirect=/\/redirect$/.test(new URL(url).pathname), key=`${tabId}:${url}`;
    redirects.delete(key);
    const frames=await api.scripting.executeScript({target:{tabId},args:[{url,origin,redirect}],func:async ({url,origin,redirect})=>{
      if (location.origin !== origin) return {error:'原 Canvas 页面已改变，请重新打开视频网页。'};
      try {
        const response=await fetch(url,{credentials:'same-origin',redirect:redirect ? 'manual' : 'follow',cache:'no-store',signal:AbortSignal.timeout(20000)});
        const mime=response.headers.get('content-type') || '';
        const result={url:response.url,status:response.status,mime};
        if (response.ok && /json/i.test(mime)) result.data=await response.json();
        else await response.body?.cancel().catch(()=>{});
        return result;
      } catch { return {error:'Canvas 请求未完成，请在原网页重新播放视频后再试。'}; }
    }});
    const result=frames[0]?.result;
    // Canvas GETs keep the normal page session. The extension's already-
    // granted webRequest access observes Location; the CDN is then read by
    // the extension without forwarding Canvas's cookies or page credentials.
    const target=redirects.get(key); redirects.delete(key);
    if (redirect && target) return fetch(target,{...options,credentials:'omit'});
    if (!result || result.error) throw new Error(result?.error || 'Canvas 页面未响应，请重新检测。');
    return {url:result.url,status:result.status,ok:result.status>=200 && result.status<300,
      headers:new Headers({'content-type':result.mime}),json:async()=>result.data};
  };
}

export const MAX_CANVAS_MANIFEST_BYTES = 256 * 1024;
async function readManifest(response) {
  if (Number(response.headers.get('content-length')) > MAX_CANVAS_MANIFEST_BYTES) throw new Error('Canvas 播放清单过大，未交给助手。');
  const reader=response.body?.getReader();
  if (!reader) throw new Error('Canvas 播放清单未能读取，请重新检测。');
  const chunks=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done) break;
      size+=value.byteLength;
      if(size>MAX_CANVAS_MANIFEST_BYTES) throw new Error('Canvas 播放清单过大，未交给助手。');
      chunks.push(value);
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

export async function resolveCanvasMedia(value, {fetcher = fetch, maxHeight = 0, includeManifest = false} = {}) {
  const asset = canvasAsset(value);
  if (!asset) throw new Error('Canvas 视频入口无效，请重新检测。');
  const request = url => fetcher(url,{credentials:'include',cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(20000)});
  const response = await request(asset.infoUrl);
  if (!response.ok) throw new Error(`Canvas 媒体信息 HTTP ${response.status}：请在原网页确认登录并重新播放。`);
  if (!response.headers.get('content-type')?.includes('json')) throw new Error('Canvas 返回了登录或验证页面，请回原网页完成后重新检测。');
  const data = await response.json();
  const sources = (Array.isArray(data.media_sources) ? data.media_sources : []).slice(0,30)
    .map(source => ({...source,url:httpUrl(source.url || source.src)})).filter(source => source.url)
    // Canvas may describe a whole DASH master as "1080p MP4". Prefer an
    // explicitly suitable file, but let a master provide lower qualities.
    .sort((a,b)=>Number(Boolean(maxHeight && Number(a.height)>maxHeight))-Number(Boolean(maxHeight && Number(b.height)>maxHeight))
      || Number(b.height || 0)-Number(a.height || 0) || Number(b.bitrate || 0)-Number(a.bitrate || 0));
  if (!sources.length) throw new Error('Canvas 没有返回所选画质的可下载媒体，请播放视频后重新检测。');
  let failure;
  for (const source of sources.slice(0,3)) {
    try {
      const media = await request(source.url);
      try {
        if (!media.ok) throw new Error(`Canvas 视频入口 HTTP ${media.status}：请回原网页重新播放后再试。`);
        const url = httpUrl(media.url), mime = media.headers.get('content-type') || '';
        if (/html|json/i.test(mime)) throw new Error('Canvas 视频入口返回了网页或验证页面，未交给下载助手。');
        const kind = classify(url,mime);
        if (!url || !kind || canvasAsset(url)) throw new Error('Canvas 没有返回有效的媒体地址，请重新播放视频。');
        if (kind==='file' && maxHeight && Number(source.height)>maxHeight) throw new Error('Canvas 没有返回所选画质的可下载文件。');
        const dashManifest=includeManifest && kind==='dash' ? await readManifest(media) : undefined;
        return {url,kind,mime,height:Number(source.height) || 0,canvasSource:asset.infoUrl,canvasResolved:true,
          ...(dashManifest !== undefined ? {dashManifest} : {}),
          poster:httpUrl(data.poster_url || data.thumbnail_url) || asset.poster,
          title:String(data.title || '').slice(0,250),source:'Canvas 播放器',time:Date.now()};
      } finally { await media.body?.cancel().catch(()=>{}); }
    } catch (error) { failure=error; }
  }
  throw failure || new Error('Canvas 视频入口暂不可用，请重新检测。');
}
