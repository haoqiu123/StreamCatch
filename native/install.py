#!/usr/bin/env python3
"""Install for this macOS user only; no administrator privileges required."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import sys

NAME = 'com.streamcatch.helper'
ROOT = Path(__file__).resolve().parent
HOME = Path.home()
DEST = HOME / 'Library' / 'Application Support' / 'StreamCatch'
BROWSERS = ['Google/Chrome', 'Microsoft Edge', 'BraveSoftware/Brave-Browser', 'Chromium']


def extension_id():
    manifest = json.loads((ROOT.parent / 'extension' / 'manifest.json').read_text())
    digest = hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32]
    return ''.join(chr(ord('a') + int(x, 16)) for x in digest)


def main():
    if sys.platform != 'darwin':
        raise SystemExit('此安装器适用于 macOS。浏览器基础模式无需安装本地助手。')
    if '--uninstall' in sys.argv:
        for browser in BROWSERS:
            (HOME / 'Library' / 'Application Support' / browser / 'NativeMessagingHosts' / (NAME + '.json')).unlink(missing_ok=True)
        if DEST.exists():
            shutil.rmtree(DEST)
        print('已卸载本地助手。已下载的视频保留。')
        return
    for binary in ('yt-dlp', 'ffmpeg'):
        if not shutil.which(binary):
            raise SystemExit(f'缺少 {binary}。请先运行 brew install yt-dlp ffmpeg python')
    DEST.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / 'host.py', DEST / 'host.py')
    launcher = DEST / 'launch.sh'
    runtime_bin = shlex.quote(str(Path(sys.executable).parent))
    launcher.write_text('#!/bin/sh\nexport PATH=' + runtime_bin + ':"$PATH"\nexec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(DEST / 'host.py')) + '\n')
    launcher.chmod(0o700)
    manifest = {'name':NAME,'description':'StreamCatch local video downloader','path':str(launcher),'type':'stdio','allowed_origins':[f'chrome-extension://{extension_id()}/']}
    for browser in BROWSERS:
        folder = HOME / 'Library' / 'Application Support' / browser / 'NativeMessagingHosts'
        folder.mkdir(parents=True, exist_ok=True)
        (folder / (NAME + '.json')).write_text(json.dumps(manifest, indent=2))
    print(f'安装完成。扩展 ID：{extension_id()}')
    print('重新打开 StreamCatch 弹窗，右上角显示本地助手已连接后即可下载。')
    print('视频将保存到：' + str(HOME / 'Downloads' / 'StreamCatch'))


if __name__ == '__main__':
    main()
