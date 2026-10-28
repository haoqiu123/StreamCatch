# 更新记录

## 1.4.2

- 中英文 README、安装指南、隐私说明与安装首页；精简项目简介。
- Bilingual README, setup guides, privacy documentation and setup pages, with a simpler project overview.
- 仅调整文档、打包与版本标识，下载行为不变。 Documentation, packaging and version labels only; download behavior is unchanged.

## 1.4.1

- 正式采用 MIT 许可证开源，补齐仓库许可证与贡献说明。
- 两个发布安装包均包含完整 LICENSE 文本。
- 更新版本标识；下载与转码行为保持 1.4.0 的实现。

## 1.4.0

- 单视频网页按明确 ID 识别并合并来源，修正重复视频卡片。
- 支持 Bilibili 语言路由、分 P 和新版页面信息获取，使用网站提供的备用来源。
- 分块下载与独立临时目录，避免复用残缺文件或覆盖已有成品。
- 检查全片音画、时长和真实编码，按需转换为 H.264 / AAC MP4。
- 区分网络断流、HTTP 403、无效媒体与编码错误。
- 保留 X 信息流的封面匹配、Canvas 未加密 DASH 桥接和弹窗后台下载。
- 首次公开发布：完整 Mac 安装包、扩展包、中文指南、可重复打包脚本和自动化测试。
- Mac 安装脚本同时准备 YouTube 解析所需的 Node.js。

## 1.3.1

- 在已打开的 Canvas 页面获取未加密 DASH 清单，再由助手下载分片。
- 临时清单只在单次任务中使用，结束后清理。

## 1.2.1

- 修正 MP4 包含不兼容视频编码时 QuickTime 只有声音的问题。
- 优先选择并输出兼容的 H.264 / AAC 音画。

## 1.2.0

- X 信息流封面、作者、推文与媒体 ID 匹配，独立视频分别显示。

## 1.1.0

- 深色卡片界面、画质选择、后台下载队列、取消与本机历史。
