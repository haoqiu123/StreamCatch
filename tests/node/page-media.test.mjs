import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMedia} from '../../extension/core/grouping.js';
import {historyGroupKey} from '../../extension/core/download-manager.js';
const p=globalThis.StreamCatchPage;
const youtube='https://www.youtube.com/watch?v=ABCDEFGHIJK';
test('YouTube watch, shorts and embeds share an exact video identity',()=>{
 for(const url of [youtube+'&t=30','https://youtu.be/ABCDEFGHIJK?si=tracking','https://www.youtube.com/shorts/ABCDEFGHIJK','https://www.youtube.com/embed/ABCDEFGHIJK'])assert.equal(p.asset(url).key,p.asset(youtube).key);
 for(const url of ['https://youtube.com.evil.test/watch?v=ABCDEFGHIJK','https://u:p@www.youtube.com/watch?v=ABCDEFGHIJK','https://www.youtube.com/','https://www.youtube.com/watch?v=short'])assert.equal(p.asset(url),null);
});
test('Bilibili language routes and tracking collapse while part numbers stay distinct',()=>{
 const first=p.asset('https://www.bilibili.com/en/video/BV1AfJD6eE3W/?trackid=FAKE&p=1');
 assert.equal(first.url,'https://www.bilibili.com/video/BV1AfJD6eE3W/');
 assert.equal(p.asset(first.url).key,first.key);
 assert.notEqual(p.asset(first.url+'?p=2').key,first.key);
 assert.equal(p.asset(first.url+'?p=2&spm_id_from=FAKE').url,first.url+'?p=2');
});
test('explicit watch page replaces provider traffic without merging unrelated external media',()=>{
 const input=[{url:youtube,kind:'page',title:'One video'},
 {url:'https://manifest.googlevideo.com/id/internal123/index.m3u8?sig=A',kind:'hls'},
 {url:'https://rr1.googlevideo.com/videoplayback?id=internal123&sig=B',kind:'file'},
 {url:'https://external.example/ad.mp4',kind:'file'}];
 const groups=groupMedia(input);assert.equal(groups.length,2);assert.equal(groups[0].url,youtube);assert.equal(groups[0].sources.length,1);
 const duplicates=groupMedia([{url:youtube+'&t=10',kind:'page'},{url:youtube+'&si=FAKE',kind:'page'}]);
 assert.equal(duplicates.length,1);assert.equal(duplicates[0].sources.length,1);
});
test('five representations on a known player page show one download and one job identity',async()=>{
 const page='https://www.pornhub.com/view_video.php?viewkey=phFAKEfixture';
 const urls=['https://www.pornhub.com/media/video.mp4','https://ev.phncdn.com/fake/720.mp4','https://hv-h.phncdn.com/fake/master.m3u8','https://ev.phncdn.com/fake/1080.mp4','https://hv-h.phncdn.com/fake/720.m3u8'];
 const groups=groupMedia([{url:page,kind:'page'},...urls.map(url=>({url,kind:'file'}))]);assert.equal(groups.length,1);
 assert.equal(await historyGroupKey(groups[0].groupKey),await historyGroupKey(groupMedia([{url:page,kind:'page'}])[0].groupKey));
});
test('homepage HLS signing renewals group by observed media ID without guessing a watch ID',()=>{
 const urls=['https://manifest.googlevideo.com/api/manifest/hls_variant/id/fixture123/file/index.m3u8?sig=A','https://manifest.googlevideo.com/api/manifest/hls_variant/id/fixture123/file/index.m3u8?sig=B'];
 const groups=groupMedia(urls.map(url=>({url,kind:'hls'})));assert.equal(groups.length,1);assert.equal(groups[0].sources.length,2);
 assert.deepEqual(groups[0].sources.map(s=>s.url).sort(),urls.sort());
 assert.equal(groupMedia([...urls,urls[0].replace('fixture123','other456')].map(url=>({url,kind:'hls'}))).length,2);
});
