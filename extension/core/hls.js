import { httpUrl } from './media.js';

export function attributes(text) {
  const result = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (const match of text.matchAll(regex)) result[match[1]] = match[2].replace(/^"|"$/g, '');
  return result;
}

function resolve(uri, base) {
  const url = httpUrl(uri, base);
  if (!url) throw new Error('播放列表包含不支持的资源地址。');
  return url;
}

function range(value, previous, url) {
  if (!value) return null;
  const match = value.match(/^(\d+)(?:@(\d+))?$/);
  if (!match) throw new Error('无效的 HLS 字节范围。');
  const length = Number(match[1]);
  const start = match[2] !== undefined ? Number(match[2]) : previous?.url === url ? previous.end + 1 : NaN;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length <= 0 || !Number.isSafeInteger(start + length)) throw new Error('HLS 字节范围缺少起始位置。');
  return {start, end: start + length - 1, url};
}

export function sequenceIV(sequence) {
  let n = BigInt(sequence);
  const iv = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { iv[i] = Number(n & 255n); n >>= 8n; }
  return iv;
}

export function parseIV(value) {
  if (!/^0x[0-9a-f]{1,32}$/i.test(value)) throw new Error('无效的 AES 初始化向量。');
  return Uint8Array.from(value.slice(2).padStart(32, '0').match(/../g), x => parseInt(x, 16));
}

export function parsePlaylist(text, base) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(x => x.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('服务器没有返回 HLS 播放列表；链接可能已过期或需要登录。');
  const result = {url: base, variants: [], audio: [], segments: [], live: true, duration: 0, issues: []};
  let pendingVariant, duration = 0, key = null, map = null, byteRange, previousRange, previousMapRange, sequence = 0;
  const issue = text => { if (!result.issues.includes(text)) result.issues.push(text); };
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    const tag = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1);
    if (tag === '#EXT-X-STREAM-INF') pendingVariant = attributes(value);
    else if (tag === '#EXT-X-MEDIA') {
      const a = attributes(value);
      if (a.TYPE === 'AUDIO' && a.URI) result.audio.push({...a, url: resolve(a.URI, base)});
    } else if (tag === '#EXT-X-MEDIA-SEQUENCE') {
      sequence = Number(value);
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('不支持的 HLS 分段编号。');
    } else if (tag === '#EXTINF') duration = Number(value.split(',')[0]) || 0;
    else if (tag === '#EXT-X-BYTERANGE') byteRange = value;
    else if (tag === '#EXT-X-KEY' || tag === '#EXT-X-SESSION-KEY') {
      const a = attributes(value);
      if (a.METHOD === 'NONE') key = null;
      else if (a.METHOD !== 'AES-128' || (a.KEYFORMAT && a.KEYFORMAT !== 'identity')) {
        issue('此视频使用 DRM 或 SAMPLE-AES，浏览器模式不支持。');
        key = {unsupported: true};
      } else {
        if (!a.URI) throw new Error('播放列表缺少 AES 密钥地址。');
        key = {url: resolve(a.URI, base), iv: a.IV ? parseIV(a.IV) : null};
      }
    } else if (tag === '#EXT-X-MAP') {
      const a = attributes(value);
      if (!a.URI) throw new Error('播放列表缺少初始化片段。');
      const url = resolve(a.URI, base);
      const r = range(a.BYTERANGE, previousMapRange, url);
      previousMapRange = r;
      map = {url, range: r, key};
      if (key && !key.iv) issue('加密的初始化片段缺少 IV。');
    } else if (tag === '#EXT-X-ENDLIST') result.live = false;
    else if (tag === '#EXT-X-DISCONTINUITY') issue('视频含有时间轴切换，请使用本地助手合并。');
    else if (tag === '#EXT-X-GAP') issue('播放列表缺少分段，无法保存完整视频。');
    else if (tag === '#EXT-X-SKIP') issue('这是增量播放列表，无法保存完整视频，请使用本地助手。');
    else if (tag === '#EXT-X-I-FRAMES-ONLY') issue('这是预览帧列表，不能作为完整视频下载。');
    else if (tag === '#EXT-X-DEFINE') issue('此播放列表使用变量，请使用本地助手解析。');
    else if (line && !line.startsWith('#')) {
      const url = resolve(line, base);
      if (pendingVariant) {
        const a = pendingVariant;
        result.variants.push({url, width: Number(a.RESOLUTION?.split('x')[0]) || 0, height: Number(a.RESOLUTION?.split('x')[1]) || 0, bandwidth: Number(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH) || 0, codecs: a.CODECS || '', audioGroup: a.AUDIO || '', name: a.NAME || ''});
        pendingVariant = null;
      } else {
        const r = range(byteRange, previousRange, url);
        previousRange = r;
        result.segments.push({url, duration, sequence: sequence++, key, map, range: r});
        result.duration += duration;
        duration = 0; byteRange = undefined;
      }
    }
  }
  result.variants.sort((a,b) => b.height - a.height || b.bandwidth - a.bandwidth);
  result.extension = result.segments.some(s => s.map) ? 'mp4' : 'ts';
  if (new Set(result.segments.map(s => JSON.stringify(s.map))).size > 1) issue('初始化片段发生变化，请使用本地助手合并。');
  return result;
}

