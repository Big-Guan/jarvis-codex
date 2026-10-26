use serde_json::{json, Value};

pub const LISTEN_FIRST: &str = "Starting, resuming, or reconnecting this voice session is a silent transition into listening, not a user request. Do not greet the user, announce startup or readiness, summarize previous work, or produce an acknowledgement merely because the session opened. A wake phrase such as Hi Jarvis, Hey Jarvis, or 嗨 Jarvis is only an activation signal. Wait silently for the user's next substantive utterance before replying. After that, respond and execute requested tasks normally.";

pub fn start_params(thread_id: &str, sdp: &str, voice: Option<&str>) -> Value {
    let mut params = json!({
        "threadId": thread_id,
        "outputModality": "audio",
        "version": "v3",
        // The default startup context can elicit an unsolicited opening reply.
        // Retain the thread; begin listening without injecting that context.
        "includeStartupContext": false,
        "realtimeStartInstructions": LISTEN_FIRST,
        "clientManagedHandoffs": false,
        // STOP must not submit a transcript tail as a fresh task.
        "flushTranscriptTailOnSessionEnd": false,
        "codexResponsesAsItems": false,
        "codexResponseHandoffMode": "commentary",
        "transport": {"type": "webrtc", "sdp": sdp}
    });
    const SUPPORTED: &[&str] = &[
        "alloy", "arbor", "ash", "ballad", "breeze", "cedar", "coral", "cove", "echo", "ember",
        "juniper", "maple", "marin", "sage", "shimmer", "sol", "spruce", "vale", "verse",
    ];
    if let Some(voice) = voice.filter(|voice| SUPPORTED.contains(voice)) {
        params["voice"] = Value::String(voice.to_owned());
    }
    params
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_connection_preserves_the_voice_thread_transport_and_stop_contract() {
        let params = start_params("existing-thread", "v=0\r\ntest-offer", Some("cove"));
        assert_eq!(params["threadId"], "existing-thread");
        assert_eq!(params["transport"]["sdp"], "v=0\r\ntest-offer");
        assert_eq!(params["version"], "v3");
        assert_eq!(params["outputModality"], "audio");
        assert_eq!(params["voice"], "cove");
        assert_eq!(params["includeStartupContext"], false);
        assert!(params["realtimeStartInstructions"]
            .as_str()
            .unwrap()
            .contains("Wait silently"));
        assert!(params.get("initialItems").is_none());
        assert_eq!(params["flushTranscriptTailOnSessionEnd"], false);
        assert_eq!(params["codexResponseHandoffMode"], "commentary");
    }

    #[test]
    fn unknown_voice_uses_the_server_default_without_losing_quiet_start() {
        let params = start_params("thread", "v=0", Some("unknown-voice"));
        assert!(params.get("voice").is_none());
        assert_eq!(params["includeStartupContext"], false);
        assert_eq!(params["realtimeStartInstructions"], LISTEN_FIRST);
    }
}
