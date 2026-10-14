# Architecture

## Runtime flow

```text
JarvisWakeListener
  └─ on-device SFSpeechRecognizer
       └─ wake event
            └─ Tauri/Rust host shows Jarvis window
                 ├─ disarms wake listener and releases microphone
                 ├─ native AVFoundation permission preflight
                 └─ WKWebView creates WebRTC offer
                      └─ Codex app-server V3 realtime conversation
                           ├─ audio response
                           ├─ transcript events
                           └─ Codex turns, tools and approvals
```

The wake listener and Voice session never capture the microphone concurrently.
The Rust host terminates the listener and waits for `AVAudioEngine` to release
the input device before WebRTC starts.

## Thread lifecycle

The frontend stores one thread ID per canonical workspace path. The Rust host
first attempts `thread/resume`; if the stored thread is unavailable, it creates
a durable `thread/start` session and replaces the stored ID. Voice and text
input share this runtime.

## Process lifecycle

- Login start, when explicitly enabled by the user, launches the app with `--background`. The app does not enable login start during setup.
- Closing the window hides it; it does not terminate the listener.
- A cold wake launches the app with `--jarvis-wake`.
- Warm wake raises the existing window and starts Voice.
- On macOS, wake explicitly activates `NSApplication`, briefly raises the
  window level, focuses Jarvis, and then restores the normal window level.
- STOP interrupts active turns, ends Voice and rearms the listener.

## Trust boundaries

- The Swift helper receives microphone and speech-recognition access.
- The Tauri host receives microphone access for Voice and owns Codex app-server.
- The WebView can call only commands exposed through the Tauri capability file.
- Permission profiles are validated in Rust rather than accepting arbitrary
  frontend sandbox strings:
  - Safe: `workspace-write` + `on-request`
  - Auto: `workspace-write` + `never`
  - Full: `danger-full-access` + `never`
- Changing permission mode rebuilds the Codex runtime while resuming the saved
  workspace thread.
- “New thread” stops the active Voice/turn, shuts down the old runtime, and
  creates a fresh persistent thread without deleting the previous Codex history.
- No API keys are embedded in the app.

## Upstream dependency

Realtime conversation is an experimental Codex app-server surface. CI verifies
the current request shapes, but a Codex update can still change protocol
semantics. Release validation must include a real Voice smoke test.
