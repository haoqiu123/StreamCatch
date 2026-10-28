import {httpUrl} from './media.js';
// Only ordinary media-request context. Never collect Cookie, Authorization,
// custom account/API tokens, or response cookies through webRequest.
export function requestContext(headers = []) {
  const get=name=>headers.find(h=>String(h.name).toLowerCase()===name)?.value;
  const context={};
  for(const [name,key]of [['referer','referer'],['origin','origin']]) {
    const value=get(name),valid=httpUrl(value);
    if(valid && valid.length<=4000)context[key]=valid;
  }
  const ua=get('user-agent');
  if(typeof ua==='string'&&ua.length<=500&&!/[\u0000-\u001f\u007f]/.test(ua))context.userAgent=ua;
  return context;
}
