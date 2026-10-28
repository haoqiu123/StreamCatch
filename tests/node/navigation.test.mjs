import test from 'node:test';
import assert from 'node:assert/strict';
const events={},event=name=>({addListener(fn){events[name]=fn;}}),session={};let scans=0;
globalThis.chrome={storage:{local:{get:async()=>({}),set:async()=>{}},session:{get:async key=>key?{[key]:session[key]}:session,set:async value=>Object.assign(session,value),remove:async()=>{}}},
 action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},runtime:{id:'fixture',onInstalled:event('installed'),onMessage:event('message'),getURL:p=>'chrome-extension://fixture/'+p},
 webRequest:{onHeadersReceived:event('headers')},webNavigation:{onCommitted:event('committed'),onHistoryStateUpdated:event('history')},tabs:{onRemoved:event('removed'),sendMessage:async()=>{scans++;}}};
await import('../../extension/background.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('YouTube/Bilibili SPA changes clear stale resources and request a fresh scan',async()=>{
 for(const [before,after]of [['https://www.youtube.com/watch?v=AAAAAAAAAAA','https://www.youtube.com/watch?v=BBBBBBBBBBB'],['https://www.bilibili.com/video/BV1AfJD6eE3W/','https://www.bilibili.com/en/video/BV1AfJD6eE3W/?p=2']]){
  session['tab:1']={pageUrl:before,items:[{url:'https://cdn.test/old.mp4',kind:'file'}]};const count=scans;
  events.history({tabId:1,frameId:0,url:after});await tick();assert.equal(session['tab:1'].items.length,0);assert.equal(session['tab:1'].pageUrl,after);assert.equal(scans,count+1);
 }
});
test('tracking updates on the same watch video preserve current resources',async()=>{
 const url='https://www.youtube.com/watch?v=AAAAAAAAAAA';session['tab:2']={pageUrl:url,items:[{url:'https://cdn.test/current.mp4'}]};
 events.history({tabId:2,frameId:0,url:url+'&t=30'});await tick();assert.equal(session['tab:2'].items.length,1);
});
test('explicit rescan drops old sources while preserving a known DRM signal',async()=>{
 session['tab:3']={pageUrl:'https://example.test/',items:[{url:'https://cdn.test/old.mp4'}],drm:true};
 const response=await new Promise(resolve=>events.message({type:'RESCAN',tabId:3},{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve));
 assert(response.ok);assert.equal(session['tab:3'].items.length,0);assert.equal(session['tab:3'].drm,true);
});
