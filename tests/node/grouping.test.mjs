import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMedia,kalturaAsset} from '../../extension/core/grouping.js';

const master='https://www.kaltura.com/p/123/sp/12300/playManifest/entryId/1_coursea/format/applehttp/flavorIds/1_video,1_audio/ks/FAKE_TOKEN';
const video='https://cfvod.kaltura.com/scf/hls/p/123/sp/12300/serveFlavor/entryId/1_coursea/v/1/flavorId/1_video/name/a.mp4/index.m3u8?Policy=FAKE&Signature=TEST';
const audio=video.replace('flavorId/1_video','flavorId/1_audio');
const item=(url,extra={})=>({url,kind:'hls',title:'Same page title',...extra});

test('Kaltura master, video and audio URLs are one video, with original URLs preserved',()=>{
  const groups=groupMedia([item(video),item(master),item(audio)]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].url,master,'The complete master is the default download');
  assert.equal(groups[0].sources.length,3);
  assert.deepEqual(new Set(groups[0].sources.map(s=>s.url)),new Set([master,video,audio]));
});
test('network arrival order never selects an individual track instead of the master',()=>{
  for(const urls of [[master,video,audio],[video,audio,master],[audio,master,video]]){
    assert.equal(groupMedia(urls.map((url,i)=>item(url,{time:i})))[0].url,master);
  }
});
test('different entries and partner accounts stay separate even with the same title',()=>{
  const groups=groupMedia([item(master),item(video),item(master.replace('1_coursea','1_courseb')),item(master.replace('/p/123/','/p/456/'))]);
  assert.equal(groups.length,3);
});
test('signed URL renewal deduplicates without stripping the active download credentials',()=>{
  const fresh=master.replace('FAKE_TOKEN','NEW_FAKE_TOKEN');
  const groups=groupMedia([item(master,{time:10}),item(fresh,{time:20})]);
  assert.equal(groups.length,1);assert.equal(groups[0].url,fresh);
  assert(groups[0].sources.some(s=>s.url===master));
});
test('query-style Kaltura identifiers share the same asset identity',()=>{
  const query='https://cdnapisec.kaltura.com/playManifest?partner_id=123&entry_id=1_coursea&format=applehttp';
  assert.equal(kalturaAsset(query).key,kalturaAsset(master).key);
});
test('unrestricted manifests outrank single-flavor and flavor-parameter manifests',()=>{
  const full=master.replace('/flavorIds/1_video,1_audio','');
  for (const limited of [master.replace('1_video,1_audio','1_audio'),full+'?flavorId=1_audio',full+'?flavorParamId=301971']) {
    assert.equal(groupMedia([item(limited,{time:20}),item(full,{time:10})])[0].url,full);
  }
});
test('unknown, incomplete and lookalike hosts are never merged heuristically',()=>{
  const urls=['https://videos.test/one.mp4?id=1','https://videos.test/one.mp4?id=2',master.replace('www.kaltura.com','kaltura.com.evil.test'),master.replace('/p/123/','/unknown/123/')];
  assert.equal(groupMedia(urls.map(url=>item(url))).length,4);
  assert.equal(kalturaAsset(urls[2]),null);assert.equal(kalturaAsset(urls[3]),null);
});
test('duplicates collapse, invalid URLs are ignored, and input state is immutable',()=>{
  const input=[Object.freeze(item(master)),Object.freeze(item(master)),Object.freeze(item('blob:https://x/123'))];
  Object.freeze(input);
  const groups=groupMedia(input);
  assert.equal(groups.length,1);assert.equal(groups[0].sources.length,1);assert.equal(input.length,3);
});
