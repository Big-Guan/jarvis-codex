import { Config, Pose } from "./domain";
export interface HandInput {
  gesture: string;
  score: number;
  hand: string;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  roll: number;
  openness: number;
  extendedFingers?: number;
  pinchRatio?: number;
  pinchX?: number;
  pinchY?: number;
}
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
export class GestureMachine {
  candidate = "";
  since = 0;
  lastSeen = 0;
  acquired = false;
  action = "";
  anchor: { input: HandInput; pose: Pose } | null = null;
  message = "张掌旋转与收放 · 捏住移动 · 握拳合体";
  private activeHand = "";
  private pinching = false;
  private assembling = false;
  private lastPinch = -Infinity;
  private spreadValue: number | null = null;
  private spreadTime = 0;
  reset() {
    this.candidate = "";
    this.acquired = false;
    this.anchor = null;
    this.action = "";
    this.activeHand = "";
    this.pinching = false;
    this.assembling = false;
    this.lastPinch = -Infinity;
    this.spreadValue = null;
    this.message = "张掌旋转与收放 · 捏住移动 · 握拳合体";
  }
  private release(message: string) {
    this.candidate = "";
    this.action = "";
    this.anchor = null;
    this.acquired = false;
    this.pinching = false;
    this.assembling = false;
    this.spreadValue = null;
    this.message = message;
  }
  step(
    input: HandInput | null,
    now: number,
    pose: Pose,
    config: Config["gestures"],
    blocked = false,
  ): Partial<Pose> | null {
    if (blocked) {
      this.reset();
      this.message = "鼠标或出场动画控制中";
      return null;
    }
    if (
      !input ||
      ![input.score, input.x, input.y, input.openness].every(Number.isFinite) ||
      (config.hand !== "Auto" && input.hand !== config.hand) ||
      input.y < 0.02 ||
      input.y > 0.95 ||
      input.x < 0.02 ||
      input.x > 0.98
    ) {
      // Drop the anchor immediately. A returning hand must grab again, never jump.
      this.release("手部离开 · 保持位置");
      return null;
    }
    if (this.activeHand && input.hand !== this.activeHand) this.reset();
    this.activeHand = input.hand;
    this.lastSeen = now;
    const fist =
      input.gesture === "Closed_Fist" &&
      input.score >= config.confidence &&
      (input.extendedFingers === undefined || input.extendedFingers < 2);
    const pinch =
      !fist &&
      // A partly closed palm can bring thumb/index together accidentally.
      // Intentional dragging also keeps at least two fingers extended.
      (input.extendedFingers === undefined || input.extendedFingers >= 2) &&
      Number.isFinite(input.pinchRatio) &&
      Number.isFinite(input.pinchX) &&
      Number.isFinite(input.pinchY) &&
      input.pinchRatio! < (this.pinching ? 0.5 : 0.3);
    this.pinching = pinch;
    if (pinch) this.lastPinch = now;
    const geometry = input.extendedFingers !== undefined;
    // Once acquired, a relaxed/partly closed palm remains a continuous control.
    // The canned classifier often calls that pose "None"; it is not tracking loss.
    const palm =
      !fist &&
      !pinch &&
      geometry &&
      ((input.extendedFingers! >= 3 && input.openness >= 0.5) ||
        (this.action === "spread" && input.openness > 0.12));
    const gesture = pinch ? "Pinch" : palm ? "Open_Palm" : input.gesture;
    // Geometry uses the worker's landmark gate, not the canned gesture score.
    if (
      !pinch &&
      !palm &&
      input.score <
        (this.acquired
          ? Math.max(0.4, config.confidence - 0.1)
          : config.confidence)
    ) {
      this.release("等待清晰手势 · 保持位置");
      return null;
    }
    const next = config.mapping[gesture] ?? "none";
    if (next === "none") {
      this.release("已松开 · 保持位置");
      return null;
    }
    const point = pinch
      ? { ...input, x: input.pinchX!, y: input.pinchY! }
      : input;
    if (this.candidate !== next) {
      this.candidate = next;
      this.since = now;
      this.anchor = null;
      this.acquired = false;
    }
    const hold =
      next === "spread" ? Math.min(160, config.holdMs) : config.holdMs;
    // Releasing a pinch briefly resembles an open palm. Suppress only that
    // transition instead of making every deliberate palm wait half a second.
    const releasingPinch = next === "spread" && now - this.lastPinch < 260;
    if (now - this.since < hold || releasingPinch) {
      this.message = next === "spread" ? "正在接住手掌" : "正在抓取";
      return null;
    }
    this.acquired = true;
    if (this.action !== next) {
      this.action = next;
      this.anchor = null;
      this.assembling = next === "assembleRotate" && pose.spread > 0.05;
      this.spreadValue = null;
    }
    if (next === "assembleRotate" && (this.assembling || pose.spread > 0.05)) {
      this.assembling = pose.spread > 0.05;
      this.anchor = null;
      this.message = "正在合体 · 保持握拳";
      return { spread: 0 };
    }
    this.anchor ??= { input: { ...point }, pose: { ...pose } };
    const dx = (point.x - this.anchor.input.x) * config.sensitivity;
    const dy = (point.y - this.anchor.input.y) * config.sensitivity;
    if (next === "spread") {
      const aperture = clamp((input.openness - 0.16) / 0.68, 0, 1);
      const dt = Math.min(100, Math.max(0, now - this.spreadTime));
      this.spreadValue =
        this.spreadValue === null
          ? aperture
          : this.spreadValue +
            (aperture - this.spreadValue) * (1 - Math.exp(-dt / 55));
      this.spreadTime = now;
      this.message = `张掌旋转 · 张合控制间距 ${Math.round(this.spreadValue * 100)}%`;
      return {
        spread: this.spreadValue,
        yaw: this.anchor.pose.yaw + dx * Math.PI * 2,
        pitch: clamp(this.anchor.pose.pitch + dy * Math.PI, -0.7, 0.7),
        roll: this.anchor.pose.roll,
      };
    }
    if (next === "move") {
      this.message = "捏住拖动 · 松开停住";
      return {
        x: clamp(this.anchor.pose.x + dx, 0.12, 0.88),
        y: clamp(this.anchor.pose.y + dy, 0.15, 0.85),
      };
    }
    this.message = "握拳移动来旋转 · 松拳停住";
    return {
      spread: 0,
      yaw: this.anchor.pose.yaw + dx * Math.PI * 2,
      pitch: clamp(this.anchor.pose.pitch + dy * Math.PI, -0.7, 0.7),
      roll: this.anchor.pose.roll,
    };
  }
}
