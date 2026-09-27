# MultiMind Flow

MultiMind Flow is a desktop workspace for discussing with multiple AI assistants and search engines side by side. It supports split-screen cells, a shared input box, per-cell configuration, and manual cross-checking between AI responses.

## 使用指南

- [应用更新](docs/app-updates.md) — 检查新版本、下载安装，以及 GitHub Releases 发布要求。

- [Bot 接入指南：账号、API Key 与费用](docs/bot-connection-guide.md) — 千问／百炼、DeepSeek、Kimi、Qoder CN 的开通与使用方式。

## Supported Platforms

- macOS: Apple Silicon and Intel builds are packaged as a Universal app.
- Windows: x64 installer.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Packaging

```bash
npm run package:mac
npm run package:win
npm run package:all
```

## Installation

### macOS

Open the `.dmg`, drag **MultiMind Flow** into **Applications**, then launch it.

The current build is not code-signed or notarized. If macOS blocks the first launch, right-click **MultiMind Flow** and choose **Open**, or allow it from **System Settings -> Privacy & Security**.

### Windows

Run the `.exe` installer and follow the prompts.

The Windows installer supports installation for the current user or for all
users, and lets you choose the installation directory. An all-users install
requests administrator permission only when it is needed.

Installing a newer version upgrades the registered MultiMind installation
instead of creating a version-by-version entry. If an all-users installation
already exists, the upgrade remains all-users and removes a duplicate
current-user installation. Setup can repair registered legacy installations
whose old uninstaller is missing or damaged.

To uninstall, close MultiMind Flow and use **Settings > Apps > Installed apps**
or the uninstall shortcut. Uninstalling removes the application and its
shortcuts from the selected installation scope. Local settings, site sessions,
and the memory library are retained so they are not lost accidentally.

The current build is not code-signed. If SmartScreen blocks it, choose **More info -> Run anyway**.

## Support the Project

MultiMind Flow is open source. If you find it useful, you can support its continued development on [Buy Me a Coffee](https://buymeacoffee.com/dirkchou). Support is optional and does not affect access to the project.

---

# MultiMind Flow 中文说明

MultiMind Flow 是一个桌面工作区，用于并排使用多个 AI 助手和搜索引擎进行讨论。它支持多格子分屏、底部统一输入、单格配置，以及手动把某个 AI 的回答转发给其它 AI 做交叉验证。

## 支持平台

- macOS：Apple Silicon 和 Intel，打包为 Universal 应用。
- Windows：x64 安装包。

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 打包

```bash
npm run package:mac
npm run package:win
npm run package:all
```

## 安装

### macOS

打开 `.dmg`，把 **MultiMind Flow** 拖入 **Applications**，然后启动应用。

当前构建未做代码签名和 notarization。首次启动如果被 macOS 拦截，可以右键 **MultiMind Flow** 选择 **Open**，或在 **System Settings -> Privacy & Security** 中允许打开。

### Windows

运行 `.exe` 安装包并按提示安装。

Windows 安装程序支持“仅为当前用户安装”和“为所有用户安装”，也支持自定义
安装目录。只有选择为所有用户安装时才会按需请求管理员权限。

安装新版本时会升级已经注册的 MultiMind 安装，不会按版本新增卸载项。如果
电脑上已有“为所有用户安装”的版本，升级会继续使用该范围，并清理当前用户
范围内的重复安装。旧卸载器缺失或损坏时，安装程序会修复已注册的历史安装。

卸载前请关闭 MultiMind Flow，然后通过 **设置 > 应用 > 已安装的应用** 或
卸载快捷方式操作。卸载会移除对应安装范围内的程序文件和快捷方式；本地设置、
网站登录状态和记忆库会保留，避免意外丢失。

当前构建未做代码签名。如果被 SmartScreen 拦截，选择 **More info -> Run anyway**。

## 支持项目

MultiMind Flow 是开源项目。如果你觉得它有帮助，可以通过 [Buy Me a Coffee](https://buymeacoffee.com/dirkchou) 自愿支持项目的持续维护。支持与否不影响项目的使用。
