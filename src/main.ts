import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createCyberStage, type VisualMode } from "./cyber-stage";
import "./style.css";

type Mode = VisualMode;
type Message = { id?: number | string; method?: string; params?: any };
type Session = { threadId: string; cwd: string };
type DirectVoice = {
  codexConnected: boolean;
  voiceActive: boolean;
  phase: string;
  protocol: string;
  threadId?: string;
  realtimeSessionId?: string;
};
type WakeStatus = {
  enabled: boolean;
  ready: boolean;
  authorization: string;
};
type WakeEvent = {
  ok: boolean;
  error?: string;
  cold?: boolean;
};
type PermissionMode = "safe" | "auto" | "full";

const state = {
  mode: "booting" as Mode,
  session: null as Session | null,
  directVoice: null as DirectVoice | null,
  wake: null as WakeStatus | null,
  manualStop: false,
  agentWorking: false,
};

const WORKSPACE_KEY = "jarvis.workspace";
const THREAD_KEY_PREFIX = "jarvis.threadId:";
const PERMISSION_KEY = "jarvis.permissionMode";
const permissionLabels: Record<PermissionMode, string> = {
  safe: "安全模式 · 需要时确认",
  auto: "自动办公 · 当前目录自主执行",
  full: "完全访问 · 高风险",
};
function storedPermissionMode(): PermissionMode {
  const value = localStorage.getItem(PERMISSION_KEY);
  return value === "safe" || value === "full" ? value : "auto";
}
let workspace = "";
let permissionMode = storedPermissionMode();
const savedThreadId = () => localStorage.getItem(`${THREAD_KEY_PREFIX}${workspace}`);
let peer: RTCPeerConnection | null = null;
let microphoneStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let microphoneAnalyser: AnalyserNode | null = null;
let remoteAnalyser: AnalyserNode | null = null;
let userTranscriptBuffer = "";
let assistantTranscriptBuffer = "";
let agentMessageBuffer = "";
let voiceStartInFlight = false;
let recoverableColdStartError = false;
const voiceAudio = new Audio();
voiceAudio.autoplay = true;
const currentWindow = getCurrentWindow();
void currentWindow.onCloseRequested(async (event) => {
  event.preventDefault();
  await currentWindow.hide();
});

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<main class="shell" data-mode="booting">
  <img class="visual-source" src="/assets/jarvis-avatar.png" alt="">
  <div class="shade"></div><div class="scanlines"></div><div class="vignette"></div>
  <header class="topbar hud-panel">
    <div class="brand"><i></i><strong>JARVIS</strong><span></span><em>CODEX VOICE SYSTEM</em></div>
    <div class="status"><i></i><b id="mode-label">INITIALIZING</b></div>
    <button id="settings" class="icon-button" aria-label="设置">⌘</button>
  </header>
  <section class="stage">
    <div class="depth-scene">
      <div class="depth-layer depth-far" aria-hidden="true">
        <div class="horizon-grid"></div>
        <div class="ambient-orbit orbit-alpha"></div>
        <div class="ambient-orbit orbit-beta"></div>
        <canvas id="fx-canvas"></canvas>
      </div>
      <div class="depth-layer depth-mid" aria-hidden="true">
        <div class="avatar-window">
          <div class="helmet-slice helmet-back"></div>
          <div class="helmet-slice helmet-main"></div>
          <div class="helmet-slice helmet-front"></div>
          <div class="eye eye-left"></div><div class="eye eye-right"></div>
          <div class="energy-core"></div>
        </div>
      </div>
      <div class="depth-layer depth-near" aria-hidden="true">
        <div class="reticle outer"></div><div class="reticle inner"></div>
        <div class="voice-ring ring-one"></div>
        <div class="voice-ring ring-two"></div>
        <div class="voice-ring ring-three"></div>
        <div class="scan-cone"></div>
        <div class="foreground-arc arc-left"></div>
        <div class="foreground-arc arc-right"></div>
        <div class="agent-beam"></div>
        <canvas id="wave"></canvas>
      </div>
      <div class="depth-glass" aria-hidden="true"></div>
    </div>
    <div class="identity"><span>JARVIS CORE</span><b id="identity-state">SYSTEM BOOT</b></div>
  </section>
  <aside class="workers">
    <article class="worker active" data-role="orchestrator"><span>›_</span><div><b>Codex</b><small>Connecting</small></div><i></i></article>
    <article class="worker" data-role="developer"><span>⌬</span><div><b>Developer</b><small>Standby</small></div><i></i></article>
    <article class="worker" data-role="researcher"><span>⌕</span><div><b>Researcher</b><small>Standby</small></div><i></i></article>
    <article class="worker" data-role="reviewer"><span>✓</span><div><b>Reviewer</b><small>Standby</small></div><i></i></article>
  </aside>
  <section class="dialogue hud-panel">
    <b>YOU</b><p id="user-transcript">“嗨，Jarvis”</p>
    <b class="jarvis">JARVIS</b><p id="assistant-transcript">正在连接 Codex 原生任务线程…</p>
  </section>
  <footer class="controls">
    <button id="mic" class="control mic"><span>🎙</span><b>CODEX VOICE</b><small>V3 WEBRTC · DIRECT</small></button>
    <form id="command-form" class="command"><input id="command-input" aria-label="文字指令" placeholder="Voice 不可用时，发送本地 Codex 文字任务…" autocomplete="off"><button>EXECUTE</button></form>
    <button id="stop" class="control stop"><span>■</span><b>STOP</b><small>INTERRUPT ALL</small></button>
  </footer>
  <div id="degraded-banner" class="degraded-banner" hidden><b>JARVIS NEEDS PERMISSION</b><span id="degraded-copy">首次使用请允许麦克风和语音识别。</span></div>
  <dialog id="approval"><h2>高风险操作确认</h2><p id="approval-copy">Codex 请求执行需要确认的动作。</p><div><button id="deny">拒绝</button><button id="approve">允许一次</button></div></dialog>
  <dialog id="settings-dialog"><h2>JARVIS SYSTEM</h2><dl><dt>Wake phrase</dt><dd>嗨 Jarvis / Hey Jarvis</dd><dt>Wake listener</dt><dd id="wake-auth">检测中</dd><dt>Codex thread</dt><dd id="thread-id">—</dd><dt>Workspace</dt><dd id="workspace">—</dd><dt>Permission</dt><dd id="permission-mode-label">—</dd><dt>Voice kernel</dt><dd id="voice-auth">检测中</dd></dl><label class="workspace-setting">工作目录<input id="workspace-setting" autocomplete="off" spellcheck="false"></label><fieldset class="permission-setting"><legend>Codex 操作权限</legend><label><input type="radio" name="permission-mode" value="safe"><span><b>安全模式</b><small>超出当前目录或高风险操作时询问</small></span></label><label class="recommended"><input type="radio" name="permission-mode" value="auto"><span><b>自动办公</b><small>当前目录内自主执行，越界操作直接阻止</small></span><em>推荐</em></label><label class="danger"><input type="radio" name="permission-mode" value="full"><span><b>完全访问</b><small>不限制目录且不询问，请谨慎使用</small></span></label></fieldset><p>权限切换会停止当前任务并重建 Codex 运行时，但会继续使用当前工作目录保存的 thread。</p><p>修改工作目录后，下次重启 Jarvis 生效。每个工作目录会续接自己的 Codex thread。</p><p>“新开线程”会结束当前任务并创建一个全新的 Codex thread；原线程仍保留在 Codex 历史记录中。</p><p>唤醒词在本机识别；Jarvis 页面通过 Codex app-server V3 WebRTC 进入官方 Voice 线程。认证复用本机 Codex 登录，不读取凭据、不模拟点击，也不建立第二套 GPT-Live。</p><div class="settings-actions"><button id="new-thread" class="new-thread">＋ 新开线程</button><span></span><button id="save-settings">保存</button><button id="close-settings">关闭</button></div></dialog>
