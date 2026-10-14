use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    future::Future,
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

pub(crate) struct CodexBinary {
    pub path: PathBuf,
    // An older CLI can still serve text turns, but must never receive Voice V3.
    pub voice_error: Option<String>,
}

pub(crate) async fn resolve(
    resource_dir: Option<PathBuf>,
    override_names: &[&str],
) -> Result<CodexBinary, String> {
    let configured = override_names.iter().find_map(|name| {
        std::env::var_os(name).map(|value| ((*name).to_owned(), PathBuf::from(value)))
    });
    let home = std::env::var_os("HOME").map(PathBuf::from);
    select_candidate(
        configured,
        candidate_paths(resource_dir.as_deref(), home.as_deref()),
        probe_voice_support,
    )
    .await
}

fn candidate_paths(resource_dir: Option<&Path>, home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(resources) = resource_dir {
        candidates.push(resources.join("codex"));
    }
    let mut application_dirs = vec![PathBuf::from("/Applications")];
    if let Some(home) = home {
        application_dirs.push(home.join("Applications"));
    }
    for applications in application_dirs {
        for app in ["ChatGPT.app", "Codex.app"] {
            for relative in [
                "Contents/Resources/codex-cli/bin/codex",
                "Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
                "Contents/Resources/codex",
            ] {
                candidates.push(applications.join(app).join(relative));
            }
        }
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ]);
    if let Some(home) = home {
        candidates.extend([home.join(".local/bin/codex"), home.join(".cargo/bin/codex")]);
    }
    candidates
}

