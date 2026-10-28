import {httpUrl} from './media.js';
import {canvasSource,canvasTarget} from './canvas-media.js';
import './x-media.js';
import './page-media.js';
const {asset:xAsset} = globalThis.StreamCatchX;
const pageMedia=globalThis.StreamCatchPage;

// A Kaltura entry is the video; flavors, manifests and signed CDN URLs are
// representations of that entry. Keep the original URLs intact for downloads.
// https://knowledge.kaltura.com/help/how-to-retrieve-the-download-or-streaming-url-using-api-calls
export function kalturaAsset(url) {
  const valid = httpUrl(url);
  if (!valid) return null;
  const u = new URL(valid);
  if (!(u.hostname === 'kaltura.com' || u.hostname.endsWith('.kaltura.com'))) return null;
  let parts;
  try { parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return null; }
  const query = new Map([...u.searchParams].map(([key,value]) => [key.toLowerCase(),value]));
  const value = (...names) => {
    const index = parts.findIndex(part => names.includes(part.toLowerCase()));
    return (index >= 0 ? parts[index + 1] : '') || names.map(name => query.get(name)).find(Boolean) || '';
  };
  const partner = value('p', 'partnerid', 'partner_id');
  const entry = value('entryid', 'entry_id');
  if (!/^\d+$/.test(partner) || !/^[a-zA-Z0-9_-]{1,128}$/.test(entry)) return null;
  const restriction = value('flavorids', 'flavor_ids', 'flavorid', 'flavor_id', 'flavorparamids', 'flavorparamid');
  const flavorIds = value('flavorids','flavor_ids','flavorid','flavor_id').split(',').filter(Boolean).sort();
  const flavorParams = value('flavorparamids','flavorparamid').split(',').filter(Boolean).sort();
  return {
    key: `kaltura:${partner}:${entry}`,
    manifest: parts.some(part => part.toLowerCase() === 'playmanifest'),
    restricted: Boolean(restriction),
    flavors: restriction.split(',').filter(Boolean).length,
    selection: JSON.stringify([flavorIds,flavorParams]),
  };
}

function priority(item) {
  if(pageMedia.resource(item.url)?.master)return 250;
  if (canvasSource(item)) return item.canvasResolved ? 400 : /\.instructuremedia\.com$/.test(new URL(item.url).hostname) ? 200 : -50;
  const x = xAsset(item.url);
  if (x) return x.audio || x.segment ? -100 : x.master ? 250 : item.kind === 'file' ? 90 : 70;
  const asset = kalturaAsset(item.url);
  const kind = {hls:30,dash:20,file:10}[item.kind] || 0;
  // Prefer a full manifest over a single video/audio track, independently of
  // network arrival order. The most recently observed equivalent URL wins.
  const completeness = asset?.restricted ? Math.min(49,asset.flavors) : 50;
  return kind + (asset?.manifest && item.kind !== 'file' ? 100 + completeness : 0);
}

export function groupMedia(items = [], assetMetadata = {}) {
  const groups = new Map();
  const pages=items.filter(item=>item.kind==='page').map(item=>pageMedia.asset(item.url)).filter(Boolean);
  const canvasTargets = new Map(items.filter(item=>item.canvasResolved && canvasSource(item))
    .map(item=>[canvasTarget(item.url),canvasSource(item)]));
  for (const item of items) {
    const url = httpUrl(item.url);
    if (!url) continue;
    // A known watch page is the authoritative download entry. Its player/CDN
    // traffic can contain ads and alternate tracks: hide that traffic rather
    // than claiming every same-provider request is another video or rendition.
    if(!pageMedia.asset(url)&&pages.some(page=>pageMedia.ownsResource(page,url)))continue;
    const x = xAsset(url);
    if (x?.audio || x?.segment) continue;
    const canvas = canvasSource(item) || canvasTargets.get(canvasTarget(url));
    const page=pageMedia.asset(url);
    const key = page?.key || canvas?.key || kalturaAsset(url)?.key || x?.key || pageMedia.resource(url)?.key || `url:${url}`;
    if (!groups.has(key)) groups.set(key, []);
    const sources = groups.get(key);
    const normalized=page?.url || url;
    if (!sources.some(source => source.url === normalized)) sources.push({...item,url:normalized});
  }
  return [...groups].map(([groupKey,sources]) => {
    sources.sort((a,b) => priority(b) - priority(a) || (b.height || 0) - (a.height || 0) || (b.time || 0) - (a.time || 0));
    const metadata = {};
    for (const source of [...sources].reverse()) {
      for (const key of ['poster','duration','title','author','postUrl']) if (source[key]) metadata[key] = source[key];
    }
    const canvas = sources.map(canvasSource).find(Boolean) || canvasTargets.get(canvasTarget(sources[0].url));
    return {...sources[0],...metadata,...assetMetadata[groupKey],...(canvas ? {canvasSource:canvas.infoUrl} : {}),groupKey,sources};
  });
}
