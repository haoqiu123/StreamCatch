import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownloadManager,historyGroupKey,publicPageUrl} from '../../extension/core/download-manager.js';

const oldMaster = 'https://www.kaltura.com/p/123/playManifest/entryId/1_video/format/applehttp/ks/OLD_SECRET';
const freshMaster = oldMaster.replace('OLD_SECRET','NEW_SECRET');
const pageUrl = 'https://example.edu/media/course/1_video';
const file = '/Users/test/Downloads/StreamCatch/course.mp4';
const sender = {id:'test-extension',url:'chrome-extension://test-extension/popup.html'};
const request = (extra = {}) => ({type:'START_DOWNLOAD',payload:{tabId:1,groupKey:'kaltura:123:1_video',url:oldMaster,pageUrl,title:'Course video',kind:'hls',maxHeight:1080,useCookies:false,...extra}});
const copy = value => structuredClone(value);
const tick = () => new Promise(resolve => setTimeout(resolve,0));
async function until(check) { for (let i=0;i<150;i++) { if (check()) return; await tick(); } assert.fail('Expected asynchronous state did not settle'); }
function event() { const listeners=[]; return {addListener(fn){listeners.push(fn);},emit(value){for(const fn of listeners) fn(value);}}; }
function fakeChrome({local = {},session = {},autoStatus = true} = {}) {
  const ports = [], writes = [];
  function storage(initial,name) {
    const data = copy(initial);
    return {data,async get(key){if(key === null) return copy(data);return {[key]:copy(data[key])};},
      async set(items){Object.assign(data,copy(items));writes.push({name,items:copy(items)});},
      async remove(keys){for(const key of Array.isArray(keys)?keys:[keys]) delete data[key];}};
  }
  const api = {
    runtime:{id:'test-extension',getURL:path => `chrome-extension://test-extension/${path}`,lastError:null,
      connectNative(name){
        assert.equal(name,'com.streamcatch.helper');
        const port = {onMessage:event(),onDisconnect:event(),messages:[],disconnected:false,
          postMessage(message){if(this.disconnected) throw new Error('Port disconnected');this.messages.push(copy(message));
            if (autoStatus && message.cmd === 'status') queueMicrotask(() => this.onMessage.emit({type:'status',ytdlp:true,ffmpeg:true}));
            if (message.cmd === 'revealFile') queueMicrotask(() => this.onMessage.emit({type:'revealed',command:'revealFile',path:message.path}));
            if (message.cmd === 'openDownloads') queueMicrotask(() => this.onMessage.emit({type:'opened',command:'openDownloads'}));
          },disconnect(){if(this.disconnected)return;this.disconnected=true;this.onDisconnect.emit();},
          receive(message){this.onMessage.emit(message);}};
        ports.push(port); return port;
      }},
    storage:{local:storage(local,'local'),session:storage(session,'session')},
    tabs:{async get(id){return {id,url:pageUrl};}},
    permissions:{async contains(){return false;}},
    cookies:{async getAll(){return [];}}
  };
  return {api,ports,writes,state:() => api.storage.local.data.downloadState};
}
async function setup(options) {
  const context = fakeChrome(options);
  context.manager = createDownloadManager(context.api,{statusTimeout:50,cancelTimeout:30,progressInterval:10});
  await context.manager.ready;
  context.send = message => context.manager.handle(message,sender);
  context.downloadPorts = () => context.ports.filter(port => port.messages.some(message => message.cmd === 'download'));
  return context;
}

test('worker owns native port: download continues after the popup response and no UI port is needed',async () => {
  const c = await setup();
  const started = await c.send(request());
  assert.equal(started.ok,true);
  await until(() => c.downloadPorts().length === 1);
  const port = c.downloadPorts()[0];
  // The popup has no connection to retain or disconnect. Its one-off request
  // has already returned; progress and completion continue in the worker.
  port.receive({type:'progress',text:'42.5% · 4 MB/s · ETA 00:03'});
  await until(() => c.state().jobs[0].percent === 42.5);
  port.receive({type:'done',files:[file]});
  await until(() => c.state().jobs[0].status === 'done');
  assert.equal(c.state().jobs[0].percent,100);
  assert.equal(port.disconnected,true);
  assert.equal(c.api.storage.session.data['native-job:' + started.jobId],undefined);
});

test('queue is serial and concurrent duplicate clicks share one active job',async () => {
  const c = await setup();
  const [a,b] = await Promise.all([c.send(request()),c.send(request())]);
  assert.equal(a.jobId,b.jobId); assert.equal(b.duplicate,true);
  const second = await c.send(request({url:oldMaster.replace('1_video','1_second')}));
  await until(() => c.downloadPorts().length === 1);
  assert.equal(c.state().jobs.find(job => job.id === second.jobId).status,'queued');
  const firstPort = c.downloadPorts()[0];
  firstPort.receive({type:'done',files:[file]});
  await until(() => c.downloadPorts().length === 2);
  const secondPort = c.downloadPorts()[1];
  assert.notEqual(firstPort,secondPort); assert.equal(firstPort.disconnected,true);
  secondPort.receive({type:'done',files:[file]});
  await until(() => c.state().jobs.every(job => job.status === 'done'));
});

