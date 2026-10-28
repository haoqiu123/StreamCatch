import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaylist, attributes, sequenceIV, parseIV, downloadHls} from '../../extension/core/hls.js';
import {classify, httpUrl, safeFilename} from '../../extension/core/media.js';
const base='https://video.example.test/path/index.m3u8?token=secret';
test('detect extensionless responses; reject partial chunks and non-http addresses',()=>{
  assert.equal(classify('https://v.test/manifest','application/vnd.apple.mpegurl'),'hls');
  assert.equal(classify('https://v.test/get','video/mp4'),'file');
  assert.equal(classify('https://v.test/a.mpd'),'dash');
  assert.equal(classify('https://v.test/chunk.ts','video/mp2t'),null);
  assert.equal(classify('https://v.test/chunk.m4s','video/mp4'),null);
  assert.equal(httpUrl('javascript:alert(1)'),null);
  assert.equal(httpUrl('https://user:secret@site.com/video.mp4'),null);
});
test('safe Unicode filenames cannot escape the download directory',()=>{
  assert.match(safeFilename('../../课程:第一课.mp4','ts'), /^_+课程_第一课\.ts$/);
  assert.equal(safeFilename('CON','mp4'),'video_CON.mp4');
});
test('master playlist preserves codec commas, signed queries, and separate audio',()=>{
  const p=parsePlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",URI="audio.m3u8?x=1"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42e01e,mp4a.40.2",AUDIO="a"\nlo.m3u8?x=2\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080\n/hi.m3u8',base);
  assert.equal(p.variants[0].height,1080);
  assert.equal(p.variants[1].codecs,'avc1.42e01e,mp4a.40.2');
  assert.equal(p.variants[1].url,'https://video.example.test/path/lo.m3u8?x=2');
  assert.equal(p.audio[0].url,'https://video.example.test/path/audio.m3u8?x=1');
});
test('byte ranges, init maps, duration, and media sequence',()=>{
  const p=parsePlaylist('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9007199254740000\n#EXT-X-MAP:URI="all.mp4",BYTERANGE="10@0"\n#EXTINF:2.5,\n#EXT-X-BYTERANGE:20@10\nall.mp4\n#EXTINF:3,\n#EXT-X-BYTERANGE:30\nall.mp4\n#EXT-X-ENDLIST',base);
  assert.equal(p.segments[1].range.start,30);
  assert.equal(p.segments[1].range.end,59);
  assert.equal(p.segments[0].sequence,9007199254740000);
  assert.equal(p.duration,5.5); assert.equal(p.extension,'mp4'); assert.equal(p.live,false);
});
test('fail closed on missing range offsets and unsupported features',()=>{
  assert.throws(()=>parsePlaylist('#EXTM3U\n#EXT-X-BYTERANGE:20\na.ts',base),/起始/);
  assert.throws(()=>parsePlaylist('#EXTM3U\n#EXT-X-BYTERANGE:20@0\na.ts\n#EXT-X-BYTERANGE:20\nb.ts',base),/起始/);
  assert.throws(()=>parsePlaylist('<html>login</html>',base),/登录/);
  const drm=parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"\na.ts\n#EXT-X-ENDLIST',base);
  assert.match(drm.issues[0],/DRM/);
  assert.match(parsePlaylist('#EXTM3U\n#EXT-X-DISCONTINUITY\na.ts',base).issues[0],/时间轴/);
});
test('AES sequence IV supports numbers above 32 bits',()=>{
  assert.deepEqual(sequenceIV(4294967297),parseIV('0x100000001'));
  assert.throws(()=>parseIV('0xnothex'));
});
test('real AES-CBC decryption and ordered writes',async t=>{
  const raw=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',raw,'AES-CBC',false,['encrypt']);
  const plain=[new TextEncoder().encode('first segment'),new TextEncoder().encode('second segment')];
  const enc=await Promise.all(plain.map((x,i)=>crypto.subtle.encrypt({name:'AES-CBC',iv:sequenceIV(10+i)},key,x)));
  const p=parsePlaylist('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\na.ts\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST',base);
  let keyLoads=0;
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('key.bin')){keyLoads++;return new Response(raw);}
    return new Response(url.endsWith('a.ts')?enc[0]:enc[1]);
  });
  const chunks=[];const progress=[];
  const bytes=await downloadHls(p,{write:async x=>chunks.push(x)},{onProgress:x=>progress.push(x)});
  assert.equal(new TextDecoder().decode(Buffer.concat(chunks)),'first segmentsecond segment');
  assert.equal(bytes,27);assert.equal(keyLoads,1);assert.equal(progress.at(-1).completed,2);
});
test('HTTP authorization failures never produce successful output',async t=>{
  const p=parsePlaylist('#EXTM3U\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST',base);
  t.mock.method(globalThis,'fetch',async()=>new Response('Forbidden',{status:403}));
  let writes=0;
  await assert.rejects(downloadHls(p,{write:async()=>writes++}),/403/);
  assert.equal(writes,0);
});
test('range response validation prevents concatenating entire files',async t=>{
  const p=parsePlaylist('#EXTM3U\n#EXT-X-BYTERANGE:3@0\na.ts\n#EXT-X-ENDLIST',base);
  t.mock.method(globalThis,'fetch',async()=>new Response('abc',{status:200}));
  await assert.rejects(downloadHls(p,{write:async()=>{}}),/字节范围/);
});
test('cancelled job writes nothing',async()=>{
  const p=parsePlaylist('#EXTM3U\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST',base);
  const controller=new AbortController();controller.abort();
  await assert.rejects(downloadHls(p,{write:async()=>assert.fail('must not write')},{signal:controller.signal}),{name:'AbortError'});
});
test('live and changing initialization map are not saved as complete files',async()=>{
  const live=parsePlaylist('#EXTM3U\n#EXTINF:1,\na.ts',base);
  await assert.rejects(downloadHls(live,{}),/直播/);
  const changed=parsePlaylist('#EXTM3U\n#EXT-X-MAP:URI="a.mp4"\na.m4s\n#EXT-X-MAP:URI="b.mp4"\nb.m4s\n#EXT-X-ENDLIST',base);
  await assert.rejects(downloadHls(changed,{}),/初始化片段/);
});
