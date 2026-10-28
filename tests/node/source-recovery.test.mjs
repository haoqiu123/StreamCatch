import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverySources,canRetrySource} from '../../extension/core/source-recovery.js';
const base = 'https://www.kaltura.com/p/123/playManifest/entryId/1_test/format/applehttp';
const old = base + '/ks/OLD', fresh = base + '/ks/NEW';
const pageUrl = 'https://school.example/media/test';
const job = {url:old,kind:'hls',pageUrl};
const state = items => ({pageUrl,items});
const item = (url,time=10) => ({url,time,kind:'hls'});
test('legacy jobs renew from the same page and preserve signed URL bytes',()=>{
  const signed = fresh+'?Policy=ABC%2B123&Signature=x%2Fy';
  assert.deepEqual(recoverySources(job,[state([item(old,1),item(signed)])]),[signed,old]);
});
test('another page or entry cannot supply a recovery source',()=>{
  assert.deepEqual(recoverySources(job,[{...state([item(fresh)]),pageUrl:pageUrl+'/other'},state([item(fresh.replace('1_test','1_other'))])]),[old]);
});
test('single flavor or audio/video leaf is never an automatic replacement',()=>{
  const leaf = fresh.replace('playManifest','serveFlavor')+'/flavorId/1_audio';
  assert.deepEqual(recoverySources(job,[state([item(leaf),item(fresh+'/flavorIds/1_video')])]),[old]);
});
test('an explicitly chosen single flavor is not upgraded to a different track',()=>{
  const single = old+'/flavorIds/1_video';
  assert.deepEqual(recoverySources({...job,url:single},[state([item(fresh)])]),[single]);
});
test('complete saved sources remain available, without duplicates or other kinds',()=>{
  const multiple=fresh+'/flavorIds/1_video,1_audio';
  assert.deepEqual(recoverySources({...job,url:old+'/flavorIds/1_video,1_audio',sources:[item(multiple),item(multiple),{...item(fresh),kind:'dash'}]}),[old+'/flavorIds/1_video,1_audio',multiple]);
});
test('arbitrary URLs and manual jobs never use heuristic title matching',()=>{
  const arbitrary='https://cdn.example/master.m3u8?token=old';
  assert.deepEqual(recoverySources({...job,url:arbitrary},[state([item(fresh)])]),[arbitrary]);
});
test('only expired or forbidden playlists allow a source fallback',()=>{
  assert.equal(canRetrySource({status:404,resource:'playlist'}),true);
  assert.equal(canRetrySource({status:403,resource:'playlist'}),true);
  assert.equal(canRetrySource({status:404,resource:'segment'}),false);
  assert.equal(canRetrySource({status:500,resource:'playlist'}),false);
});

test('multiple audio tracks are not a replacement for an unrestricted or different selection',()=>{
  const audio = fresh+'/flavorIds/1_audio_en,1_audio_es';
  const video = old+'/flavorIds/1_video,1_audio';
  assert.deepEqual(recoverySources(job,[state([item(audio)])]),[old]);
  assert.deepEqual(recoverySources({...job,url:video},[state([item(audio)])]),[video]);
});
