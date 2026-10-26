import { Pose, homePose } from "./domain";
export function pointerMode(
  button: number,
  shift: boolean,
): "move" | "rotate" | null {
  return button === 2 || (button === 0 && shift)
    ? "move"
    : button === 0
      ? "rotate"
      : null;
}
export function pointerPose(
  pose: Pose,
  mode: "move" | "rotate",
  dx: number,
  dy: number,
  width: number,
  height: number,
): Partial<Pose> {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));
  return mode === "move"
    ? {
        x: clamp(pose.x + dx / Math.max(1, width), 0.12, 0.88),
        y: clamp(pose.y + dy / Math.max(1, height), 0.15, 0.85),
      }
    : {
        yaw: pose.yaw + dx * 0.008,
        pitch: clamp(pose.pitch + dy * 0.008, -0.7, 0.7),
      };
}
export const frontPose = () => ({
  yaw: homePose.yaw,
  pitch: homePose.pitch,
  roll: homePose.roll,
});
