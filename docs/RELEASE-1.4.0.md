StreamCatch 首个公开安装版：在浏览器弹窗中识别视频、选择画质，由 Mac 助手下载和合并为兼容 MP4。

## 下载哪个文件

- **Mac 用户：`StreamCatch-macOS.zip`**，包含扩展、助手安装脚本和中文安装页面。
- **仅需要扩展：`StreamCatch-extension.zip`**，解压后加载包含 `manifest.json` 的文件夹。
- **`SHA256SUMS.txt`**，用于核对下载文件。

请下载下面 Assets 中的安装包。GitHub 自动附带的 Source code 是开发源码包。

## 安装

1. 下载、解压完整包，把 `StreamCatch` 放到长期保留的位置。
2. Chrome 地址栏输入 `chrome://extensions`，开启“开发者模式”→“加载已解压的扩展程序”→选择 `StreamCatch/extension`。
3. 双击 `安装Mac助手.command` 并按提示完成安装。首次需要先安装 [Homebrew](https://brew.sh/)。
4. 播放原网页视频几秒，再打开插件，确认“本地助手已连接”后下载。

[完整中文安装指南](https://github.com/haoqiu123/StreamCatch/blob/main/docs/INSTALL.md) · [隐私与权限](https://github.com/haoqiu123/StreamCatch/blob/main/docs/PRIVACY.md)

## 本版功能

- 深色视频卡片、封面与时长，合并同一视频的重复来源。
- HLS / DASH 和音画分离支持，选择画质上限。
- 后台队列、进度、取消和本机下载记录。
- Bilibili 页面识别和备用线路处理，修复无效媒体被误报为 MP4 编码失败。
- 检查全片音画和真实编码，必要时转换为 H.264 / AAC MP4。
- Mac 安装脚本准备 Python、FFmpeg、Node.js 和下载组件。

验证：78 项 JavaScript、28 项 Python / 安装脚本测试通过；隔离浏览器界面验证通过。安装包不含用户浏览器数据、Cookie、下载记录或测试视频。

## 支持范围

本地助手安装器适用于 macOS；Windows / Linux 暂无对应助手安装器。此版本尚未上架 Chrome 应用商店，需要手动加载解压后的扩展文件夹。无法保证所有网站可下载，DRM 内容不支持。
