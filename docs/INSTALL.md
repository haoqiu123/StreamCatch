# 安装 StreamCatch

**简体中文** · [English](INSTALL.en.md)

## 1. 下载并解压

[下载 Mac 完整安装包](https://github.com/haoqiu123/StreamCatch/releases/latest/download/StreamCatch-macOS.zip)，双击 ZIP 解压。

把整个 `StreamCatch` 文件夹放到长期保留的位置。完成后应看到：

```text
StreamCatch/
├── 开始安装.html
├── Start Here.html
├── 安装Mac助手.command
├── 卸载Mac助手.command
├── extension/          ← Chrome 需要选择这一层
│   └── manifest.json
├── native/
├── README.md
├── README.en.md
└── docs/
```

## 2. 加载浏览器扩展

1. 打开 Chrome，在地址栏输入 `chrome://extensions` 并按回车。
2. 打开右上角的“开发者模式”。
3. 点击左上角的“加载已解压的扩展程序”。
4. 选择刚才的 **StreamCatch → extension** 文件夹。选择包含 `manifest.json` 的那一层。
5. 点击浏览器工具栏的拼图按钮，把 StreamCatch 固定到工具栏。

Edge 使用 `edge://extensions`，Brave 使用 `brave://extensions`，操作类似。本项目尚未上架 Chrome 应用商店，因此没有商店安装按钮。

## 3. 安装 Mac 助手

首次安装需要 [Homebrew](https://brew.sh/)。请先按官网说明安装 Homebrew，再继续。

双击安装包中的 **安装Mac助手.command**。终端会显示需要的依赖，并在缺少依赖时询问是否安装；输入 `y` 后按回车。等待显示“安装完成”，再按回车关闭窗口。

脚本通过 Homebrew 准备缺少的 Python、FFmpeg、Node.js，通过 PyPI 在独立 Python 环境安装 yt-dlp / curl_cffi，然后为当前用户注册助手。Homebrew 的首次安装可能需要系统授权；助手注册本身不需要管理员权限。

如果双击没有打开脚本，也可先检查脚本内容，然后在终端输入 `zsh `（末尾有空格），将该文件拖入终端窗口，再按回车。

## 4. 下载第一个视频

打开原视频网页，播放几秒后点击 StreamCatch。确认右上角显示 **本地助手已连接**，选择画质，再点击 **下载**。

成功时下载记录显示“已完成 · MP4”。文件位于 **下载 → StreamCatch**，可以点击记录旁的文件夹按钮定位。

如需登录状态，在齿轮设置中勾选相应选项。请保持浏览器运行，关闭弹窗不会影响后台任务。

## 更新

1. 下载最新完整包，先关闭正在进行的下载。
2. 将新包的内容替换到原来保留的 StreamCatch 文件夹中。
3. 在 Chrome 扩展管理页，点击 StreamCatch 卡片上的圆形“重新加载”按钮。
4. 再运行一次 `安装Mac助手.command` 更新助手，最后刷新原视频网页。

更新解析器：

```sh
"$HOME/Library/Application Support/StreamCatch/runtime/bin/python" -m pip install -U 'yt-dlp[default]'
```

## 卸载

在 Chrome 扩展管理页移除 StreamCatch；Mac 助手通过 `卸载Mac助手.command` 卸载。已下载的视频和 Homebrew 安装的依赖保留。

## 核对下载文件

Release 同时提供 `SHA256SUMS.txt`。在下载目录执行 `shasum -a 256 -c SHA256SUMS.txt`，可以核对 ZIP 是否完整。它用于检查文件一致性，不是 Apple 公证或 Chrome 商店签名。

## 常见问题

**没有发现视频？** 在原网页播放几秒，再点“重新检测”；也可以点击“没有检测到？”让助手解析原网页。

**助手未连接？** 运行 `安装Mac助手.command`，等待“安装完成”，再重新打开插件。不要删除或移动已经加载的 `extension` 文件夹。

**提示 403 或需要登录？** 先确认视频在原网页能正常播放，再重新检测。需要登录时，可在齿轮设置中授权使用当前网站登录状态；站点限制或 DRM 内容仍可能无法下载。

**中途断流？** 重新检测后重试。助手在完整性检查通过后才发布 MP4，不会把残缺文件标为完成。

**系统兼容性？** 建议使用 Homebrew 当前支持的 macOS。Intel Mac 和旧系统的依赖支持情况见 [Homebrew 官方说明](https://docs.brew.sh/Installation)。
