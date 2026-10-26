export type Mode =
  | "ready"
  | "connecting"
  | "listening"
  | "working"
  | "speaking"
  | "approval"
  | "stopping"
  | "stopped"
  | "error";
export type GestureAction = "spread" | "assembleRotate" | "move" | "none";
export type PartGroup = "eyes" | "forehead" | "temples" | "jaw" | "shell";
export interface Config {
  schema: 1;
  appearance: {
    skin: string;
    height: number;
    glow: number;
    accent: string;
    pixelRatio: number;
    groups: Record<string, PartGroup>;
  };
  entrance: {
    mode: "full" | "quick" | "off";
    sound: number;
    intensity: number;
  };
  gestures: {
    enabled: boolean;
    camera: string;
    hand: "Auto" | "Left" | "Right";
    sensitivity: number;
    holdMs: number;
    confidence: number;
    mapping: Record<string, GestureAction>;
    calibrated: boolean;
    openness: [number, number];
  };
  voice: {
    wake: boolean;
    input: string;
    output: string;
    volume: number;
    name: string;
  };
  workspace: { path: string; permission: "safe" | "auto" | "full" };
  system: { reduceMotion: boolean; autostart: boolean; monitor: string };
}
export const defaults: Config = {
  schema: 1,
  appearance: {
    skin: "nano-armor",
    height: 360,
    glow: 0.7,
    accent: "#61d8f5",
    pixelRatio: 2,
    groups: {},
  },
  entrance: { mode: "full", sound: 0.12, intensity: 0.75 },
  gestures: {
    enabled: false,
    camera: "",
    hand: "Auto",
    sensitivity: 1.6,
    holdMs: 200,
    confidence: 0.55,
    mapping: {
      Open_Palm: "spread",
      Closed_Fist: "assembleRotate",
      Pinch: "move",
    },
    calibrated: false,
    openness: [0, 1],
  },
  voice: { wake: false, input: "", output: "", volume: 0.8, name: "cove" },
  workspace: { path: "", permission: "auto" },
  system: { reduceMotion: false, autostart: false, monitor: "" },
};
const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(hi, Math.max(lo, v))
    : fallback;
const str = (v: unknown, fallback = "") =>
  typeof v === "string" ? v : fallback;
const bool = (v: unknown, fallback: boolean) =>
  typeof v === "boolean" ? v : fallback;
