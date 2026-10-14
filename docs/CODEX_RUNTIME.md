# Codex runtime and Voice compatibility

[简体中文](CODEX_RUNTIME.zh-CN.md)

Jarvis uses Voice v3 / WebRTC from a local Codex app-server. Desktop installation
layouts can change; finding an executable or checking its version number alone
does not establish Voice compatibility.

## Automatic discovery

Jarvis checks an app-bundled Codex first, followed by ChatGPT and Codex under
`/Applications` and `~/Applications`, using these layouts:

- `Contents/Resources/codex-cli/bin/codex`
- `Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`
- `Contents/Resources/codex`

It then checks Homebrew, `~/.local/bin/codex`, and `~/.cargo/bin/codex`.
Each candidate exports its local experimental schema with
`app-server generate-json-schema --experimental`. Jarvis checks Voice v3,
WebRTC, and the STOP/handoff fields it uses. Each probe has a 15-second timeout;
its temporary schema directory is removed afterward. The probe does not start
an app-server session, log in, create a thread, open the microphone, or connect
to Voice.

Automatic discovery prefers a compatible CLI over an older candidate. If only
an older CLI is available, text turns remain available and Voice reports a
compatibility error before sending a v3 request. Diagnostics include the
selected executable path.

Set `JARVIS_CODEX_BIN` to explicitly select an executable. A missing,
non-executable, or uninspectable override produces an error rather than silently
switching CLIs. An explicitly selected older CLI can still serve text turns,
but will not receive v3 requests.

## Login startup and verification

Launching Jarvis no longer enables login startup automatically. It respects
the existing user setting. Listening for the wake phrase after closing the
window remains separate from launching at login.

```bash
npm run check
# Optional: check the installed CLI without connecting to Voice.
cargo test --manifest-path src-tauri/Cargo.toml installed_codex_preflight -- --ignored --nocapture
```

Tests use protocol fixtures captured from CLI 0.142.5 and
0.162.0-alpha.17.2 on 2026-10-14. They cover legacy detection, candidate
selection, explicit overrides, invalid candidates, and STOP-field validation.

A passing schema check establishes local interface compatibility. Account
access, networking, microphone capture, WebRTC audio, and task handoffs still
require a real Voice session.

See the official [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server)
for version-specific CLI schema generation and experimental API opt-in.
