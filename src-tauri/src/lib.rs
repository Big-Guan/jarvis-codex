mod codex_binary;
mod launch;
mod next;
mod voice_policy;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex, RwLock},
    time::{timeout, Duration},
};

struct AppState {
    runtime: Mutex<Option<Arc<CodexRuntime>>>,
    cold_wake_pending: AtomicBool,
    background_start: bool,
    wake_enabled: AtomicBool,
    wake_ready: AtomicBool,
    wake_supervisor_running: AtomicBool,
    wake_pid: AtomicU32,
    wake_authorization: RwLock<String>,
}

#[tauri::command]
fn startup_is_background(state: State<'_, AppState>) -> bool {
    state.background_start
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn request_microphone_permission() -> Result<String, String> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
    use std::sync::Mutex as StdMutex;

    let media_type =
        unsafe { AVMediaTypeAudio }.ok_or_else(|| "macOS 未提供音频授权类型".to_owned())?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    match status {
        AVAuthorizationStatus::Authorized => return Ok("authorized".to_owned()),
        AVAuthorizationStatus::Denied => return Ok("denied".to_owned()),
        AVAuthorizationStatus::Restricted => return Ok("restricted".to_owned()),
        _ => {}
    }

    let (sender, receiver) = oneshot::channel::<bool>();
    let sender = Arc::new(StdMutex::new(Some(sender)));
    {
        let completion_sender = sender.clone();
        let completion = RcBlock::new(move |granted: Bool| {
            if let Ok(mut guard) = completion_sender.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(granted.as_bool());
                }
            }
        });
        unsafe {
            AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &completion);
        }
    }
    let granted = receiver
        .await
        .map_err(|_| "macOS 麦克风授权回调中断".to_owned())?;
    Ok(if granted { "authorized" } else { "denied" }.to_owned())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn request_microphone_permission() -> Result<String, String> {
    Ok("authorized".to_owned())
}

