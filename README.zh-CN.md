<p align="center">
  <img src="src-tauri/icons/icon.png" width="160" alt="Jarvis Codex 图标">
</p>

<h1 align="center">Jarvis × Codex</h1>

<p align="center">
  一声“嗨 Jarvis”，让 Codex 从桌面醒来。
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center">
  <a href="https://github.com/Big-Guan/jarvis-codex/releases/latest">下载最新版 DMG</a>
  ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

<p align="center">
  <img src="public/assets/jarvis-character-v2.png" width="520" alt="Jarvis Codex 透明角色界面">
</p>

Jarvis × Codex 是一个 macOS 本地语音工作入口。说出唤醒词后，透明窗口从桌面升起，
粒子与装甲碎片聚合成 Jarvis；随后通过 Codex app-server WebRTC 进入同一个
Codex 线程。你可以自然对话、打断回复、继续追问，也可以让 Codex 在选定项目中
真正执行任务。

> 当前状态：已在 macOS 26 Apple Silicon 实机验证唤醒、实时转写、语音回复和
> Codex 任务执行。Realtime conversation 仍是实验性的 Codex app-server 能力，
> 上游协议升级时可能需要同步适配。

## 主要能力

- 使用本机语音识别唤醒词：嗨/嘿 Jarvis、Hi/Hey Jarvis、嗨/嘿贾维斯
- Tauri 2 + Rust + TypeScript 透明无边框桌面界面
- 通过 app-server V3 WebRTC 直接连接 Codex Voice
- 语音、文字、工具事件和任务执行共用同一个 Codex 线程
- 按规范化后的工作目录持久化并续接不同线程
- 支持自然轮流说话、回复中打断、连续追问和 STOP
- 提供安全、自动办公和完全访问三档权限
- 登录时后台启动，冷启动或暖启动唤醒后升起窗口
- Voice 临时不可用时可以使用文字输入

Jarvis 不模拟点击 Codex 或 ChatGPT 窗口，不绑定全局热键，也不创建第二套
GPT-Live 会话。它复用本机 Codex 的登录状态和 app-server runtime。

## 视觉演进

### v0.1.x：全息工作台

![Jarvis Codex v0.1.x 全息工作台](docs/images/jarvis-main-ui.png)

第一版采用完整 HUD 工作台，任务角色、对话记录、文字输入和 STOP 控制常驻页面，
重点是让用户清楚地看到 Codex 正在做什么。

### v0.2.0：透明角色界面

第二版让 Jarvis 本身成为界面。唤醒时，粒子、装甲碎片与能量环聚合成完整角色；
鼠标移入角色区域后才显示控制按钮。音频电平和任务状态会驱动呼吸、扫描、确认、
等待授权、完成和异常等视觉反馈。

视觉层只消费已有的音频、转写和任务事件，不替换唤醒监听、WebRTC 连接、工作目录
线程续接、权限模式或任务中断逻辑。

## 工作原理

```text
JarvisWakeListener（本机语音识别）
        ↓
Tauri / Rust 宿主升起 Jarvis 窗口
        ↓
唤醒监听器释放麦克风
        ↓
WebView 创建 WebRTC offer
        ↓
Codex app-server V3 realtime conversation
        ↓
语音、文字、工具和项目任务共用一个 Codex 线程
```

Swift 唤醒 helper 与 Voice 会话不会同时采集麦克风。运行时、线程生命周期和信任
边界详见[架构文档](docs/ARCHITECTURE.md)。

## 快速开始

1. 在 Mac 上安装并登录 Codex App、ChatGPT App 或 Codex CLI。
2. 下载最新 DMG，把 `Jarvis Codex` 拖入“应用程序”。
3. 首次启动时允许麦克风和语音识别权限。
4. 打开设置，选择希望 Codex 工作的项目目录。
5. 关闭窗口，让 Jarvis 留在后台监听。
6. 对电脑说“嗨 Jarvis”，窗口升起后直接说出任务。
7. 将鼠标移到 Jarvis 上显示控制按钮；点击 `STOP` 可中断 Voice 和当前任务。

Voice 暂时不可用时，可以使用底部文字输入框。语音和文字都会进入当前工作目录所
对应的线程。

## 权限模式

| 模式 | Sandbox | 审批策略 | 使用场景 |
| --- | --- | --- | --- |
| 安全模式 | `workspace-write` | `on-request` | 需要时确认操作 |
| 自动办公 | `workspace-write` | `never` | 在当前工作目录内自主执行 |
| 完全访问 | `danger-full-access` | `never` | 用户明确启用的高信任任务 |

权限配置由 Rust 宿主验证，前端不能传入任意 sandbox 或审批策略字符串。

## 系统要求

普通使用：

- macOS 13 或更高版本
- 当前发布的 DMG 面向 Apple Silicon
- 已安装并登录 Codex App、ChatGPT App 或 Codex CLI
- 麦克风和语音识别权限

源码开发：

- Node.js 20 或更高版本
- Rust stable，并安装 `rustfmt` 和 `clippy`
- Xcode Command Line Tools 和 Swift

## 本地开发

```bash
npm ci
npm run check
npm run dev
```

设置开发时的初始工作目录：

```bash
JARVIS_WORKSPACE=/absolute/path npm run dev
```

也可以在 Jarvis 设置面板中保存工作目录。

## 测试

提交 Pull Request 前请运行：

```bash
npm run check
npm run build
```

如果修改了唤醒、麦克风、Voice、STOP、线程续接、权限或打包逻辑，还需要在真实
macOS 环境执行 smoke test。现有自动化测试会检查重要协议与生命周期约束，但不能
证明实验性 realtime 服务和 macOS 隐私授权端到端正常。

## 构建

```bash
npm run build
```

预期产物：

- `src-tauri/target/release/bundle/macos/Jarvis Codex.app`
- `src-tauri/target/release/bundle/dmg/Jarvis Codex_0.2.0_aarch64.dmg`

构建脚本会生成并签名 `JarvisWakeListener.app`，生成的 app bundle 不进入 Git。

## 生产发布

本地构建默认使用 ad-hoc 签名身份 `-`。公开分发必须使用 Apple Developer ID
Application 证书并完成 notarization，不应把 ad-hoc 构建描述为生产版本。

签名、公证、entitlement 和 smoke test 要求见[生产发布清单](docs/PRODUCTION.md)。

## 隐私与安全

- 唤醒词强制使用本机语音识别。
- 只有唤醒后，麦克风音频才进入 Codex Voice。
- Jarvis 不保存原始音频和登录凭据。
- WebView 使用限制性内容安全策略。
- 自动办公模式限制在选定工作目录内。
- 完全访问必须由用户主动选择。
- Siri 不参与主链路。

安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告，不要创建公开 Issue。

## 开源许可证

Jarvis × Codex 使用 [GNU General Public License v3.0](LICENSE) 开源。

## 参与贡献

欢迎参与项目贡献。`main` 分支受到保护，不接受直接推送。贡献者需要先 Fork 仓库，
在自己的 Fork 中创建分支，然后提交 Pull Request。开始开发前请阅读
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 本地运行时兼容性

Jarvis 会识别新版 Codex/ChatGPT 桌面 CLI 路径，并在连接语音前检查 Voice v3
兼容性。启动应用不会自动启用开机自启。详见[运行时说明](docs/CODEX_RUNTIME.zh-CN.md)。
