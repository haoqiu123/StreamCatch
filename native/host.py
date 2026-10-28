#!/usr/bin/env python3
"""StreamCatch native messaging host. No HTTP server and no shell commands."""
import json
import copy
import importlib.util
import hashlib
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, urlsplit, urljoin

HOST = 'com.streamcatch.helper'
os.environ['PATH'] = str(Path(sys.executable).parent) + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + os.environ.get('PATH', '')
write_lock = threading.Lock()
process_lock = threading.Lock()
process = None
worker = None
cancelled = threading.Event()
completed_files = []
VERSION = '1.4.2'


class DownloadCancelled(Exception):
    pass


def send(message):
    payload = json.dumps(message, ensure_ascii=False).encode('utf-8')
    if len(payload) > 900_000:
        payload = b'{"type":"error","error":"Message too large"}'
    try:
        with write_lock:
            sys.stdout.buffer.write(struct.pack('<I', len(payload)))
            sys.stdout.buffer.write(payload)
            sys.stdout.buffer.flush()
    except (BrokenPipeError, OSError):
        cancel()


def read_exact(length):
    data = b''
    while len(data) < length:
        chunk = sys.stdin.buffer.read(length - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def valid_url(value):
    if not isinstance(value, str) or len(value) > 20000 or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid URL')
    u = urlsplit(value)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password:
        raise ValueError('Only HTTP(S) URLs are supported')
    return value


def cookie_file(cookies, urls):
    if not cookies:
        return None
    if not isinstance(cookies, list) or len(cookies) > 2000:
        raise ValueError('Too many cookies')
    hosts = {urlsplit(valid_url(u)).hostname.lower() for u in urls if u}
    lines = ['# Netscape HTTP Cookie File', '# Temporary; removed when this job ends.']
    for c in cookies:
        domain = str(c.get('domain', ''))
        bare = domain.lstrip('.').lower()
        if not bare or not any(h == bare or h.endswith('.' + bare) for h in hosts):
            continue
        parts = [domain, 'FALSE' if c.get('hostOnly', not domain.startswith('.')) else 'TRUE',
                 str(c.get('path', '/')), 'TRUE' if c.get('secure') else 'FALSE',
                 str(max(0, int(c.get('expirationDate', 0)))), str(c.get('name', '')), str(c.get('value', ''))]
        if any(re.search(r'[\r\n\t\x00]', p) for p in parts):
            continue
        if c.get('httpOnly'):
            parts[0] = '#HttpOnly_' + parts[0]
        lines.append('\t'.join(parts))
    fd, name = tempfile.mkstemp(prefix='streamcatch-', suffix='.cookies')
    with os.fdopen(fd, 'w', encoding='utf-8') as out:
        out.write('\n'.join(lines) + '\n')
    return name


def output_title(value):
    """Return a literal, bounded basename suitable for a yt-dlp template."""
    if value is None or value == '':
        return None
    if not isinstance(value, str):
        raise ValueError('文件名必须是文字。')
    value = unicodedata.normalize('NFC', value)
    # A title is never a path. Replace separators and control characters before
    # truncating; keep enough space for the source hash suffix.
    value = ''.join('_' if unicodedata.category(c) in ('Cc', 'Cf') else c for c in value)
    value = re.sub(r'[/\\:*?"<>|]', '_', value).strip(' .')
    value = re.sub(r'\.(?:mp4|mkv|webm|mov|m4v|avi|flv|ts|m2ts|mpeg|mpg|m3u8)$', '', value, flags=re.I).strip(' .')
    if not value:
        raise ValueError('请输入有效的文件名。')
    if re.match(r'^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', value, flags=re.I):
        value = '_' + value
    value = value.encode('utf-8')[:150].decode('utf-8', errors='ignore').rstrip(' .')
    # yt-dlp expands percent expressions even when passed without a shell.
    return value.replace('%', '%%')


def canonical_page(value):
    if not value:
        return None
    u = urlsplit(valid_url(value))
    if u.hostname in ('www.bilibili.com', 'bilibili.com', 'm.bilibili.com'):
        match = re.fullmatch(r'/(?:[a-z]{2}(?:-[A-Za-z]{2})?/)?video/(BV[A-Za-z0-9]{10}|av\d+)/?', u.path)
        if match:
            part = parse_qs(u.query).get('p', ['1'])[0]
            suffix = '?p=' + part if re.fullmatch(r'[1-9]\d{0,3}', part) and part != '1' else ''
            return f'https://www.bilibili.com/video/{match[1]}/' + suffix
    return None


def download_error(errors, code):
    detail = '\n'.join(errors[-3:]) or f'下载未完成（exit {code}），请检查日志。'
    if re.search(r'HTTP Error 403|HTTP.*403.*Forbidden',detail,re.I):
        return '服务器拒绝读取媒体（HTTP 403）。请在原网页登录并播放后重新检测；需要登录时，在下载设置中授权使用当前网站登录状态。403 本身不代表 DRM，受 DRM 保护的内容不支持下载。\n'+detail
    if re.search(r'bytes read,.*expected|IncompleteRead|ContentTooShortError|Connection reset|timed out',detail,re.I):
        return '网络传输未完成，未生成成品。请在原网页重新播放并重新检测后再试。\n'+detail
    if re.search(r'Invalid data found|moov atom not found|Error opening input|Invalid NAL|End of file', detail, re.I):
        return '下载结果不是有效的完整媒体，可能是失效地址、损坏分片或错误响应。请刷新原视频页并重新检测下载；未生成成品。\n' + detail
    if re.search(r'could not find tag|codec.*not.*supported|not supported in container', detail, re.I):
        return '音视频合并失败，未生成成品。请重新检测原视频页后重试。\n' + detail
    return detail


def bilibili_info(message, cookie_path=None):
    source = valid_url(message.get('url'))
    page = canonical_page(source)
    if not page and urlsplit(source).hostname.endswith(('.bilivideo.com', '.bilivideo.cn', '.bilibili.com')):
        page = canonical_page(message.get('pageUrl'))
    if not page:
        return None
    from yt_dlp import YoutubeDL
    from yt_dlp.extractor.bilibili import BiliBiliIE
    from yt_dlp.utils import ExtractorError
    requested = re.search(r'/video/([^/]+)', page).group(1)
    class NativeLogger:
        def debug(self, *args, **kwargs): pass
        def warning(self, text):
            send({'type':'log','text':re.sub(r'https?://\S+', '[视频来源]', text)[:1000]})
        error = warning
    class ModernLayoutBiliIE(BiliBiliIE):
        def extract_formats(self, play_info):
            formats = super().extract_formats(play_info)
            dash = (play_info or {}).get('dash') or {}
            tracks = list(dash.get('video') or []) + list(dash.get('audio') or [])
            tracks += (dash.get('dolby') or {}).get('audio') or []
            flac = (dash.get('flac') or {}).get('audio')
            if flac: tracks.append(flac)
            backups = {track.get('baseUrl') or track.get('base_url'):track.get('backupUrl') or track.get('backup_url') or [] for track in tracks}
            for fmt in formats:
                values = backups.get(fmt.get('url')) or []
                fmt['_streamcatch_backups'] = [valid_url(value) for value in values[:3] if isinstance(value,str)]
            return formats
        def _search_json(self, start, string, name, video_id, *args, **kwargs):
            state = super()._search_json(start, string, name, video_id, *args, **kwargs)
            if name != 'initial state' or state:
                return state
            risk = super()._search_json(r'\bwindow\._riskdata_\s*=', string, 'risk', video_id, default={})
            if risk.get('v_voucher'):
                return state  # Keep the normal rate-limit / verification error.
            query = {'platform':'web', 'bvid' if requested.startswith('BV') else 'aid':requested if requested.startswith('BV') else requested[2:]}
            detail = self._download_json('https://api.bilibili.com/x/web-interface/wbi/view/detail', video_id,
                note='读取 Bilibili 视频信息', query=self._sign_wbi(query, video_id),
                headers={'Referer':'https://www.bilibili.com/','Origin':'https://www.bilibili.com'})
            data = detail.get('data', {}).get('View') or {}
            matches = data.get('bvid') == requested if requested.startswith('BV') else str(data.get('aid')) == requested[2:]
            if detail.get('code') != 0 or not matches:
                raise ExtractorError('Bilibili 没有返回当前视频的可用信息，请确认原网页仍可播放。', expected=True)
            return {'videoData':data, 'upData':data.get('owner',{})}
    with YoutubeDL({'quiet':True,'no_warnings':False,'noplaylist':True,'skip_download':True,
                    'cookiefile':cookie_path,'socket_timeout':30,'logger':NativeLogger()}) as ydl:
        extracted = ModernLayoutBiliIE(ydl).extract(page)
        if extracted.get('_type') not in (None, 'video'):
            raise ValueError('当前 Bilibili 返回了旧式分段或合集入口，请选择具体视频分 P 后重新下载。')
        formats = extracted.get('formats') or []
        if not formats:
            raise ValueError('Bilibili 没有返回可用音画来源，请在原网页确认权限后重新检测。')
        for fmt in formats:
            valid_url(fmt.get('url'))
            if fmt.get('has_drm'):
                raise ValueError('此视频使用 DRM 保护，助手不支持下载。')
        return {key:extracted[key] for key in ('id','title','formats','duration','http_headers') if key in extracted} | {
            'webpage_url':page,'extractor':'BiliBili','extractor_key':'BiliBili'}


def backup_media_info(info):
    if not info or info.get('extractor_key') != 'BiliBili':
        return None
    renewed = copy.deepcopy(info)
    changed = False
    for fmt in renewed.get('formats', []):
        urls = fmt.pop('_streamcatch_backups', [])
        if urls:
            fmt['url'] = valid_url(urls[0])
            changed = True
    return renewed if changed else None


def command(message, destination, cookie_path=None, info_path=None):
    binary = shutil.which('yt-dlp')
    if not binary or not shutil.which('ffmpeg'):
        raise ValueError('未找到 yt-dlp 或 FFmpeg。请运行 Mac 助手安装脚本。')
    url = valid_url(message.get('url'))
    # A googlevideo request may contain only one adaptive audio/video track.
    # Give yt-dlp the known YouTube page so it can select both tracks together.
    page_url = valid_url(message['pageUrl']) if message.get('pageUrl') else None
    original_page = canonical_page(page_url)
    if canonical_page(url):
        url = canonical_page(url)
    elif original_page and urlsplit(url).hostname.endswith(('.bilivideo.com', '.bilivideo.cn', '.bilibili.com')):
        url = original_page
    if page_url and urlsplit(url).hostname.endswith('.googlevideo.com'):
        page = urlsplit(page_url)
        youtube = page.hostname in ('www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be')
        video_id = parse_qs(page.query).get('v', [''])[0] if page.path == '/watch' else page.path.rstrip('/').split('/')[-1]
        if youtube and re.fullmatch(r'[a-zA-Z0-9_-]{11}', video_id):
            url = page_url
    height = int(message.get('maxHeight', 0))
    if height not in (0, 480, 720, 1080, 2160):
        raise ValueError('Unsupported quality')
    source_id = hashlib.sha256(url.encode('utf-8')).hexdigest()[:10]
    title = output_title(message.get('title')) or '%(title).150B'
    args = [binary, '--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-overwrites', '--windows-filenames',
            '--no-colors', '--newline', '--progress', '--no-simulate', '--socket-timeout', '30',
            '--retries', '5', '--fragment-retries', '5', '--abort-on-unavailable-fragments',
            # Use a private intermediate that accepts real codec combinations.
            # The host validates/transcodes and publishes only a final MP4.
            '--no-continue', '--fixup', 'warn', '--no-write-subs', '--no-write-auto-subs', '--no-embed-subs', '--no-embed-thumbnail',
            '--concurrent-fragments', '4', '--merge-output-format', 'mkv',
            '--paths', str(destination), '--output', f'{title} [{source_id}].%(ext)s',
            '--print', 'after_move:SC_FILE:%(filepath)s',
            '--progress-template', 'download:SC_PROGRESS:%(progress._percent_str)s · %(progress._speed_str)s · ETA %(progress._eta_str)s']
    if height:
        args += ['--format', f'bv*[height<={height}]+ba/b[height<={height}]']
    else:
        args += ['--format', 'bv*+ba/b']
    # Preserve resolution preference, then prefer compatible codecs when the
    # same quality exists. Actual downloaded streams are checked below too.
    args += ['--format-sort', 'res,vcodec:h264,acodec:aac,ext:mp4:m4a']
    if canonical_page(url):
        args += ['--http-chunk-size', '2M', '--add-header', 'Cache-Control:no-cache']
    hostname = urlsplit(url).hostname
    # The current yt-dlp requires an enabled JS runtime for YouTube challenges.
    if hostname in ('www.youtube.com','youtube.com','m.youtube.com','youtu.be') and shutil.which('node'):
        args += ['--js-runtimes', 'node:' + shutil.which('node')]
    if hostname.endswith(('.instructure.com', '.instructuremedia.com')):
        if importlib.util.find_spec('curl_cffi') is None:
            raise ValueError('Canvas 下载需要浏览器兼容网络组件，请更新 Mac 助手后重试。')
        args += ['--impersonate', 'chrome', '--extractor-args', 'generic:impersonate=chrome']
    context = message.get('requestHeaders') or {}
    if not isinstance(context, dict): raise ValueError('媒体请求信息无效。')
    user_agent = context.get('userAgent')
    if user_agent:
        if not isinstance(user_agent, str) or user_agent.startswith('-') or len(user_agent)>500 or any(ord(c)<32 or ord(c)==127 for c in user_agent):
            raise ValueError('浏览器请求信息无效。')
        args += ['--user-agent', user_agent]
    referer = context.get('referer') or message.get('pageUrl')
    if referer:
        args += ['--referer', valid_url(referer)]
    if context.get('origin'):
        origin = urlsplit(valid_url(context['origin']))
        args += ['--add-header', 'Origin:'+origin.scheme+'://'+origin.netloc]
    if cookie_path:
        args += ['--cookies', cookie_path]
    args += ['--load-info-json', str(info_path)] if info_path else ['--', url]
    return args


def browser_dash_info(message):
    """Parse an already-authorized browser MPD; never re-fetch its entry URL."""
    manifest = message.get('dashManifest')
    if manifest is None:
        return None
    url = valid_url(message.get('url'))
    if not urlsplit(url).hostname.endswith('.instructuremedia.com'):
        raise ValueError('浏览器清单只用于 Canvas 媒体来源。')
    if not isinstance(manifest, str) or len(manifest.encode('utf-8')) > 256 * 1024:
        raise ValueError('Canvas 播放清单无效或过大。')
    if re.search(r'<!DOCTYPE|<!ENTITY', manifest, re.I):
        raise ValueError('Canvas 播放清单包含不支持的 XML 声明。')
    try:
        root = ET.fromstring(manifest)
    except ET.ParseError:
        raise ValueError('Canvas 播放清单不是有效 XML。') from None
    if root.tag != '{urn:mpeg:dash:schema:mpd:2011}MPD' or root.get('type') == 'dynamic':
        raise ValueError('Canvas 播放清单不是受支持的 DASH 点播。')
    if any(node.tag.split('}')[-1] == 'ContentProtection' for node in root.iter()):
        raise ValueError('此 Canvas 视频使用 DRM 保护，助手不支持下载。')
    for node in root.iter():
        if node.tag.split('}')[-1] == 'BaseURL' and node.text:
            valid_url(urljoin(url, node.text.strip()))
        for name, target in node.attrib.items():
            if name.split('}')[-1] in ('media', 'initialization', 'sourceURL', 'href', 'base'):
                valid_url(urljoin(url, target))
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.extractor.common import InfoExtractor
        from yt_dlp.utils import parse_duration
    except ImportError:
        raise ValueError('请更新 Mac 助手，安装浏览器清单解析组件。') from None
    duration = parse_duration(root.get('mediaPresentationDuration'))
    if not duration or not 0 < duration <= 86400:
        raise ValueError('Canvas 清单时长无效或过长。')
    # Bound expansion before handing a SegmentTimeline to the parser.
    for template in root.iter('{urn:mpeg:dash:schema:mpd:2011}SegmentTemplate'):
        try:
            scale = int(template.get('timescale', '1'))
            timeline = template.find('{urn:mpeg:dash:schema:mpd:2011}SegmentTimeline')
            count = 0
            if scale <= 0: raise ValueError()
            if timeline is not None:
                for segment in timeline:
                    length = int(segment.get('d', '0'))
                    repeat = int(segment.get('r', '0'))
                    if length <= 0 or repeat < -1: raise ValueError()
                    count += repeat + 1 if repeat >= 0 else int(duration * scale / length) + 2
            elif template.get('duration'):
                length = int(template.get('duration'))
                if length <= 0: raise ValueError()
                count = int(duration * scale / length) + 2
            if count > 20000: raise ValueError()
        except (ValueError, OverflowError):
            raise ValueError('Canvas 分片时间轴无效或分片过多。') from None
    class QuietLogger:
        def debug(self, *args, **kwargs): pass
        def warning(self, *args, **kwargs): pass
        def error(self, *args, **kwargs): pass
    with YoutubeDL({'quiet': True, 'no_warnings': True, 'logger': QuietLogger()}) as ydl:
        formats = InfoExtractor(ydl)._parse_mpd_formats(root, mpd_url=url, mpd_base_url=urljoin(url, '.'))
    if not formats or len(formats) > 64 or sum(len(f.get('fragments', [])) for f in formats) > 20000:
        raise ValueError('Canvas 清单没有受支持的音视频轨道或分片过多。')
    for fmt in formats:
        if fmt.get('has_drm'):
            raise ValueError('此 Canvas 视频使用 DRM 保护，助手不支持下载。')
        for key in ('url', 'manifest_url', 'fragment_base_url'):
            if fmt.get(key): valid_url(fmt[key])
        base = fmt.get('fragment_base_url') or fmt.get('url') or url
        for fragment in fmt.get('fragments', []):
            target = fragment.get('url') or fragment.get('path')
            if target: valid_url(urljoin(base, target))
    return {'id': hashlib.sha256(url.encode()).hexdigest()[:10],
            'title': str(message.get('title') or 'Canvas video')[:250],
            'formats': formats, 'duration': duration, 'webpage_url': valid_url(message.get('pageUrl') or url),
            'extractor': 'StreamCatchCanvas', 'extractor_key': 'Generic'}


def managed_process(args):
    global process
    with process_lock:
        if cancelled.is_set():
            raise DownloadCancelled()
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, encoding='utf-8', errors='replace', bufsize=1,
                                   stdin=subprocess.DEVNULL, start_new_session=True)
        return process


