// Shared with the content script. Stable identities come from an explicit
// watch-page URL, never from a page title or a guessed CDN filename.
(() => {
  const url=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u:null;}catch{return null;}};
  function asset(value) {
    const u=url(value);if(!u)return null;
    let id,provider,canonical,part='';
    if(/^(?:(?:www|m)\.)?youtube\.com$/.test(u.hostname)||u.hostname==='youtu.be') {
      id=u.hostname==='youtu.be'?u.pathname.slice(1).split('/')[0]:u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
      if(!/^[\w-]{11}$/.test(id||''))return null;
      provider='youtube';canonical=`https://www.youtube.com/watch?v=${id}`;
    } else if(/^(?:(?:www|m)\.)?bilibili\.com$/.test(u.hostname)) {
      id=u.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?video\/(BV[A-Za-z0-9]{10}|av\d+)(?:\/|$)/)?.[1];
      if(!id)return null;
      const p=u.searchParams.get('p');part=/^[1-9]\d{0,3}$/.test(p||'')&&p!=='1'?p:'';
      provider='bilibili';canonical=`https://www.bilibili.com/video/${id}/`+(part?`?p=${part}`:'');
    } else if(/^(?:(?:www|m|[a-z]{2})\.)?pornhub\.com$/.test(u.hostname)&&u.pathname==='/view_video.php') {
      id=u.searchParams.get('viewkey');if(!/^[\w-]{3,100}$/.test(id||''))return null;
      provider='pornhub';canonical=`https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(id)}`;
    } else return null;
    return {provider,id,url:canonical,key:`page:${provider}:${id}${part?':p'+part:''}`};
  }
  function ownsResource(page,value) {
    const u=url(value);if(!u||!page)return false;
    const host=u.hostname;
    return page.provider==='youtube'?host.endsWith('.googlevideo.com'):
      page.provider==='bilibili'?host.endsWith('.bilivideo.com')||host.endsWith('.bilivideo.cn')||host=== 'www.bilibili.com':
      page.provider==='pornhub'?host.endsWith('.phncdn.com')||host==='www.pornhub.com':false;
  }
  function resource(value) {
    const u=url(value);if(!u||!u.hostname.endsWith('.googlevideo.com'))return null;
    const id=u.searchParams.get('id')||u.pathname.match(/\/id\/([^/]+)/)?.[1];
    if(!/^[\w.-]{4,160}$/.test(id||''))return null;
    return {key:`youtube-cdn:${id}`,id,master:/\/hls_variant\//.test(u.pathname)};
  }
  globalThis.StreamCatchPage=Object.freeze({asset,ownsResource,resource});
})();
