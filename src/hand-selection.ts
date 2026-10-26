export type ControlHand = "Auto" | "Left" | "Right";
export interface DetectedHand {
  hand: "Left" | "Right";
  x: number;
  y: number;
  score: number;
}

/** Keep one controller while both hands are visible; reacquire after a short loss. */
export class HandSelection {
  private active: DetectedHand | null = null;
  private lastSeen = 0;
  reset() {
    this.active = null;
    this.lastSeen = 0;
  }
  select(hands: DetectedHand[], preference: ControlHand, now: number): number {
    if (preference !== "Auto") {
      const index = hands.findIndex((h) => h.hand === preference);
      if (index >= 0) {
        this.active = hands[index];
        this.lastSeen = now;
      }
      return index;
    }
    if (this.active) {
      const index = hands.findIndex((h) => h.hand === this.active!.hand);
      if (index >= 0) {
        this.active = hands[index];
        this.lastSeen = now;
        return index;
      }
      if (now - this.lastSeen < 180) return -1;
    }
    if (!hands.length) return -1;
    const index = hands.reduce(
      (best, hand, i) => (hand.score > hands[best].score ? i : best),
      0,
    );
    if (hands[index].score < 0.4) return -1;
    this.active = hands[index];
    this.lastSeen = now;
    return index;
  }
}