async fn select_candidate<F, Fut>(
    configured: Option<(String, PathBuf)>,
    candidates: Vec<PathBuf>,
    mut probe: F,
) -> Result<CodexBinary, String>
where
    F: FnMut(PathBuf) -> Fut,
    Fut: Future<Output = Result<Option<String>, String>>,
{
    if let Some((name, path)) = configured {
        if !is_executable(&path) {
            return Err(format!(
                "{name} 指向的文件不存在或不可执行：{}",
                path.display()
            ));
        }
        let voice_error = probe(path.clone())
            .await
            .map_err(|error| format!("{name}（{}）：{error}", path.display()))?;
        return Ok(CodexBinary { path, voice_error });
    }
    let mut seen = HashSet::new();
    let mut text_fallback = None;
    let mut failures = Vec::new();
    for path in candidates {
        if !is_executable(&path) || !seen.insert(path.canonicalize().unwrap_or(path.clone())) {
            continue;
        }
        match probe(path.clone()).await {
            Ok(voice_error) => {
                let binary = CodexBinary { path, voice_error };
                if binary.voice_error.is_none() {
                    return Ok(binary);
                }
                if text_fallback.is_none() {
                    text_fallback = Some(binary);
                }
            }
            Err(error) => failures.push(format!("{}：{error}", path.display())),
        }
    }
    if let Some(binary) = text_fallback {
        return Ok(binary);
    }
    Err(format!(
        "未找到可用的 Codex；请安装 Codex/ChatGPT 桌面版，或设置 JARVIS_CODEX_BIN。{}",
        failures.join("；")
    ))
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

async fn probe_voice_support(path: PathBuf) -> Result<Option<String>, String> {
    // Schema generation is local tooling: no server, login, thread, microphone,
    // or upstream Voice connection is started during this compatibility check.
    let directory = SchemaDirectory::create()?;
    let status = timeout(
        Duration::from_secs(15),
        Command::new(&path)
            .args([
                "app-server",
                "generate-json-schema",
                "--experimental",
                "--out",
            ])
            .arg(&directory.0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await
    .map_err(|_| "Codex 协议检查超时（15 秒）".to_owned())?
    .map_err(|error| format!("无法检查 Codex 协议：{error}"))?;
    if !status.success() {
        return Err(format!("Codex 无法导出实验性协议（{status}）"));
    }
    let schema_path = [
        "v2/ThreadRealtimeStartParams.json",
        "ThreadRealtimeStartParams.json",
    ]
    .iter()
    .map(|relative| directory.0.join(relative))
    .find(|candidate| candidate.is_file());
    let Some(schema_path) = schema_path else {
        return Ok(Some(
            "该 Codex 未提供 thread/realtime/start 协议".to_owned(),
        ));
    };
    let schema: Value = serde_json::from_slice(
        &fs::read(schema_path).map_err(|error| format!("无法读取 Codex 协议：{error}"))?,
    )
    .map_err(|error| format!("Codex 协议格式无效：{error}"))?;
    Ok(validate_voice_schema(&schema).err())
}

fn validate_voice_schema(schema: &Value) -> Result<(), String> {
    let definitions = schema.get("definitions").or_else(|| schema.get("$defs"));
    let has_v3 = definitions
        .and_then(|value| value.pointer("/RealtimeConversationVersion/enum"))
        .and_then(Value::as_array)
        .is_some_and(|versions| versions.iter().any(|version| version == "v3"));
    if !has_v3 {
        return Err("该 Codex 不支持 Voice v3，请更新 Codex/ChatGPT 桌面版或检查指定的 Codex 路径；文字功能仍可使用".to_owned());
    }
    let has_webrtc = definitions
        .and_then(|value| value.pointer("/ThreadRealtimeStartTransport/oneOf"))
        .and_then(Value::as_array)
        .is_some_and(|transports| {
            transports.iter().any(|transport| {
                transport
                    .pointer("/properties/type/enum")
                    .and_then(Value::as_array)
                    .is_some_and(|types| types.iter().any(|kind| kind == "webrtc"))
            })
        });
    if !has_webrtc {
        return Err("该 Codex 未提供 Voice WebRTC 传输，文字功能仍可使用".to_owned());
    }
    for field in [
        "version",
        "transport",
        "outputModality",
        "flushTranscriptTailOnSessionEnd",
        "codexResponseHandoffMode",
    ] {
        if schema
            .get("properties")
            .and_then(|properties| properties.get(field))
            .is_none()
        {
            return Err(format!(
                "Codex Voice 协议缺少 {field}，请更新 Codex/ChatGPT 桌面版"
            ));
        }
    }
    Ok(())
}

struct SchemaDirectory(PathBuf);

impl SchemaDirectory {
    fn create() -> Result<Self, String> {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        for _ in 0..10 {
            let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "jarvis-codex-schema-{}-{time}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("无法创建 Codex 协议检查目录：{error}")),
            }
        }
        Err("无法创建唯一的 Codex 协议检查目录".to_owned())
    }
}

impl Drop for SchemaDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn executable(directory: &SchemaDirectory, name: &str) -> PathBuf {
        let path = directory.0.join(name);
        fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    #[test]
    fn current_schema_supports_voice_but_legacy_does_not() {
        let current =
            serde_json::from_str(include_str!("../tests/fixtures/codex-0.162-realtime.json"))
                .unwrap();
        let legacy =
            serde_json::from_str(include_str!("../tests/fixtures/codex-0.142-realtime.json"))
                .unwrap();
        assert!(validate_voice_schema(&current).is_ok());
        assert!(validate_voice_schema(&legacy)
            .unwrap_err()
            .contains("不支持 Voice v3"));
    }

    #[test]
    fn missing_webrtc_and_stop_contract_are_rejected() {
        let mut schema: Value =
            serde_json::from_str(include_str!("../tests/fixtures/codex-0.162-realtime.json"))
                .unwrap();
        schema["properties"]
            .as_object_mut()
            .unwrap()
            .remove("flushTranscriptTailOnSessionEnd");
        assert!(validate_voice_schema(&schema)
            .unwrap_err()
            .contains("flushTranscriptTailOnSessionEnd"));
        schema["definitions"]["ThreadRealtimeStartTransport"]["oneOf"] = serde_json::json!([]);
        assert!(validate_voice_schema(&schema)
            .unwrap_err()
            .contains("WebRTC"));
    }

    #[test]
    fn desktop_layouts_precede_standalone_cli() {
        let paths = candidate_paths(None, Some(Path::new("/Users/test")));
        let desktop =
            PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex");
        let standalone = PathBuf::from("/Users/test/.local/bin/codex");
        assert!(
            paths.iter().position(|p| p == &desktop).unwrap()
                < paths.iter().position(|p| p == &standalone).unwrap()
        );
        assert!(paths.contains(&PathBuf::from("/Users/test/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex")));
    }

    #[tokio::test]
    async fn unsupported_bundle_does_not_hide_compatible_desktop_cli() {
        let directory = SchemaDirectory::create().unwrap();
        let old = executable(&directory, "old");
        let new = executable(&directory, "new");
        let result = select_candidate(None, vec![old, new.clone()], |path| async move {
            Ok((path.file_name().unwrap() == "old").then(|| "v1/v2 only".to_owned()))
        })
        .await
        .unwrap();
        assert_eq!(result.path, new);
        assert!(result.voice_error.is_none());
    }

    #[tokio::test]
    async fn legacy_cli_preserves_text_but_blocks_voice() {
        let directory = SchemaDirectory::create().unwrap();
        let old = executable(&directory, "old");
        let result = select_candidate(None, vec![old.clone()], |_| async {
            Ok(Some("v1/v2 only".to_owned()))
        })
        .await
        .unwrap();
        assert_eq!(result.path, old);
        assert!(result.voice_error.is_some());
    }

    #[tokio::test]
    async fn explicit_override_is_never_silently_replaced() {
        let directory = SchemaDirectory::create().unwrap();
        let old = executable(&directory, "old");
        let new = executable(&directory, "new");
        let result = select_candidate(
            Some(("JARVIS_CODEX_BIN".to_owned(), old.clone())),
            vec![new],
            |_| async { Ok(Some("v1/v2 only".to_owned())) },
        )
        .await
        .unwrap();
        assert_eq!(result.path, old);
        assert!(result.voice_error.is_some());
        let error = select_candidate(
            Some(("JARVIS_CODEX_BIN".to_owned(), directory.0.join("missing"))),
            vec![old],
            |_| async { panic!("must not probe fallback") },
        )
        .await
        .err()
        .unwrap();
        assert!(error.contains("JARVIS_CODEX_BIN"));
    }

    #[tokio::test]
    async fn broken_candidate_does_not_hide_compatible_cli() {
        let directory = SchemaDirectory::create().unwrap();
        let broken = executable(&directory, "broken");
        let working = executable(&directory, "working");
        let result = select_candidate(None, vec![broken, working.clone()], |path| async move {
            if path.file_name().unwrap() == "broken" {
                Err("cannot export schema".to_owned())
            } else {
                Ok(None)
            }
        })
        .await
        .unwrap();
        assert_eq!(result.path, working);
    }

    #[tokio::test]
    #[ignore = "Requires an installed Codex with Voice v3; only exports local schemas, never connects to Voice"]
    async fn installed_codex_preflight() {
        let binary = resolve(None, &["JARVIS_CODEX_BIN"]).await.unwrap();
        println!("Selected Codex: {}", binary.path.display());
        assert!(binary.voice_error.is_none(), "{:?}", binary.voice_error);
    }
}