export function normalizeConfig(input: unknown): Config {
  const p = (
    input && typeof input === "object" ? input : {}
  ) as Partial<Config>;
  if (p.schema !== undefined && p.schema !== 1)
    throw new Error("配置版本不兼容，请使用 Jarvis Next 导出的配置。");
  const c = structuredClone(defaults),
    a = p.appearance,
    g = p.gestures,
    v = p.voice,
    e = p.entrance;
  c.appearance.skin = str(a?.skin, c.appearance.skin);
  c.appearance.height = num(a?.height, 360, 180, 650);
  c.appearance.glow = num(a?.glow, 0.7, 0, 2);
  c.appearance.pixelRatio = num(a?.pixelRatio, 2, 1, 3);
  if (/^#[a-f0-9]{6}$/i.test(a?.accent ?? "")) c.appearance.accent = a!.accent;
  for (const [key, value] of Object.entries(a?.groups ?? {}))
    if (
      ["eyes", "forehead", "temples", "jaw", "shell"].includes(value) &&
      key !== "__proto__"
    )
      c.appearance.groups[key] = value;
  if (["full", "quick", "off"].includes(e?.mode ?? ""))
    c.entrance.mode = e!.mode;
  c.entrance.sound = num(e?.sound, 0.12, 0, 1);
  c.entrance.intensity = num(e?.intensity, 0.75, 0, 1);
  c.gestures.enabled = bool(g?.enabled, false);
  c.gestures.camera = str(g?.camera);
  c.gestures.hand = g?.hand === "Left" || g?.hand === "Right" ? g.hand : "Auto";
  c.gestures.sensitivity = num(g?.sensitivity, 1.6, 0.4, 3);
  c.gestures.holdMs = num(g?.holdMs, 200, 100, 1000);
  c.gestures.confidence = num(g?.confidence, 0.55, 0.4, 0.95);
  c.gestures.calibrated = bool(g?.calibrated, false);
  if (Array.isArray(g?.openness) && g.openness.length === 2) {
    const range: [number, number] = [
      num(g.openness[0], 0, 0, 1),
      num(g.openness[1], 1, 0, 1),
    ];
    if (range[1] - range[0] > 0.15) c.gestures.openness = range;
  }
  for (const key of Object.keys(c.gestures.mapping))
    if (
      ["spread", "assembleRotate", "move", "none"].includes(
        g?.mapping?.[key] ?? "",
      )
    )
      c.gestures.mapping[key] = g!.mapping[key];
  // Migrate the old pointing binding to pinch while retaining explicit custom actions.
  if (g?.mapping && !("Pinch" in g.mapping) && "Pointing_Up" in g.mapping) {
    const old = g.mapping.Pointing_Up;
    if (["spread", "assembleRotate", "move", "none"].includes(old))
      c.gestures.mapping.Pinch = old;
  }
  c.voice = {
    wake: bool(v?.wake, false),
    input: str(v?.input),
    output: str(v?.output),
    volume: num(v?.volume, 0.8, 0, 1),
    name: str(v?.name, "cove"),
  };
  c.workspace.path = str(p.workspace?.path);
  c.workspace.permission = ["safe", "full"].includes(
    p.workspace?.permission ?? "",
  )
    ? p.workspace!.permission
    : "auto";
  c.system = {
    reduceMotion: bool(p.system?.reduceMotion, false),
    autostart: bool(p.system?.autostart, false),
    monitor: str(p.system?.monitor),
  };
  return c;
}
export function validateConfig(c: Config): string | null {
  const actions = Object.values(c.gestures.mapping).filter((x) => x !== "none");
  if (new Set(actions).size !== actions.length)
    return "同一个动作绑定了多个手势，请保留唯一映射。";
  return null;
}
export interface Pose {
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  roll: number;
  spread: number;
}
export const homePose: Pose = {
  x: 0.5,
  y: 0.5,
  yaw: 0,
  pitch: -Math.PI / 18,
  roll: 0,
  spread: 0,
};
export interface HistoryItem {
  role: "user" | "assistant" | "system";
  text: string;
  time: number;
}
export interface Approval {
  id: number | string;
  method: string;
  detail: string;
}
export interface RuntimeState {
  paused: boolean;
  interactionPending: boolean;
  mode: Mode;
  voiceActive: boolean;
  taskActive: boolean;
  threadId: string;
  inputLevel: number;
  outputLevel: number;
  error: string;
  wakeReady: boolean;
  wakeStatus: string;
  userText: string;
  assistantText: string;
  history: HistoryItem[];
  approvals: Approval[];
  tools: { name: string; status: string; time: number }[];
}
export const initialRuntime = (): RuntimeState => ({
  paused: false,
  interactionPending: false,
  mode: "ready",
  voiceActive: false,
  taskActive: false,
  threadId: "",
  inputLevel: 0,
  outputLevel: 0,
  error: "",
  wakeReady: false,
  wakeStatus: "未启用",
  userText: "",
  assistantText: "",
  history: [],
  approvals: [],
  tools: [],
});
export interface Skin {
  id: string;
  name: string;
  path: string;
}
export const builtinSkin: Skin = {
  id: "nano-armor",
  name: "纳米装甲",
  path: "/models/nano-armor.glb",
};
export interface Snapshot {
  config: Config;
  runtime: RuntimeState;
  visible: boolean;
  revision: number;
  pose: Pose;
  command: { id: number; type: string };
  skins: Skin[];
}
export const modeLabels: Record<Mode, string> = {
  ready: "待命",
  connecting: "正在连接",
  listening: "正在倾听",
  working: "执行任务",
  speaking: "正在说话",
  approval: "等待确认",
  stopping: "正在停止",
  stopped: "已停止",
  error: "需要处理",
};
export function escapeHTML(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