struct CodexRuntime {
    writer: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    thread_id: RwLock<Option<String>>,
    active_turn: RwLock<Option<String>>,
    voice_active: AtomicBool,
    voice_phase: RwLock<String>,
    realtime_session_id: RwLock<Option<String>>,
    voice_error: Option<String>,
    permission_mode: PermissionMode,
    workspace: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum PermissionMode {
    Safe,
    Auto,
    Full,
}

struct PermissionProfile {
    approval_policy: &'static str,
    sandbox: &'static str,
    instructions: &'static str,
}

impl PermissionMode {
    fn profile(self) -> PermissionProfile {
        match self {
            Self::Safe => PermissionProfile {
                approval_policy: "on-request",
                sandbox: "workspace-write",
                instructions: "Require explicit confirmation when Codex requests approval for actions outside the workspace boundary or for risky operations.",
            },
            Self::Auto => PermissionProfile {
                approval_policy: "never",
                sandbox: "workspace-write",
                instructions: "Work autonomously inside the selected workspace. Never request elevated access; if an action is blocked by the sandbox, explain the blocked boundary and continue with the safest in-workspace alternative.",
            },
            Self::Full => PermissionProfile {
                approval_policy: "never",
                sandbox: "danger-full-access",
                instructions: "Full filesystem and network access is enabled. Still avoid destructive or irreversible actions unless the user explicitly requested the exact action and target.",
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    thread_id: String,
    cwd: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectVoiceInfo {
    codex_connected: bool,
    voice_active: bool,
    phase: String,
    protocol: &'static str,
    thread_id: Option<String>,
    realtime_session_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WakeStatus {
    enabled: bool,
    ready: bool,
    authorization: String,
}

fn raise_jarvis_window(app: &AppHandle) {
    next::show_panel(app);
}

impl CodexRuntime {
    async fn spawn(
        app: AppHandle,
        permission_mode: PermissionMode,
        workspace: String,
    ) -> Result<Arc<Self>, String> {
        let codex_binary = codex_binary::resolve(
            app.path().resource_dir().ok(),
            &["JARVIS_NEXT_CODEX_BIN", "JARVIS_CODEX_BIN"],
        )
        .await?;
        eprintln!("Codex runtime: {}", codex_binary.path.display());
        let mut child = Command::new(&codex_binary.path)
            // Realtime is an experimental app-server surface. Enable it only
            // for this isolated Jarvis child; never mutate ~/.codex/config.toml.
            .args(["app-server", "--enable", "realtime_conversation", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("无法启动 codex app-server：{error}"))?;
        let writer = child.stdin.take().ok_or("无法连接 Codex stdin")?;
        let stdout = child.stdout.take().ok_or("无法连接 Codex stdout")?;
        let stderr = child.stderr.take().ok_or("无法连接 Codex stderr")?;
        let runtime = Arc::new(Self {
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            thread_id: RwLock::new(None),
            active_turn: RwLock::new(None),
            voice_active: AtomicBool::new(false),
            voice_phase: RwLock::new("standby".to_owned()),
            realtime_session_id: RwLock::new(None),
            voice_error: codex_binary
                .voice_error
                .map(|error| format!("{}：{error}", codex_binary.path.display())),
            permission_mode,
            workspace,
        });

        let weak = Arc::downgrade(&runtime);
        let event_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                eprintln!(
                    "codex rpc: id={} method={}",
                    message
                        .get("id")
                        .map(Value::to_string)
                        .unwrap_or_else(|| "-".to_owned()),
                    message.get("method").and_then(Value::as_str).unwrap_or("-")
                );
                if message.get("method").is_none() {
                    if let Some(id) = message.get("id").and_then(Value::as_u64) {
                        if let Some(runtime) = weak.upgrade() {
                            if let Some(sender) = runtime.pending.lock().await.remove(&id) {
                                let result = if let Some(error) = message.get("error") {
                                    Err(error
                                        .get("message")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Codex request failed")
                                        .to_owned())
                                } else {
                                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                                };
                                let _ = sender.send(result);
                            }
                        }
                    }
                    continue;
                }
                if let Some(runtime) = weak.upgrade() {
                    match message.get("method").and_then(Value::as_str) {
                        Some("turn/started") => {
                            *runtime.active_turn.write().await = message
                                .pointer("/params/turn/id")
                                .and_then(Value::as_str)
                                .map(str::to_owned);
                        }
                        Some("turn/completed") => *runtime.active_turn.write().await = None,
                        Some("thread/realtime/started") => {
                            runtime.voice_active.store(true, Ordering::SeqCst);
                            *runtime.voice_phase.write().await = "connected".to_owned();
                            *runtime.realtime_session_id.write().await = message
                                .pointer("/params/realtimeSessionId")
                                .and_then(Value::as_str)
                                .map(str::to_owned);
                        }
                        Some("thread/realtime/error") => {
                            runtime.voice_active.store(false, Ordering::SeqCst);
                            *runtime.voice_phase.write().await = "error".to_owned();
                        }
                        Some("thread/realtime/closed") => {
                            runtime.voice_active.store(false, Ordering::SeqCst);
                            *runtime.voice_phase.write().await = "closed".to_owned();
                            *runtime.realtime_session_id.write().await = None;
                        }
                        _ => {}
                    }
                }
                let _ = event_app.emit("codex-event", message);
            }
        });
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("codex stderr: {line}");
                if line.contains("ERROR") {
                    let _ = app.emit("codex-diagnostic", line);
                }
            }
        });
        Ok(runtime)
    }

    async fn write(&self, message: &Value) -> Result<(), String> {
        let mut payload = serde_json::to_vec(message).map_err(|error| error.to_string())?;
        payload.push(b'\n');
        let mut writer = self.writer.lock().await;
        writer
            .write_all(&payload)
            .await
            .map_err(|error| error.to_string())?;
        writer.flush().await.map_err(|error| error.to_string())
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        if let Err(error) = self
            .write(&json!({"id": id, "method": method, "params": params}))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        timeout(Duration::from_secs(90), receiver)
            .await
            .map_err(|_| format!("{method} 响应超时"))?
            .map_err(|_| format!("{method} 响应通道关闭"))?
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({"method": method, "params": params}))
            .await
    }

    async fn thread(&self) -> Result<String, String> {
        self.thread_id
            .read()
            .await
            .clone()
            .ok_or("Jarvis 尚未连接 Codex 线程".to_owned())
    }
}

async fn runtime(state: &State<'_, AppState>) -> Result<Arc<CodexRuntime>, String> {
    state
        .runtime
        .lock()
        .await
        .clone()
        .ok_or("Jarvis runtime 尚未启动".to_owned())
}

