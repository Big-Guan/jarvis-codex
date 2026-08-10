const SINGLE_BINDINGS = Object.freeze({
  Open_Palm: {
    action: "dashboard",
    zh: "张开手掌 · 仪表盘",
    en: "Open palm · Dashboard",
    minScore: 0.64,
    holdFrames: 3,
  },
  Thumb_Down: {
    action: "stop",
    zh: "拇指向下 · 停止或拒绝",
    en: "Thumbs down · Stop or deny",
    minScore: 0.66,
    holdFrames: 3,
  },
  Closed_Fist: {
    action: "confirm",
    zh: "握拳 · 确认",
    en: "Closed fist · Confirm",
    minScore: 0.7,
    holdFrames: 3,
  },
  Thumb_Up: {
    action: "approve",
    zh: "拇指向上 · 批准",
    en: "Thumbs up · Approve",
    minScore: 0.7,
    holdFrames: 3,
  },
  Victory: {
    action: "cockpit",
    zh: "V 字手势 · 驾驶舱",
    en: "Victory sign · Cockpit",
    minScore: 0.66,
    holdFrames: 3,
  },
  ILoveYou: {
    action: "spin",
    zh: "我爱你手势 · 旋转",
    en: "I-love-you sign · Spin",
    minScore: 0.66,
    holdFrames: 3,
  },
  Pointing_Up: {
    action: "voice",
    zh: "食指向上 · 语音切换",
    en: "Point up · Toggle Voice",
    minScore: 0.7,
    holdFrames: 3,
  },
});

const COMBO_BINDINGS = Object.freeze({
  "Open_Palm+Open_Palm": {
    action: "settings",
    zh: "双手张开 · 设置",
    en: "Two open palms · Settings",
    minScore: 0.68,
    holdFrames: 4,
  },
  "Closed_Fist+Closed_Fist": {
    action: "studio",
    zh: "双手握拳 · DIY 工作台",
    en: "Two closed fists · DIY Studio",
    minScore: 0.72,
    holdFrames: 4,
  },
});

function candidate(key, binding, score) {
  return {
    state: "candidate",
    key,
    action: binding.action,
    zh: binding.zh,
    en: binding.en,
    score,
    holdFrames: binding.holdFrames,
  };
}

export function selectGestureCandidate(detections) {
  const known = detections
    .map(({ name, score }) => ({ name, score, binding: SINGLE_BINDINGS[name] }))
    .filter(({ binding }) => Boolean(binding));

  if (known.length === 0) return { state: "idle" };
  if (known.some(({ score, binding }) => score < binding.minScore)) return { state: "ambiguous" };

  if (known.length === 2) {
    const comboKey = known.map(({ name }) => name).sort().join("+");
    const combo = COMBO_BINDINGS[comboKey];
    if (!combo || known.some(({ score }) => score < combo.minScore)) return { state: "ambiguous" };
    return candidate(`combo:${comboKey}`, combo, Math.min(...known.map(({ score }) => score)));
  }

  if (known.length !== 1) return { state: "ambiguous" };
  const [{ name, score, binding }] = known;
  return candidate(`single:${name}`, binding, score);
}

export class GestureLatch {
  constructor({ releaseFrames = 3, cooldownMs = 700 } = {}) {
    this.releaseFrames = releaseFrames;
    this.cooldownMs = cooldownMs;
    this.reset();
  }

  update(selection, now) {
    if (selection.state === "idle") {
      this.holdKey = "";
      this.holdCount = 0;
      if (this.latched) {
        this.releaseCount += 1;
        if (this.releaseCount >= this.releaseFrames) this.latched = false;
      }
      return null;
    }

    // A low-confidence or conflicting multi-hand pose is not a release. This
    // keeps pose transitions from firing a second command by accident.
    if (selection.state === "ambiguous") {
      this.holdKey = "";
      this.holdCount = 0;
      this.releaseCount = 0;
      return null;
    }

    this.releaseCount = 0;
    if (this.latched) return null;
    if (selection.key === this.holdKey) this.holdCount += 1;
    else {
      this.holdKey = selection.key;
      this.holdCount = 1;
    }

    if (this.holdCount < selection.holdFrames || now < this.cooldownUntil) return null;
    this.latched = true;
    this.holdKey = "";
    this.holdCount = 0;
    this.cooldownUntil = now + this.cooldownMs;
    return selection;
  }

  reset() {
    this.holdKey = "";
    this.holdCount = 0;
    this.latched = false;
    this.releaseCount = 0;
    this.cooldownUntil = 0;
  }
}

export const GESTURE_ACTION_COUNT = Object.keys(SINGLE_BINDINGS).length + Object.keys(COMBO_BINDINGS).length;
