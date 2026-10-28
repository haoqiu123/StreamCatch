# Privacy and permissions

[简体中文](PRIVACY.md) · **English**

StreamCatch has no project-operated upload, analytics or telemetry service. The extension communicates with the Mac helper locally. Downloads contact the original website and its media servers in response to your actions.

## Browser permissions

| Permission | Purpose |
| --- | --- |
| Site access, webRequest, webNavigation | Detect cross-origin players and media requests; clear stale sources after navigation |
| activeTab, scripting | Read media and player information from the current page |
| storage | Store settings, session detection results and local download history |
| downloads | Browser downloads and download record management |
| nativeMessaging | Communicate with the installed Mac helper |
| cookies (optional) | Read cookies matching the selected page and media URL after you grant access |

Normal media request context includes only the corresponding Referer, Origin and User-Agent. Network observation does not collect Cookie, Authorization or custom API credentials.

## Login sessions

Cookies are read only when you enable session access and grant permission. Matching cookies are sent to the local helper through native messaging and placed in a temporary file readable only by your user account. The file is removed when the task ends. Requests made by the browser may also carry existing site cookies according to browser rules.

## Local storage

- Detected media and temporary source data are kept in the current browser session.
- Recent download records are stored locally and include file names, status and local paths.
- History does not retain cookies or signed media URLs.
- Downloads use isolated temporary directories. Final files are published after media and integrity checks.
- Completed videos are saved to `~/Downloads/StreamCatch`.

The helper does not open a local HTTP server or accept arbitrary shell commands. Dependency installation and updates contact Homebrew, PyPI and their distribution services.

Before opening an issue, remove cookies, passwords, signed URLs and private course or media information.
