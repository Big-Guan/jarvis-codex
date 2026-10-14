# Codex 运行时与 Voice 兼容性

Jarvis 使用本机 Codex app-server 的 Voice v3 / WebRTC。Codex 桌面安装结构会变化，
不能以“文件存在”或 CLI 版本号作为语音兼容性的充分依据。

## 自动选择

优先检查应用资源内的 Codex，然后检查 `/Applications` 和 `~/Applications` 内
ChatGPT/Codex 的以下路径：

- `Contents/Resources/codex-cli/bin/codex`
- `Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`
- `Contents/Resources/codex`

最后检查 Homebrew、`~/.local/bin/codex` 和 `~/.cargo/bin/codex`。
每个候选通过本地 `app-server generate-json-schema --experimental` 检查 Voice v3、
WebRTC 及使用的 STOP/交接字段，单次最多等待 15 秒。临时协议文件随后删除。
这一步不启动 app-server 会话，不登录，不创建线程，不打开麦克风，不连接 Voice。

自动选择会跳过不兼容候选，优先选择语音兼容的 CLI；如果只有旧版，仍允许文字任务，
但会在发起 Voice 请求前给出兼容性错误。错误与诊断日志包含所选文件路径。

可用 `JARVIS_CODEX_BIN` 指定可执行文件。
显式设置不存在、不可执行或无法检查的文件会报错，不会悄悄换用其他 CLI。
显式指定旧版时仍可使用文字功能，但不会向它发送 v3 请求。

## 自启与验证

启动应用不再自动启用登录启动项，尊重用户现有设置。关闭窗口后继续监听唤醒词的
行为与开机自启是两个独立功能。

```bash
npm run check
# 可选：验证本机选择的 CLI；仅导出协议，不进行语音连接。
cargo test --manifest-path src-tauri/Cargo.toml installed_codex_preflight -- --ignored --nocapture
```

测试包含本机 CLI 0.142.5 和 0.162.0-alpha.17.2 在 2026-10-14 导出的协议样本，
覆盖旧版识别、自动选择、显式覆盖、无效文件和 STOP 字段检查。

协议检查通过仅证明本地接口匹配。账户权限、网络、麦克风、WebRTC 音频及任务交接
仍需实际 Voice 会话验证。

官方依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)，
其中说明 CLI 导出的协议与该 CLI 版本对应，实验接口需显式启用。
