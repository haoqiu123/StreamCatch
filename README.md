# StreamCatch

**简体中文** · [English](README.en.md)

识别网页视频，保存到本机。

[下载 Mac 完整包](https://github.com/haoqiu123/StreamCatch/releases/latest/download/StreamCatch-macOS.zip) · [仅下载扩展](https://github.com/haoqiu123/StreamCatch/releases/latest/download/StreamCatch-extension.zip) · [更新记录](https://github.com/haoqiu123/StreamCatch/releases/latest)

![StreamCatch 界面，使用示例数据](docs/images/popup.png)

## 功能

- 封面预览、视频去重和画质选择。
- 通过 Mac 助手下载 HLS / DASH、合并音画并输出兼容 MP4。
- 后台队列、下载进度与取消。
- 本地处理，登录状态按需授权。

## 安装

1. 下载并解压 Mac 完整包，保留 `StreamCatch` 文件夹。
2. Chrome 打开 `chrome://extensions`，开启“开发者模式”→“加载已解压的扩展程序”，选择 `extension` 文件夹。
3. 首次先安装 [Homebrew](https://brew.sh/)，再双击 `安装Mac助手.command`，按提示完成安装。
4. 播放原网页视频，打开插件，选择画质并下载。

文件保存在 `~/Downloads/StreamCatch`。关闭弹窗后下载仍会继续，请保持浏览器运行。

[详细安装与常见问题](docs/INSTALL.md) · [隐私与权限](docs/PRIVACY.md) · [开发与贡献](docs/DEVELOPMENT.md)

## 支持范围

浏览器：Chrome 120+，Edge / Brave 可尝试加载。本地助手：macOS；Windows / Linux 暂无助手安装器。

当前采用开发者模式安装。DRM 内容不支持，网站权限、链接有效期和站点变化可能影响下载。

## 许可证

[MIT](LICENSE)。第三方依赖遵循各自许可证。
