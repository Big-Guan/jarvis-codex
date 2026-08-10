import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import {
  GESTURE_ACTION_COUNT,
  GestureLatch,
  selectGestureCandidate,
  type GestureAction,
} from "./gesture-engine.js";

export type { GestureAction } from "./gesture-engine.js";

export interface GestureEvent {
  action: GestureAction;
  label: string;
  score: number;
}

const FRAME_INTERVAL_MS = 90;
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
  private latch = new GestureLatch();
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
          numHands: 2,
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
      this.latch.reset();
      onStatus?.(`手势识别已就绪：支持 ${GESTURE_ACTION_COUNT} 种控制动作。`);
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
    const detections = (result.gestures ?? [])
      .map((categories) => categories[0])
      .filter((category) => Boolean(category))
      .map((category) => ({ name: category.categoryName, score: category.score }));
    const event = this.latch.update(selectGestureCandidate(detections), now);
    if (event) onGesture({ action: event.action, label: event.zh, score: event.score });
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
    this.latch.reset();
  }
}
