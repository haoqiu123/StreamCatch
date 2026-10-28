import test from 'node:test';
import assert from 'node:assert/strict';
import {requestContext} from '../../extension/core/request-context.js';
test('only normal media headers survive; credentials and custom API tokens never do',()=>{
 const result=requestContext([{name:'User-Agent',value:'Chrome fixture'},{name:'Referer',value:'https://onlyfans.com/fixture'},{name:'Origin',value:'https://onlyfans.com'},
  {name:'Cookie',value:'PRIVATE_COOKIE'},{name:'Authorization',value:'Bearer PRIVATE_TOKEN'},{name:'X-BC',value:'PRIVATE_API_TOKEN'}]);
 assert.deepEqual(result,{userAgent:'Chrome fixture',referer:'https://onlyfans.com/fixture',origin:'https://onlyfans.com/'});
 for(const privateValue of ['PRIVATE_COOKIE','PRIVATE_TOKEN','PRIVATE_API_TOKEN'])assert(!JSON.stringify(result).includes(privateValue));
});
test('request context rejects unsafe URLs and header control characters',()=>{
 assert.deepEqual(requestContext([{name:'Referer',value:'file:///etc/passwd'},{name:'Origin',value:'https://u:p@site.example/'},{name:'User-Agent',value:'Chrome\r\nCookie: BAD'}]),{});
});
