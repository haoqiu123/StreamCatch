# Install StreamCatch

[简体中文](INSTALL.md) · **English**

## 1. Download

[Download the Mac package](https://github.com/haoqiu123/StreamCatch/releases/latest/download/StreamCatch-macOS.zip) and extract it. Move the entire `StreamCatch` folder somewhere you will keep, such as Documents.

Open `Start Here.html` for the English setup page, or `开始安装.html` for Chinese.

```text
StreamCatch/
├── Start Here.html
├── 开始安装.html
├── 安装Mac助手.command       ← Install Mac helper
├── 卸载Mac助手.command       ← Uninstall Mac helper
├── extension/               ← Select this folder in Chrome
│   └── manifest.json
├── native/
├── README.md
├── README.en.md
└── docs/
```

## 2. Load the extension

1. Open Chrome and enter `chrome://extensions` in the address bar.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select **StreamCatch → extension**, the folder containing `manifest.json`.
5. Open Chrome's extensions menu and pin StreamCatch to the toolbar.

For Edge, use `edge://extensions`; for Brave, use `brave://extensions`. This GitHub version uses Developer mode and is not listed in the Chrome Web Store.

## 3. Install the Mac helper

Install [Homebrew](https://brew.sh/) using its official instructions first.

Double-click **安装Mac助手.command**. The installer currently displays Chinese prompts. Enter `y` and press Return when asked to install missing dependencies. Wait for **安装完成** (installation complete), then press Return to close the window.

The script prepares Python, FFmpeg and Node.js through Homebrew, installs yt-dlp and curl_cffi into a separate Python environment through PyPI, and registers the helper for your user account. Homebrew setup may require system authorization; helper registration itself does not require administrator access.

If double-clicking does not launch the script, review it first. Then type `zsh ` in Terminal, drag the `.command` file into the window, and press Return.

## 4. Download a video

Play the video on its original page for a few seconds, then open StreamCatch. **本地助手已连接** means the helper is connected. Choose a quality and click **下载** (Download).

Completed downloads show **已完成 · MP4**. Files are saved to **Downloads → StreamCatch**. Click the folder button beside a completed entry to reveal it in Finder.

For sites requiring login, use the gear menu to grant access to the current site's session. Keep the browser running; closing the popup will not stop a download.

## Update

1. Finish or cancel active downloads, then download the latest full package.
2. Replace the contents of your existing StreamCatch folder with the new files.
3. Open Chrome's extensions page and click the circular **Reload** button on the StreamCatch card.
4. Run `安装Mac助手.command` again to update the helper, then refresh the original video page.

To update the site extractor:

```sh
"$HOME/Library/Application Support/StreamCatch/runtime/bin/python" -m pip install -U 'yt-dlp[default]'
```

## Uninstall

Remove StreamCatch from Chrome's extensions page. Run `卸载Mac助手.command` to remove the Mac helper. Downloaded videos and Homebrew dependencies are kept.

## Verify downloads

Each release includes `SHA256SUMS.txt`. In the download folder, run `shasum -a 256 -c SHA256SUMS.txt` to check the ZIP files. These checksums verify file consistency; they are not Apple notarization or a Chrome Web Store signature.

## Troubleshooting

**No video detected?** Play the video for a few seconds, then click **重新检测** (Rescan). **没有检测到？** lets the helper try the original page directly.

**Helper disconnected?** Run `安装Mac助手.command` until installation completes, then reopen the popup. Keep the loaded `extension` folder in place.

**HTTP 403 or login required?** Check that the original page plays normally, then rescan. You can optionally grant session access in settings. Site restrictions and DRM may still prevent downloads.

**Connection interrupted?** Rescan and retry. The helper publishes MP4 files only after integrity checks; incomplete files are not reported as complete.

**Which macOS versions work?** Use a macOS version supported by Homebrew. See [Homebrew's requirements](https://docs.brew.sh/Installation) for Intel Macs and older systems.
