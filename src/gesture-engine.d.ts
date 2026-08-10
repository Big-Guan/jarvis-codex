export type GestureAction =
  | "stop"
  | "confirm"
  | "approve"
  | "dashboard"
  | "cockpit"
  | "spin"
  | "voice"
  | "settings"
  | "studio";

export interface GestureDetection {
  name: string;
  score: number;
}

export type GestureSelection =
  | { state: "idle" | "ambiguous" }
  | {
      state: "candidate";
      key: string;
      action: GestureAction;
      zh: string;
      en: string;
      score: number;
      holdFrames: number;
    };

export function selectGestureCandidate(detections: GestureDetection[]): GestureSelection;

export class GestureLatch {
  constructor(options?: { releaseFrames?: number; cooldownMs?: number });
  update(selection: GestureSelection, now: number): Extract<GestureSelection, { state: "candidate" }> | null;
  reset(): void;
}

export const GESTURE_ACTION_COUNT: number;
