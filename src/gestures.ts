import { Config } from "./domain";
import { HandInput } from "./gesture-machine";
import { call, native } from "./platform";
import { openGestureEngine } from "./gesture-engine";
import { HandSelection } from "./hand-selection";
import { handFeatures } from "./hand-features";
interface Point {
  x: number;
  y: number;
  z: number;
}
export class GestureCamera {
  video = document.createElement("video");
  worker: Worker | null = null;
  stream: MediaStream | null = null;
  running = false;
  private cancelInit: (() => void) | null = null;
  private generation = 0;
  private frame = 0;
  private busy = false;
  private lastFrame = 0;
  private selection = new HandSelection();
  constructor(
    private config: () => Config["gestures"],
    private result: (
      input: HandInput | null,
      landmarks: Point[] | null,
      ms: number,
    ) => void,
    private status: (text: string) => void,
  ) {
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.className = "camera-video";
  }
  async start() {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    this.status("正在载入本机手势引擎…");
    try {
      if (
        native &&
        (await call<string>("request_camera_permission")) !== "authorized"
      )
        throw new Error("请在系统设置中允许 Jarvis Next 使用摄像头。");
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: this.config().camera
            ? { exact: this.config().camera }
            : undefined,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (generation !== this.generation) return;
      const engine = openGestureEngine(),
        worker = engine.worker;
      this.worker = worker;
      this.cancelInit = engine.cancel;
      await engine.ready;
      this.cancelInit = null;
      if (generation !== this.generation) {
        worker.terminate();
        return;
      }
      worker.onmessage = (e) => {
        this.busy = false;
        if (e.data.type === "result") this.process(e.data.result, e.data.ms);
        else if (e.data.type === "error") {
          this.stop();
          this.status(e.data.message);
        }
      };
      worker.onerror = (e) => {
        this.stop();
        this.status(`手势引擎错误：${e.message}`);
      };
      stream.getVideoTracks()[0].onended = () => {
        this.stop();
        this.status("摄像头连接已结束");
      };
      this.status("本机识别已开启");
      this.tick(generation);
    } catch (error) {
      if (generation === this.generation) {
        this.stop();
        this.status(String(error));
        throw error;
      }
    }
  }
  private tick(generation: number) {
    if (generation !== this.generation || !this.running) return;
    this.frame = requestAnimationFrame(() => this.tick(generation));
    const now = performance.now();
    if (this.busy || now - this.lastFrame < 33 || this.video.readyState < 2)
      return;
    this.lastFrame = now;
    this.busy = true;
    void createImageBitmap(this.video)
      .then((image) => {
        if (generation !== this.generation) {
          image.close();
          return;
        }
        this.worker?.postMessage({ type: "frame", image, time: now }, [image]);
      })
      .catch((e) => {
        this.busy = false;
        this.status(String(e));
      });
  }
  private process(r: any, ms: number) {
    const hands = (r.handedness as any[]).map((h, i) => ({
      hand: h[0]?.categoryName as "Left" | "Right",
      x: r.landmarks[i]?.[0]?.x ?? 0,
      y: r.landmarks[i]?.[0]?.y ?? 0,
      score: h[0]?.score ?? 0,
    }));
    const index = this.selection.select(
      hands,
      this.config().hand,
      performance.now(),
    );
    if (index < 0) {
      this.result(null, null, ms);
      return;
    }
    const points = r.landmarks[index] as Point[],
      world = r.worldLandmarks[index] as Point[],
      g = r.gestures[index]?.[0];
    const features = handFeatures(points, world);
    if (!features) {
      this.result(null, null, ms);
      return;
    }
    this.result(
      {
        ...features,
        gesture: g?.categoryName ?? "None",
        score: g?.score ?? 0,
        hand: hands[index].hand,
      },
      points,
      ms,
    );
  }

  stop() {
    ++this.generation;
    this.cancelInit?.();
    this.cancelInit = null;
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.busy = false;
    this.selection.reset();
    this.result(null, null, 0);
    this.status("未占用");
  }
}
