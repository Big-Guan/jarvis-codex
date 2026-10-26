import { PartGroup, RuntimeState } from "./domain";

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const level = (value: number) =>
  Number.isFinite(value) ? Math.sqrt(clamp((value - 0.012) * 2.6)) : 0;
const follow = (value: number, target: number, dt: number, attack = 0.045) =>
  value +
  (target - value) * (1 - Math.exp(-dt / (target > value ? attack : 0.18)));

/** Visual envelopes only. This never changes the actual Voice/task state. */
export class ArmorPresence {
  private speech = 0;
  private hearing = 0;
  private work = 0;
  private movement = 0;

  sample(
    now: number,
    dt: number,
    runtime: RuntimeState,
    reduceMotion: boolean,
    controlled: boolean,
  ) {
    const halted =
      runtime.paused || ["stopped", "stopping"].includes(runtime.mode);
    const attention = ["error", "approval"].includes(runtime.mode);
    const voice = runtime.voiceActive || runtime.mode === "speaking";
    this.speech = halted
      ? 0
      : follow(this.speech, voice ? level(runtime.outputLevel) : 0, dt);
    this.hearing = halted
      ? 0
      : follow(
          this.hearing,
          runtime.voiceActive ? level(runtime.inputLevel) : 0,
          dt,
        );
    this.work =
      halted || attention
        ? 0
        : follow(
            this.work,
            runtime.taskActive || runtime.mode === "working" ? 1 : 0,
            dt,
            0.14,
          );
    this.movement = follow(
      this.movement,
      halted || reduceMotion || controlled ? 0 : 1,
      dt,
      0.3,
    );
    const breath =
      reduceMotion || halted
        ? 0.35
        : (Math.sin((now * Math.PI * 2) / 4600) + 1) / 2;
    const speaking = runtime.mode === "speaking" && !halted ? 0.12 : 0;
    const speech = Math.max(this.speech, speaking);
    return {
      lift: (breath - 0.5) * 0.03 * this.movement,
      scale: 1 + (breath - 0.5) * 0.014 * this.movement,
      pitch: (-0.012 * (breath - 0.5) - this.speech * 0.025) * this.movement,
      scan: 0.62 - ((now % 1900) / 1900) * 1.24,
      work: reduceMotion ? 0 : this.work,
      rim: halted
        ? 0.015
        : 0.08 + breath * 0.16 + speech * 0.38 + this.work * 0.22,
      halo: halted
        ? 0.1
        : 0.38 + breath * 0.2 + speech * 0.55 + this.work * 0.22,
      attention,
      light: (group: PartGroup) => {
        if (halted) return 0.04;
        if (attention) return 0.75 + breath * 0.5;
        const eye = group === "eyes",
          jaw = group === "jaw";
        const workingRegion = group === "forehead" || group === "temples";
        return (
          0.45 +
          breath * 0.8 +
          (eye ? 0.5 + this.hearing * 2.8 : this.hearing * 0.3) +
          speech * (eye ? 7 : jaw ? 4.5 : 2) +
          this.work * (workingRegion ? 2.1 : 0.45)
        );
      },
    };
  }
}
