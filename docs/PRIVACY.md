# 数据和权限

**简体中文** · [English](PRIVACY.en.md)

StreamCatch 没有项目自建的上传、统计或遥测服务。扩展与 Mac 助手在本机通信；下载时会按用户操作访问原视频网站及其媒体服务器。

## 浏览器权限

| 权限 | 用途 |
| --- | --- |
| 网站访问、webRequest、webNavigation | 发现跨域播放器和媒体请求，清理页面切换后的旧来源 |
| activeTab、scripting | 检测当前页面及播放器信息 |
| storage | 保存设置、当前会话的检测结果和本机下载记录 |
| downloads | 浏览器下载及记录管理 |
| nativeMessaging | 与安装在本机的 Mac 助手通信 |
| cookies（可选） | 用户主动授权后，读取当前网页和媒体地址匹配的登录 Cookie |

正常媒体请求上下文只传递对应来源的 Referer、Origin、User-Agent；网络观察不会收集 Cookie、Authorization 或自定义 API 凭据。

## 登录状态

只有用户选择“使用当前网站的登录状态”并授权后，才读取相应 Cookie。Cookie 经原生消息交给本机助手，写入仅当前用户可读的临时文件供下载器使用，任务结束后清理。浏览器自身发起的请求也可能按网站规则携带已有登录 Cookie。

## 本机保存

- 检测列表和临时来源保存在浏览器当前会话中。
- 最近的下载记录保存在扩展本机存储中，包含文件名、状态和本地路径。
- 历史记录不会保存 Cookie 或带签名的媒体 URL。
- 下载在独立临时目录处理，音画和完整性检查通过后才发布成品。
- 最终视频保存在 `~/Downloads/StreamCatch`。

Mac 助手不开放本地 HTTP 服务，不接受任意 shell 命令。安装和更新依赖会访问 Homebrew、PyPI 及其依赖分发服务。

提交 Issue 前请删除 Cookie、密码、签名 URL、课程或私密内容等个人信息。
