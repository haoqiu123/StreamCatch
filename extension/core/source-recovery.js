import {httpUrl} from './media.js';
import {kalturaAsset} from './grouping.js';

const completeManifest = asset => asset?.manifest && (!asset.restricted || asset.flavors > 1);

// Only renew a known complete entry. A flavor URL can be video-only or audio-only,
// so it must never silently replace the entry's master playlist.
export function recoverySources(job, pageStates = []) {
  const original = httpUrl(job.url);
  if (!original) return [];
  const asset = kalturaAsset(original);
  if (job.kind !== 'hls' || !completeManifest(asset)) return [original];
  const matches = item => {
    const other = kalturaAsset(item.url);
    return item.kind === job.kind && other?.key === asset.key && completeManifest(other)
      && (!other.restricted || other.selection === asset.selection);
  };
  const live = pageStates.filter(state => httpUrl(state.pageUrl) === httpUrl(job.pageUrl))
    .flatMap(state => state.items || []).filter(matches)
    .sort((a,b) => (b.time || 0) - (a.time || 0));
  const saved = (job.sources || []).filter(matches).sort((a,b) => (b.time || 0) - (a.time || 0));
  return [...new Set([...live.map(item => item.url), original, ...saved.map(item => item.url)])].slice(0,8);
}

export function canRetrySource(error) {
  return error.resource === 'playlist' && [401,403,404,410].includes(error.status);
}
