# 应用更新

在「设置 → 应用更新」勾选“启动时自动检查新版本”后，应用启动时会检查 GitHub Releases 的稳定版本。默认不勾选，选择会保存在本机；无论是否勾选，都可以手动检查。

- Windows：新版本支持自动安装时，点击「下载更新」，下载完成后点击「重启并安装」。回答正在生成时，请先完成或停止本轮。
- macOS：当前安装包通过「打开下载页」获取新版，下载后按安装提示替换应用。
- 检查更新不会自动下载安装包，也不会自动关闭应用。网络暂时不可用时，可以稍后重试。

## 发布者准备

更新源使用 `electron-builder.yml` 的 GitHub publish 配置。构建时生成应用内的版本检查地址，Windows 更新器读取打包生成的 `app-update.yml`。

发布新版本时：

1. 同时提升 `package.json` 和 `package-lock.json` 的版本并提交。
2. 创建并推送同版本标签（例如 `v1.1.3`）。标签会触发 GitHub Actions，在 GitHub 的 macOS 和 Windows 构建机上分别打包，不需要从本地上传安装包。
3. 工作流完成测试、安全检查和双平台打包后，创建一个 Draft Release，并上传 macOS `.dmg`、Windows NSIS `.exe`、对应 `.blockmap`、`latest.yml` 和 `SHA256SUMS.txt`。
4. 检查 Draft Release 的版本、说明和下载文件，然后发布为正式版本；草稿和预发布不会作为稳定更新。
5. 使用上一版本的已安装应用检查下载与安装流程，再确认发布可用。

已经存在的标签可以在 GitHub 的 Actions 页面手动运行“Build desktop release”，输入标签名重新构建。手动运行默认仍生成 Draft；只有明确选择 `published` 才会在构建完成后直接公开。

如需在本地验证安装包，仍可运行现有的 `npm run package:mac` 和 `npm run package:win`，但正式发布不依赖本地产物。

只有安装包、没有 `latest.yml` 的 Release 仍可被发现，但 Windows 会显示下载页入口。现有旧应用没有本次更新功能，需要先手动安装包含此功能的新版本。

在当前使用的 Electron 自动更新方案下，macOS 后续启用完整自动安装，需要应用签名并提供 ZIP 更新产物及 `latest-mac.yml`，同时调整应用更新策略。这属于当前更新方案的要求，并不意味着所有未签名应用都无法实现自定义更新流程。参见 [electron-builder 自动更新文档](https://www.electron.build/docs/features/auto-update/)。
