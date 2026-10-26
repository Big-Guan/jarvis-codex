import { call, on } from "./platform";
import { Config, initialRuntime, RuntimeState } from "./domain";
import { SessionRuntime } from "./runtime";

export interface SessionView {
  ready: boolean;
  state: RuntimeState;
  connecting: boolean;
  connectionStep: string;
}
export interface SessionRequest {
  id: number;
  method: string;
  args: unknown[];
  config: Config;
}
interface Reply {
  id: number;
  value?: any;
  error?: string;
}

// The panel is a controller, never a second microphone / WebRTC owner.
export class RemoteSessionRuntime {
  state = initialRuntime();
  connecting = false;
  connectionStep = "正在连接机甲服务";
  private sequence = 0;
  private requests = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private config: () => Config,
    private changed: () => void,
    private levels: (input: number, output: number) => void,
    private wake: (cold: boolean) => void,
    private localAction: (action: string) => void,
  ) {}
  private accept(value: SessionView) {
    if (!value?.state) return;
    this.state = value.state;
    this.connecting = value.connecting;
    this.connectionStep = value.connectionStep;
    this.changed();
  }
  private async request(method: string, args: unknown[] = []) {
    const id = ++this.sequence;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.requests.delete(id);
          reject(new Error(`机甲服务响应超时：${method}`));
        },
        method === "startVoice" ? 180000 : 30000,
      );
      this.requests.set(id, { resolve, reject, timer });
      void call("request_session", {
        request: { id, method, args, config: this.config() },
      }).catch((error) => this.reply({ id, error: String(error) }));
    });
  }
  private reply(reply: Reply) {
    const pending = this.requests.get(reply.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.requests.delete(reply.id);
    if (reply.error) pending.reject(new Error(reply.error));
    else pending.resolve(reply.value);
  }
  async init() {
    await on<SessionView>("next-session", (value) => this.accept(value));
    await on<Reply>("next-session-reply", (value) => this.reply(value));
    await on<{ type: string; cold?: boolean; action?: string }>(
      "next-session-signal",
      (signal) => {
        if (signal.type === "wake") this.wake(signal.cold === true);
        else if (signal.action) this.localAction(signal.action);
      },
    );
    await on<{ input: number; output: number }>("next-levels", (value) => {
      this.state.inputLevel = value.input;
      this.state.outputLevel = value.output;
      this.levels(value.input, value.output);
    });
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
      const value = await call<SessionView>("read_session");
      if (value?.ready) {
        this.accept(value);
        await this.request("consumeWake");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("机甲服务尚未就绪，请重新打开 Jarvis Next。");
  }
  async startVoice(onConnected?: () => Promise<void>, cold = false) {
    const connected = await this.request("startVoice", [cold]);
    if (connected) await onConnected?.();
  }
  async endVoice(rearm = true) {
    await this.request("endVoice", [rearm]);
  }
  async stopAll() {
    await this.request("stopAll");
  }
  async pauseInteraction() {
    await this.request("pauseInteraction");
  }
  async continueInteraction() {
    await this.request("continueInteraction");
  }
  async syncWake() {
    await this.request("syncWake");
  }
  async suspend() {
    await this.request("suspend");
  }
  async resume() {
    await this.request("resume");
  }
  async send(text: string) {
    await this.request("send", [text]);
  }
  async setOutput() {
    await this.request("setOutput");
  }
  async freshThread(resume: string | null = null) {
    await this.request("freshThread", [resume]);
  }
  async reconfigure() {
    await this.request("reconfigure");
  }
  async approve(id: number | string, approved: boolean) {
    await this.request("approve", [id, approved]);
  }
  async getDiagnostics() {
    return this.request("diagnostics");
  }
  async cameraPreview(active: boolean) {
    await this.request("cameraPreview", [active]);
  }
  fail(error: unknown) {
    this.state.error = String(error);
    this.state.mode = "error";
    this.changed();
    void this.request("fail", [String(error)]).catch(console.error);
  }
}

// Explicit dispatch keeps cross-window messages from invoking arbitrary members.
// Calls run concurrently so STOP can cancel an in-flight getUserMedia or offer.
export async function executeSessionRequest(
  runtime: SessionRuntime,
  request: SessionRequest,
) {
  const a = request.args;
  switch (request.method) {
    case "startVoice":
      await runtime.startVoice(undefined, a[0] === true);
      return runtime.state.voiceActive;
    case "endVoice":
      return runtime.endVoice(a[0] !== false);
    case "stopAll":
      return runtime.stopAll();
    case "pauseInteraction":
      return runtime.pauseInteraction();
    case "continueInteraction":
      return runtime.continueInteraction();
    case "syncWake":
      return runtime.syncWake();
    case "suspend":
      return runtime.suspend();
    case "resume":
      return runtime.resume();
    case "send":
      return runtime.send(String(a[0] ?? ""));
    case "setOutput":
      return runtime.setOutput();
    case "freshThread":
      return runtime.freshThread(typeof a[0] === "string" ? a[0] : null);
    case "reconfigure":
      return runtime.reconfigure();
    case "approve":
      return runtime.approve(a[0] as number | string, a[1] === true);
    case "diagnostics":
      return runtime.getDiagnostics();
    case "consumeWake":
      return call("consume_cold_wake");
    case "fail":
      return runtime.fail(String(a[0]));
    default:
      throw new Error(`未知会话操作：${request.method}`);
  }
}
