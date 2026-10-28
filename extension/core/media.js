export function httpUrl(value, base) {
  try {
    const u = new URL(value, base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}

export function classify(url, mime = '') {
  const valid = httpUrl(url);
  if (!valid) return null;
  const path = new URL(valid).pathname.toLowerCase();
  const type = mime.toLowerCase().split(';')[0].trim();
  if (/\.m3u8?$/.test(path) || /mpegurl/.test(type)) return 'hls';
  if (/\.mpd$/.test(path) || type === 'application/dash+xml') return 'dash';
  // Individual chunks are not complete videos.
  if (/\.(m4s|ts|m4a|aac|vtt|srt|key|jpg|png|gif|webp)$/.test(path) || type === 'video/mp2t') return null;
  if (/\.(mp4|m4v|webm|mov|mkv|ogv|avi)$/.test(path) || type.startsWith('video/')) return 'file';
  return null;
}

export function safeFilename(title, extension = '') {
  let s = String(title || 'video').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/\.{2,}/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100);
  if (!s || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = `video_${s}`;
  if (extension) s = s.replace(/\.(mp4|m4v|webm|mov|mkv|ogv|avi|ts|m3u8|mpd)$/i, '') + '.' + extension;
  return s;
}

export function fileExtension(url, mime = '') {
  const ext = new URL(url).pathname.match(/\.(mp4|m4v|webm|mov|mkv|ogv|avi)$/i)?.[1];
  return ext?.toLowerCase() || ({'video/webm':'webm', 'video/quicktime':'mov', 'video/x-matroska':'mkv', 'video/ogg':'ogv'}[mime.split(';')[0]] || 'mp4');
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '大小未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function durationText(n) {
  if (!Number.isFinite(n)) return '时长未知';
  const seconds = Math.round(n);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