def media_info(path):
    """Probe real streams with FFmpeg, which is also bundled without ffprobe."""
    p = managed_process([shutil.which('ffmpeg'), '-hide_banner', '-nostdin', '-i', str(path),
                         '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-t', '0', '-f', 'null', '-'])
    output, _ = p.communicate()
    if cancelled.is_set():
        raise DownloadCancelled()
    if p.returncode:
        raise ValueError('无法读取下载文件的音视频轨道，请重新下载。')
    # Only parse the input stream declarations, not the null output codec.
    info = output.split('Stream mapping:')[0]
    video = next((m for m in re.finditer(r'^\s*Stream #\d+:\d+[^\n]*?: Video: ([\w]+)([^\n]*)', info, re.M)
                  if 'attached pic' not in m.group(0)), None)
    audio = re.search(r'^\s*Stream #\d+:\d+[^\n]*?: Audio: ([\w]+)', info, re.M)
    duration = re.search(r'Duration: (\d+):(\d+):([\d.]+)', info)
    pixel = re.search(r',\s*((?:yuv|yuva|gbr|rgb|bgr|gray|p010|nv12)[a-z0-9]+)', video.group(2)) if video else None
    return {'video': video.group(1) if video else None, 'pixel': pixel.group(1) if pixel else None,
            'audio': audio.group(1) if audio else None,
            'duration': sum(float(v) * scale for v, scale in zip(duration.groups(), (3600, 60, 1))) if duration else None}


