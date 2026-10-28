# StreamCatch

[简体中文](README.md) · **English**

Find web videos. Save them locally.

[Download for Mac](https://github.com/haoqiu123/StreamCatch/releases/latest/download/StreamCatch-macOS.zip) · [Extension only](https://github.com/haoqiu123/StreamCatch/releases/latest/download/StreamCatch-extension.zip) · [Releases](https://github.com/haoqiu123/StreamCatch/releases/latest)

![StreamCatch interface with demo data](docs/images/popup.png)

## Features

- Video previews, duplicate detection and quality selection.
- HLS / DASH downloads, audio and video merging, and compatible MP4 output through the Mac helper.
- Background queue, progress tracking and cancellation.
- Local processing with optional access to the current site's login session.

## Install

1. Download and extract the Mac package. Keep the `StreamCatch` folder.
2. Open `chrome://extensions` in Chrome. Enable **Developer mode**, click **Load unpacked**, and select the `extension` folder.
3. Install [Homebrew](https://brew.sh/) first, then run `安装Mac助手.command` to set up the helper. Enter `y` if prompted to install dependencies.
4. Play a video on its original page, open StreamCatch, choose a quality and download.

Files are saved to `~/Downloads/StreamCatch`. Downloads continue when the popup closes; keep the browser running.

[Setup and troubleshooting](docs/INSTALL.en.md) · [Privacy and permissions](docs/PRIVACY.en.md) · [Development and contributions](docs/DEVELOPMENT.md)

## Support

Browser: Chrome 120+; Edge and Brave may also work. Native helper: macOS. Helper installers for Windows and Linux are not available yet. The extension interface currently uses Simplified Chinese.

Installation uses Developer mode. DRM content is unsupported. Site permissions, expiring links and website changes may affect downloads.

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses.
