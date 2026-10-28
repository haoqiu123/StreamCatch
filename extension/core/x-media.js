// Shared by the classic content script and the extension's ES modules. Keep
// identities based on CDN media IDs, never the page title or request order.
(() => {
  const url = value => {
    try {
      const u = new URL(value);
      return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u : null;
    } catch { return null; }
  };
  function asset(value) {
    const u = url(value);
    if (u?.hostname !== 'video.twimg.com') return null;
    const match = u.pathname.match(/^\/(ext_tw_video|amplify_video)\/(\d+)\/(.*)$/);
    const gif = u.pathname.match(/^\/tweet_video\/([\w-]+)\.mp4$/i);
    if (gif) return {key:`x:tweet_video:${gif[1]}`, id:gif[1], master:false, audio:false, segment:false};
    if (!match) return null;
    const tail = match[3];
    const playlist = /\.m3u8?$/i.test(tail);
    return {
      key:`x:${match[1]}:${match[2]}`, id:match[2],
      // X's /pl/<name>.m3u8 is the master; /pl/<codec>/... are
      // individual renditions. Do not select an audio-only leaf.
      master:playlist && /^(?:pu\/)?pl\/[^/]+\.m3u8?$/i.test(tail),
      audio:/(?:^|\/)(?:mp4a|aac)(?:\/|\.)/i.test(tail),
      segment:/(?:^|\/)\d+\.(?:m4s|ts)$/i.test(tail) || /\.(?:m4s|ts)$/i.test(tail)
        || /(?:^|\/)(?:seg|segment|chunk|init)[-_\d.]/i.test(tail),
    };
  }
  function posterAsset(value) {
    const u = url(value);
    if (u?.hostname !== 'pbs.twimg.com') return null;
    const match = u.pathname.match(/^\/(ext_tw_video|amplify_video)_thumb\/(\d+)\//);
    if (match) return {key:`x:${match[1]}:${match[2]}`,id:match[2]};
    const gif = u.pathname.match(/^\/tweet_video_thumb\/([\w-]+)\.[a-z0-9]+$/i);
    return gif ? {key:`x:tweet_video:${gif[1]}`,id:gif[1]} : null;
  }
  function isPage(value) {
    const u = url(value);
    return Boolean(u && /^(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)$/.test(u.hostname));
  }
  function postUrl(value) {
    const u = url(value);
    if (!u || !isPage(value)) return null;
    const match = u.pathname.match(/^\/([\w]{1,50})\/status\/(\d+)(?:\/|$)/);
    return match ? `https://x.com/${match[1]}/status/${match[2]}` : null;
  }
  globalThis.StreamCatchX = Object.freeze({asset,posterAsset,isPage,postUrl});
})();
