use super::*;
use std::{io::Read, sync::Mutex as StdMutex};
use tauri::{
    menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::ManagerExt;

#[derive(Default)]
pub struct NextState {
    snapshot: StdMutex<Value>,
    media: StdMutex<std::collections::VecDeque<Value>>,
    session: StdMutex<Value>,
    bounds: StdMutex<Option<[f64; 4]>>,
    pub quitting: AtomicBool,
    pub suspended: AtomicBool,
    mouse: AtomicBool,
    dragging: AtomicBool,
    status_item: StdMutex<Option<MenuItem<tauri::Wry>>>,
    last_status: StdMutex<String>,
}
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn atomic_json(path: &std::path::Path, value: &Value) -> Result<(), String> {
    let temp = path.with_extension("json.tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Value, String> {
    let path = data_dir(&app)?.join("settings.json");
    if !path.exists() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("配置读取失败，原文件已保留：{e}"))
}
#[tauri::command]
pub fn save_settings(app: AppHandle, config: Value) -> Result<(), String> {
    if config.get("schema").and_then(Value::as_u64) != Some(1) {
        return Err("不支持的配置版本".into());
    }
    if let Some(path) = config
        .pointer("/workspace/path")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        super::validated_workspace(path)?;
    }
    let desired = config
        .pointer("/system/autostart")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let manager = app.autolaunch();
    let before = manager.is_enabled().map_err(|e| e.to_string())?;
    if desired != before {
        if desired {
            manager.enable()
        } else {
            manager.disable()
        }
        .map_err(|e| e.to_string())?;
    }
    if let Err(error) = atomic_json(&data_dir(&app)?.join("settings.json"), &config) {
        if desired != before {
            let _ = if before {
                manager.enable()
            } else {
                manager.disable()
            };
        }
        return Err(error);
    }
    Ok(())
}
#[tauri::command]
pub fn export_json(path: String, data: Value) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|s| s.to_str()) != Some("json") {
        return Err("请选择 .json 文件保存".into());
    }
    atomic_json(&path, &data)
}
#[tauri::command]
pub async fn check_environment(app: AppHandle) -> Result<Value, String> {
    let binary = codex_binary::resolve(
        app.path().resource_dir().ok(),
        &["JARVIS_NEXT_CODEX_BIN", "JARVIS_CODEX_BIN"],
    )
    .await?;
    let version = timeout(
        Duration::from_secs(8),
        Command::new(&binary.path)
            .arg("--version")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Codex 版本检查超时")?
    .map_err(|e| e.to_string())?;
    // Only the exit status is retained. Never include account data or tokens in diagnostics.
    let login = timeout(
        Duration::from_secs(8),
        Command::new(&binary.path)
            .args(["login", "status"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await;
    let logged_in = login.ok().and_then(Result::ok).map(|s| s.success());
    Ok(json!({
        "version": String::from_utf8_lossy(&version.stdout).trim(),
        "binary": binary.path,
        "voiceV3": binary.voice_error.is_none(),
        "voiceError": binary.voice_error,
        "loggedIn": logged_in,
        "checkedAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?.as_millis()
    }))
}
#[tauri::command]
pub fn list_skins(app: AppHandle) -> Result<Value, String> {
    let path = data_dir(&app)?.join("skins.json");
    if !path.exists() {
        return Ok(json!([]));
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn import_skin(app: AppHandle, source: String) -> Result<Value, String> {
    let source = PathBuf::from(source);
    let mut file = fs::File::open(&source).map_err(|e| e.to_string())?;
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    if !(20..=157_286_400).contains(&length) {
        return Err("GLB 文件须小于 150 MB".into());
    }
    let mut header = [0u8; 12];
    file.read_exact(&mut header).map_err(|e| e.to_string())?;
    if &header[..4] != b"glTF"
        || u32::from_le_bytes(header[4..8].try_into().unwrap()) != 2
        || u32::from_le_bytes(header[8..12].try_into().unwrap()) as u64 != length
    {
        return Err("GLB 头部无效或文件不完整".into());
    }
    let id = format!(
        "skin-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    );
    let dir = data_dir(&app)?.join("skins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{id}.glb"));
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    let skin = json!({"id":id,"name":source.file_stem().unwrap_or_default().to_string_lossy(),"path":dest});
    let mut list = list_skins(app.clone())?;
    list.as_array_mut()
        .ok_or("皮肤索引无效")?
        .push(skin.clone());
    atomic_json(&data_dir(&app)?.join("skins.json"), &list)?;
    Ok(skin)
}
#[tauri::command]
pub fn publish_snapshot(
    app: AppHandle,
    state: State<'_, NextState>,
    snapshot: Value,
) -> Result<(), String> {
    let mode = snapshot
        .pointer("/runtime/mode")
        .and_then(Value::as_str)
        .unwrap_or("ready");
    let label = if snapshot.pointer("/runtime/paused").and_then(Value::as_bool) == Some(true) {
        "已暂停"
    } else {
        match mode {
            "working" => "执行任务",
            "listening" => "正在倾听",
            "speaking" => "正在说话",
            "approval" => "等待确认",
            "error" => "需要处理",
            "stopping" => "正在停止",
            "connecting" => "正在连接",
            "stopped" => "已停止",
            _ => "待命",
        }
    };
    let text = format!("Jarvis Next · {label}");
    let mut last = state.last_status.lock().map_err(|e| e.to_string())?;
    if *last != text {
        if let Some(item) = state
            .status_item
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
        {
            let _ = item.set_text(&text);
        }
        *last = text;
    }
    *state.snapshot.lock().map_err(|e| e.to_string())? = snapshot.clone();
    app.emit("next-state", snapshot).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn read_snapshot(state: State<'_, NextState>) -> Result<Value, String> {
    Ok(state.snapshot.lock().map_err(|e| e.to_string())?.clone())
}
#[tauri::command]
pub fn dispatch_action(app: AppHandle, action: String) -> Result<(), String> {
    app.emit_to("main", "next-action", action)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn avatar_feedback(
    app: AppHandle,
    state: State<'_, NextState>,
    feedback: Value,
) -> Result<(), String> {
    if let Some(value) = feedback.get("bounds") {
        let bounds = value.as_array().filter(|a| a.len() == 4).and_then(|a| {
            let values: Option<Vec<f64>> = a.iter().map(Value::as_f64).collect();
            values
                .filter(|v| v.iter().all(|n| n.is_finite()))
                .map(|v| [v[0], v[1], v[2], v[3]])
        });
        *state.bounds.lock().map_err(|e| e.to_string())? = bounds;
    }
    app.emit_to("main", "next-feedback", feedback)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn publish_levels(app: AppHandle, input: f64, output: f64) -> Result<(), String> {
    app.emit("next-levels", json!({"input":input,"output":output}))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn monitor_list(app: AppHandle) -> Result<Value, String> {
    Ok(Value::Array(app.available_monitors().map_err(|e|e.to_string())?.iter().map(|m|json!({"name":m.name(),"width":m.size().width,"height":m.size().height,"scale":m.scale_factor()})).collect()))
}
fn position_avatar(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("avatar").ok_or("机甲窗口未建立")?;
    let state = app.state::<NextState>();
    let selected = state
        .snapshot
        .lock()
        .map_err(|e| e.to_string())?
        .pointer("/config/system/monitor")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let cursor = app.cursor_position().ok();
    let monitor = monitors
        .iter()
        .find(|m| !selected.is_empty() && m.name().map(String::as_str) == Some(selected.as_str()))
        .or_else(|| {
            monitors.iter().find(|m| {
                cursor.is_some_and(|p| {
                    p.x >= m.position().x as f64
                        && p.x < (m.position().x + m.size().width as i32) as f64
                        && p.y >= m.position().y as f64
                        && p.y < (m.position().y + m.size().height as i32) as f64
                })
            })
        })
        .or_else(|| monitors.first())
        .ok_or("未找到可用显示器")?;
    let area = monitor.work_area();
    window
        .set_position(area.position)
        .map_err(|e| e.to_string())?;
    window.set_size(area.size).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn show_panel(app: &AppHandle) {
    // Opening settings does not hide the armor or move its audio session.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit_to("main", "next-action", "panel-shown");
}
#[tauri::command]
pub fn ensure_session_visible(app: AppHandle) -> Result<(), String> {
    let owner = app
        .get_webview_window("avatar")
        .ok_or("机甲会话窗口未建立")?;
    if !owner.is_visible().map_err(|e| e.to_string())? {
        position_avatar(&app)?;
        owner.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn publish_session(
    app: AppHandle,
    state: State<'_, NextState>,
    session: Value,
) -> Result<(), String> {
    *state.session.lock().map_err(|e| e.to_string())? = session.clone();
    app.emit_to("main", "next-session", session)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn read_session(state: State<'_, NextState>) -> Result<Value, String> {
    Ok(state.session.lock().map_err(|e| e.to_string())?.clone())
}
#[tauri::command]
pub fn request_session(app: AppHandle, request: Value) -> Result<(), String> {
    app.emit_to("avatar", "next-session-request", request)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn reply_session(app: AppHandle, reply: Value) -> Result<(), String> {
    app.emit_to("main", "next-session-reply", reply)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn session_signal(app: AppHandle, signal: Value) -> Result<(), String> {
    app.emit_to("main", "next-session-signal", signal)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn record_media_sample(app: AppHandle, sample: Value) -> Result<(), String> {
    // Bounded diagnostic counters only. Never persist audio, SDP or transcripts.
    let mut safe = serde_json::Map::new();
    for key in [
        "time",
        "surface",
        "generation",
        "visibility",
        "peer",
        "mic",
        "muted",
        "enabled",
        "audioContext",
        "input",
        "output",
        "bytesSent",
        "bytesReceived",
    ] {
        if let Some(value) = sample.get(key) {
            if value.is_boolean()
                || value.is_number()
                || value.as_str().is_some_and(|s| s.len() <= 64)
            {
                safe.insert(key.to_owned(), value.clone());
            }
        }
    }
    if let Some(view) = app.get_webview_window("avatar") {
        safe.insert("hostWindow".into(), json!(view.label()));
        safe.insert(
            "hostVisible".into(),
            json!(view.is_visible().unwrap_or(false)),
        );
    }
    let state = app.state::<NextState>();
    let mut samples = state.media.lock().map_err(|e| e.to_string())?;
    samples.push_back(Value::Object(safe));
    while samples.len() > 90 {
        samples.pop_front();
    }
    atomic_json(
        &data_dir(&app)?.join("runtime-media.json"),
        &json!(*samples),
    )
}
#[tauri::command]
pub fn window_mode(app: AppHandle, mode: String) -> Result<(), String> {
    match mode.as_str() {
        "panel" => show_panel(&app),
        "prepare" => position_avatar(&app)?,
        "avatar" => {
            position_avatar(&app)?;
            if let Some(window) = app.get_webview_window("avatar") {
                window.show().map_err(|e| e.to_string())?;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
            let _ = app.emit("next-visibility", true);
        }
        "hide" => {
            // Hide the artwork, not the live media owner's WKWebView.
            *app.state::<NextState>()
                .bounds
                .lock()
                .map_err(|e| e.to_string())? = None;
            app.state::<NextState>()
                .dragging
                .store(false, Ordering::SeqCst);
            let _ = app.emit("next-visibility", false);
        }
        _ => return Err("未知窗口模式".into()),
    };
    Ok(())
}
#[tauri::command]
pub fn mouse_control(state: State<'_, NextState>, enabled: bool, dragging: bool) {
    state.mouse.store(enabled, Ordering::SeqCst);
    state.dragging.store(dragging, Ordering::SeqCst);
}
#[tauri::command]
pub async fn quit_next(app: AppHandle) -> Result<(), String> {
    let _ = super::disarm_wake_listener(app.clone()).await;
    let _ = timeout(Duration::from_secs(3), async {
        let _ = super::stop_codex_voice(app.state::<AppState>()).await;
        let _ = super::stop_all(app.state::<AppState>()).await;
    })
    .await;
    let _ = super::terminate_runtime(&app.state::<AppState>()).await;
    app.state::<NextState>()
        .quitting
        .store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
#[tauri::command]
pub async fn request_camera_permission() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2::runtime::Bool;
        use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeVideo};
        let kind = unsafe { AVMediaTypeVideo }.ok_or("系统未提供摄像头类型")?;
        match unsafe { AVCaptureDevice::authorizationStatusForMediaType(kind) } {
            AVAuthorizationStatus::Authorized => return Ok("authorized".into()),
            AVAuthorizationStatus::Denied => return Ok("denied".into()),
            AVAuthorizationStatus::Restricted => return Ok("restricted".into()),
            _ => {}
        }
        let (tx, rx) = oneshot::channel::<bool>();
        let tx = Arc::new(StdMutex::new(Some(tx)));
        {
            let callback = RcBlock::new(move |granted: Bool| {
                if let Ok(mut tx) = tx.lock() {
                    if let Some(tx) = tx.take() {
                        let _ = tx.send(granted.as_bool());
                    }
                }
            });
            unsafe {
                AVCaptureDevice::requestAccessForMediaType_completionHandler(kind, &callback);
            }
        }
        Ok(if rx.await.map_err(|e| e.to_string())? {
            "authorized"
        } else {
            "denied"
        }
        .into())
    }
    #[cfg(not(target_os = "macos"))]
    Ok("authorized".into())
}
pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let menubar = match app.menu() {
        Some(menu) => menu,
        None => Menu::default(app.handle())?,
    };
    if let Some(MenuItemKind::Submenu(app_menu)) = menubar.items()?.first() {
        let settings = MenuItem::with_id(
            app,
            "open-settings",
            "打开管理面板…",
            true,
            Some("CmdOrCtrl+,"),
        )?;
        app_menu.insert(&settings, 1)?;
    }
    app.set_menu(menubar)?;
    app.on_menu_event(|app, event| {
        if event.id.as_ref() == "open-settings" {
            show_panel(app);
        }
    });
    let status = MenuItem::with_id(app, "status", "Jarvis Next · 待命", true, None::<&str>)?;
    let panel = MenuItem::with_id(app, "panel", "打开管理面板", true, None::<&str>)?;
    let summon = MenuItem::with_id(app, "summon", "召唤 Jarvis", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "restore", "再次显示机甲", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "暂停 / 继续", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "仅隐藏机甲（会话继续）", true, None::<&str>)?;
    let skip = MenuItem::with_id(app, "skip", "跳过出场", true, None::<&str>)?;
    let center = MenuItem::with_id(app, "center", "机甲回到中央", true, None::<&str>)?;
    let mouse = MenuItem::with_id(app, "mouse", "切换鼠标操控", true, None::<&str>)?;
    let wake = MenuItem::with_id(app, "toggle-wake", "切换唤醒监听", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止全部", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Jarvis Next…", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &status, &panel, &summon, &show, &pause, &hide, &skip, &center, &mouse, &wake, &sep,
            &stop, &quit,
        ],
    )?;
    *app.state::<NextState>().status_item.lock().unwrap() = Some(status);
    let mut tray = TrayIconBuilder::with_id("jarvis-next")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Jarvis Next");
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| {
        let id = event.id.as_ref();
        if id == "panel" || id == "status" {
            show_panel(app);
        } else {
            let _ = app.emit_to("main", "next-action", id);
            if id == "quit" {
                show_panel(app);
            }
            if id == "stop" {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = super::stop_codex_voice(app.state::<AppState>()).await;
                    let _ = super::stop_all(app.state::<AppState>()).await;
                });
            }
        }
    })
    .build(app)?;
    if let Some(avatar) = app.get_webview_window("avatar") {
        avatar.set_ignore_cursor_events(true)?;
    }
    start_desktop_monitor(app.handle().clone());
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut ignoring = true;
        loop {
            tokio::time::sleep(Duration::from_millis(30)).await;
            let state = handle.state::<NextState>();
            if state.quitting.load(Ordering::SeqCst) {
                break;
            }
            let mut capture = state.dragging.load(Ordering::SeqCst);
            if state.mouse.load(Ordering::SeqCst) {
                if let (Ok(point), Some(window)) = (
                    handle.cursor_position(),
                    handle.get_webview_window("avatar"),
                ) {
                    if let (Ok(origin), Ok(size)) = (window.outer_position(), window.inner_size()) {
                        if let Ok(bounds) = state.bounds.lock() {
                            if let Some([left, top, right, bottom]) = *bounds {
                                let x = (point.x - origin.x as f64) / size.width as f64;
                                let y = (point.y - origin.y as f64) / size.height as f64;
                                capture |= x >= left && x <= right && y >= top && y <= bottom;
                            }
                        }
                    }
                }
            }
            if ignoring == capture {
                if let Some(window) = handle.get_webview_window("avatar") {
                    let _ = window.set_ignore_cursor_events(!capture);
                }
                ignoring = !capture;
            }
        }
    });
    Ok(())
}

fn start_desktop_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let packaged = app
            .path()
            .resource_dir()
            .ok()
            .map(|p| p.join("native-helpers/NextDesktopMonitor"));
        let path = packaged.filter(|p| p.is_file()).unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("native-helpers/NextDesktopMonitor")
        });
        let Ok(mut child) = Command::new(path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
        else {
            return;
        };
        let Some(stdout) = child.stdout.take() else {
            return;
        };
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        loop {
            let line = tokio::select! {
                line = lines.next_line() => match line { Ok(Some(line))=>line, _=>break },
                _ = tokio::time::sleep(Duration::from_secs(1)) => { if app.state::<NextState>().quitting.load(Ordering::SeqCst) { break; } continue; }
            };
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let kind = event.get("kind").and_then(Value::as_str).unwrap_or("");
            match kind {
                "sleep" | "lock" => {
                    app.state::<NextState>()
                        .suspended
                        .store(true, Ordering::SeqCst);
                    let _ = window_mode(app.clone(), "hide".into());
                    let _ = app.emit("next-system", event.clone());
                    let _ = super::disarm_wake_listener(app.clone()).await;
                    let _ = super::stop_codex_voice(app.state::<AppState>()).await;
                }
                "resume" => {
                    app.state::<NextState>()
                        .suspended
                        .store(false, Ordering::SeqCst);
                    let _ = app.emit("next-system", event);
                }
                "displays" => {
                    let _ = position_avatar(&app);
                    let _ = app.emit("next-system", event);
                }
                "fullscreen" => {
                    let _ = window_mode(app.clone(), "hide".into());
                    let _ = app.emit("next-system", event);
                }
                _ => {}
            }
        }
        let _ = child.kill().await;
    });
}
