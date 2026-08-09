import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

export type GestureAction = "stop" | "confirm" | "approve" | "cockpit" | "spin" | "voice";

export interface GestureEvent {
  action: GestureAction;
  label: string;
  score: number;
}

interface GestureBinding {
  action: GestureAction;
  zh: string;
  en: string;
  minScore: number;
  holdFrames: number;
}

const GESTURE_MAP: Record<string, GestureBinding> = {
  Open_Palm: { action: "stop", zh: "张开手掌 · 停止", en: "Open palm", minScore: 0.6, holdFrames: 3 },
  Thumb_Down: { action: "stop", zh: "拇指向下 · 停止", en: "Thumbs down", minScore: 0.62, holdFrames: 3 },
  Closed_Fist: { action: "confirm", zh: "握拳 · 确认", en: "Fist", minScore: 0.68, holdFrames: 3 },
  Thumb_Up: { action: "approve", zh: "比赞 · 批准", en: "Thumbs up", minScore: 0.68, holdFrames: 3 },
  Victory: { action: "cockpit", zh: "胜利手势 · 打开驾驶舱", en: "Victory", minScore: 0.62, holdFrames: 3 },
  ILoveYou: { action: "spin", zh: "我爱你手势 · 旋转", en: "I love you", minScore: 0.62, holdFrames: 3 },
  Pointing_Up: { action: "voice", zh: "手指向上 · 语音", en: "Point up", minScore: 0.68, holdFrames: 3 },
};

const COOLDOWN_MS = 1600;
const FRAME_INTERVAL_MS = 90;
const RELEASE_FRAMES = 3;
const WASM_ROOT = "/wasm";
const MODEL_PATH = "/gesture_recognizer.task";

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof Event !== "undefined" && error instanceof Event) {
    const source = (error.target as (EventTarget & { src?: string }) | null)?.src;
    return source ? `资源加载失败：${source}` : `资源加载失败：${error.type}`;
  }
  return String(error);
}

export class CameraGestureController {
  private recognizer: GestureRecognizer | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private video: HTMLVideoElement | null = null;
  private holdGesture = "";
  private holdCount = 0;
  private latchedGesture = "";
  private releaseCount = 0;
  private cooldownUntil = 0;
  active = false;

  async start(
    video: HTMLVideoElement,
    onGesture: (event: GestureEvent) => void,
    onError: (message: string) => void,
    onStatus?: (message: string) => void,
  ): Promise<boolean> {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        onError("当前环境不支持摄像头访问（navigator.mediaDevices 不可用）");
        return false;
      }

      // Open the camera before loading MediaPipe. The model can take several
      // seconds to initialize in WKWebView; doing it first made the UI look as
      // if camera permission had failed even after macOS had granted access.
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
        audio: false,
      });
      this.video = video;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = this.stream;
      await video.play();
      onStatus?.("摄像头已打开，正在加载手势模型…");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      if (!this.recognizer) {
        // Keep these URLs root-relative. WKWebView can reject a dynamically
        // inserted crossOrigin script when the same Tauri custom-protocol URL
        // is supplied as an absolute `tauri://` URL.
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const modelResponse = await fetch(MODEL_PATH);
        if (!modelResponse.ok) {
          throw new Error(`手势模型加载失败：HTTP ${modelResponse.status}`);
        }
        const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());
        const options = {
          runningMode: "VIDEO" as const,
          numHands: 1,
        };
        try {
          this.recognizer = await GestureRecognizer.createFromOptions(vision, {
            ...options,
            baseOptions: { modelAssetBuffer: modelAssetBuffer.slice(), delegate: "GPU" },
          });
        } catch (gpuError) {
          onStatus?.("GPU 手势识别不可用，正在切换 CPU…");
          try {
            this.recognizer = await GestureRecognizer.createFromOptions(vision, {
              ...options,
              baseOptions: { modelAssetBuffer: modelAssetBuffer.slice(), delegate: "CPU" },
            });
          } catch (cpuError) {
            throw new Error(
              `手势模型初始化失败（GPU：${describeError(gpuError)}；CPU：${describeError(cpuError)}）`,
            );
          }
        }
      }
      this.active = true;
      this.cooldownUntil = 0;
      this.holdCount = 0;
      this.holdGesture = "";
      this.latchedGesture = "";
      this.releaseCount = 0;
      this.timer = setInterval(() => this.tick(onGesture), FRAME_INTERVAL_MS);
      return true;
    } catch (error) {
      onError(describeError(error));
      this.stop();
      return false;
    }
  }

  private tick(onGesture: (event: GestureEvent) => void) {
    if (!this.recognizer || !this.video || this.video.readyState < 2) return;
    const now = performance.now();
    let result;
    try {
      result = this.recognizer.recognizeForVideo(this.video, now);
    } catch {
      return;
    }
    const top = result.gestures?.[0]?.[0];
    const name = top?.categoryName ?? "";
    const meta = GESTURE_MAP[name];
    if (!top || !meta || top.score < meta.minScore) {
      this.holdGesture = "";
      this.holdCount = 0;
      this.releaseCount += 1;
      if (this.releaseCount >= RELEASE_FRAMES) this.latchedGesture = "";
      return;
    }
    this.releaseCount = 0;
    if (name === this.latchedGesture) return;
    if (name === this.holdGesture) {
      this.holdCount += 1;
    } else {
      this.holdGesture = name;
      this.holdCount = 1;
    }
    if (this.holdCount >= meta.holdFrames && now >= this.cooldownUntil) {
      this.cooldownUntil = now + COOLDOWN_MS;
      this.holdCount = 0;
      this.latchedGesture = name;
      onGesture({ action: meta.action, label: meta.zh, score: top.score });
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.recognizer?.close();
    this.recognizer = null;
    this.active = false;
    this.holdGesture = "";
    this.holdCount = 0;
    this.latchedGesture = "";
    this.releaseCount = 0;
  }
}
