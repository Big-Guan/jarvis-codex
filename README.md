<p align="center">
  <img src="src-tauri/icons/icon.png" width="160" alt="Jarvis Codex icon">
</p>

<h1 align="center">Jarvis × Codex</h1>

<p align="center">
  Wake Codex from your desktop with “Hey Jarvis.”
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/Big-Guan/jarvis-codex/releases/latest">Download the latest DMG</a>
  ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <img src="public/assets/jarvis-character-v2.png" width="520" alt="Jarvis Codex transparent avatar">
</p>

Jarvis × Codex is a local voice workspace for macOS. Say the wake phrase and a
transparent Jarvis window rises from the desktop, then connects to the same
Codex thread through the Codex app-server WebRTC interface. You can speak
naturally, interrupt a response, continue the conversation, and ask Codex to
perform real work in the selected project.

> Current status: wake, live transcription, voice responses, and Codex task
> execution have been verified on Apple Silicon running macOS 26. Realtime
> conversation is still an experimental Codex app-server capability, so
> upstream protocol changes may require compatibility updates.

## What it does

- Recognizes “Hi/Hey Jarvis” and Chinese Jarvis wake phrases on-device
- Opens a transparent, borderless Tauri 2 desktop interface
- Connects directly to Codex Voice through app-server V3 WebRTC
- Keeps voice, text, tool activity, and task execution in the same Codex thread
- Stores one persistent thread per canonical workspace path
- Supports natural turn-taking, interruption, follow-up questions, and STOP
- Offers safe, automatic workspace, and full-access permission profiles
- Runs in the background at login and raises the window on warm or cold wake
- Falls back to text input when Voice is temporarily unavailable

Jarvis does not simulate clicks in the Codex or ChatGPT applications, register
a global hotkey, or create a separate GPT-Live session. It reuses the local
Codex authentication and app-server runtime.

## Visual evolution

### v0.1.x — holographic workstation

![Jarvis Codex v0.1.x holographic workstation](docs/images/jarvis-main-ui.png)

The first version used a persistent HUD with task roles, transcripts, text
input, and STOP controls. It emphasized visibility into what Codex was doing.

### v0.2.0 — transparent character interface

The second version makes Jarvis the interface itself. Particles, armor shards,
and energy rings assemble the character when it wakes. Controls remain hidden
until the pointer enters the character area, while audio levels and task states
drive breathing, scanning, acknowledgement, approval, completion, and error
effects.

The visual layer consumes the existing audio, transcript, and task events. It
does not replace the wake listener, WebRTC connection, workspace thread
resumption, permission profiles, or interruption logic.

## How it works

```text
JarvisWakeListener (on-device speech recognition)
        ↓
Tauri / Rust host raises the Jarvis window
        ↓
The wake listener releases the microphone
        ↓
WebView creates a WebRTC offer
        ↓
Codex app-server V3 realtime conversation
        ↓
One Codex thread for voice, text, tools, and project work
```

The Swift wake helper and the Voice session never capture the microphone at the
same time. See [Architecture](docs/ARCHITECTURE.md) for the runtime, thread, and
trust boundaries.

## Quick start

1. Install and sign in to Codex App, ChatGPT App, or Codex CLI on your Mac.
2. Download the latest DMG and drag `Jarvis Codex` into Applications.
3. Allow microphone and speech-recognition access on first launch.
4. Open Settings and select the project directory Codex should work in.
5. Close the window to leave Jarvis listening in the background.
6. Say “Hey Jarvis,” then speak your task when the window appears.
7. Move the pointer over Jarvis to reveal controls; select `STOP` to interrupt
   Voice and the active task.

If Voice is unavailable, use the text field at the bottom. Voice and text use
the thread associated with the current workspace.

## Permission profiles

| Profile | Sandbox | Approval policy | Intended use |
| --- | --- | --- | --- |
| Safe | `workspace-write` | `on-request` | Confirm operations when needed |
| Auto | `workspace-write` | `never` | Work autonomously inside the workspace |
| Full | `danger-full-access` | `never` | Explicitly enabled high-trust work |

Permission profile values are validated by the Rust host. The frontend cannot
send arbitrary sandbox or approval-policy strings.

## Requirements

For regular use:

- macOS 13 or later
- Apple Silicon for the currently published DMG
- Codex App, ChatGPT App, or Codex CLI installed and signed in
- Microphone and speech-recognition permission

For source development:

- Node.js 20 or later
- Rust stable with `rustfmt` and `clippy`
- Xcode Command Line Tools and Swift

## Development

```bash
npm ci
npm run check
npm run dev
```

To set the initial development workspace:

```bash
JARVIS_WORKSPACE=/absolute/path npm run dev
```

You can also save a workspace in Jarvis Settings.

## Testing

Before opening a pull request, run:

```bash
npm run check
npm run build
```

Changes to wake, microphone, Voice, STOP, thread resumption, permissions, or
packaging also require a real macOS smoke test. The current automated tests
verify important protocol and lifecycle invariants, but cannot prove that the
experimental realtime service or macOS privacy prompts work end to end.

## Build

```bash
npm run build
```

Expected outputs:

- `src-tauri/target/release/bundle/macos/Jarvis Codex.app`
- `src-tauri/target/release/bundle/dmg/Jarvis Codex_0.2.0_aarch64.dmg`

The build script creates and signs `JarvisWakeListener.app`. The generated app
bundle is not committed to Git.

## Production releases

Local builds use the ad-hoc signing identity `-`. Public distribution requires
an Apple Developer ID Application certificate and notarization. Do not publish
an ad-hoc build as a production release.

See the [production release checklist](docs/PRODUCTION.md) for signing,
notarization, entitlement, and smoke-test requirements.

## Privacy and security

- Wake recognition requires on-device speech recognition.
- Microphone audio reaches Codex Voice only after wake.
- Raw audio and login credentials are not stored by Jarvis.
- The WebView uses a restrictive content security policy.
- Automatic mode remains confined to the selected workspace.
- Full access must be selected explicitly.
- Siri is not part of the runtime path.

Please report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a
public issue.

## License

Jarvis × Codex is released under the [GNU General Public License v3.0](LICENSE).

## Contributing

Contributions are welcome. The `main` branch is protected and does not accept
direct pushes. Contributors must fork the repository, create a branch in their
fork, and open a pull request. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
starting work.

## Codex runtime compatibility

Jarvis discovers current Codex/ChatGPT desktop CLI layouts and checks Voice v3
compatibility before connecting. Launching the app does not automatically
enable login startup. See [runtime details](docs/CODEX_RUNTIME.md).