async fn direct_voice_info(state: &State<'_, AppState>) -> DirectVoiceInfo {
    let runtime = state.runtime.lock().await.clone();
    let Some(runtime) = runtime else {
        return DirectVoiceInfo {
            codex_connected: false,
            voice_active: false,
            phase: "standby".to_owned(),
            protocol: "Codex app-server V3 · WebRTC",
            thread_id: None,
            realtime_session_id: None,
        };
    };
    let phase = runtime.voice_phase.read().await.clone();
    let thread_id = runtime.thread_id.read().await.clone();
    let realtime_session_id = runtime.realtime_session_id.read().await.clone();
    DirectVoiceInfo {
        codex_connected: true,
        voice_active: runtime.voice_active.load(Ordering::SeqCst),
        phase,
        protocol: "Codex app-server V3 · WebRTC",
        thread_id,
        realtime_session_id,
    }
}

#[tauri::command]
async fn direct_voice_status(state: State<'_, AppState>) -> Result<DirectVoiceInfo, String> {
    Ok(direct_voice_info(&state).await)
}

fn wake_helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let relative = PathBuf::from("wake-helper/build.noindex/JarvisNextWake.app");
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(&relative);
        if bundled.exists() {
            return Ok(bundled);
        }
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    if development.exists() {
        return Ok(development);
    }
    Err("Jarvis 唤醒监听器未找到".to_owned())
}

fn host_app_bundle_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let contents_dir = resource_dir.parent()?;
    let bundle = contents_dir.parent()?;
    (bundle.extension().and_then(|value| value.to_str()) == Some("app"))
        .then(|| bundle.to_path_buf())
}

async fn wake_status_value(state: &AppState) -> WakeStatus {
    WakeStatus {
        enabled: state.wake_enabled.load(Ordering::SeqCst),
        ready: state.wake_ready.load(Ordering::SeqCst),
        authorization: state.wake_authorization.read().await.clone(),
    }
}

fn start_wake_supervisor(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.wake_supervisor_running.swap(true, Ordering::SeqCst) {
        return;
    }
    state.wake_enabled.store(true, Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let helper = match wake_helper_path(&app) {
            Ok(path) => path,
            Err(error) => {
                *state.wake_authorization.write().await = error.clone();
                state.wake_enabled.store(false, Ordering::SeqCst);
                state.wake_supervisor_running.store(false, Ordering::SeqCst);
                let _ = app.emit("jarvis-wake-status", wake_status_value(&state).await);
                return;
            }
        };
        // A previous host may have exited while its LaunchServices helper
        // remained alive. Keep exactly one microphone listener.
        let _ = Command::new("/usr/bin/pkill")
            .args(["-x", "JarvisNextWake"])
            .status()
            .await;

        let mut woke = false;
        while state.wake_enabled.load(Ordering::SeqCst) {
            state.wake_ready.store(false, Ordering::SeqCst);
            let event_file =
                std::env::temp_dir().join(format!("jarvis-next-wake-{}.jsonl", std::process::id()));
            let _ = fs::remove_file(&event_file);
            if let Err(error) = fs::write(&event_file, "") {
                *state.wake_authorization.write().await = format!("无法创建唤醒事件通道：{error}");
                break;
            }
            if !state.wake_enabled.load(Ordering::SeqCst) {
                let _ = fs::remove_file(&event_file);
                break;
            }

            // LaunchServices is required so macOS attributes microphone and
            // speech-recognition permissions to the helper app bundle.
            let mut command = Command::new("/usr/bin/open");
            command
                .args(["-n", "-W"])
                .arg(&helper)
                .args(["--args", "--event-file"])
                .arg(&event_file);
            if let Some(host_app) = host_app_bundle_path(&app) {
                command.arg("--host-app").arg(host_app);
            }
            let mut child = match command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
            {
                Ok(child) => child,
                Err(error) => {
                    *state.wake_authorization.write().await =
                        format!("无法启动唤醒监听器：{error}");
                    break;
                }
            };
            state
                .wake_pid
                .store(child.id().unwrap_or(0), Ordering::SeqCst);
            let mut processed = 0usize;

            loop {
                let content = fs::read_to_string(&event_file).unwrap_or_default();
                let lines: Vec<&str> = content.lines().collect();
                for line in lines.iter().skip(processed) {
                    let Ok(message) = serde_json::from_str::<Value>(line) else {
                        continue;
                    };
                    match message.get("type").and_then(Value::as_str) {
                        Some("authorization") => {
                            let authorization = message
                                .get("status")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown");
                            *state.wake_authorization.write().await = authorization.to_owned();
                            // `notDetermined` means the helper has just asked
                            // macOS for access. Keep it alive so the native
                            // permission sheet can complete its callback.
                            if matches!(authorization, "denied" | "restricted") {
                                state.wake_enabled.store(false, Ordering::SeqCst);
                            }
                        }
                        Some("ready") => {
                            state.wake_ready.store(true, Ordering::SeqCst);
                        }
                        Some("wake") => {
                            woke = true;
                            state.wake_enabled.store(false, Ordering::SeqCst);
                            state.wake_ready.store(false, Ordering::SeqCst);
                            // The persistent session owner routes wake to the avatar window.
                        }
                        Some("error") => {
                            *state.wake_authorization.write().await = message
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("wake listener error")
                                .to_owned();
                        }
                        _ => {}
                    }
                    let _ = app.emit("jarvis-wake-status", wake_status_value(&state).await);
                    if woke {
                        break;
                    }
                }
                processed = lines.len();
                if woke || !state.wake_enabled.load(Ordering::SeqCst) {
                    break;
                }
                if child.try_wait().ok().flatten().is_some() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
            }

            if woke || !state.wake_enabled.load(Ordering::SeqCst) {
                let _ = Command::new("/usr/bin/pkill")
                    .args(["-x", "JarvisNextWake"])
                    .status()
                    .await;
            }
            let _ = child.wait().await;
            let _ = fs::remove_file(&event_file);
            state.wake_pid.store(0, Ordering::SeqCst);
            if woke || !state.wake_enabled.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }

        state.wake_ready.store(false, Ordering::SeqCst);
        state.wake_supervisor_running.store(false, Ordering::SeqCst);
        if woke {
            // The WebView owns the RTCPeerConnection, so wake only raises the
            // Jarvis surface and asks the renderer to begin the official Codex
            // app-server V3 Voice handshake. No keypress or UI automation.
            let _ = app.emit("jarvis-wake", json!({"ok": true}));
        }
        let _ = app.emit("jarvis-wake-status", wake_status_value(&state).await);
    });
}

