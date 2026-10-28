import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasAsset,resolveCanvasMedia,MAX_CANVAS_MANIFEST_BYTES} from '../../extension/core/canvas-media.js';
import {groupMedia} from '../../extension/core/grouping.js';
const iframe='https://rutgers.instructure.com/media_attachments_iframe/123?embedded=true&type=video';
const redirect='https://rutgers.instructure.com/media_attachments/123/redirect?bitrate=44';
const asset=canvasAsset(iframe), info=asset.infoUrl;
const cdn='https://nv.instructuremedia.com/media/fixture-123/manifest.mpd?token=FAKE';
const response=(url,mime,data,status=200)=>({url,ok:status>=200&&status<300,status,headers:new Headers({'content-type':mime}),json:async()=>data,body:{cancel:async()=>{}}});
test('Canvas embed, metadata and redirect share a tenant-scoped asset',()=>{
 assert.equal(canvasAsset(redirect).key,asset.key);assert.equal(canvasAsset(info).key,asset.key);
 assert.notEqual(canvasAsset(iframe.replace('/123?','/124?')).key,asset.key);
 assert.notEqual(canvasAsset(iframe.replace('rutgers.','other.')).key,asset.key);
 assert.equal(canvasAsset('https://rutgers.instructure.com.evil.example/media_attachments/123/info'),null);
 assert.equal(canvasAsset('https://rutgers.instructure.com/media_attachments/not-a-number/info'),null);
});
test('Canvas signed manifests, wrapper and renewals are one card with combined metadata',()=>{
 const groups=groupMedia([{url:cdn,kind:'dash',canvasSource:info}, {url:redirect,kind:'file',duration:598.3}, {url:cdn.replace('FAKE','NEW_FAKE'),kind:'dash',canvasSource:info,canvasResolved:true,title:'Actual video',poster:asset.poster}]);
 assert.equal(groups.length,1);assert.equal(groups[0].kind,'dash');assert.equal(groups[0].url,cdn.replace('FAKE','NEW_FAKE'));
 assert.equal(groups[0].duration,598.3);assert.equal(groups[0].title,'Actual video');assert.equal(groups[0].canvasSource,info);assert.equal(groups[0].sources.length,3);
 assert.equal(groupMedia([{url:cdn,kind:'dash'},{url:cdn.replace('123','999'),kind:'dash'}]).length,2,'unrelated CDN URLs are never merged by hostname/title');
});
test('Canvas resolution uses browser credentials and the final response MIME, not misleading source metadata',async()=>{
 const calls=[];
 const item=await resolveCanvasMedia(iframe,{fetcher:async(url,options)=>{calls.push([url,options]);return url===info ? response(info,'application/json',{title:'Financial Planning',media_sources:[{url:redirect,content_type:'video/mp4',height:'1080'}]}) : response(cdn,'application/dash+xml');}});
 assert.equal(item.url,cdn);assert.equal(item.kind,'dash');assert.equal(item.canvasSource,info);assert.equal(item.height,1080);
 assert.equal(item.title,'Financial Planning');assert.equal(item.poster,asset.poster);
 for(const [,opts]of calls){assert.equal(opts.credentials,'include');assert.equal(opts.cache,'no-store');assert.equal(opts.redirect,'follow');}
});
test('Canvas resolution keeps the requested quality upper bound',async()=>{
 const calls=[];
 const result=await resolveCanvasMedia(info,{maxHeight:720,fetcher:async url=>{calls.push(url);return url===info ? response(info,'application/json',{media_sources:[{url:redirect+'&quality=1080',height:'1080'},{url:redirect+'&quality=720',height:'720'}]}) : response(cdn.replace('manifest.mpd','720.mp4'),'video/mp4');}});
 assert.equal(result.kind,'file');assert.equal(result.height,720);assert(calls[1].includes('quality=720'));
});
test('Canvas login/challenge pages and expired redirects never become media URLs',async()=>{
 await assert.rejects(resolveCanvasMedia(info,{fetcher:async()=>response(info,'text/html',null,403)}),/HTTP 403/);
 await assert.rejects(resolveCanvasMedia(info,{fetcher:async()=>response(info,'text/html')}),/登录或验证/);
 await assert.rejects(resolveCanvasMedia(info,{fetcher:async url=>url===info ? response(info,'application/json',{media_sources:[{url:redirect}]}) : response(cdn,'text/html')}),/返回了网页或验证/);
 await assert.rejects(resolveCanvasMedia(info,{fetcher:async url=>url===info ? response(info,'application/json',{media_sources:[{url:redirect}]}) : response(cdn,'text/plain',null,410)}),/HTTP 410/);
});
test('Canvas resolves a new signed URL for each download attempt',async()=>{
 let token=0;
 const fetcher=async url=>url===info ? response(info,'application/json',{media_sources:[{url:redirect}]}) : response(cdn.replace('FAKE',`FAKE_${++token}`),'application/dash+xml');
 const first=await resolveCanvasMedia(info,{fetcher}),second=await resolveCanvasMedia(info,{fetcher});
 assert.notEqual(first.url,second.url);assert.equal(first.canvasSource,second.canvasSource);
});
test('Canvas master described as 1080p can still supply a requested 720p stream',async()=>{
 const fetcher=async url=>url===info ? response(info,'application/json',{media_sources:[{url:redirect,height:'1080'}]}) : response(cdn,'application/dash+xml');
 assert.equal((await resolveCanvasMedia(info,{maxHeight:720,fetcher})).kind,'dash');
 await assert.rejects(resolveCanvasMedia(info,{maxHeight:720,fetcher:async url=>url===info ? response(info,'application/json',{media_sources:[{url:redirect,height:'1080'}]}) : response(cdn.replace('manifest.mpd','1080.mp4'),'video/mp4')}),/所选画质/);
});
test('DASH bytes are passed only during download, with a strict byte limit',async()=>{
 const xml='<MPD>browser-authorized bytes</MPD>';
 const fetcher=async url=>{
  if(url===info)return response(info,'application/json',{media_sources:[{url:redirect}]});
  const r=new Response(xml,{headers:{'content-type':'application/dash+xml'}});Object.defineProperty(r,'url',{value:cdn});return r;
 };
 assert.equal((await resolveCanvasMedia(info,{fetcher})).dashManifest,undefined);
 assert.equal((await resolveCanvasMedia(info,{fetcher,includeManifest:true})).dashManifest,xml);
 let cancelled=false;
 const huge=async url=>{
  if(url===info)return response(info,'application/json',{media_sources:[{url:redirect}]});
  const r=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_CANVAS_MANIFEST_BYTES+1));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/dash+xml'}});
  Object.defineProperty(r,'url',{value:cdn});return r;
 };
 await assert.rejects(resolveCanvasMedia(info,{fetcher:huge,includeManifest:true}),/过大/);assert(cancelled);
});
