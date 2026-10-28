(() => {
  if (globalThis.__streamCatchInstalled) return;
  globalThis.__streamCatchInstalled = true;
  const sent = new Map();
  const mediaPattern = /\.(?:mp4|m4v|webm|mov|mkv|ogv|avi|m3u8?|mpd)(?:[?#]|$)/i;
  const xMedia = globalThis.StreamCatchX;
  const pageMedia=globalThis.StreamCatchPage;
  let timer, lastMetadata = '{}', lastContexts = '[]', lastPage = location.href, resourceStart = 0;
  function syncPage() {
    if (lastPage === location.href) return;
    lastPage = location.href; resourceStart = performance.now();
    sent.clear(); lastMetadata = '{}'; lastContexts = '[]';
  }
  function posterUrl(value) {
    try {
      if (!value) return undefined;
      const url = new URL(value, document.baseURI);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
    } catch { return undefined; }
  }
  function videoMetadata(video) {
    const poster = posterUrl(video.poster);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
    return {...(poster ? {poster} : {}), ...(duration ? {duration} : {})};
  }
  function mainVideoMetadata(videos) {
    const candidates = videos.map(video => {
      const metadata = videoMetadata(video);
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      const area = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
        ? Math.max(0, rect.width) * Math.max(0, rect.height) : 0;
      return {metadata, area, playing: !video.paused && !video.ended};
    }).filter(candidate => candidate.metadata.poster || candidate.metadata.duration);
    candidates.sort((a, b) => Number(b.area > 0) - Number(a.area > 0)
      || Number(b.playing) - Number(a.playing) || b.area - a.area
      || Number(Boolean(b.metadata.duration)) - Number(Boolean(a.metadata.duration)));
    return candidates[0]?.metadata || {};
  }
  function xContexts(videos) {
    if (!xMedia?.isPage(location.href)) return [];
    const contexts = new Map();
    // Some unplayed/quoted posts have an image before they mount a video.
    const elements = [...document.querySelectorAll('article img'), ...videos];
    for (const media of elements) {
      const poster = posterUrl(media.tagName === 'VIDEO' ? media.poster : media.currentSrc || media.src);
      const asset = xMedia.posterAsset(poster);
      if (!asset) continue;
      const article = media.closest('article');
      if (!article) continue;
      let scope = media.parentElement;
      while (scope && scope !== article && !scope.querySelector('[data-testid="User-Name"]')) scope = scope.parentElement;
      scope ||= article;
      const clean = (value, limit) => String(value || '').replace(/\s+/g,' ').trim().slice(0,limit);
      const header = scope.querySelector('[data-testid="User-Name"]');
      const author = clean(header?.textContent?.split('·')[0],120).replace(/([^\s])@/,'$1 @');
      const title = clean(scope.querySelector('[data-testid="tweetText"]')?.textContent,250);
      const links = [...scope.querySelectorAll('a[href*="/status/"]')];
      const ownLink = links.find(a => a.querySelector('time')) || links.find(a => xMedia.postUrl(a.href));
      const containingLink = article.querySelector('a[href*="/status/"]');
      const postUrl = xMedia.postUrl(ownLink?.href || containingLink?.href);
      const rect = media.getBoundingClientRect();
      const style = getComputedStyle(media);
      const inViewport = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
        && rect.top < innerHeight && rect.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
      const previous = contexts.get(asset.key) || {};
      contexts.set(asset.key,{...previous,poster,...(title ? {title} : {}),...(author ? {author} : {}),
        ...(postUrl ? {postUrl} : {}),...(media.tagName === 'VIDEO' ? videoMetadata(media) : {}),
        inViewport:inViewport || Boolean(previous.inViewport)});
    }
    return [...contexts.values()].slice(0,100);
  }
  function emit(items = [], drm = false, metadata, contexts) {
    const fresh = [];
    for (const item of items) {
      if (!/^https?:\/\//i.test(item.url)) continue;
      const previous = sent.get(item.url);
      const details = {...previous};
      // Network observations must not erase metadata obtained from the player.
      for (const key of ['height', 'poster', 'duration', 'title', 'author', 'postUrl']) if (item[key]) details[key] = item[key];
      if (previous && JSON.stringify(previous) === JSON.stringify(details)) continue;
      sent.set(item.url, details);
      if (sent.size > 500) sent.delete(sent.keys().next().value);
      fresh.push({...item, ...details});
    }
    const metadataChanged = metadata !== undefined && JSON.stringify(metadata) !== lastMetadata;
    if (metadataChanged) lastMetadata = JSON.stringify(metadata);
    const contextsChanged = contexts !== undefined && JSON.stringify(contexts) !== lastContexts;
    if (contextsChanged) lastContexts = JSON.stringify(contexts);
    if (!fresh.length && !drm && !metadataChanged && !contextsChanged) return;
    chrome.runtime.sendMessage({type: 'FOUND', items: fresh.slice(0, 100), title: document.title, drm,
      documentUrl:location.href,...(metadata !== undefined ? {metadata} : {}),
      ...(contexts !== undefined ? {mediaContexts:contexts} : {})}).catch(() => {});
  }
  function scan() {
    syncPage();
    const items = [], videos = [], roots = [document];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      for (const video of root.querySelectorAll('video')) {
        videos.push(video);
        for (const source of [{url:video.currentSrc},{url:video.src},...Array.from(video.querySelectorAll('source'), s => ({url:s.src,mime:s.type}))]) {
          if (source.url) items.push({...source, fromVideo: true, height: video.videoHeight, source: '播放器', ...videoMetadata(video)});
        }
      }
      for (const frame of root.querySelectorAll('iframe[src]')) {
        try {
          const url=new URL(frame.src,document.baseURI);
          const match=url.pathname.match(/^\/(media_attachments|media_objects)_iframe\/([\w-]+)$/);
          if (url.hostname.endsWith('.instructure.com') && match) items.push({url:`${url.origin}/${match[1]}/${match[2]}/info`,source:'Canvas 播放器'});
        } catch {}
      }
      for (const source of root.querySelectorAll('a[href],meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]')) {
        const url = source.href || source.content;
        if (url && mediaPattern.test(url)) items.push({url, source: '网页链接'});
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    // A blob player can have no downloadable DOM URL. Send its metadata independently
    // so the popup can attach it when network requests resolve to one grouped video.
    // Players may keep hidden preload/alternate video elements alongside the main one.
    // Feed pages contain independent posts. Never spread one player's poster
    // or the profile's Open Graph image across unrelated X videos.
    const isX = xMedia?.isPage(location.href);
    const metadata = isX ? {} : mainVideoMetadata(videos);
    if (!isX && !metadata.poster) {
      const poster = posterUrl(document.querySelector('meta[property="og:image"],meta[name="twitter:image"]')?.content);
      if (poster) metadata.poster = poster;
    }
    const page=pageMedia?.asset(location.href);
    if(page) {
      const declared=pageMedia.asset(document.querySelector('meta[property="og:url"]')?.content || document.querySelector('link[rel="canonical"]')?.href);
      const exact=declared?.key===page.key;
      if(declared && declared.id!==page.id)for(const key of Object.keys(metadata))delete metadata[key];
      const title=exact&&document.querySelector('meta[property="og:title"]')?.content || document.querySelector('h1')?.textContent || document.title;
      const poster=page.provider==='youtube'?`https://i.ytimg.com/vi/${page.id}/hqdefault.jpg`:
        exact?posterUrl(document.querySelector('meta[property="og:image"]')?.content):metadata.poster;
      items.push({url:page.url,kind:'page',source:'视频网页',title:String(title).trim().slice(0,250),...metadata,...(poster?{poster}:{})});
    }
    emit(items, false, metadata, isX ? xContexts(videos) : undefined);
  }
  function resources() {
    syncPage();
    emit(performance.getEntriesByType('resource').filter(r => r.startTime >= resourceStart && mediaPattern.test(r.name)).map(r => ({url:r.name, source:'已加载资源'})));
  }
  function schedule() {
    // Throttle rather than debounce: busy feeds can mutate continuously.
    if (timer) return;
    timer = setTimeout(() => { timer = null; scan(); resources(); }, 450);
  }
  new MutationObserver(schedule).observe(document, {subtree:true, childList:true, attributes:true, attributeFilter:['src', 'poster', 'content']});
  for (const event of ['loadedmetadata', 'durationchange', 'play']) document.addEventListener(event, schedule, true);
  document.addEventListener('scroll', schedule, {passive:true,capture:true});
  document.addEventListener('encrypted', () => emit([], true), true);
  try { new PerformanceObserver(list => {
    syncPage();
    emit(list.getEntries().filter(r => r.startTime >= resourceStart && mediaPattern.test(r.name)).map(r => ({url:r.name, source:'网络资源'})));
  }).observe({type:'resource', buffered:true}); } catch {}
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'SCAN') {
      sent.clear(); lastMetadata = '{}'; lastContexts = '[]';
      scan(); resources();
    }
  });
  schedule();
})();