</main>`;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const shell = $<HTMLElement>(".shell");
const transcript = $("#user-transcript");
const response = $("#assistant-transcript");
const banner = $("#degraded-banner") as HTMLDivElement;
const mic = $("#mic") as HTMLButtonElement;
const approval = $("#approval") as HTMLDialogElement;
const settings = $("#settings-dialog") as HTMLDialogElement;
const visualStage = createCyberStage({
  root: shell,
  scene: $<HTMLElement>(".depth-scene"),
  waveCanvas: $("#wave") as HTMLCanvasElement,
  fxCanvas: $("#fx-canvas") as HTMLCanvasElement,
});
visualStage.setMode(state.mode);
window.addEventListener("beforeunload", () => visualStage.destroy(), { once: true });
let approvalId: number | string | undefined;
const copy: Record<Mode, [string, string]> = {
  booting: ["INITIALIZING", "SYSTEM BOOT"], ready: ["READY", "CODEX VOICE STANDBY"],
  "voice-starting": ["VOICE LINKING", "OPENING CODEX VOICE"], listening: ["LISTENING", "OFFICIAL VOICE ONLINE"],
  working: ["CODEX WORKING", "TASK EXECUTION"], speaking: ["JARVIS SPEAKING", "VOICE OUTPUT"],
  degraded: ["PERMISSION NEEDED", "WAKE SYSTEM OFFLINE"], stopped: ["INTERRUPTED", "ALL SYSTEMS HALTED"],
};

function setMode(mode: Mode) {
  state.mode = mode; shell.setAttribute("data-mode", mode);
  visualStage.setMode(mode);
  $("#mode-label").textContent = copy[mode][0]; $("#identity-state").textContent = copy[mode][1];
}
function setWorker(role: string, label: string, active = true) {
  const card = document.querySelector<HTMLElement>(`.worker[data-role="${role}"]`);
  if (!card) return;
  card.classList.toggle("active", active); card.querySelector("small")!.textContent = label;
}
function roleOf(params: any) {
  const text = JSON.stringify(params ?? {}).toLowerCase();
  return text.includes("research") ? "researcher" : text.includes("review") ? "reviewer" :
    text.includes("developer") || text.includes("commandexecution") || text.includes("filechange") ? "developer" : "orchestrator";
}
function analyserLevel(analyser: AnalyserNode | null) {
  if (!analyser) return 0;
  const samples = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(samples);
  let energy = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    energy += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(energy / samples.length) * 5);
}

function updateAudioMeters() {
  const micLevel = analyserLevel(microphoneAnalyser);
  const speakerLevel = analyserLevel(remoteAnalyser);
  visualStage.setAudioLevels({
    mic: micLevel,
    speaker: speakerLevel,
  });
  if (state.directVoice?.voiceActive && !state.agentWorking) {
    if (speakerLevel > 0.08 && state.mode !== "speaking") setMode("speaking");
    if (speakerLevel < 0.025 && state.mode === "speaking") setMode("listening");
  }
  requestAnimationFrame(updateAudioMeters);
}
updateAudioMeters();

function updateVoiceInfo(info: DirectVoice) {
  state.directVoice = info;
  mic.classList.toggle("active", info.voiceActive);
  $("#voice-auth").textContent = info.codexConnected
    ? `${info.protocol} · ${info.voiceActive ? "connected" : info.phase}`
    : `${info.protocol} · standby`;
  if (info.threadId) {
    state.session = { threadId: info.threadId, cwd: workspace };
    $("#thread-id").textContent = info.threadId;
    localStorage.setItem(`${THREAD_KEY_PREFIX}${workspace}`, info.threadId);
  }
}

async function handle(message: Message) {
  if (message.id !== undefined && message.method) {
    approvalId = message.id; $("#approval-copy").textContent = `Codex 请求：${message.method}`; approval.showModal(); return;
  }
  const method = message.method, params = message.params;
  if (method === "thread/realtime/sdp") {
    if (!peer || !params?.sdp) return;
    try {
      await peer.setRemoteDescription({ type: "answer", sdp: params.sdp });
    } catch (error) {
      setMode("degraded");
      response.textContent = `Codex Voice SDP 连接失败：${String(error)}`;
    }
  } else if (method === "thread/realtime/started") {
    updateVoiceInfo({
      codexConnected: true,
      voiceActive: true,
      phase: "connected",
      protocol: "Codex app-server V3 · WebRTC",
      threadId: params?.threadId,
      realtimeSessionId: params?.realtimeSessionId,
    });
    banner.hidden = true;
    setMode("listening");
    setWorker("orchestrator", "Official Voice online");
    response.textContent = "Codex 官方 Voice 已上线。你现在可以直接和 Jarvis 对话。";
  } else if (method === "thread/realtime/transcript/delta") {
    const delta = typeof params?.delta === "string" ? params.delta : "";
    if (params?.role === "assistant") {
      assistantTranscriptBuffer += delta;
      response.textContent = assistantTranscriptBuffer;
      if (!state.agentWorking) setMode("speaking");
    } else {
      userTranscriptBuffer += delta;
      transcript.textContent = userTranscriptBuffer;
      if (!state.agentWorking) setMode("listening");
    }
  } else if (method === "thread/realtime/transcript/done") {
    const text = typeof params?.text === "string" ? params.text.trim() : "";
    if (params?.role === "assistant") {
      if (text) response.textContent = text;
      assistantTranscriptBuffer = "";
      if (!state.agentWorking) setMode("listening");
    } else {
      if (text) transcript.textContent = text;
      userTranscriptBuffer = "";
    }
  } else if (method === "thread/realtime/itemAdded") {
    const itemType = String(params?.item?.type ?? "");
    if (itemType.includes("handoff") || itemType.includes("delegation")) {
      setMode("working");
      setWorker("orchestrator", "Delegating to Codex");
    }
  } else if (method === "thread/realtime/error") {
    setMode("degraded");
    banner.hidden = false;
    const detail = params?.message ?? "Codex Voice realtime error";
    $("#degraded-copy").textContent = detail;
    response.textContent = detail;
  } else if (method === "thread/realtime/closed") {
    cleanupPeer();
    updateVoiceInfo({
      codexConnected: true,
      voiceActive: false,
      phase: "closed",
      protocol: "Codex app-server V3 · WebRTC",
      threadId: params?.threadId ?? state.session?.threadId,
    });
    if (!state.manualStop) {
      setMode("ready");
      response.textContent = "Codex Voice 已结束。再次说“嗨 Jarvis”即可唤醒。";
      await armWakeListener();
    }
  } else if (method === "turn/started") {
    if (state.manualStop) return;
    agentMessageBuffer = "";
    state.agentWorking = true;
    setMode("working"); setWorker("orchestrator", "Codex working");
  } else if (method === "item/agentMessage/delta") {
    const delta = typeof params?.delta === "string" ? params.delta : "";
    agentMessageBuffer += delta;
    if (agentMessageBuffer) response.textContent = agentMessageBuffer;
  } else if (method === "turn/completed") {
    state.agentWorking = false;
    setMode(state.manualStop ? "stopped" : state.directVoice?.voiceActive ? "listening" : "ready");
    setWorker("orchestrator", state.manualStop ? "Interrupted" : "Ready", !state.manualStop);
    for (const role of ["developer", "researcher", "reviewer"]) {
      setWorker(role, state.manualStop ? "Interrupted" : "Standby", false);
    }
  } else if (method === "item/started") {
    if (!state.manualStop) setWorker(roleOf(params), "Working");
  }
  else if (method === "item/completed") {
    setWorker(roleOf(params), "Complete", false);
    if (params?.item?.type === "agentMessage") {
      const text = typeof params.item.text === "string" ? params.item.text : agentMessageBuffer;
      if (text) response.textContent = text;
    }
  }
}

async function waitForIceGathering(connection: RTCPeerConnection) {
  if (connection.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      connection.removeEventListener("icegatheringstatechange", changed);
      reject(new Error("WebRTC ICE gathering timed out"));
    }, 12_000);
    const changed = () => {
      if (connection.iceGatheringState !== "complete") return;
      window.clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", changed);
      resolve();
    };
    connection.addEventListener("icegatheringstatechange", changed);
  });
}

function attachAnalyser(stream: MediaStream, target: "microphone" | "remote") {
  audioContext ??= new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  if (target === "microphone") microphoneAnalyser = analyser;
  else remoteAnalyser = analyser;
}

function cleanupPeer() {
  peer?.close();
  peer = null;
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  remoteStream?.getTracks().forEach((track) => track.stop());
  remoteStream = null;
  voiceAudio.pause();
  voiceAudio.srcObject = null;
  microphoneAnalyser = null;
  remoteAnalyser = null;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function isNotAllowedError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "NotAllowedError"
    : String(error).includes("NotAllowedError");
}

async function acquireMicrophone(coldStart: boolean) {
  const attempts = coldStart ? 6 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      if (!coldStart || !isNotAllowedError(error) || attempt === attempts) throw error;
      response.textContent = `正在等待系统释放麦克风… ${attempt}/${attempts - 1}`;
      await sleep(700);
    }
  }
  throw new Error("麦克风初始化失败");
}

async function startDirectVoice({ coldStart = false } = {}) {
  if (voiceStartInFlight || peer || state.directVoice?.voiceActive) return;
  voiceStartInFlight = true;
  state.manualStop = false;
  recoverableColdStartError = false;
  setMode("voice-starting");
  banner.hidden = true;
  response.textContent = "正在建立 Codex 官方 Voice V3 WebRTC 会话…";
  try {
    const microphoneAuthorization = await invoke<string>("request_microphone_permission");
    if (microphoneAuthorization !== "authorized") {
      throw new Error("请在系统设置 → 隐私与安全性 → 麦克风中允许 Jarvis Codex。");
    }
    await invoke("disarm_wake_listener");
    if (coldStart) {
      // A newly created WKWebView can reject an otherwise-authorized
      // getUserMedia call until its first visible/focused render cycle.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await sleep(900);
    }
    microphoneStream = await acquireMicrophone(coldStart);
    attachAnalyser(microphoneStream, "microphone");

    const connection = new RTCPeerConnection();
    peer = connection;
    const track = microphoneStream.getAudioTracks()[0];
    if (!track) throw new Error("未找到麦克风音轨");
    connection.addTrack(track, microphoneStream);
    connection.createDataChannel("oai-events");
    connection.ontrack = (event) => {
      remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      voiceAudio.srcObject = remoteStream;
      attachAnalyser(remoteStream, "remote");
      void audioContext?.resume();
      void voiceAudio.play();
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") {
        setMode("degraded");
        response.textContent = "Codex Voice WebRTC 连接失败。";
      }
    };
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await waitForIceGathering(connection);
    const sdp = connection.localDescription?.sdp;
    if (!sdp) throw new Error("WebRTC 未生成 SDP offer");

    const info = await invoke<DirectVoice>("start_codex_voice", {
      cwd: workspace,
      threadId: savedThreadId(),
      permissionMode,
      sdp,
      voice: "cove",
    });
    updateVoiceInfo(info);
  } catch (error) {
    cleanupPeer();
    recoverableColdStartError = coldStart && isNotAllowedError(error);
    setMode("degraded");
    banner.hidden = false;
    $("#degraded-copy").textContent = String(error);
    response.textContent = String(error);
    await armWakeListener();
  } finally {
    voiceStartInFlight = false;
  }
}

async function stopDirectVoice() {
  try {
    const info = await invoke<DirectVoice>("stop_codex_voice");
    updateVoiceInfo(info);
  } finally {
    cleanupPeer();
  }
}

await listen<Message>("codex-event", ({ payload }) => void handle(payload));
await listen<WakeStatus>("jarvis-wake-status", ({ payload }) => {
  state.wake = payload;
  $("#wake-auth").textContent = payload.ready
    ? "Local listener ready"
    : payload.authorization === "authorized"
      ? "Waiting to re-arm"
      : payload.authorization;
  if (payload.ready) {
    if (recoverableColdStartError && state.mode === "degraded") {
      recoverableColdStartError = false;
      banner.hidden = true;
      setMode("ready");
    }
    if (state.mode === "ready") {
      response.textContent = "我在。直接说“嗨 Jarvis”。";
      setWorker("orchestrator", "Wake word armed");
    }
  }
});
await listen<WakeEvent>("jarvis-wake", ({ payload }) => {
  transcript.textContent = "“嗨，Jarvis”";
  state.manualStop = false;
  if (!payload.ok) {
    setMode("degraded");
    banner.hidden = false;
    $("#degraded-copy").textContent = payload.error ?? "无法打开官方 Codex Voice。";
    response.textContent = payload.error ?? "无法打开官方 Codex Voice。";
    return;
  }
  banner.hidden = true;
  void startDirectVoice({ coldStart: payload.cold === true });
});
$("#command-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const input = $("#command-input") as HTMLInputElement, text = input.value.trim();
  if (!text) return;
  state.manualStop = false;
  transcript.textContent = text;
  input.value = "";
  if (state.directVoice?.voiceActive) {
    response.textContent = "已将文字作为用户话语注入当前 Codex Voice 会话。";
    await invoke("append_codex_voice_text", { text });
    return;
  }
  if (!state.session) {
    state.session = await invoke<Session>("start_jarvis", {
      cwd: workspace,
      threadId: savedThreadId(),
      permissionMode,
    });
    localStorage.setItem(`${THREAD_KEY_PREFIX}${workspace}`, state.session.threadId);
    $("#thread-id").textContent = state.session.threadId;
    $("#workspace").textContent = state.session.cwd;
  }
  setMode("working");
  await invoke("send_text", { text });
});
mic.addEventListener("click", () => {
  if (state.directVoice?.voiceActive || peer) void stopDirectVoice();
  else void startDirectVoice();
});
$("#stop").addEventListener("click", async () => {
  state.manualStop = true; setMode("stopped");
  state.agentWorking = false;
  for (const role of ["orchestrator", "developer", "researcher", "reviewer"]) setWorker(role, "Interrupted", false);
  if (state.directVoice?.voiceActive || peer) {
    try { await stopDirectVoice(); } catch { /* task interruption still continues */ }
  }
  await invoke("stop_all");
  await armWakeListener();
});
function syncPermissionControls() {
  const input = document.querySelector<HTMLInputElement>(
    `input[name="permission-mode"][value="${permissionMode}"]`,
  );
  if (input) input.checked = true;
  $("#permission-mode-label").textContent = permissionLabels[permissionMode];
}

$("#settings").addEventListener("click", () => {
  syncPermissionControls();
  settings.showModal();
});
$("#close-settings").addEventListener("click", () => settings.close());
$("#new-thread").addEventListener("click", async () => {
  const button = $("#new-thread") as HTMLButtonElement;
  button.disabled = true;
  state.manualStop = true;
  settings.close();
  response.textContent = "正在结束当前任务并创建新的 Codex thread…";
  try {
    if (state.directVoice?.voiceActive || peer) {
      try { await stopDirectVoice(); } catch { cleanupPeer(); }
    }
    try { await invoke("stop_all"); } catch { /* no active runtime */ }
    await invoke("shutdown");
    const freshSession = await invoke<Session>("start_jarvis", {
      cwd: workspace,
      threadId: null,
      permissionMode,
    });
    state.session = freshSession;
    state.directVoice = null;
    localStorage.setItem(`${THREAD_KEY_PREFIX}${workspace}`, freshSession.threadId);
    $("#thread-id").textContent = freshSession.threadId;
    $("#workspace").textContent = freshSession.cwd;
    userTranscriptBuffer = "";
    assistantTranscriptBuffer = "";
    agentMessageBuffer = "";
    transcript.textContent = "“新开线程”";
    response.textContent = "新的 Codex thread 已创建。下一次唤醒和文字任务都会进入这个线程。";
    setMode("ready");
    setWorker("orchestrator", "Fresh thread ready");
  } catch (error) {
    try { await invoke("shutdown"); } catch { /* already stopped */ }
    state.session = null;
    state.directVoice = null;
    setMode("degraded");
    response.textContent = `新建线程失败，原线程仍可续接：${String(error)}`;
  } finally {
    button.disabled = false;
    await armWakeListener();
  }
});
$("#save-settings").addEventListener("click", async () => {
  const nextWorkspace = ($("#workspace-setting") as HTMLInputElement).value.trim();
  if (!nextWorkspace) return;
  const selectedPermission = document.querySelector<HTMLInputElement>(
    'input[name="permission-mode"]:checked',
  )?.value as PermissionMode | undefined;
  const nextPermission = selectedPermission ?? permissionMode;
  if (nextWorkspace !== workspace) {
    localStorage.setItem(WORKSPACE_KEY, nextWorkspace);
    response.textContent = "工作目录已保存，重启 Jarvis 后生效。";
  }
  if (nextPermission !== permissionMode) {
    state.manualStop = true;
    if (state.directVoice?.voiceActive || peer) {
      try { await stopDirectVoice(); } catch { cleanupPeer(); }
    }
    try { await invoke("stop_all"); } catch { /* no active runtime */ }
    await invoke("shutdown");
    permissionMode = nextPermission;
    localStorage.setItem(PERMISSION_KEY, permissionMode);
    state.session = null;
    state.directVoice = null;
    syncPermissionControls();
    setMode("ready");
    response.textContent = `权限已切换为“${permissionLabels[permissionMode]}”，下一次任务将续接当前 Codex thread。`;
    await armWakeListener();
  }
  settings.close();
});
for (const [selector, approved] of [["#approve", true], ["#deny", false]] as const) {
  $(selector).addEventListener("click", async () => { await invoke("resolve_server_request", { requestId: approvalId, approved }); approval.close(); });
}

try {
  workspace = localStorage.getItem(WORKSPACE_KEY)
    ?? await invoke<string>("default_workspace");
  localStorage.setItem(WORKSPACE_KEY, workspace);
  $("#thread-id").textContent = "Not started";
  $("#workspace").textContent = workspace;
  ($("#workspace-setting") as HTMLInputElement).value = workspace;
  syncPermissionControls();
  setWorker("orchestrator", "Wake word starting");
  setMode("ready");
  const backgroundStart = await invoke<boolean>("startup_is_background");
  if (!backgroundStart) {
    const microphoneAuthorization = await invoke<string>("request_microphone_permission");
    if (microphoneAuthorization !== "authorized") {
      setMode("degraded");
      banner.hidden = false;
      $("#degraded-copy").textContent =
        "请在系统设置 → 隐私与安全性 → 麦克风中允许 Jarvis Codex。";
    }
  }
  await armWakeListener();
  updateVoiceInfo(await invoke<DirectVoice>("direct_voice_status"));
  if (await invoke<boolean>("consume_cold_wake")) {
    transcript.textContent = "“嗨，Jarvis”";
  }
} catch (error) { setMode("stopped"); response.textContent = `启动失败：${String(error)}`; }

async function armWakeListener() {
  try {
    state.wake = await invoke<WakeStatus>("arm_wake_listener");
    $("#wake-auth").textContent = state.wake.ready ? "Local listener ready" : state.wake.authorization;
    if (["denied", "restricted"].includes(state.wake.authorization)) {
      setMode("degraded");
      banner.hidden = false;
      $("#degraded-copy").textContent = "请在系统设置 → 隐私与安全性中允许麦克风和语音识别。";
    }
  } catch (error) {
    $("#wake-auth").textContent = String(error);
  }
}