def quicktime_compatible(info):
    return info['video'] == 'h264' and info['pixel'] in ('yuv420p', 'yuvj420p') and info['audio'] in (None, 'aac')


def verify_playback(path):
    p = managed_process([shutil.which('ffmpeg'), '-hide_banner', '-nostdin', '-v', 'error', '-xerror',
                         '-i', str(path), '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-'])
    p.communicate()
    if cancelled.is_set():
        raise DownloadCancelled()
    if p.returncode:
        raise ValueError('下载文件的画面或声音无法解码，未标记为完成。')


def ensure_compatible(path):
    """Keep H.264/AAC unchanged; convert other real codecs atomically."""
    info = media_info(path)
    if not info['video']:
        raise ValueError('只获取到音轨，没有视频画面。请从原视频网页重新下载。')
    with path.open('rb') as source:
        mp4_container = source.read(12)[4:8] == b'ftyp'
    if quicktime_compatible(info) and mp4_container:
        verify_playback(path)
        return
    fd, temporary = tempfile.mkstemp(prefix='.streamcatch-compatible-', suffix='.mp4', dir=path.parent)
    os.close(fd)
    try:
        video_copy = info['video'] == 'h264' and info['pixel'] in ('yuv420p', 'yuvj420p')
        args = [shutil.which('ffmpeg'), '-hide_banner', '-nostdin', '-y', '-i', str(path),
                '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0', '-map_chapters', '0']
        if video_copy:
            args += ['-c:v', 'copy']
        else:
            args += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high',
                     '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-threads', str(min(6, os.cpu_count() or 1))]
        args += ['-c:a', 'copy'] if info['audio'] in (None, 'aac') else ['-c:a', 'aac', '-b:a', '192k']
        args += ['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', temporary]
        send({'type': 'progress', 'text': '正在转换为 QuickTime 兼容格式 · 0.0%'})
        p = managed_process(args)
        tail, last = [], 0
        for raw in p.stdout:
            line = raw.strip()
            tail.append(line)
            tail = tail[-20:]
            if line.startswith('out_time_us=') and info['duration'] and time.monotonic() - last >= .5:
                try:
                    percent = max(0, min(99.9, float(line.split('=', 1)[1]) / 1_000_000 / info['duration'] * 100))
                except ValueError:
                    continue
                send({'type': 'progress', 'text': f'正在转换为 QuickTime 兼容格式 · {percent:.1f}%'})
                last = time.monotonic()
        code = p.wait()
        if cancelled.is_set():
            raise DownloadCancelled()
        if code:
            raise ValueError('视频兼容转换失败，未标记为完成。请重试或检查 FFmpeg。')
        converted = media_info(Path(temporary))
        if not quicktime_compatible(converted):
            raise ValueError('转换后的音视频编码检查失败，未标记为完成。')
        if info['duration'] and (not converted['duration'] or abs(converted['duration'] - info['duration']) > 1):
            raise ValueError('转换后的视频时长不完整，未标记为完成。')
        verify_playback(Path(temporary))
        if cancelled.is_set():
            raise DownloadCancelled()
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def publish_mp4(source, output):
    """Commit a fully validated file without overwriting an existing download."""
    base = source.stem
    for index in range(1,10001):
        target = output / (base + (f' ({index})' if index > 1 else '') + '.mp4')
        if cancelled.is_set():
            raise DownloadCancelled()
        try:
            os.link(source, target)
            target.chmod(0o600)
            return str(target)
        except FileExistsError:
            continue
    raise ValueError('同名文件过多，请更改文件名后重试。')