#[tauri::command]
async fn arm_wake_listener(app: AppHandle) -> Result<WakeStatus, String> {
    if app
        .state::<next::NextState>()
        .suspended
        .load(Ordering::SeqCst)
    {
        return Ok(WakeStatus {
            enabled: false,
            ready: false,
            authorization: "系统休眠或锁屏".into(),
        });
    }
    start_wake_supervisor(app.clone());
    tokio::time::sleep(Duration::from_millis(80)).await;
    Ok(wake_status_value(&app.state::<AppState>()).await)
}

#[tauri::command]
async fn disarm_wake_listener(app: AppHandle) -> Result<WakeStatus, String> {
    let state = app.state::<AppState>();
    state.wake_enabled.store(false, Ordering::SeqCst);
    state.wake_ready.store(false, Ordering::SeqCst);
    let pid = state.wake_pid.swap(0, Ordering::SeqCst);
    if pid > 0 {
        let _ = Command::new("/bin/kill")
            .arg(pid.to_string())
            .status()
            .await;
    }
    // The supervisor starts asynchronously and can cross this command in
    // flight. Keep terminating until it has observed wake_enabled=false.
    for _ in 0..15 {
        let _ = Command::new("/usr/bin/pkill")
            .args(["-x", "JarvisNextWake"])
            .status()
            .await;
        if !state.wake_supervisor_running.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // AVAudioEngine releases the input device asynchronously after SIGTERM.
    // Starting WebRTC in the same tick can otherwise fail with NotAllowedError.
    tokio::time::sleep(Duration::from_millis(350)).await;
    Ok(wake_status_value(&state).await)
}

#[tauri::command]
async fn wake_listener_status(app: AppHandle) -> WakeStatus {
    wake_status_value(&app.state::<AppState>()).await
}

#[tauri::command]
async fn consume_cold_wake(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    if !state.cold_wake_pending.swap(false, Ordering::SeqCst) {
        return Ok(false);
    }
    // Replay a cold launch through the same external event path as a normal
    // warm wake, but only after the newly spawned listener fully releases mic.
    state.wake_enabled.store(false, Ordering::SeqCst);
    state.wake_ready.store(false, Ordering::SeqCst);
    let pid = state.wake_pid.swap(0, Ordering::SeqCst);
    if pid > 0 {
        let _ = Command::new("/bin/kill")
            .arg(pid.to_string())
            .status()
            .await;
    }
    for _ in 0..15 {
        let _ = Command::new("/usr/bin/pkill")
            .args(["-x", "JarvisNextWake"])
            .status()
            .await;
        if !state.wake_supervisor_running.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(350)).await;
    // The persistent session owner routes wake to the avatar window.
    let _ = app.emit("jarvis-wake", json!({"ok": true, "cold": true}));
    Ok(true)
}

#[tauri::command]
fn default_workspace() -> Result<String, String> {
    if let Ok(configured) = std::env::var("JARVIS_WORKSPACE") {
        let path = PathBuf::from(configured);
        if path.is_dir() {
            return path
                .canonicalize()
                .map(|value| value.to_string_lossy().into_owned())
                .map_err(|error| format!("无法读取 JARVIS_WORKSPACE：{error}"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let path = PathBuf::from(home);
        if path.is_dir() {
            return Ok(path.to_string_lossy().into_owned());
        }
    }
    std::env::current_dir()
        .map(|value| value.to_string_lossy().into_owned())
        .map_err(|error| format!("无法确定默认工作目录：{error}"))
}

fn validated_workspace(cwd: &str) -> Result<String, String> {
    let path = PathBuf::from(cwd);
    if !path.is_dir() {
        return Err(format!("工作目录不存在或不是文件夹：{cwd}"));
    }
    path.canonicalize()
        .map(|value| value.to_string_lossy().into_owned())
        .map_err(|error| format!("无法读取工作目录：{error}"))
}

async fn terminate_runtime(state: &AppState) -> Result<(), String> {
    if let Some(runtime) = state.runtime.lock().await.take() {
        runtime
            .child
            .lock()
            .await
            .kill()
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

async fn ensure_runtime(
    app: AppHandle,
    state: &State<'_, AppState>,
    cwd: &str,
    resume_thread_id: Option<&str>,
    permission_mode: PermissionMode,
) -> Result<Arc<CodexRuntime>, String> {
    let cwd = validated_workspace(cwd)?;
    let existing = { state.runtime.lock().await.clone() };
    if let Some(existing) = existing {
        if existing.permission_mode == permission_mode && existing.workspace == cwd {
            return Ok(existing);
        }
        terminate_runtime(state).await?;
    }
    let profile = permission_mode.profile();
    let runtime = CodexRuntime::spawn(app, permission_mode, cwd.clone()).await?;
    runtime.request("initialize", json!({
        "clientInfo": {"name": "jarvis-next", "title": "Jarvis Next", "version": env!("CARGO_PKG_VERSION")},
        "capabilities": {"experimentalApi": true}
    })).await?;
    runtime.notify("initialized", json!({})).await?;
    let thread_options = json!({
        "cwd": cwd,
        "approvalPolicy": profile.approval_policy,
        "sandbox": profile.sandbox,
        "baseInstructions": format!(
            "You are Codex speaking through the local Jarvis interface. Keep voice replies concise and natural, execute real tasks with Codex tools when asked, report progress while work continues, and accept spoken corrections in the same thread. {} {}",
            voice_policy::LISTEN_FIRST, profile.instructions
        )
    });
    let started = if let Some(thread_id) = resume_thread_id.filter(|value| !value.trim().is_empty())
    {
        let mut resume_options = thread_options.clone();
        resume_options["threadId"] = Value::String(thread_id.to_owned());
        match runtime.request("thread/resume", resume_options).await {
            Ok(resumed) => resumed,
            Err(_) => {
                let mut start_options = thread_options;
                start_options["ephemeral"] = Value::Bool(false);
                runtime.request("thread/start", start_options).await?
            }
        }
    } else {
        let mut start_options = thread_options;
        start_options["ephemeral"] = Value::Bool(false);
        runtime.request("thread/start", start_options).await?
    };
    let thread_id = started
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .ok_or("Codex 未返回 threadId")?
        .to_owned();
    *runtime.thread_id.write().await = Some(thread_id.clone());
    *state.runtime.lock().await = Some(runtime.clone());
    Ok(runtime)
}

#[tauri::command]
async fn start_jarvis(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: String,
    thread_id: Option<String>,
    permission_mode: PermissionMode,
) -> Result<SessionInfo, String> {
    let runtime = ensure_runtime(app, &state, &cwd, thread_id.as_deref(), permission_mode).await?;
    let thread_id = runtime.thread().await?;
    Ok(SessionInfo { thread_id, cwd })
}

#[tauri::command]
async fn start_codex_voice(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: String,
    thread_id: Option<String>,
    permission_mode: PermissionMode,
    sdp: String,
    voice: Option<String>,
) -> Result<DirectVoiceInfo, String> {
    if !sdp.starts_with("v=0") {
        return Err("WebRTC SDP offer 无效".to_owned());
    }
    let runtime = ensure_runtime(app, &state, &cwd, thread_id.as_deref(), permission_mode).await?;
    if let Some(error) = &runtime.voice_error {
        return Err(error.clone());
    }
    let thread_id = runtime.thread().await?;
    if runtime.voice_active.load(Ordering::SeqCst) {
        let _ = runtime
            .request("thread/realtime/stop", json!({"threadId": thread_id}))
            .await;
    }
    *runtime.voice_phase.write().await = "starting".to_owned();
    runtime.voice_active.store(false, Ordering::SeqCst);
    *runtime.realtime_session_id.write().await = None;

    let params = voice_policy::start_params(&thread_id, &sdp, voice.as_deref());
    if let Err(error) = runtime.request("thread/realtime/start", params).await {
        *runtime.voice_phase.write().await = "error".to_owned();
        return Err(format!("Codex Voice V3 启动失败：{error}"));
    }
    Ok(direct_voice_info(&state).await)
}

#[tauri::command]
async fn stop_codex_voice(state: State<'_, AppState>) -> Result<DirectVoiceInfo, String> {
    let Ok(runtime) = runtime(&state).await else {
        return Ok(direct_voice_info(&state).await);
    };
    if !runtime.voice_active.load(Ordering::SeqCst)
        && *runtime.voice_phase.read().await != "starting"
    {
        return Ok(direct_voice_info(&state).await);
    }
    let thread_id = runtime.thread().await?;
    *runtime.voice_phase.write().await = "stopping".to_owned();
    let result = runtime
        .request("thread/realtime/stop", json!({"threadId": thread_id}))
        .await;
    runtime.voice_active.store(false, Ordering::SeqCst);
    *runtime.voice_phase.write().await = "closed".to_owned();
    *runtime.realtime_session_id.write().await = None;
    result?;
    Ok(direct_voice_info(&state).await)
}

#[tauri::command]
async fn append_codex_voice_text(state: State<'_, AppState>, text: String) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Voice 文本不能为空".to_owned());
    }
    let runtime = runtime(&state).await?;
    if !runtime.voice_active.load(Ordering::SeqCst) {
        return Err("Codex Voice 尚未连接".to_owned());
    }
    let thread_id = runtime.thread().await?;
    runtime
        .request(
            "thread/realtime/appendText",
            json!({"threadId": thread_id, "role": "user", "text": text}),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn send_text(state: State<'_, AppState>, text: String) -> Result<(), String> {
    let runtime = runtime(&state).await?;
    let thread_id = runtime.thread().await?;
    runtime
        .request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{"type": "text", "text": text, "text_elements": []}]
            }),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn stop_all(state: State<'_, AppState>) -> Result<(), String> {
    let Ok(runtime) = runtime(&state).await else {
        return Ok(());
    };
    let thread_id = runtime.thread().await?;
    // Continue checking because a Voice handoff may arrive immediately after STOP.
    let mut interrupted_turn: Option<String> = None;
    let mut interrupt_error: Option<String> = None;
    for _ in 0..6 {
        let active_turn = { runtime.active_turn.read().await.clone() };
        if let Some(turn_id) = active_turn {
            if interrupted_turn.as_deref() != Some(turn_id.as_str()) {
                match runtime
                    .request(
                        "turn/interrupt",
                        json!({"threadId":thread_id,"turnId":turn_id}),
                    )
                    .await
                {
                    Ok(_) => {
                        interrupted_turn = Some(turn_id);
                        interrupt_error = None;
                    }
                    Err(error) => interrupt_error = Some(error),
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    let mut failures = Vec::new();
    if runtime.active_turn.read().await.is_some() {
        if let Some(error) = interrupt_error {
            failures.push(format!("任务中断失败：{error}"));
        }
    }
    match runtime
        .request(
            "thread/backgroundTerminals/list",
            json!({"threadId":thread_id,"limit":100}),
        )
        .await
    {
        Ok(background) => {
            if let Some(terminals) = background.get("data").and_then(Value::as_array) {
                for terminal in terminals {
                    if let Some(process_id) = terminal.get("processId").and_then(Value::as_str) {
                        if let Err(error) = runtime
                            .request(
                                "thread/backgroundTerminals/terminate",
                                json!({"threadId":thread_id,"processId":process_id}),
                            )
                            .await
                        {
                            failures.push(format!("后台进程停止失败：{error}"));
                        }
                    }
                }
            }
        }
        Err(error) => failures.push(format!("无法确认后台进程状态：{error}")),
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

#[tauri::command]
async fn resolve_server_request(
    state: State<'_, AppState>,
    request_id: Value,
    approved: bool,
) -> Result<(), String> {
    let runtime = runtime(&state).await?;
    runtime.write(&json!({"id": request_id, "result": {"decision": if approved {"accept"} else {"decline"}}})).await
}

#[tauri::command]
async fn shutdown(state: State<'_, AppState>) -> Result<(), String> {
    terminate_runtime(&state).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let arguments: Vec<String> = std::env::args().collect();
    let launch_mode = launch::LaunchMode::from_args(&arguments);
    let cold_wake_pending = launch_mode == launch::LaunchMode::Wake;
    let background_start = !launch_mode.opens_panel();
    tauri::Builder::default()
        .manage(next::NextState::default())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            runtime: Mutex::new(None),
            cold_wake_pending: AtomicBool::new(cold_wake_pending),
            background_start,
            wake_enabled: AtomicBool::new(false),
            wake_ready: AtomicBool::new(false),
            wake_supervisor_running: AtomicBool::new(false),
            wake_pid: AtomicU32::new(0),
            wake_authorization: RwLock::new("notDetermined".to_owned()),
        })
        .invoke_handler(tauri::generate_handler![
            direct_voice_status,
            arm_wake_listener,
            disarm_wake_listener,
            wake_listener_status,
            consume_cold_wake,
            default_workspace,
            startup_is_background,
            request_microphone_permission,
            start_jarvis,
            start_codex_voice,
            stop_codex_voice,
            append_codex_voice_text,
            send_text,
            stop_all,
            resolve_server_request,
            shutdown,
            next::load_settings,
            next::save_settings,
            next::export_json,
            next::check_environment,
            next::list_skins,
            next::import_skin,
            next::publish_snapshot,
            next::read_snapshot,
            next::dispatch_action,
            next::avatar_feedback,
            next::publish_levels,
            next::window_mode,
            next::ensure_session_visible,
            next::record_media_sample,
            next::publish_session,
            next::read_session,
            next::request_session,
            next::reply_session,
            next::session_signal,
            next::monitor_list,
            next::mouse_control,
            next::request_camera_permission,
            next::quit_next
        ])
        .setup(move |app| {
            use tauri_plugin_autostart::MacosLauncher;
            app.handle().plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                Some(vec!["--background"]),
            ))?;
            // Windows start hidden so a voice/login launch cannot flash settings
            // before the WebViews finish loading. Only manual launch opens them.
            // Respect the user's login-item preference; never re-enable it on launch.
            if let Some(window) = app.get_webview_window("main") {
                if background_start {
                    let _ = window.hide();
                } else {
                    raise_jarvis_window(app.handle());
                }
            }
            next::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                let _ = window
                    .app_handle()
                    .emit_to("main", "next-action", "panel-hidden");
            }
        })
        .build(tauri::generate_context!())
        .expect("error building Jarvis Next")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. }
                if !app
                    .state::<next::NextState>()
                    .quitting
                    .load(Ordering::SeqCst) =>
            {
                api.prevent_exit();
                next::show_panel(app);
                let _ = app.emit_to("main", "next-action", "quit");
            }
            #[cfg(target_os = "macos")]
            // Ignore initial activation until cold wake is routed. A later
            // Dock/application click still opens the management panel.
            tauri::RunEvent::Reopen { .. }
                if !app
                    .state::<AppState>()
                    .cold_wake_pending
                    .load(Ordering::SeqCst) =>
            {
                next::show_panel(app);
            }
            _ => {}
        });
}
