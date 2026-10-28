import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlaylist, parsePlaylist, downloadHls} from '../../extension/core/hls.js';

const source = 'https://media.example.test/old/master.m3u8?Signature=PRIVATE_TEST_SIGNATURE';
const text = '#EXTM3U\n#EXTINF:1,\nvideo.ts\n#EXT-X-ENDLIST';
const response = (body = text, url = source) => Object.defineProperty(new Response(body), 'url', {value: url});

for (const status of [401,403,404,410]) {
  test(`playlist HTTP ${status} has safe structured context and is not retried`, async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('PRIVATE_SERVER_BODY', {status}); });
    await assert.rejects(loadPlaylist(source), error => {
      assert.equal(error.status, status);
      assert.equal(error.resource, 'playlist');
      assert.equal(error.fatal, true);
      assert.match(error.message, /播放列表/);
      if ([404,410].includes(status)) assert.doesNotMatch(error.message, /登录/);
      assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE|https?:|Signature/);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test('fresh playlists bypass cache and resolve relative URLs from the final redirect URL', async t => {
  const final = 'https://cdn.example.test/final/path/index.m3u8?Signature=REDIRECT_ONLY';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, source);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'include');
    return response(text.replace('video.ts', '../video.ts?Signature=CHILD_SIGNATURE'), final);
  });
  const playlist = await loadPlaylist(source);
  assert.equal(playlist.url, final);
  assert.equal(playlist.segments[0].url, 'https://cdn.example.test/final/video.ts?Signature=CHILD_SIGNATURE');
});

for (const resource of ['init','segment','key']) {
  test(`HTTP 404 identifies the ${resource} phase and does not write failed data`, async t => {
    let body = text;
    if (resource === 'init') body = body.replace('#EXTINF', '#EXT-X-MAP:URI="init.mp4"\n#EXTINF');
    if (resource === 'key') body = body.replace('#EXTINF', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin?Signature=PRIVATE_KEY"\n#EXTINF');
    const playlist = parsePlaylist(body, source);
    let writes = 0, calls = 0;
    t.mock.method(globalThis, 'fetch', async url => {
      calls++;
      if (resource === 'key' && !url.includes('key.bin')) return new Response(new Uint8Array(16));
      return new Response('missing', {status:404});
    });
    await assert.rejects(downloadHls(playlist, {write:async () => writes++}), error => {
      assert.equal(error.status, 404);
      assert.equal(error.resource, resource);
      assert.equal(error.segmentIndex, resource === 'init' ? undefined : 0);
      assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE|Signature|https?:/);
      return true;
    });
    assert.equal(writes, 0);
    assert.equal(calls, resource === 'key' ? 2 : 1);
  });
}

test('segment failure includes its zero-based index after earlier successful writes', async t => {
  const playlist = parsePlaylist(text.replace('#EXT-X-ENDLIST', '#EXTINF:1,\nmissing.ts\n#EXT-X-ENDLIST'), source);
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/missing.ts') ? new Response('', {status:410}) : new Response('first'));
  const chunks = [];
  await assert.rejects(downloadHls(playlist, {write:async bytes => chunks.push(bytes)}), error => {
    assert.equal(error.status, 410);
    assert.equal(error.resource, 'segment');
    assert.equal(error.segmentIndex, 1);
    assert.match(error.message, /视频分段 2/);
    return true;
  });
  assert.equal(chunks.length, 1);
});

test('temporary server failures retry and keep structured context on final failure', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', {status:503}); });
  await assert.rejects(loadPlaylist(source), error => {
    assert.equal(error.status, 503);
    assert.equal(error.resource, 'playlist');
    assert.equal(error.fatal, false);
    return true;
  });
  assert.equal(calls, 3);
});

test('an already aborted playlist request does not fetch or retry', async t => {
  const controller = new AbortController(); controller.abort();
  t.mock.method(globalThis, 'fetch', async () => assert.fail('must not fetch'));
  await assert.rejects(loadPlaylist(source, controller.signal), {name:'AbortError'});
});

test('aborting an in-flight request preserves cancellation without retrying', async t => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++;
    controller.abort();
    options.signal.throwIfAborted();
  });
  await assert.rejects(loadPlaylist(source, controller.signal), {name:'AbortError'});
  assert.equal(calls, 1);
});
