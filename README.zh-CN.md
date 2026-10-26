<p align="center">
  <img src="src-tauri/icons/icon.png" width="160" alt="Jarvis 图标">
</p>

<h1 align="center">Jarvis × Codex</h1>

<p align="center">一声“嗨 Jarvis”，让 Codex 从桌面醒来。</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文 ·
  <a href="https://github.com/Big-Guan/jarvis-codex/releases/tag/v0.4.7">下载 0.4.7</a> ·
  <a href="docs/USAGE.zh-CN.md">使用指南</a> ·
  <a href="CHANGELOG.md">进化历史</a>
</p>

<p align="center">
  <img src="docs/images/nano-armor-hero.png" width="640" alt="Jarvis 真实 3D 机甲">
</p>

Jarvis × Codex 是一个 macOS 桌面语音助手。叫出唤醒词，透明机甲出现在桌面并连接 Codex Voice；你可以自然对话、打断回答，或让它在选定工作区完成实际任务。语音、文字、工具调用和任务沿用同一个 Codex 线程。

当前主分支为 **Jarvis Next 0.4.7**：真实 3D 机甲、独立管理面板、单手与鼠标操控、安静唤醒。新版使用独立的应用与配置标识，可与旧版 Jarvis Codex 分别安装。旧版源码保留在 [`legacy/jarvis-codex-v0.2`](https://github.com/Big-Guan/jarvis-codex/tree/legacy/jarvis-codex-v0.2)，已有 [v0.2.0 安装包](https://github.com/Big-Guan/jarvis-codex/releases/tag/v0.2.0) 属于旧版。

## 可以做什么

- **说话与执行任务**：本机识别「Hi / Hey Jarvis」「嗨 Jarvis」等唤醒词，直连 Codex app-server V3 / WebRTC，支持连续对话、文字任务、审批与 STOP。
- **安静唤醒**：直接显示机甲并连接语音，等待你的实际指令，不自动问候，也不弹出管理面板。
- **桌面与管理分离**：面板配置皮肤、外观、声音、手势、工作区与权限；桌面只显示机甲。两个窗口可以同时存在，切换面板不会中断语音。
- **真实 3D 与出场**：165 个独立网格，保留原始几何与贴图；由远及近飞行、多次撞击、逐步脱甲、碎片散落后在中央聚合，可选择快速出场或关闭。
- **单手与鼠标控制**：张掌旋转并调整碎片间距、捏合移动、握拳合体；鼠标也可旋转、移动、缩放和复位。
- **状态动效**：待机呼吸，倾听和说话随实际音量发光，工作时流光扫过装甲；发光强度和动态效果可调。
- **自己的工作区**：选择文件夹与权限，放置资料、自我介绍和交付物；不同工作区分别续接线程。

## 视觉演进

### v0.1.x · 全息工作台

![早期 Jarvis 全息工作台](docs/images/jarvis-main-ui.png)

第一版把任务角色、转写、文字输入和 STOP 放在常驻 HUD 中，让执行过程可见。

### v0.2.0 · 透明角色界面

<p align="center">
  <img src="public/assets/jarvis-character-v2.png" width="420" alt="v0.2.0 透明角色">
</p>

角色成为桌面界面的中心，加入粒子聚合、装甲碎片和随状态变化的视觉效果。这一阶段采用角色图像与动效，语音和工作区能力继续沿用。

### 3D 探索 → v0.4.x · Jarvis Next

从分部件模型验证出发，加入真正可旋转、拆散和重组的机甲，再发展成管理 GUI 与透明桌面窗口分离的应用。后续逐步完善左右手识别、鼠标操控、独立桌面语音、暂停与隐藏、状态灯光和安静唤醒。

![Jarvis Next 外观管理面板](docs/screenshots/0.4.6-presence-preview.png)

*这是 0.4.6 原生外观页截图，0.4.7 沿用这套界面。设置留在面板，桌面机甲没有悬浮工具栏。版本细节见[更新历史](CHANGELOG.md)。*

## 下载与安装

[下载 Jarvis Next 0.4.7（Apple Silicon DMG）](https://github.com/Big-Guan/jarvis-codex/releases/download/v0.4.7/Jarvis-Next_0.4.7_arm64.dmg)，适用于 macOS 14+ 的 M 系列 Mac。打开 DMG，把 `Jarvis Next.app` 拖到「应用程序」。安装包已包含机甲与手势资源，无需安装 Node.js、Rust、Tripo 或 Blender；语音仍需要已登录且兼容的 Codex。

**本安装包使用临时签名，尚未经过 Apple Developer ID 签名和 Apple 公证。** 首次打开可能被 macOS 拦截；确认下载来源与发布页校验值后，可按 [Apple 官方说明](https://support.apple.com/zh-cn/102445) 在「系统设置 → 隐私与安全性」为该应用选择「仍要打开」。发布页同时提供 SHA-256 校验文件。

本版与旧版 Jarvis Codex 使用不同应用标识。安装后在管理面板选择自己的工作文件夹，再配置麦克风、唤醒和手势权限。

## 从源码构建

需要 macOS 14+、Xcode Command Line Tools、Rust stable（含 `rustfmt` / `clippy`）和 Node.js 20.19+ 或 22.12+。本机验证平台为 Apple Silicon，CI 使用 Node 22。语音还需要已登录且支持 V3 / WebRTC 的本机 Codex。

```sh
git clone https://github.com/Big-Guan/jarvis-codex.git jarvis-next
cd jarvis-next
npm ci
npm run check
npm run build
open "src-tauri/target/release/bundle/macos/Jarvis Next.app"
```

构建后也可双击 `打开 Jarvis Next.command`。本机构建默认使用临时签名；唤醒助手与桌面状态助手显式以 macOS 14 为最低目标，避免继承构建机的较新系统版本。

```sh
npm run dev      # 原生 Tauri 应用
npm run web:dev  # 浏览器预览：http://127.0.0.1:4400
```

浏览器预览模型、动画和配置；原生透明窗口、唤醒、Voice 与任务执行需要 macOS 应用。当前没有 Windows / Linux 原生版本。

## 第一次使用

1. 打开「工作区与权限」，选择已有文件夹与权限，保存。
2. 在「语音与唤醒」配置声音与设备；需要口令唤醒时开启监听，并授权麦克风和语音识别。
3. 点击「打开 Jarvis」，或说出唤醒词。连接后直接倾听，无需再点击启动。
4. 从菜单栏重新打开管理面板；需要手势时再开启摄像头，默认可直接用鼠标操作。

| 操作 | 效果 |
| --- | --- |
| 张掌 / 捏合 / 握拳 | 旋转并收放碎片 / 移动 / 合体后旋转 |
| 左键拖动 / Shift + 左键或右键拖动 | 旋转 / 移动 |
| 滚轮 / 双击 | 临时缩放 / 恢复正脸微仰的朝向 |
| 暂停 / 继续 | 停止或恢复音频与手势交互，执行中的任务继续 |
| 隐藏 Jarvis | 隐藏机甲并释放摄像头，语音和任务继续 |
| 停止全部 | 结束语音并取消任务 |

暂停、隐藏和 STOP 在管理面板与菜单栏。「仅显示机甲」和「只看出场效果」不建立语音连接。工作区、自我介绍和常见问题见[使用指南](docs/USAGE.zh-CN.md)。

## 连接、权限与数据

本机唤醒助手 → 释放麦克风 → 机甲窗口建立 WebRTC → Codex app-server V3 → 工作区线程。机甲窗口持有音频，管理面板控制同一会话；复用本机 Codex 登录。

| 权限 | 沙箱 / 审批策略 | 用途 |
| --- | --- | --- |
| 安全模式 | `workspace-write` / `on-request` | 按需确认操作 |
| 自动办公 | `workspace-write` / `never` | 工作区内自主执行 |
| 完全访问 | `danger-full-access` / `never` | 明确选择后的广泛文件访问 |

手势摄像头画面在本机处理，不保存、不上传；语音和任务连接 Codex 服务。配置与导入皮肤保存在 `~/Library/Application Support/com.bigguan.jarvis-next/`，资料和成果保存在所选工作区。隐藏机甲不等于关闭麦克风，要停止交互请用暂停或停止全部。

应用会检查本机 Codex 的 V3 / WebRTC 协议兼容性。可用 `JARVIS_NEXT_CODEX_BIN` 指定可执行文件；协议不兼容时，语音会报错，文字任务仍可用。启动应用不会擅自开启登录自启。

## 检查与贡献

提交改动前运行 `npm run check` 和 `npm run build`。自动检查覆盖 33 项 TypeScript 与 11 项 Rust 测试、前端编译、格式和 Clippy；另有一项本机 Codex 检查需显式运行。唤醒、音频、摄像头和打包修改还需要 macOS 实机测试。

已有桌面语音试用确认与安静唤醒的模拟检查；自动测试不代表真人唤醒识别率、手势体感或长期稳定性验收。Codex 实时接口仍属实验能力，上游变化可能需要兼容修复。欢迎通过 Issue 或 Pull Request 提交反馈和改进。

代码使用 [GPL-3.0](LICENSE)，第三方组件保留原有声明，见[模型与资源说明](docs/ASSETS.md)。本项目是基于 Codex 接口的独立客户端。