function httpError(status, resource, segmentIndex) {
  const label = {playlist: '播放列表', init: '初始化片段', segment: '视频分段', key: 'AES 密钥'}[resource];
  const location = resource === 'segment' && Number.isInteger(segmentIndex) ? `${label} ${segmentIndex + 1}` : label;
  let reason;
  if (status === 401) reason = `${location}需要有效的登录授权。请回到视频网页确认仍可播放。`;
  else if (status === 403) reason = `服务器拒绝访问${location}，可能需要有效的登录授权或来源校验。`;
  else if (status === 404) reason = `${location}地址不存在或已经失效。请重新检测视频来源。`;
  else if (status === 410) reason = `${location}已不再可用。请重新检测视频来源。`;
  else reason = `请求${location}失败，服务器暂未返回可用资源。`;
  // Keep signed URLs and server response bodies out of errors and diagnostics.
  return Object.assign(new Error(`HTTP ${status}：${reason}`), {
    status, resource, fatal: [401,403,404,410].includes(status),
    ...(Number.isInteger(segmentIndex) ? {segmentIndex} : {}),
  });
}

async function request(url, {signal, range: r, text = false, resource, segmentIndex} = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(45000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, {credentials: 'include', signal: combined, headers: r ? {Range: `bytes=${r.start}-${r.end}`} : {}, ...(text ? {cache: 'no-store'} : {})});
      if (!response.ok) throw httpError(response.status, resource, segmentIndex);
      if (text) {
        const body = await response.text();
        if (body.length > 8 * 1024 * 1024) throw Object.assign(new Error('播放列表过大，请使用本地助手。'), {fatal: true});
        return {text: body, url: response.url};
      }
      if (r && (response.status !== 206 || response.headers.get('Content-Range')?.split('/')[0] !== `bytes ${r.start}-${r.end}`)) throw Object.assign(new Error('服务器未正确返回分段字节范围，已停止以避免损坏文件。'), {fatal: true});
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (r && bytes.length !== r.end - r.start + 1) throw new Error('分段长度不完整。');
      if (!bytes.length) throw new Error('服务器返回了空分段。');
      return bytes;
    } catch (error) {
      signal?.throwIfAborted();
      if (error.fatal) throw error;
      last = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw last;
}

export async function loadPlaylist(url, signal) {
  const result = await request(url, {signal, text: true, resource: 'playlist'});
  return parsePlaylist(result.text, result.url);
}

export async function downloadHls(playlist, writable, {signal, onProgress = () => {}} = {}) {
  if (playlist.variants.length) throw new Error('请先选择清晰度。');
  if (playlist.live) throw new Error('这是直播或尚未结束的视频，请使用本地助手。');
  if (playlist.issues.length) throw new Error(playlist.issues.join(' '));
  if (!playlist.segments.length) throw new Error('未找到视频分段。');
  const keys = new Map();
  let bytes = 0;
  async function get(part, sequence, resource, segmentIndex) {
    let data = await request(part.url, {signal, range: part.range, resource, segmentIndex});
    if (part.key) {
      if (part.key.unsupported) throw new Error('不支持此加密方式。');
      if (!keys.has(part.key)) {
        const raw = await request(part.key.url, {signal, resource: 'key', segmentIndex});
        if (raw.length !== 16) throw new Error('无法读取有效的 AES-128 密钥。');
        keys.set(part.key, await crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']));
      }
      try { data = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-CBC', iv: part.key.iv || sequenceIV(sequence)}, keys.get(part.key), data)); }
      catch { throw new Error('分段解密失败，密钥或视频链接可能已过期。'); }
    }
    signal?.throwIfAborted();
    return data;
  }
  // Write one segment at a time. Large videos do not accumulate in RAM.
  const map = playlist.segments[0].map;
  if (map) { const data = await get(map, 0, 'init'); await writable.write(data); bytes += data.length; }
  for (let i = 0; i < playlist.segments.length; i++) {
    const segment = playlist.segments[i];
    const data = await get(segment, segment.sequence, 'segment', i);
    await writable.write(data); bytes += data.length;
    onProgress({completed: i + 1, total: playlist.segments.length, bytes});
  }
  return bytes;
}