def reveal_file(value):
    """Reveal only an existing download inside StreamCatch's output folder."""
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        raise ValueError('文件路径无效。')
    folder = (Path.home() / 'Downloads' / 'StreamCatch').resolve()
    path = Path(value)
    if not path.is_absolute():
        raise ValueError('文件路径必须是完整路径。')
    path = path.resolve(strict=True)
    if not path.is_relative_to(folder) or not path.is_file():
        raise ValueError('只能打开 StreamCatch 下载文件夹内的视频文件。')
    subprocess.Popen(['/usr/bin/open', '-R', str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return str(path)


def open_downloads():
    folder = Path.home() / 'Downloads' / 'StreamCatch'
    folder.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(['/usr/bin/open', str(folder)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return str(folder)


def cancel():
    cancelled.set()
    with process_lock:
        p = process
    if p and p.poll() is None:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        def force_stop():
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        threading.Thread(target=force_stop, daemon=True).start()


def download(message):
    global process, completed_files
    cookie_path = None
    info_path = None
    staging = None
    output = Path.home() / 'Downloads' / 'StreamCatch'
    try:
        output.mkdir(parents=True, exist_ok=True)
        staging = tempfile.TemporaryDirectory(prefix='.streamcatch-job-', dir=output)
        stage = Path(staging.name)
        url = valid_url(message.get('url'))
        page_url = valid_url(message['pageUrl']) if message.get('pageUrl') else url
        cookie_path = cookie_file(message.get('cookies', []), [url, page_url])
        info = browser_dash_info(message)
        if info is None:
            info = bilibili_info(message, cookie_path)
        if info is not None:
            fd, info_path = tempfile.mkstemp(prefix='streamcatch-manifest-', suffix='.json')
            os.close(fd)
        for attempt in range(2):
            if info_path:
                with open(info_path, 'w', encoding='utf-8') as info_out:
                    json.dump(info, info_out)
            attempt_folder = stage / str(attempt)
            attempt_folder.mkdir(mode=0o700)
            args = command(message, attempt_folder, cookie_path, info_path)
            with process_lock:
                if cancelled.is_set():
                    p = None
                else:
                    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                               text=True, encoding='utf-8', errors='replace', bufsize=1,
                                               stdin=subprocess.DEVNULL, start_new_session=True)
                    p = process
            if p is None:
                send({'type': 'cancelled'})
                return
            files, errors = [], []
            for raw in p.stdout:
                line = raw.strip()
                if line.startswith('SC_FILE:'):
                    path = Path(line[len('SC_FILE:'):]).resolve()
                    if path.is_file() and path.is_relative_to(attempt_folder.resolve()):
                        files.append(str(path))
                elif line.startswith('SC_PROGRESS:'):
                    send({'type': 'progress', 'text': line[len('SC_PROGRESS:'):]})
                elif line:
                    safe = re.sub(r'https?://\S+', '[视频来源]', line)[:1500]
                    send({'type': 'log', 'text': safe})
                    if re.search(r'ERROR:|Got error:|bytes read,.*expected', safe, re.I) and safe != 'ERROR:':
                        errors.append(safe)
                        errors = errors[-8:]
            code = p.wait()
            backup = backup_media_info(info) if attempt == 0 and code and not cancelled.is_set() else None
            if backup:
                info = backup
                send({'type':'progress','text':'主线路未完成，正在使用备用音画线路重新下载…'})
                continue
            break
        completed_files = []
        if cancelled.is_set():
            send({'type': 'cancelled'})
        elif code == 0 and files:
            send({'type': 'progress', 'text': '正在检查音画轨道和播放器兼容性…'})
            for file in files:
                ensure_compatible(Path(file))
            if len(files)==1 and isinstance(info, dict) and info.get('duration'):
                actual = media_info(Path(files[0]))['duration']
                if not actual or abs(actual - float(info['duration'])) > 2:
                    raise ValueError('下载视频的时长与完整来源不一致，未生成成品。请重新检测原网页。')
            completed_files = [publish_mp4(Path(file), output) for file in files]
            send({'type': 'done', 'files': completed_files})
        else:
            send({'type': 'error', 'error': download_error(errors, code)})
    except DownloadCancelled:
        send({'type': 'cancelled'})
    except Exception as exc:
        send({'type': 'error', 'error': str(exc)})
    finally:
        with process_lock:
            process = None
        for temporary_path in (cookie_path, info_path):
            if not temporary_path:
                continue
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
        if staging:
            staging.cleanup()


def main():
    global worker, completed_files
    try:
        while True:
            header = read_exact(4)
            if header is None:
                break
            size = struct.unpack('<I', header)[0]
            if not 0 < size <= 1024 * 1024:
                break
            payload = read_exact(size)
            if payload is None:
                break
            cmd = None
            try:
                message = json.loads(payload)
                cmd = message.get('cmd')
                if cmd == 'status':
                    send({'type':'status', 'version':VERSION, 'ytdlp':bool(shutil.which('yt-dlp')), 'ffmpeg':bool(shutil.which('ffmpeg')), 'browserImpersonation':importlib.util.find_spec('curl_cffi') is not None, 'browserManifest':importlib.util.find_spec('yt_dlp') is not None})
                elif cmd == 'download':
                    if worker and worker.is_alive():
                        send({'type':'error','error':'已有下载正在进行。'})
                        continue
                    completed_files = []
                    cancelled.clear()
                    worker = threading.Thread(target=download, args=(message,))
                    worker.start()
                elif cmd == 'cancel':
                    cancel()
                elif cmd == 'reveal':
                    index = int(message.get('index', -1))
                    if not 0 <= index < len(completed_files):
                        raise ValueError('没有可打开的下载文件。')
                    send({'type':'revealed', 'command':cmd, 'path':reveal_file(completed_files[index])})
                elif cmd == 'revealFile':
                    send({'type':'revealed', 'command':cmd, 'path':reveal_file(message.get('path'))})
                elif cmd == 'openDownloads':
                    send({'type':'opened', 'command':cmd, 'path':open_downloads()})
            except Exception as exc:
                if cmd in ('reveal', 'revealFile', 'openDownloads'):
                    # Folder actions can run while downloading. Their errors
                    # must not be mistaken for a failed download by the popup.
                    send({'type':'commandError', 'command':cmd, 'error':str(exc)})
                else:
                    send({'type':'error','error':str(exc)})
    finally:
        cancel()
        if worker:
            worker.join(timeout=8)


if __name__ == '__main__':
    main()