test('queued cancellation never starts a native download, active cancellation sends cancel',async () => {
  const c = await setup();
  const first = await c.send(request());
  await until(() => c.downloadPorts().length === 1);
  const queued = await c.send(request({url:oldMaster.replace('1_video','1_second')}));
  await c.send({type:'CANCEL_DOWNLOAD',id:queued.jobId});
  assert.equal(c.state().jobs.find(job => job.id === queued.jobId).status,'cancelled');
  await c.send({type:'CANCEL_DOWNLOAD',id:first.jobId});
  const port = c.downloadPorts()[0];
  assert(port.messages.some(message => message.cmd === 'cancel'));
  port.receive({type:'cancelled'});
  await until(() => c.state().jobs.every(job => job.status === 'cancelled'));
  assert.equal(c.downloadPorts().length,1);
  assert.deepEqual(Object.keys(c.api.storage.session.data).filter(key => key.startsWith('native-job:')),[]);
});

test('cancel before helper handshake disconnects without sending download',async () => {
  const c = await setup({autoStatus:false});
  const job = await c.send(request());
  await until(() => c.ports.length === 1);
  await c.send({type:'CANCEL_DOWNLOAD',id:job.jobId});
  c.ports[0].receive({type:'status',ytdlp:true,ffmpeg:true});
  assert.equal(c.state().jobs[0].status,'cancelled');
  assert.equal(c.downloadPorts().length,0);
});

test('refresh uses newest complete source on the actual original tab and never an individual track',async () => {
  const leaf = 'https://cfvod.kaltura.com/serveFlavor/p/123/entryId/1_video/flavorId/1_audio/a.m3u8';
  const c = await setup({session:{'tab:1':{pageUrl,items:[{url:freshMaster,kind:'hls',time:2},{url:leaf,kind:'hls',time:3}]}}});
  await c.send(request()); await until(() => c.downloadPorts().length === 1);
  assert.equal(c.downloadPorts()[0].messages.find(message => message.cmd === 'download').url,freshMaster);
  c.downloadPorts()[0].receive({type:'done',files:[file]});
  await until(() => c.state().jobs[0].status === 'done');
});

test('a reused tab does not lend its captured credentials to an older page job',async () => {
  const c = await setup({session:{'tab:1':{pageUrl,items:[{url:freshMaster,kind:'hls',time:2}]}}});
  c.api.tabs.get = async id => ({id,url:'https://example.edu/different'});
  await c.send(request()); await until(() => c.downloadPorts().length === 1);
  assert.equal(c.downloadPorts()[0].messages.find(message => message.cmd === 'download').url,oldMaster);
  c.downloadPorts()[0].receive({type:'done',files:[file]});
  await until(() => c.state().jobs[0].status === 'done');
});

test('local history and logs never persist signed media URLs or cookie credentials',async () => {
  const url = 'https://cdn.example.edu/v.mp4?token=PRIVATE_MEDIA_SECRET';
  const c = await setup();
  c.api.permissions.contains = async () => true;
  c.api.cookies.getAll = async () => [{domain:'example.edu',path:'/',name:'session',value:'COOKIE_SECRET'}];
  await c.send(request({url,kind:'file',groupKey:url,pageUrl:pageUrl+'?token=PAGE_SECRET',useCookies:true}));
  await until(() => c.downloadPorts().length === 1);
  const port = c.downloadPorts()[0];
  assert.equal(port.messages.find(message => message.cmd === 'download').cookies[0].value,'COOKIE_SECRET');
  port.receive({type:'error',error:`ERROR fetching ${url} token=ANOTHER_SECRET`});
  await until(() => c.state().jobs[0].status === 'error');
  const local = JSON.stringify(c.writes.filter(write => write.name === 'local'));
  for (const secret of ['PRIVATE_MEDIA_SECRET','COOKIE_SECRET','PAGE_SECRET','ANOTHER_SECRET']) assert(!local.includes(secret));
  assert.match(c.state().jobs[0].groupKey,/^media:[a-f0-9]{64}$/);
});

test('cookie opt-in requires previously granted permission and does not request permission from the worker',async () => {
  const c = await setup();
  c.api.cookies.getAll = async () => assert.fail('Must not read ungranted cookies');
  await c.send(request({useCookies:true}));
  await until(() => c.state().jobs[0].status === 'error');
  assert.match(c.state().jobs[0].error,/允许使用当前登录状态/);
  assert.equal(c.ports.length,0);
});

test('untrusted content scripts and invalid quality cannot start native processes',async () => {
  const c = await setup();
  const result = await c.manager.handle(request(),{id:sender.id,url:pageUrl,tab:{id:1}});
  assert.equal(result.ok,false);
  assert.equal((await c.send(request({maxHeight:999}))).ok,false);
  assert.equal((await c.send(request({url:'file:///etc/passwd'}))).ok,false);
  assert.equal(c.ports.length,0);
  assert.equal(c.state().jobs.length,0);
});

