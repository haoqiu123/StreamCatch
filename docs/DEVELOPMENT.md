# 开发与贡献 / Development

[简体中文首页](../README.md) · [English overview](../README.en.md)

扩展源码位于 `extension/`，可直接加载，无需编译。Mac 助手源码位于 `native/`。

The extension lives in `extension/` and can be loaded without a build step. The Mac helper lives in `native/`.

## 检查 / Checks

Node.js 22+:

```sh
npm test
npm run check
```

Python:

```sh
python3 -m pip install 'yt-dlp[default]>=2026.10.26'
python3 -m unittest discover -s tests -p '*_test.py'
```

## 打包 / Packaging

```sh
python3 scripts/package-release.py
```

生成的 ZIP 和 SHA-256 校验文件位于 `dist/`。发布包包含公共运行文件、双语说明和 MIT 许可证。

ZIP files and SHA-256 checksums are written to `dist/`. Packages include public runtime files, bilingual documentation and the MIT license.

## 参与 / Contributing

欢迎提交 Issue 和 Pull Request。请说明问题、改动与验证方式，运行相关检查，并删除日志中的凭据、签名链接和私人内容。

Issues and pull requests are welcome. Describe the problem, changes and validation, run the relevant checks, and remove credentials, signed URLs and private content from logs.

[MIT 许可证 / MIT license](../LICENSE)
