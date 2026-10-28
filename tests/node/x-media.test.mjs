import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMedia} from '../../extension/core/grouping.js';
const x=globalThis.StreamCatchX;
const root='https://video.twimg.com/amplify_video/2110904875018268672';
const master=root+'/pl/master.m3u8?tag=14';
const video=root+'/pl/avc1/1280x720/video.m3u8';
const audio=root+'/pl/mp4a/128000/audio.m3u8';
const file=root+'/vid/avc1/1280x720/direct.mp4';
const item=url=>({url,kind:url.includes('.m3u8')?'hls':'file'});
test('X media and thumbnail share an exact identity',()=>{
 assert.equal(x.asset(master).key,x.posterAsset('https://pbs.twimg.com/amplify_video_thumb/2110904875018268672/img/cover.jpg').key);
 assert.equal(x.asset(master.replace('amplify_video','ext_tw_video')).key,x.posterAsset('https://pbs.twimg.com/ext_tw_video_thumb/2110904875018268672/pu/img/cover.jpg?name=small').key);
 assert.equal(x.asset('https://video.twimg.com/tweet_video/ABC-def.mp4').key,x.posterAsset('https://pbs.twimg.com/tweet_video_thumb/ABC-def.jpg').key);
});
test('X master, rendition and direct variants form one card; audio/chunks are not standalone videos',()=>{
 const urls=[file,video,audio,root+'/vid/avc1/segment_0.mp4',root+'/vid/avc1/0.m4s',master];
 const groups=groupMedia(urls.map(item));assert.equal(groups.length,1);assert.equal(groups[0].sources.length,3);assert.equal(groups[0].url,master);
 assert.equal(groupMedia([item(audio)]).length,0);
});
test('X master preference is independent of arrival order, and credentials stay intact',()=>{
 for(const urls of [[master,video,file],[file,video,master],[video,master,file]])assert.equal(groupMedia(urls.map(item))[0].url,master);
 const fresh=master.replace('tag=14','tag=15&token=FAKE');
 assert.equal(groupMedia([{...item(master),time:1},{...item(fresh),time:2}])[0].url,fresh);
 assert.equal(x.asset(master.replace('/pl/','/pu/pl/')).master,true);
});
test('different media IDs and families never collapse even in the same tweet',()=>{
 assert.equal(groupMedia([master,master.replace('2110904875018268672','2110904875018268673'),master.replace('amplify_video','ext_tw_video')].map(item)).length,3);
});
test('lookalikes, arbitrary poster hosts and unsafe links are rejected',()=>{
 assert.equal(x.asset(master.replace('video.twimg.com','video.twimg.com.evil.example')),null);
 assert.equal(x.posterAsset('https://pbs.twimg.com.evil.example/amplify_video_thumb/123/img/x.jpg'),null);
 assert.equal(x.posterAsset('https://pbs.twimg.com/media/abc.jpg'),null);
 assert.equal(x.postUrl('javascript:alert(1)'),null);
 assert.equal(x.postUrl('https://x.com.evil.example/name/status/123'),null);
 assert.equal(x.postUrl('https://twitter.com/name/status/123/video/1?ref=tracking'),'https://x.com/name/status/123');
});
test('exact metadata enriches its group even when it arrives on a lower-priority rendition',()=>{
 const key=x.asset(master).key;
 const result=groupMedia([item(master),{...item(video),poster:'https://fixture/cover.jpg',duration:13}],{[key]:{title:'Actual post',author:'Author @name',poster:'https://pbs.twimg.com/amplify_video_thumb/2110904875018268672/img/cover.jpg'}})[0];
 assert.equal(result.title,'Actual post');assert.equal(result.duration,13);assert.equal(result.url,master);assert.match(result.poster,/pbs\.twimg/);
});
