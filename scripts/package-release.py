#!/usr/bin/env python3
"""Build clean, reproducible GitHub release assets using the standard library."""
from pathlib import Path
import hashlib
import json
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
PUBLIC_FILES = ['LICENSE', 'README.md', 'CHANGELOG.md', '开始安装.html', '安装Mac助手.command',
                '卸载Mac助手.command', 'native/host.py', 'native/install.py',
                'docs/INSTALL.md', 'docs/PRIVACY.md', 'docs/images/popup.png']


def extension_files():
    for path in sorted((ROOT / 'extension').rglob('*')):
        if path.is_file() and not path.is_symlink() and path.name != '.DS_Store' and '__pycache__' not in path.parts:
            yield path.relative_to(ROOT)


def archive(name, prefix, files, extension_only=False):
    with zipfile.ZipFile(DIST / name, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as out:
        for relative in sorted(files, key=str):
            source = ROOT / relative
            if not source.is_file() or source.is_symlink():
                raise ValueError(f'Missing or symbolic public file: {relative}')
            member = relative.relative_to('extension') if extension_only and relative.parts[0] == 'extension' else relative
            info = zipfile.ZipInfo(str(Path(prefix) / member), date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = (stat.S_IFREG | (0o755 if source.suffix == '.command' else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            out.writestr(info, source.read_bytes())


def main():
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
    assert manifest['version'] == json.loads((ROOT / 'package.json').read_text())['version']
    DIST.mkdir(exist_ok=True)
    files = list(extension_files())
    archive('StreamCatch-extension.zip', 'StreamCatch-extension', files + [Path('LICENSE')], extension_only=True)
    archive('StreamCatch-macOS.zip', 'StreamCatch', files + [Path(p) for p in PUBLIC_FILES])
    assets = ['StreamCatch-extension.zip', 'StreamCatch-macOS.zip']
    (DIST / 'SHA256SUMS.txt').write_text(''.join(
        f'{hashlib.sha256((DIST / name).read_bytes()).hexdigest()}  {name}\n' for name in assets))
    for name in assets:
        with zipfile.ZipFile(DIST / name) as package:
            assert package.testzip() is None
        print(f'{name}: {(DIST / name).stat().st_size:,} bytes · version {manifest["version"]}')
    print('SHA256SUMS.txt written. No dependencies, user data or test media bundled.')


if __name__ == '__main__':
    main()
