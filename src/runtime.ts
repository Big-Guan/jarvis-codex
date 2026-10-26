import { call, native, on } from "./platform";
import { Config, initialRuntime, RuntimeState, HistoryItem } from "./domain";
interface VoiceInfo {
  voiceActive: boolean;
  threadId?: string;
  phase: string;
}
interface Message {
  id?: number | string;
  method?: string;
  params?: any;
}
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export class SessionRuntime {
  state: RuntimeState = initialRuntime();
  private peer: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private remote: MediaStream | null = null;
  private audio = new Audio();
  private context: AudioContext | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private epoch = 0;
  private starting = false;
  private realtimeStarted = false;
  private connectionTimer: ReturnType<typeof setTimeout> | undefined;
  private voiceWaiters = new Set<(connected: boolean) => void>();
  private taskEpoch = 0;
  private outputDevice = "";
  private stopped = false;
  private agentBuffer = "";
  private userBuffer = "";
  private assistantBuffer = "";
  private lastPublish = 0;
  private lastMediaSample = 0;
  mediaDiagnostics: Record<string, unknown>[] = [];
  connectionStep = "未连接";
  async getDiagnostics() {
    return {
      media: this.mediaDiagnostics,
      connectionStep: this.connectionStep,
    };
  }
  private connectingStep(step: string) {
    this.connectionStep = step;
    this.update();
  }
  private async sampleMedia() {
    const peer = this.peer;
    if (!peer) return;
    const track = this.mic?.getAudioTracks()[0];
    const sample: Record<string, unknown> = {
      time: new Date().toISOString(),
      surface: document.documentElement.dataset.surface,
      generation: this.epoch,
      visibility: document.visibilityState,
      peer: peer.connectionState,
      mic: track?.readyState,
      muted: track?.muted,
      enabled: track?.enabled,
      audioContext: this.context?.state,
      input: this.state.inputLevel,
      output: this.state.outputLevel,
    };
    try {
      const stats = await peer.getStats();
      stats.forEach((r) => {
        if (r.type === "outbound-rtp" && r.kind === "audio")
          sample.bytesSent = r.bytesSent;
        if (r.type === "inbound-rtp" && r.kind === "audio")
          sample.bytesReceived = r.bytesReceived;
      });
    } catch {
      /* The peer may close while diagnostics are sampled. */
    }
    this.mediaDiagnostics.push(sample);
    this.mediaDiagnostics = this.mediaDiagnostics.slice(-45);
    if (native) void call("record_media_sample", { sample }).catch(() => {});
  }
  private suspended = false;
  private resumeVoiceAfterPause = false;
  constructor(
    private config: () => Config,
    private changed: () => void,
    private levels: (input: number, output: number) => void,
    private wake: (cold: boolean) => void,
    private localAction: (action: string) => void,
  ) {
    this.audio.autoplay = true;
    this.audio.setAttribute("playsinline", "");
  }
  get connecting() {
    return this.starting || (!!this.peer && !this.state.voiceActive);
  }
  private historyKey() {
    return `jarvis-next.history:${this.config().workspace.path}:${this.state.threadId}`;
  }
  private restoreHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(this.historyKey()) ?? "[]");
      this.state.history = Array.isArray(h)
        ? h.filter((x: any) => typeof x.text === "string").slice(-40)
        : [];
    } catch {
      this.state.history = [];
    }
  }
  private key() {
    return `jarvis-next.thread:${this.config().workspace.path}`;
  }
  private update() {
    this.changed();
  }
  private log(role: HistoryItem["role"], text: string) {
    if (!text.trim()) return;
    const last = this.state.history.at(-1);
    if (last?.role === role && last.text === text) return;
    this.state.history.push({
      role,
      text: text.slice(0, 30000),
      time: Date.now(),
    });
    this.state.history = this.state.history.slice(-80);
    this.persistHistory();
  }
  private persistHistory() {
    try {
      localStorage.setItem(
        this.historyKey(),
        JSON.stringify(this.state.history.slice(-40)),
      );
    } catch {
      /* Storage failure must not interrupt Voice. */
    }
  }
  fail(error: unknown) {
    this.state.error = String(error);
    this.state.mode = "error";
    this.update();
  }
  async init(consumeWake = true) {
    this.state.threadId = localStorage.getItem(this.key()) ?? "";
    this.restoreHistory();
    if (!native) {
      this.state.wakeStatus = "浏览器预览 · 未连接原生服务";
      this.update();
      return;
    }
    await on<Message>(
      "codex-event",
      (m) => void this.handle(m).catch((e) => this.fail(e)),
    );
    await on<any>("jarvis-wake-status", (p) => {
      this.state.wakeReady = p.ready;
      this.state.wakeStatus = p.ready ? "本机唤醒就绪" : p.authorization;
      this.update();
    });
    await on<any>("jarvis-wake", (p) => {
      if (p.ok) {
        if (!this.state.paused) this.wake(p.cold === true);
      } else this.fail(p.error ?? "唤醒失败");
    });
    await this.syncWake();
    if (consumeWake) await call("consume_cold_wake");
    setInterval(() => {
      const input = this.level(this.inputAnalyser),
        output = this.level(this.outputAnalyser);
      if (performance.now() - this.lastMediaSample > 1000) {
        this.lastMediaSample = performance.now();
        void this.sampleMedia();
      }
      this.state.inputLevel = input;
      this.state.outputLevel = output;
      if (
        this.state.voiceActive &&
        !this.state.taskActive &&
        !this.state.approvals.length &&
        this.state.mode !== "error"
      ) {
        const mode = output > 0.055 ? "speaking" : "listening";
        if (this.state.mode !== mode) {
          this.state.mode = mode;
          this.update();
        }
      }
      if (performance.now() - this.lastPublish > 90) {
        this.levels(input, output);
        this.lastPublish = performance.now();
      }
    }, 50);
  }
  private level(a: AnalyserNode | null) {
    if (!a) return 0;
    const values = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(values);
    let energy = 0;
    for (const v of values) energy += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(energy / values.length) * 5);
  }
  private analyse(stream: MediaStream, target: "input" | "output") {
    this.context ??= new AudioContext();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    this.context.createMediaStreamSource(stream).connect(analyser);
    if (target === "input") this.inputAnalyser = analyser;
    else this.outputAnalyser = analyser;
    void this.context
      .resume()
      .catch((e) => this.fail(`音频分析器启动失败：${e}`));
  }
  private async acquireMicrophone(constraints: MediaStreamConstraints) {
    let expired = false;
    let timer: ReturnType<typeof setTimeout>;
    const capture = navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        if (expired) stream.getTracks().forEach((t) => t.stop());
        return stream;
      });
    try {
      return await Promise.race([
        capture,
        new Promise<MediaStream>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(
              new Error("麦克风打开超时，请确认系统授权、设备连接后重试。"),
            );
          }, 20000);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
  private waitForVoice(): Promise<boolean> {
    if (this.state.voiceActive) return Promise.resolve(true);
    return new Promise((resolve) => this.voiceWaiters.add(resolve));
  }
  private settleVoice(connected: boolean) {
    for (const resolve of this.voiceWaiters) resolve(connected);
    this.voiceWaiters.clear();
  }
  private cleanup() {
    this.starting = false;
    this.settleVoice(false);
    clearTimeout(this.connectionTimer);
    this.realtimeStarted = false;
    this.peer?.close();
    this.peer = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.remote?.getTracks().forEach((t) => t.stop());
    this.remote = null;
    this.audio.pause();
    this.audio.srcObject = null;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
    this.state.voiceActive = false;
    this.connectionStep = this.state.paused ? "已暂停" : "未连接";
    this.state.inputLevel = 0;
    this.state.outputLevel = 0;
  }
  private voiceConnected() {
    if (!this.realtimeStarted || this.peer?.connectionState !== "connected")
      return;
    clearTimeout(this.connectionTimer);
    this.state.voiceActive = true;
    this.connectionStep = "语音已连接";
    this.settleVoice(true);
    this.state.mode = this.state.taskActive ? "working" : "listening";
    this.state.error = "";
    this.update();
  }
  private async voiceFailed(error: unknown) {
    await this.endVoice().catch(() => {});
    this.fail(error);
  }
  async syncWake() {
    if (!native) return;
    const enabled =
      this.config().voice.wake &&
      !this.suspended &&
      !this.state.paused &&
      !this.state.voiceActive &&
      !this.starting;
    const s = await call<any>(
      enabled ? "arm_wake_listener" : "disarm_wake_listener",
    );
    this.state.wakeReady = s.ready;
    this.state.wakeStatus = enabled
      ? s.ready
        ? "本机唤醒就绪"
        : s.authorization
      : "已关闭";
    this.update();
  }
  async suspend() {
    this.suspended = true;
    await this.endVoice(false);
    if (native) await call("disarm_wake_listener");
    this.state.wakeReady = false;
    this.state.wakeStatus = "锁屏或休眠已暂停";
    this.update();
  }
  async resume() {
    this.suspended = false;
    await this.syncWake();
  }
  async pauseInteraction() {
    if (this.state.paused || this.state.interactionPending) return;
    this.resumeVoiceAfterPause = this.state.voiceActive || this.connecting;
    this.state.interactionPending = true;
    this.state.paused = true;
    this.update();
    try {
      await this.endVoice(false);
      await this.syncWake();
    } finally {
      this.state.interactionPending = false;
      this.update();
    }
  }
  async continueInteraction() {
    if (!this.state.paused || this.state.interactionPending) return;
    const reconnect = this.resumeVoiceAfterPause;
    this.resumeVoiceAfterPause = false;
    this.state.paused = false;
    this.state.interactionPending = true;
    this.connectionStep = "未连接";
    this.update();
    try {
      if (reconnect) await this.startVoice();
      else await this.syncWake();
    } finally {
      this.state.interactionPending = false;
      this.update();
    }
  }
  async startVoice(onConnected?: () => Promise<void>, cold = false) {
    if (!native) throw new Error("官方 Voice 需要 Jarvis Next 原生应用。");
    if (this.suspended) throw new Error("系统尚未恢复，语音已暂停。");
    this.state.paused = false;
    this.resumeVoiceAfterPause = false;
    if (this.state.voiceActive) {
      await onConnected?.();
      return;
    }
    if (this.starting || this.peer) {
      const epoch = this.epoch;
      const connected = await this.waitForVoice();
      if (connected && epoch === this.epoch && this.state.voiceActive)
        await onConnected?.();
      return;
    }
    this.starting = true;
    const epoch = ++this.epoch;
    this.stopped = false;
    this.state.error = "";
    this.state.mode = "connecting";
    this.update();
    try {
      await call("ensure_session_visible");
      if (epoch !== this.epoch) return;
      this.connectingStep("等待系统麦克风授权");
      const permission = await call<string>("request_microphone_permission");
      if (epoch !== this.epoch) return;
      if (permission !== "authorized")
        throw new Error(
          "请在系统设置 → 隐私与安全性 → 麦克风中允许 Jarvis Next。",
        );
      this.connectingStep("释放唤醒监听");
      await call("disarm_wake_listener");
      if (cold) await wait(900);
      if (epoch !== this.epoch) return;
      const attempts = cold ? 6 : 1;
      for (let i = 0; i < attempts; i++) {
        try {
          if (epoch !== this.epoch) return;
          this.connectingStep("正在打开麦克风");
          const stream = await this.acquireMicrophone({
            audio: {
              deviceId: this.config().voice.input
                ? { exact: this.config().voice.input }
                : undefined,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          if (epoch !== this.epoch) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          this.mic = stream;
          break;
        } catch (e) {
          if (i === attempts - 1) throw e;
          await wait(700);
        }
      }
      if (epoch !== this.epoch) {
        this.cleanup();
        return;
      }
      if (!this.mic) throw new Error("未取得麦克风");
      this.analyse(this.mic, "input");
      if (epoch !== this.epoch) return;
      this.connectingStep("正在建立音频通道");
      const peer = new RTCPeerConnection();
      this.peer = peer;
      const track = this.mic.getAudioTracks()[0];
      if (!track) throw new Error("没有音频轨道");
      peer.addTrack(track, this.mic);
      peer.createDataChannel("oai-events");
      peer.ontrack = (e) => {
        if (epoch !== this.epoch) return;
        this.remote = e.streams[0] ?? new MediaStream([e.track]);
        this.audio.srcObject = this.remote;
        this.audio.volume = this.config().voice.volume;
        this.analyse(this.remote, "output");
        void this.setOutput()
          .then(() => this.audio.play())
          .catch((e) => {
            if (epoch === this.epoch)
              void this.voiceFailed(`音频播放失败：${e}`);
          });
      };
      peer.onconnectionstatechange = () => {
        if (epoch !== this.epoch) return;
        if (peer.connectionState === "connected") this.voiceConnected();
        else if (peer.connectionState === "failed")
          void this.voiceFailed(
            "Codex Voice 连接失败，已释放麦克风，请重新连接。",
          );
        else if (peer.connectionState === "disconnected") {
          this.state.voiceActive = false;
          this.state.mode = "connecting";
          clearTimeout(this.connectionTimer);
          this.connectionTimer = setTimeout(() => {
            if (epoch === this.epoch && peer.connectionState !== "connected")
              void this.voiceFailed("语音连接已断开，请检查网络后重新连接。");
          }, 10000);
          this.update();
        }
      };
      this.connectingStep("正在协商网络连接");
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise<void>((resolve, reject) => {
        if (peer.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const done = () => {
          if (peer.iceGatheringState === "complete") {
            clearTimeout(timer);
            peer.removeEventListener("icegatheringstatechange", done);
            resolve();
          }
        };
        const timer = setTimeout(() => {
          peer.removeEventListener("icegatheringstatechange", done);
          reject(new Error("WebRTC ICE 等待超时"));
        }, 12000);
        peer.addEventListener("icegatheringstatechange", done);
      });
      if (epoch !== this.epoch) return;
      this.connectingStep("正在连接 Codex Voice");
      const info = await call<VoiceInfo>("start_codex_voice", {
        cwd: this.config().workspace.path,
        permissionMode: this.config().workspace.permission,
        threadId: localStorage.getItem(this.key()),
        sdp: peer.localDescription?.sdp,
        voice: this.config().voice.name,
      });
      if (epoch !== this.epoch) {
        await call("stop_codex_voice");
        await call("stop_all");
        return;
      }
      if (info.threadId) this.thread(info.threadId);
      if (!this.state.voiceActive) {
        this.connectionTimer = setTimeout(() => {
          if (epoch === this.epoch && !this.state.voiceActive)
            void this.voiceFailed("语音连接超时，已释放麦克风，请重新连接。");
        }, 25000);
      }
      const connected = await this.waitForVoice();
      if (connected && epoch === this.epoch && this.state.voiceActive)
        await onConnected?.();
    } catch (e) {
      if (epoch === this.epoch) {
        this.cleanup();
        await call("stop_codex_voice").catch(() => {});
        this.fail(e);
        throw e;
      }
    } finally {
      if (epoch === this.epoch) {
        this.starting = false;
        if (!this.state.voiceActive && !this.peer)
          await this.syncWake().catch((e) => this.fail(e));
      }
    }
  }
  async setOutput() {
    this.audio.volume = this.config().voice.volume;
    const audio = this.audio as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    const device = this.config().voice.output;
    if (device === this.outputDevice || !audio.setSinkId) return;
    await audio.setSinkId(device);
    this.outputDevice = device;
  }
  private thread(id: string) {
    this.state.threadId = id;
    localStorage.setItem(this.key(), id);
    this.update();
  }
  async endVoice(rearm = true) {
    ++this.epoch;
    this.cleanup();
    try {
      if (native) await call("stop_codex_voice");
    } finally {
      if (!this.state.taskActive) this.state.mode = "ready";
      this.update();
      if (rearm) await this.syncWake();
    }
  }
  async stopAll() {
    this.resumeVoiceAfterPause = false;
    this.stopped = true;
    ++this.taskEpoch;
    ++this.epoch;
    this.cleanup();
    this.state.mode = "stopping";
    this.update();
    try {
      if (native) {
        const settled = await Promise.allSettled([
          call("stop_codex_voice"),
          call("disarm_wake_listener"),
        ]);
        await call("stop_all");
        const failed = settled.filter((r) => r.status === "rejected");
        if (failed.length)
          throw new Error(
            failed.map((r) => (r as PromiseRejectedResult).reason).join("; "),
          );
      }
      this.state.taskActive = false;
      this.state.approvals = [];
      this.state.mode = "stopped";
      this.log("system", "已停止语音和当前任务。");
    } catch (e) {
      this.fail(e);
      throw e;
    } finally {
      this.update();
      await this.syncWake().catch((e) => this.fail(e));
    }
  }
  async send(text: string) {
    if (!text.trim()) return;
    if (!native) throw new Error("浏览器不执行 Codex 任务，请启动原生版。");
    if (this.connecting) throw new Error("语音正在连接，请稍后发送。");
    if (this.state.taskActive && !this.state.voiceActive)
      throw new Error("当前任务尚未结束，可停止后再发送新任务。");
    this.stopped = false;
    this.state.error = "";
    this.state.userText = text;
    this.log("user", text);
    this.update();
    if (this.state.voiceActive) {
      await call("append_codex_voice_text", { text });
      return;
    }
    const taskEpoch = ++this.taskEpoch;
    this.state.taskActive = true;
    this.state.mode = "connecting";
    this.update();
    try {
      const session = await call<{ threadId: string }>("start_jarvis", {
        cwd: this.config().workspace.path,
        permissionMode: this.config().workspace.permission,
        threadId: localStorage.getItem(this.key()),
      });
      this.thread(session.threadId);
      if (taskEpoch !== this.taskEpoch) return;
      await call("send_text", { text });
    } catch (error) {
      if (taskEpoch === this.taskEpoch) {
        this.state.taskActive = false;
        this.fail(error);
        throw error;
      }
    }
  }
  async freshThread(resume: string | null = null) {
    if (this.state.taskActive || this.connecting)
      throw new Error("请先停止当前任务或语音连接，再切换线程。");
    await this.endVoice(false);
    await call("shutdown");
    const s = await call<{ threadId: string }>("start_jarvis", {
      cwd: this.config().workspace.path,
      permissionMode: this.config().workspace.permission,
      threadId: resume,
    });
    this.thread(s.threadId);
    this.restoreHistory();
    this.state.userText = "";
    this.state.assistantText = "";
    await this.syncWake();
    this.update();
  }
  async reconfigure() {
    if (this.state.taskActive || this.state.voiceActive || this.connecting)
      throw new Error("请先结束任务与语音，再切换工作区或权限。");
    if (native) await call("shutdown");
    this.state.threadId = localStorage.getItem(this.key()) ?? "";
    this.restoreHistory();
    this.state.userText = "";
    this.state.assistantText = "";
    this.state.tools = [];
    this.state.mode = "ready";
    this.update();
  }
  async approve(id: number | string, approved: boolean) {
    await call("resolve_server_request", { requestId: id, approved });
    this.state.approvals = this.state.approvals.filter((x) => x.id !== id);
    this.state.mode = this.state.taskActive
      ? "working"
      : this.state.voiceActive
        ? "listening"
        : "ready";
    this.update();
  }
  private async handle(message: Message) {
    const m = message.method,
      p = message.params ?? {};
    if (message.id !== undefined && m) {
      this.state.approvals.push({
        id: message.id,
        method: m,
        detail: JSON.stringify(p, null, 2).slice(0, 12000),
      });
      this.state.mode = "approval";
      this.update();
      return;
    }
    if (m === "thread/realtime/sdp" && this.peer && p.sdp) {
      await this.peer.setRemoteDescription({ type: "answer", sdp: p.sdp });
    } else if (m === "thread/realtime/started") {
      if (this.stopped || !this.peer) {
        await call("stop_codex_voice");
        return;
      }
      this.realtimeStarted = true;
      if (p.threadId) this.thread(p.threadId);
      this.voiceConnected();
    } else if (m === "thread/realtime/transcript/delta") {
      if (p.role === "assistant") {
        this.assistantBuffer += p.delta ?? "";
        this.state.assistantText = this.assistantBuffer;
      } else {
        this.userBuffer += p.delta ?? "";
        this.state.userText = this.userBuffer;
      }
    } else if (m === "thread/realtime/transcript/done") {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (p.role === "assistant") {
        if (text) {
          this.state.assistantText = text;
          this.log("assistant", text);
        }
        this.assistantBuffer = "";
      } else {
        if (text) {
          this.state.userText = text;
          this.log("user", text);
          const normalized = text
            .replace(/[\s，。！？,.!?]/g, "")
            .toLowerCase();
          const command = normalized.replace(/^(jarvis|贾维斯)/, "");
          const actions: Record<string, string> = {
            打开设置: "panel",
            打开管理面板: "panel",
            隐藏机甲: "hide",
            跳过出场: "skip",
            回到中央: "center",
            停止全部: "stop",
            停下: "stop",
          };
          if (actions[command]) this.localAction(actions[command]);
        }
        this.userBuffer = "";
      }
    } else if (m === "thread/realtime/error") {
      await this.voiceFailed(p.message ?? "语音连接发生错误");
    } else if (m === "thread/realtime/closed") {
      ++this.epoch;
      this.cleanup();
      if (!this.stopped && this.state.mode !== "error")
        this.state.mode = this.state.taskActive ? "working" : "ready";
      await this.syncWake();
    } else if (m === "turn/started") {
      if (this.stopped) {
        void call("stop_all");
        return;
      }
      this.agentBuffer = "";
      this.state.taskActive = true;
      this.state.mode = "working";
    } else if (m === "item/agentMessage/delta") {
      this.agentBuffer += p.delta ?? "";
      this.state.assistantText = this.agentBuffer;
    } else if (m === "turn/completed") {
      this.state.taskActive = false;
      const error = p.turn?.error?.message;
      if (error) this.fail(error);
      else
        this.state.mode = this.stopped
          ? "stopped"
          : this.state.voiceActive
            ? "listening"
            : "ready";
    } else if (m === "item/started" || m === "item/completed") {
      const item = p.item ?? {};
      if (item.type === "agentMessage" && m === "item/completed") {
        const text = item.text ?? this.agentBuffer;
        if (text) {
          this.state.assistantText = text;
          this.log("assistant", text);
        }
      } else if (item.type) {
        this.state.tools.unshift({
          name: item.type,
          status: m === "item/started" ? "执行中" : "完成",
          time: Date.now(),
        });
        this.state.tools = this.state.tools.slice(0, 20);
      }
    }
    this.update();
  }
}