test('worker restart marks unfinished work interrupted and removes all temporary payloads',async () => {
  const c = await setup({local:{downloadState:{jobs:[{id:'old',groupKey:oldMaster,pageUrl,title:'Course',status:'downloading',created:1,percent:30,files:[]},{id:'queued',groupKey:'other',pageUrl,title:'Other',status:'queued',created:2}]}},session:{'native-job:old':{url:oldMaster},'native-job:queued':{url:freshMaster},'tab:1':{pageUrl,items:[]}}});
  assert.equal(c.ports.length,0);
  assert(c.state().jobs.every(job => job.status === 'error' && /重启/.test(job.error)));
  assert.deepEqual(Object.keys(c.api.storage.session.data),['tab:1']);
  assert(!JSON.stringify(c.state()).includes('OLD_SECRET'));
});

test('native disconnect is an explicit error, does not claim success, and advances the queue',async () => {
  const c = await setup();
  const first = await c.send(request());
  await c.send(request({url:oldMaster.replace('1_video','1_second')}));
  await until(() => c.downloadPorts().length === 1);
  c.downloadPorts()[0].disconnect();
  await until(() => c.downloadPorts().length === 2);
  assert.equal(c.state().jobs.find(job => job.id === first.jobId).status,'error');
  c.downloadPorts()[1].receive({type:'done',files:[file]});
  await until(() => c.state().jobs.some(job => job.status === 'done'));
});

test('status checks disconnect idle ports; folder and reveal use separate command ports',async () => {
  const c = await setup();
  assert.equal((await c.send({type:'NATIVE_STATUS'})).ok,true);
  assert.equal(c.state().helper.ready,true); assert.equal(c.ports[0].disconnected,true);
  const job = await c.send(request()); await until(() => c.downloadPorts().length === 1);
  c.downloadPorts()[0].receive({type:'done',files:[file]}); await until(() => c.state().jobs[0].status === 'done');
  assert.equal((await c.send({type:'REVEAL_DOWNLOAD',id:job.jobId})).ok,true);
  assert.equal((await c.send({type:'OPEN_DOWNLOADS'})).ok,true);
  assert.equal(c.ports.at(-2).messages[0].cmd,'revealFile');
  assert.equal(c.ports.at(-1).messages[0].cmd,'openDownloads');
  assert(c.ports.every(port => port.disconnected));
});

test('history removal cannot remove active work, clear preserves active jobs, and only thirty records remain',async () => {
  const jobs = Array.from({length:35},(_,i) => ({id:String(i),groupKey:'media:'+'a'.repeat(64),pageUrl,title:'Old',status:'done',files:[file],created:i+1}));
  const c = await setup({local:{downloadState:{jobs}}});
  assert.equal(c.state().jobs.length,30);
  const started = await c.send(request()); await until(() => c.downloadPorts().length === 1);
  assert.equal((await c.send({type:'REMOVE_DOWNLOAD',id:started.jobId})).ok,false);
  await c.send({type:'CLEAR_HISTORY'});
  assert.equal(c.state().jobs.length,1);
  c.downloadPorts()[0].receive({type:'done',files:[file]}); await until(() => c.state().jobs[0].status === 'done');
  await c.send({type:'REMOVE_DOWNLOAD',id:started.jobId});
  assert.equal(c.state().jobs.length,0);
});

test('identity helpers are stable and remove signed query parameters from history',async () => {
  assert.equal(await historyGroupKey('kaltura:123:1_video'),'kaltura:123:1_video');
  const hash = await historyGroupKey('https://cdn.example.edu/a?token=secret');
  assert.equal(await historyGroupKey(hash),hash);
  assert.equal(publicPageUrl('https://site.example/course?token=secret#player'),'https://site.example/course');
  assert(!publicPageUrl(oldMaster).includes('OLD_SECRET'));
});
test('normal request context is bound to the exact live media URL and does not export credentials',async()=>{
 const page='https://onlyfans.com/fixture-post',url='https://cdn3.onlyfans.com/fixture-video.mp4?signature=FAKE';
 const c=await setup({session:{'tab:1':{pageUrl:page,items:[{url,kind:'file',requestContext:{referer:page,origin:'https://onlyfans.com',userAgent:'Site-specific browser UA',Cookie:'DO_NOT_EXPORT',Authorization:'DO_NOT_EXPORT'}}]}}});
 c.api.tabs.get=async id=>({id,url:page});
 await c.send(request({url,pageUrl:page,kind:'file'}));await until(()=>c.downloadPorts().length===1);
 const port=c.downloadPorts()[0],call=port.messages.find(m=>m.cmd==='download');
 assert.equal(call.requestHeaders.userAgent,'Site-specific browser UA');assert.equal(call.requestHeaders.referer,page);
 assert.equal(call.requestHeaders.Cookie,undefined);assert.equal(call.requestHeaders.Authorization,undefined);assert.deepEqual(call.cookies,[]);
 assert(!JSON.stringify(c.writes.filter(w=>w.name==='local')).includes('Site-specific browser UA'));
 port.receive({type:'done',files:[file]});await until(()=>c.state().jobs[0].status==='done');
});
