import {
  createIcons,
  LayoutDashboard,
  Box,
  Hand,
  Sparkles,
  Mic,
  Folder,
  MessageSquare,
  Activity,
  Play,
  Square,
  RotateCcw,
  Plus,
  ArrowUpRight,
  ChevronRight,
  ShieldCheck,
  SlidersHorizontal,
  Camera,
  Eye,
  Save,
  Volume2,
  Check,
  X,
  Monitor,
  Radio,
  Move,
  Rotate3d,
  ArrowLeft,
  Cpu,
  Settings2,
} from "lucide";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Config,
  defaults,
  normalizeConfig,
  validateConfig,
  RuntimeState,
  initialRuntime,
  homePose,
  Pose,
  Snapshot,
  Skin,
  builtinSkin,
  modeLabels,
  escapeHTML as esc,
  PartGroup,
} from "./domain";
import {
  native,
  call,
  on,
  publish,
  loadConfig,
  saveConfig,
  loadSkins,
  skinURL,
} from "./platform";
import { SessionRuntime } from "./runtime";
import { RemoteSessionRuntime } from "./session-bridge";
import { ArmorScene } from "./armor-scene";
import {
  duration,
  impactTimes,
  blastTime,
  firstReleaseTime,
  floatTime,
  gatherTime,
} from "./entrance";
import { GestureCamera } from "./gestures";
import { GestureMachine } from "./gesture-machine";
import { probeGestureEngine } from "./gesture-engine";
const icons = {
  LayoutDashboard,
  Box,
  Hand,
  Sparkles,
  Mic,
  Folder,
  MessageSquare,
  Activity,
  Play,
  Square,
  RotateCcw,
  Plus,
  ArrowUpRight,
  ChevronRight,
  ShieldCheck,
  SlidersHorizontal,
  Camera,
  Eye,
  Save,
  Volume2,
  Check,
  X,
  Monitor,
  Radio,
  Move,
  Rotate3d,
  ArrowLeft,
  Cpu,
  Settings2,
};
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const nav = [
  ["overview", "layout-dashboard", "总览"],
  ["appearance", "box", "皮肤与外观"],
  ["gestures", "hand", "手势控制"],
  ["entrance", "sparkles", "出场与退场"],
  ["voice", "mic", "语音与唤醒"],
  ["workspace", "folder", "工作区与权限"],
  ["tasks", "message-square", "对话与任务"],
  ["system", "activity", "系统与诊断"],
];
const titles: Record<string, [string, string]> = {
  overview: ["控制中心", "设置妥当，召唤你的 Jarvis。"],
  appearance: ["皮肤与外观", "真正的三维装甲，每一个部件都可独立运动。"],
  gestures: ["手势控制", "一只手，捏住移动、握拳旋转、张手展开。"],
  entrance: ["出场与退场", "从远处逼近，在桌面中央重组。"],
  voice: ["语音与唤醒", "直接进入同一个 Codex Voice 会话。"],
  workspace: ["工作区与权限", "明确 Jarvis 在哪里工作、可以做什么。"],
  tasks: ["对话与任务", "同一个线程，连续对话与真实执行。"],
  system: ["系统与诊断", "设备、窗口与本机运行状态。"],
};
let config: Config;
let initialError = "";
try {
  config = await loadConfig();
} catch (e) {
  config = structuredClone(defaults);
  initialError = String(e);
}
if (native && !config.workspace.path)
  config.workspace.path = await call<string>("default_workspace");
let draft = structuredClone(config);
try {
  draft = normalizeConfig(
    JSON.parse(localStorage.getItem("jarvis-next.draft") ?? "null") ?? config,
  );
} catch {
  initialError = "上次草稿格式无效，已保留正式配置。";
}
let skins = await loadSkins().catch(() => [builtinSkin]);
let currentPage = "overview",
  visible = false,
  panelShown = true,
  returned = false,
  revision = 1,
  command = { id: 0, type: "" },
  pose: Pose = { ...homePose };
let pendingPublish = false,
  pendingRender = false,
  mouseEnabled = true,
  demoMode = "",
  selectedPart = "";
let devices: MediaDeviceInfo[] = [],
  monitors: any[] = [];
let cameraMessage = "摄像头未开启",
  handMessage = "等待手势",
  inferenceMs = 0;
let appearanceError = "",
  avatarCameraStatus = "未占用";
let commandSequence = Date.now();
let openingAvatar = false;
let lastAttention = "";
let prepared: {
  id: number;
  resolve: () => void;
  reject: (error: Error) => void;
} | null = null;
let environment: {
  version: string;
  voiceV3: boolean;
  voiceError?: string;
  loggedIn: boolean | null;
  checkedAt: number;
} | null = null;
let environmentMessage = "尚未检查 · 不打开麦克风、不创建会话";
const app = document.querySelector<HTMLDivElement>("#app")!;
document.documentElement.dataset.surface = "panel";
app.innerHTML = `<div class="panel-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">J</span><div>JARVIS<small>NEXT / 0.4</small></div></div><nav>${nav.map(([id, i, label]) => `<button data-page="${id}" aria-label="${label}" title="${label}">${icon(i)}<span>${label}</span></button>`).join("")}</nav></aside><section class="workspace"><header class="topbar"><div class="breadcrumb">JARVIS NEXT <span>/</span> <b id="breadcrumb">总览</b></div><div class="top-actions"><span id="save-state">已保存</span><button class="quiet" data-action="save" aria-label="保存配置">${icon("save")}</button><button class="quiet" data-action="pause" title="暂停语音与手势，当前任务继续"><span data-pause-label>暂停</span></button><button class="quiet" data-action="hide" title="隐藏机甲，会话继续">隐藏 Jarvis</button><button class="primary" data-action="summon">${icon("play")}<span id="summon-label">${native ? "打开 Jarvis" : "预览桌面机甲"}</span></button></div></header><main class="content"><div class="page-heading"><div><h1 id="page-title"></h1><p id="page-subtitle"></p></div><span class="status-pill" id="runtime-pill"><i></i><span>待命</span></span></div><div id="browser-notice" class="notice" ${native ? "hidden" : ""}>浏览器预览 · 真实 3D 与配置可用，桌面窗口、官方 Voice 与任务执行请使用原生版。</div><div id="page-content"></div></main><footer class="app-footer"><span>${icon("monitor")} ${native ? "macOS · 本机运行" : "Browser · 交互预览"}</span><span id="footer-info">正在载入 3D 模型…</span><span class="footer-right">${icon("shield-check")} 原始模型保留</span></footer></section></div><div id="browser-desktop" hidden><div id="desktop-stage"></div><button class="browser-return" data-action="panel">${icon("arrow-left")} 返回面板 <kbd>Esc</kbd></button><span class="browser-desktop-label">浏览器桌面预览 · 原生版背景透明</span></div><div id="toast" role="status"></div><dialog id="confirm-dialog"><h2></h2><p></p><div><button data-dialog="cancel">取消</button><button class="primary" data-dialog="confirm">确认</button></div></dialog>`;
const stageHost = document.createElement("div");
stageHost.className = "stage";
let stage: ArmorScene;
const Runtime = native ? RemoteSessionRuntime : SessionRuntime;
const runtime = new Runtime(
  () => config,
  scheduleUpdate,
  (input, output) => {
    if (stage && !demoMode)
      ((stage.runtime.inputLevel = input),
        (stage.runtime.outputLevel = output));
    document
      .querySelector<HTMLElement>("#input-meter")
      ?.style.setProperty("--level", `${input * 100}%`);
  },
  (cold) => void guard(() => summon(true, cold)),
  (action) => void guard(() => handleAction(action)),
);
const machine = new GestureMachine();
const camera = new GestureCamera(
  () => draft.gestures,
  (input, points, ms) => {
    inferenceMs = ms;
    if (stage && input) {
      const patch = machine.step(
        input,
        performance.now(),
        { ...stage.target, spread: stage.pose.spread },
        draft.gestures,
        stage.playing || stage.gestureBlocked || runtime.state.paused,
      );
      if (patch) stage.setPose(patch, true);
    } else if (stage)
      machine.step(null, performance.now(), stage.target, draft.gestures);
    handMessage = `${input ? (input.hand === "Left" ? "左手 · " : "右手 · ") : ""}${machine.message}`;
    const status = document.querySelector("#gesture-live");
    if (status)
      status.textContent = `${handMessage}${ms ? ` · ${Math.round(ms)} ms` : ""}`;
    const canvas = document.querySelector<HTMLCanvasElement>("#hand-overlay");
    if (canvas) {
      const c = canvas.getContext("2d")!;
      c.clearRect(0, 0, 640, 480);
      if (points) {
        c.fillStyle = "#8ce9fb";
        c.strokeStyle = "#67d2e2";
        c.lineWidth = 2;
        for (const ids of [
          [0, 1, 2, 3, 4],
          [0, 5, 6, 7, 8],
          [5, 9, 10, 11, 12],
          [9, 13, 14, 15, 16],
          [13, 17, 18, 19, 20],
          [0, 17],
        ]) {
          c.beginPath();
          ids.forEach((id, i) =>
            i
              ? c.lineTo((1 - points[id].x) * 640, points[id].y * 480)
              : c.moveTo((1 - points[id].x) * 640, points[id].y * 480),
          );
          c.stroke();
        }
        for (const p of points) {
          c.beginPath();
          c.arc((1 - p.x) * 640, p.y * 480, 3, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
  },
  (text) => {
    cameraMessage = text;
    const el = document.querySelector("#camera-message");
    if (el) el.textContent = text;
  },
);
stage = new ArmorScene(stageHost, {
  ready: (stats) => {
    appearanceError = "";
    updateStats();
    document
      .querySelector("#part-count")
      ?.replaceChildren(document.createTextNode(`${stats.meshes} 部件`));
  },
  error: (message) => {
    appearanceError = message;
    toast(message);
  },
  progress: (value) => {
    const e = document.querySelector("#load-progress");
    if (e) e.textContent = `载入 ${Math.round(value * 100)}%`;
  },
  pose: (p) => {
    if (!native && visible) pose = p;
  },
  picked: (name, group) => {
    selectedPart = name;
    const nameEl = document.querySelector("#selected-part");
    if (nameEl) nameEl.textContent = name;
    const select = document.querySelector<HTMLSelectElement>("#part-group");
    if (select) select.value = group;
  },
  finished: () => {
    if (visible && command.type === "test") void handleAction("panel");
  },
});
function isDirty() {
  return JSON.stringify(draft) !== JSON.stringify(config);
}
function toast(text: string) {
  const e = document.querySelector<HTMLElement>("#toast")!;
  e.textContent = text;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 4500);
}
async function guard(fn: () => unknown) {
  try {
    await fn();
  } catch (e) {
    toast(String(e));
    console.error(e);
  }
}
function snapshot(): Snapshot {
  return {
    config,
    runtime: runtime.state,
    visible,
    revision,
    pose,
    command,
    skins,
  };
}
function scheduleUpdate() {
  if (pendingPublish) return;
  pendingPublish = true;
  setTimeout(() => {
    pendingPublish = false;
    void publish(snapshot()).catch((e) => toast(String(e)));
    updateRuntime();
  }, 100);
}
function updateRuntime() {
  const voiceStep = document.querySelector("#voice-step");
  if (voiceStep) voiceStep.textContent = runtime.connectionStep;
  const state = runtime.state,
    label = state.paused ? "已暂停" : modeLabels[state.mode];
  for (const el of document.querySelectorAll("[data-pause-label]"))
    el.textContent = state.paused ? "继续" : "暂停";
  for (const el of document.querySelectorAll<HTMLButtonElement>(
    '[data-action="pause"]',
  ))
    el.disabled = state.interactionPending;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-action="summon"],[data-action="test"],[data-action="restore"]',
  )) {
    button.disabled = openingAvatar;
    button.setAttribute("aria-busy", String(openingAvatar));
  }
  const attention =
    state.mode === "approval"
      ? JSON.stringify(state.approvals.map((a) => a.id))
      : state.mode === "error"
        ? state.error
        : "";
  if (attention && attention !== lastAttention) {
    lastAttention = attention;
    if (visible)
      void guard(async () => {
        await handleAction("panel");
        navigate(
          state.mode === "approval" || state.taskActive ? "tasks" : "voice",
        );
        if (state.error) toast(state.error);
      });
  } else if (!attention) lastAttention = "";
  const pill = document.querySelector<HTMLElement>("#runtime-pill")!;
  pill.dataset.mode = state.mode;
  pill.querySelector("span")!.textContent = label;
  for (const el of document.querySelectorAll("[data-runtime]")) {
    const key = (el as HTMLElement).dataset.runtime!;
    el.textContent =
      key === "mode"
        ? label
        : key === "voice"
          ? state.voiceActive
            ? "已连接"
            : "未连接"
          : key === "wake"
            ? state.wakeReady
              ? "监听中"
              : config.voice.wake
                ? state.wakeStatus
                : "已关闭"
            : key === "thread"
              ? state.threadId || "尚未建立线程"
              : key === "error"
                ? state.error || "暂无错误"
                : "";
  }
  if (!demoMode) stage.runtime = state;
  if (currentPage === "tasks") updateTasks();
  updateSaved();
}
function updateSaved() {
  const dirty = isDirty();
  document.querySelector("#save-state")!.textContent = dirty
    ? "有未保存修改"
    : "已保存";
  document.querySelector("#save-state")!.classList.toggle("dirty", dirty);
  document.querySelector("#summon-label")!.textContent =
    (dirty ? "保存并" : "") +
    (native ? (returned ? "返回 Jarvis" : "打开 Jarvis") : "预览桌面机甲");
}
function updateStats() {
  const s = stage.stats;
  document.querySelector("#footer-info")!.textContent = s
    ? `${s.meshes} 部件 · ${(s.triangles / 10000).toFixed(1)} 万三角面 · 原始几何`
    : "模型载入中…";
  for (const el of document.querySelectorAll("[data-stats]"))
    el.textContent = s
      ? (el as HTMLElement).dataset.stats === "triangles"
        ? `${(s.triangles / 10000).toFixed(1)} 万`
        : `${s.meshes}`
      : "—";
}
const button = (label: string, action: string, i?: string, cls = "") =>
  `<button class="${cls}" data-action="${action}">${i ? icon(i) : ""}${label}</button>`;
function getAt(object: any, path: string) {
  return path.split(".").reduce((v, k) => v?.[k], object);
}
function setAt(object: any, path: string, value: unknown) {
  const keys = path.split(".");
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key];
  target[keys.at(-1)!] = value;
}
const range = (
  label: string,
  path: string,
  min: number,
  max: number,
  step: number,
  suffix = "",
) =>
  `<label class="field range-field"><span>${label}<output>${esc(getAt(draft, path))}${suffix}</output></span><input type="range" min="${min}" max="${max}" step="${step}" value="${esc(getAt(draft, path))}" data-field="${path}" data-suffix="${suffix}"></label>`;
const toggle = (label: string, description: string, path: string) =>
  `<label class="toggle-row"><span><b>${label}</b><small>${description}</small></span><input type="checkbox" data-field="${path}" ${getAt(draft, path) ? "checked" : ""}><span class="switch"></span></label>`;
const select = (label: string, path: string, options: [string, string][]) =>
  `<label class="field"><span>${label}</span><select data-field="${path}">${options.map(([value, label]) => `<option value="${esc(value)}" ${String(getAt(draft, path)) === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>`;
const preview = () =>
  `<div class="preview-card"><div class="card-heading"><span>实时预览</span><span id="load-progress" class="muted">原始模型</span></div><div class="preview-slot"></div><div class="preview-toolbar">${button("聚合", "assemble", "box")}${button("展开", "spread", "move")}${button("归位", "reset", "rotate-ccw")}</div><div class="preview-caption">拖动旋转 · 双击归位 · 所有原始部件保留</div></div>`;
const section = (title: string, description: string, body: string) =>
  `<section class="card"><div class="card-heading"><div><h3>${title}</h3>${description ? `<p>${description}</p>` : ""}</div></div>${body}</section>`;
function render() {
  document.querySelector("#page-title")!.textContent = titles[currentPage][0];
  document.querySelector("#page-subtitle")!.textContent =
    titles[currentPage][1];
  document.querySelector("#breadcrumb")!.textContent = nav.find(
    (x) => x[0] === currentPage,
  )![2];
  for (const b of document.querySelectorAll<HTMLElement>("[data-page]"))
    b.classList.toggle("active", b.dataset.page === currentPage);
  const page = document.querySelector("#page-content")!;
  let html = "";
  if (currentPage === "overview")
    html = `<div class="overview-grid"><div class="hero-card"><div class="hero-top"><span class="eyebrow">CURRENT SKIN</span><span class="mini-tag" id="part-count">${stage.stats?.meshes ?? "—"} 部件</span></div><h2>${esc(skins.find((s) => s.id === config.appearance.skin)?.name ?? "纳米装甲")}<span>01 / ARMOR</span></h2><div class="preview-slot"></div><div class="hero-bottom"><div><span class="online-dot"></span>真实 3D · 原始几何</div>${button("更换皮肤", "appearance", "arrow-up-right", "quiet")}</div></div><div class="overview-side">${section("随时，唤醒 Jarvis。", "设置留在这里。机甲属于桌面。", `<div class="readiness"><div>${icon("mic")}<span>Codex Voice</span><b data-runtime="voice">未连接</b></div><div>${icon("radio")}<span>语音唤醒</span><b data-runtime="wake">已关闭</b></div><div>${icon("hand")}<span>手势控制</span><b>${config.gestures.enabled ? "已启用" : "未开启"}</b></div></div><div class="stack">${button(native ? "打开 Jarvis" : "预览桌面机甲", "summon", "play", "primary wide")}${button("只看出场效果", "test", "sparkles", "wide")}${button("仅显示机甲", "restore", "monitor", "quiet wide")}</div><p class="fine-print">召唤后隐藏管理面板。菜单栏随时返回。</p>`)}<div class="quick-grid"><button data-action="gestures">${icon("hand")}<b>手势操控</b><small>张开 · 合拢 · 旋转</small>${icon("chevron-right")}</button><button data-action="entrance">${icon("sparkles")}<b>出场编排</b><small>撞击 · 散落 · 重组</small>${icon("chevron-right")}</button></div><div class="session-strip"><span class="eyebrow">CURRENT SESSION</span><b data-runtime="mode">待命</b><p data-runtime="thread">尚未建立线程</p>${button("查看对话与任务", "tasks", "arrow-up-right", "quiet")}</div></div></div><div class="bottom-metrics"><div><span>窗口模式</span><b>面板 / 桌面分离</b></div><div><span>当前出场</span><b>${{ full: `完整召唤 · ${(duration / 1000).toFixed(1)} 秒`, quick: "快速聚合 · 0.9 秒", off: "直接显现" }[config.entrance.mode]}</b></div><div><span>模型精度</span><b><span data-stats="triangles">190.7 万</span> 三角面</b></div></div>`;
  if (currentPage === "appearance")
    html = `<div class="settings-grid"><div class="settings-column">${section("你的皮肤", "独立保存模型与外观参数。", `<div class="skin-list">${skins.map((s) => `<button data-skin="${esc(s.id)}" class="skin-row ${draft.appearance.skin === s.id ? "selected" : ""}">${icon("box")}<span><b>${esc(s.name)}</b><small>${s.id === "nano-armor" ? "165 部件 · 原始 GLB" : "导入的 GLB 皮肤"}</small></span>${draft.appearance.skin === s.id ? icon("check") : ""}</button>`).join("")}${button("导入 GLB 皮肤", "import-skin", "plus", "wide dashed")}</div>`)}${section("外观", "只改变实时显示，原始文件保持完整。", range("机甲高度", "appearance.height", 180, 650, 10, " px") + range("发光强度", "appearance.glow", 0, 2, 0.05) + `<label class="field color-field"><span>能量颜色</span><input type="color" data-field="appearance.accent" value="${draft.appearance.accent}"><b>${draft.appearance.accent}</b></label>`)}${section(
      "部件分区",
      "点击预览中的装甲，指定它如何响应工作状态。",
      `<p class="selected-part" id="selected-part">${selectedPart || "先点击一个部件"}</p><select id="part-group">${[
        ["eyes", "眼部"],
        ["forehead", "额头"],
        ["temples", "太阳穴"],
        ["jaw", "下颌"],
        ["shell", "外壳"],
      ]
        .map(([v, l]) => `<option value="${v}">${l}</option>`)
        .join(
          "",
        )}</select>${button("保存此部件分区", "assign-part", "check")}<p class="fine-print">初始分区按空间位置估算，可逐个校正。发光保留金属与蓝色纹理细节。</p>`,
    )} </div><div>${preview()}${section("状态试播", "待机呼吸 · 说话随音量发光 · 工作流光。此处仅试播，不启动语音或任务。", `<div class="segmented">${["ready", "listening", "working", "speaking"].map((mode) => `<button data-demo="${mode}" class="${demoMode === mode ? "selected" : ""}">${modeLabels[mode as keyof typeof modeLabels]}</button>`).join("")}</div>${button("返回真实状态", "clear-demo", "rotate-ccw", "quiet")}`)}</div></div>`;
  if (currentPage === "gestures")
    html = `<div class="settings-grid"><div class="settings-column">${section(
      "手势开关",
      "仅在机甲显示或当前试用期间使用摄像头。",
      toggle(
        "启用手势",
        "本机识别，不保存或上传摄像头画面。",
        "gestures.enabled",
      ) +
        select("控制手", "gestures.hand", [
          ["Auto", "左右手自动识别"],
          ["Right", "右手"],
          ["Left", "左手"],
        ]) +
        select("摄像头", "gestures.camera", [
          ["", "系统默认"],
          ...devices
            .filter((d) => d.kind === "videoinput")
            .map(
              (d, i) =>
                [d.deviceId, d.label || `摄像头 ${i + 1}`] as [string, string],
            ),
        ]),
    )}${section(
      "单手操作",
      "张掌后移动手掌来旋转；张大手指让碎片散开，放松收拢让碎片靠近。捏合拖动位置，握拳合体后也能旋转。左右手均可。",
      Object.entries({
        Open_Palm: "张开手掌",
        Closed_Fist: "握紧拳头",
        Pinch: "拇指与食指捏合",
      })
        .map(([id, label]) =>
          select(label, `gestures.mapping.${id}`, [
            ["spread", "张合收放并旋转"],
            ["assembleRotate", "合体后旋转"],
            ["move", "捏住拖动位置"],
            ["none", "不执行动作"],
          ]),
        )
        .join(""),
    )}${section("手感调节", "张掌确认不超过 160 ms；捏合松开后保留短暂防误触间隔。旋转采用相对位置跟随。", range("灵敏度", "gestures.sensitivity", 0.4, 3, 0.1) + range("手势确认时间", "gestures.holdMs", 100, 1000, 25, " ms") + range("识别置信度", "gestures.confidence", 0.4, 0.95, 0.05) + button("恢复单手预设", "responsive-gestures", "sparkles", "wide"))}</div><div>${section("手势试用", "无需校准。让整只手进入画面，跟随下方实时提示操作。", `<div class="camera-frame"><div id="camera-video-slot"></div><canvas id="hand-overlay" width="640" height="480"></canvas><div class="camera-empty" ${camera.running ? "hidden" : ""}>${icon("camera")}<p>点击开始试用后才打开摄像头</p></div></div><p class="live-label" id="camera-message">${esc(cameraMessage)}</p><p class="fine-print" id="gesture-live">${esc(handMessage)}</p><div class="button-row">${button(camera.running ? "停止摄像头" : "开始试用", camera.running ? "camera-stop" : "try-gestures", "camera")}</div>`)}${section("鼠标操控", "桌面机甲与这里的预览使用同一套操作。", '<p>左键拖动旋转；Shift + 左键或右键拖动位置；滚轮缩放；双击恢复正脸。</p><p class="fine-print">鼠标操作时暂停手势接管。桌面空白处可正常点击，菜单栏可切换鼠标操控。</p>')}${preview()}</div></div>`;
  if (currentPage === "entrance")
    html = `<div class="settings-grid"><div class="settings-column">${section(
      "召唤方式",
      "完整出场在中央合体；临时隐藏后恢复原姿态。",
      `<div class="choice-list">${[
        [
          "full",
          "完整召唤",
          `${impactTimes.length} 次高速连撞，逐步脱甲与重组 · ${(duration / 1000).toFixed(1)} 秒`,
        ],
        ["quick", "快速聚合", "零件就近锁合 · 0.9 秒"],
        ["off", "直接显现", "淡入机甲 · 0.15 秒"],
      ]
        .map(
          ([v, l, d]) =>
            `<label class="choice ${draft.entrance.mode === v ? "selected" : ""}"><input type="radio" name="entrance" data-field="entrance.mode" value="${v}" ${draft.entrance.mode === v ? "checked" : ""}><span><b>${l}</b><small>${d}</small></span></label>`,
        )
        .join("")}</div>`,
    )}${section("效果强度", "对话时自动降低出场音效。", range("火花与冲击气浪", "entrance.intensity", 0, 1, 0.05) + range("出场音量", "entrance.sound", 0, 1, 0.05) + toggle("减少动态效果", "用淡入替代撞击与大范围碎片。", "system.reduceMotion"))}${section("桌面试播", "只播放视觉效果，不打开麦克风。", `<div class="button-row">${button("面板内预览", "play-in-panel", "play", "primary")}${button("桌面试播", "test", "monitor")}</div><label class="field"><span>分镜时间轴 <output id="scrub-label">0.00 s</output></span><input type="range" min="0" max="${duration}" step="5" value="0" id="entrance-scrub" aria-label="出场分镜时间"></label><p class="fine-print">拖动查看真实部件的每个阶段；播放按钮从头开始。</p>`)}<div class="timeline">${[
      ["00.0", "从远处角落逼近"],
      [(impactTimes[0] / 1000).toFixed(2), `${impactTimes.length} 次高速连撞`],
      [(firstReleaseTime / 1000).toFixed(2), "后段连撞，逐步脱甲"],
      [(blastTime / 1000).toFixed(2), "最后一撞，碎片炸开"],
      [(floatTime / 1000).toFixed(2), "减速，碎片悬浮"],
      [(gatherTime / 1000).toFixed(2), "部件依次吸回锁合"],
      [(duration / 1000).toFixed(2), "机甲就绪"],
    ]
      .map(([t, l]) => `<div><span>${t}</span><i></i><b>${l}</b></div>`)
      .join(
        "",
      )}</div></div><div>${preview()}<div class="hint-card">${icon("sparkles")}<p>动画与语音连接并行。随时从菜单栏跳过出场或停止全部。</p></div></div></div>`;
  if (currentPage === "voice")
    html = `<div class="settings-grid"><div class="settings-column">${section("本机唤醒", "说出唤醒词，开始与 Jarvis 对话。", toggle("监听「嗨 Jarvis」", "启用后在后台待命；官方 Voice 连接时释放唤醒麦克风。", "voice.wake") + `<p class="inline-status" data-runtime="wake">已关闭</p>`)}${section("音频设备", "通过系统授权后可以显示设备名称。", select("麦克风", "voice.input", [["", "系统默认"], ...devices.filter((d) => d.kind === "audioinput").map((d, i) => [d.deviceId, d.label || `麦克风 ${i + 1}`] as [string, string])]) + select("扬声器", "voice.output", [["", "系统默认"], ...devices.filter((d) => d.kind === "audiooutput").map((d, i) => [d.deviceId, d.label || `扬声器 ${i + 1}`] as [string, string])]) + range("语音音量", "voice.volume", 0, 1, 0.05) + `<div id="input-meter" class="audio-meter"><i></i></div><div class="button-row">${button("授权并检测麦克风", "mic-test", "mic")}${button("刷新设备", "devices", "rotate-ccw")}</div><p class="fine-print">当前环境不支持输出设备选择时，使用系统默认扬声器。</p>`)}${section(
      "声音",
      "声音选项来自已复用的 Codex Voice 接口。",
      select(
        "Voice",
        "voice.name",
        [
          "cove",
          "arbor",
          "ash",
          "ballad",
          "breeze",
          "cedar",
          "coral",
          "echo",
          "ember",
          "juniper",
          "maple",
          "marin",
          "sage",
          "shimmer",
          "sol",
          "spruce",
          "vale",
          "verse",
        ].map((x) => [x, x]),
      ) +
        `<div class="button-row">${button("连接语音", "connect-voice", "mic", "primary")}${button("结束语音", "end-voice", "square")}</div>`,
    )}</div><div>${preview()}${section("连接信息", "界面切换不会重新创建会话。", `<dl><dt>Voice</dt><dd data-runtime="voice"></dd><dt>当前线程</dt><dd data-runtime="thread"></dd><dt>连接信息</dt><dd data-runtime="error"></dd></dl>`)}</div></div>`;
  if (currentPage === "workspace")
    html = `<div class="settings-grid"><div class="settings-column">${section("工作目录", "每个目录独立续接自己的 Codex 线程。", `<label class="field"><span>目录</span><input type="text" data-field="workspace.path" value="${esc(draft.workspace.path)}" placeholder="选择一个项目文件夹"></label>${button("选择文件夹", "choose-workspace", "folder")}<p class="fine-print">活动任务或语音期间，先停止再切换工作区与权限。</p>`)}${section(
      "执行权限",
      "选择 Jarvis 执行任务时可以访问的范围。",
      `<div class="choice-list">${[
        ["safe", "安全模式", "需要时确认越界操作"],
        ["auto", "自动办公", "在当前工作区内自主执行，越界直接阻止"],
        ["full", "完全访问", "可访问整个文件系统；仅在明确需要时选择"],
      ]
        .map(
          ([v, l, d]) =>
            `<label class="choice"><input type="radio" data-field="workspace.permission" name="permission" value="${v}" ${draft.workspace.permission === v ? "checked" : ""}><span><b>${l}</b><small>${d}</small></span></label>`,
        )
        .join("")}</div>`,
    )}${section("线程管理", "新建或切换不删除原来的 Codex 历史。", `<p class="code-value" data-runtime="thread"></p><div class="button-row">${button("新开线程", "new-thread", "plus")}${button("续接指定线程", "resume-thread", "rotate-ccw")}</div>`)}</div><div>${section("当前状态", "", `<dl><dt>状态</dt><dd data-runtime="mode"></dd><dt>Voice</dt><dd data-runtime="voice"></dd><dt>线程</dt><dd data-runtime="thread"></dd></dl>`)} </div></div>`;
  if (currentPage === "tasks")
    html = `<div id="approvals"></div><div class="task-layout"><section class="conversation card"><div class="card-heading"><h3>当前会话</h3><span data-runtime="mode"></span></div><div id="messages" class="messages"></div><form id="command-form"><textarea id="command-input" placeholder="输入任务，发送到当前 Codex 线程…" rows="2" aria-label="任务输入"></textarea><div><small>${native ? "文字可加入正在进行的语音会话" : "浏览器预览不执行真实任务"}</small><button class="primary" type="submit">发送 ${icon("arrow-up-right")}</button></div></form></section><div>${section("执行状态", "", `<div id="tool-list"></div><div class="button-row">${button("停止全部", "stop", "square", "danger")}</div>`)}${section("最近的问题", "", `<p data-runtime="error"></p>`)}</div></div>`;
  if (currentPage === "system")
    html = `<div class="settings-grid"><div class="settings-column">${section("启动与显示器", "设置启动方式和桌面显示位置。", toggle("开机后台待命", "登录后在后台待命，不自动播放出场。", "system.autostart") + select("机甲显示器", "system.monitor", [["", "鼠标所在显示器"], ...monitors.map((m) => [m.name, `${m.name} · ${m.width} × ${m.height}`] as [string, string])]))}${section(
      "渲染质量",
      "所有档位都保留原始几何和贴图。",
      select("渲染像素倍率", "appearance.pixelRatio", [
        ["1", "1× · 降低填充开销"],
        ["2", "2× · 清晰"],
        ["3", "3× · 高像素密度"],
      ]) +
        `<p class="fine-print">像素倍率只改变渲染缓冲。不会减面、缩小原始贴图或丢弃部件。</p>`,
    )}${section("配置管理", "导出的配置不包含账号凭证或原始音频。", `<div class="button-row">${button("导出配置", "export-config", "arrow-up-right")}${button("导入配置", "import-config", "plus")}${button("撤销草稿", "discard", "rotate-ccw")}</div><input type="file" id="config-file" accept="application/json,.json" hidden>`)}</div><div>${section("诊断概览", "仅展示已取得的真实状态。", `<dl><dt>应用版本</dt><dd>Jarvis Next 0.4.7</dd><dt>运行环境</dt><dd>${native ? "Tauri / macOS" : "浏览器预览"}</dd><dt>模型部件</dt><dd data-stats="parts">—</dd><dt>三角面</dt><dd data-stats="triangles">—</dd><dt>唤醒</dt><dd data-runtime="wake"></dd><dt>摄像头</dt><dd id="camera-diagnostic">${camera.running ? "试用中" : esc(avatarCameraStatus)}</dd><dt>语音连接阶段</dt><dd id="voice-step">${esc(runtime.connectionStep)}</dd><dt>错误</dt><dd data-runtime="error"></dd></dl><div class="button-row">${native ? button("检查 Codex 环境", "check-environment", "cpu") : ""}${button("自检手势引擎", "probe-engine", "hand")}${button("导出诊断", "export-diagnostics", "activity")}</div><p class="fine-print" id="environment-result">${esc(environmentMessage)}</p><p id="engine-result" class="fine-print">自检使用空白帧，不打开摄像头。</p>`)}</div></div>`;
  page.innerHTML = html;
  const slot = document.querySelector<HTMLElement>(".preview-slot");
  if (slot) {
    slot.append(stageHost);
    stage.active = panelShown;
    stage.desktop = false;
    stage.moveTo(stageHost);
  } else stage.active = false;
  if (currentPage === "gestures" && camera.running)
    document.querySelector("#camera-video-slot")?.append(camera.video);
  stage.setConfig(draft);
  createIcons({ icons });
  updateSaved();
  updateRuntime();
  updateStats();
}
function updateTasks() {
  const messages = document.querySelector("#messages");
  if (!messages) return;
  const state = runtime.state;
  let history = state.history;
  const body =
    history
      .map(
        (m) =>
          `<article class="message ${m.role}"><span>${m.role === "user" ? "你" : m.role === "assistant" ? "JARVIS" : "系统"}<time>${new Date(m.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></span><p>${esc(m.text)}</p></article>`,
      )
      .join("") ||
    `<div class="empty-state">${icon("message-square")}<h3>从一个任务开始</h3><p>语音或文字都将进入同一个 Codex 线程。</p></div>`;
  const latest =
    state.assistantText && state.history.at(-1)?.text !== state.assistantText
      ? `<article class="message assistant"><span>JARVIS · 正在输出</span><p>${esc(state.assistantText)}</p></article>`
      : "";
  if (messages.innerHTML !== body + latest) {
    messages.innerHTML = body + latest;
    messages.scrollTop = messages.scrollHeight;
  }
  document.querySelector("#approvals")!.innerHTML = state.approvals
    .map(
      (a, i) =>
        `<section class="approval-card"><h3>需要你确认 · ${esc(a.method)}</h3><pre>${esc(a.detail)}</pre><div class="button-row"><button data-approval="${i}" data-allow="false">拒绝</button><button class="primary" data-approval="${i}" data-allow="true">允许一次</button></div></section>`,
    )
    .join("");
  document.querySelector("#tool-list")!.innerHTML = state.tools.length
    ? state.tools
        .map(
          (t) =>
            `<div class="tool-row"><b>${esc(t.name)}</b><span>${esc(t.status)}</span></div>`,
        )
        .join("")
    : '<p class="muted">暂无执行中的工具。</p>';
}
function navigate(page: string) {
  if (!titles[page]) return;
  if (stage.playing) stage.skip();
  if (currentPage === "gestures" && page !== "gestures") {
    camera.stop();
    if (runtime instanceof RemoteSessionRuntime)
      void runtime.cameraPreview(false);
    machine.reset();
  }
  demoMode = "";
  currentPage = page;
  render();
}
async function commit() {
  const next = normalizeConfig(draft),
    error = validateConfig(next);
  if (error) throw new Error(error);
  const scopeChanged =
    JSON.stringify(config.workspace) !== JSON.stringify(next.workspace);
  if (
    scopeChanged &&
    (runtime.state.taskActive ||
      runtime.state.voiceActive ||
      runtime.connecting)
  )
    throw new Error(
      "先结束当前任务与语音，再保存工作区或权限变更。其他外观设置可单独保存。",
    );
  if (
    config.voice.input !== next.voice.input &&
    (runtime.state.voiceActive || runtime.connecting)
  )
    throw new Error("请先结束当前语音，再切换麦克风。");
  await saveConfig(next);
  config = next;
  draft = structuredClone(next);
  revision++;
  localStorage.removeItem("jarvis-next.draft");
  if (scopeChanged) await runtime.reconfigure();
  await runtime.setOutput();
  await runtime.syncWake();
  scheduleUpdate();
  updateSaved();
  toast("配置已保存");
}
async function showAvatar(type: string) {
  if (openingAvatar) return;
  openingAvatar = true;
  updateRuntime();
  try {
    camera.stop();
    machine.reset();
    demoMode = "";
    stage.runtime = runtime.state;
    if (type === "summon" || type === "test") pose = { ...homePose };
    if (native) {
      await call("window_mode", { mode: "prepare" });
      const id = ++commandSequence;
      command = { id, type: "prepare" };
      const ready = new Promise<void>((resolve, reject) => {
        prepared = { id, resolve, reject };
      });
      const timer = setTimeout(
        () =>
          prepared?.reject(new Error("机甲加载超时，请返回皮肤页面检查模型。")),
        45000,
      );
      try {
        await publish(snapshot());
        await ready;
      } finally {
        clearTimeout(timer);
        prepared = null;
      }
      stage.active = false;
      panelShown = false;
      await call("mouse_control", { enabled: mouseEnabled, dragging: false });
      await call("window_mode", { mode: "avatar" });
      visible = true;
      command = { id: ++commandSequence, type };
      await publish(snapshot());
      if (runtime instanceof RemoteSessionRuntime)
        await runtime.cameraPreview(false);
    } else {
      visible = true;
      panelShown = false;
      command = { id: ++commandSequence, type };
      document.querySelector<HTMLElement>(".panel-shell")!.hidden = true;
      document.querySelector<HTMLElement>("#browser-desktop")!.hidden = false;
      stage.desktop = true;
      stage.mouse = true;
      stage.moveTo(document.querySelector("#desktop-stage")!);
      stage.setConfig(type === "test" ? draft : config);
      stage.active = true;
      stage.setPose(pose);
      if (type === "summon" || type === "test") stage.play();
      else stage.skip();
    }
    if (type !== "test") returned = true;
  } finally {
    openingAvatar = false;
    updateRuntime();
  }
}
async function summon(wake = false, cold = false) {
  if (!wake && isDirty()) await commit();
  const type = returned && !wake ? "restore" : "summon";
  if (!wake || !visible) await showAvatar(type);
  if (native) await runtime.startVoice(undefined, cold);
}
async function saveDownload(name: string, data: unknown) {
  if (native) {
    const path = await save({
      defaultPath: name,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    await call("export_json", { path, data });
    toast("文件已保存");
    return;
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function confirmDialog(title: string, copy: string) {
  const d = document.querySelector<HTMLDialogElement>("#confirm-dialog")!;
  d.querySelector("h2")!.textContent = title;
  d.querySelector("p")!.textContent = copy;
  d.showModal();
  return new Promise<boolean>((resolve) => {
    const done = (value: boolean) => {
      d.removeEventListener("click", click);
      d.removeEventListener("cancel", cancel);
      d.close();
      resolve(value);
    };
    const click = (e: Event) => {
      const button = (e.target as Element).closest<HTMLElement>(
        "[data-dialog]",
      );
      if (button) done(button.dataset.dialog === "confirm");
    };
    const cancel = (e: Event) => {
      e.preventDefault();
      done(false);
    };
    d.addEventListener("click", click);
    d.addEventListener("cancel", cancel);
  });
}

async function handleAction(action: string) {
  if (titles[action]) {
    navigate(action);
    return;
  }
  if (action === "save") {
    await commit();
    render();
  } else if (action === "summon") await summon();
  else if (action === "pause") {
    camera.stop();
    machine.reset();
    if (runtime.state.paused) await runtime.continueInteraction();
    else await runtime.pauseInteraction();
  } else if (action === "restore") await showAvatar("restore");
  else if (action === "test") {
    const previous = config;
    config = structuredClone(draft);
    try {
      await showAvatar("test");
    } finally {
      config = previous;
    }
  } else if (action === "panel" || action === "panel-shown") {
    prepared?.reject(new Error("已返回管理面板。"));
    panelShown = true;
    camera.stop();
    machine.reset();
    if (native) {
      if (action === "panel") await call("window_mode", { mode: "panel" });
    } else {
      visible = false;
      document.querySelector<HTMLElement>("#browser-desktop")!.hidden = true;
      document.querySelector<HTMLElement>(".panel-shell")!.hidden = false;
      stage.moveTo(stageHost);
    }
    render();
    scheduleUpdate();
  } else if (action === "panel-hidden") {
    panelShown = false;
    camera.stop();
    if (runtime instanceof RemoteSessionRuntime)
      await runtime.cameraPreview(false);
    stage.active = false;
  } else if (action === "hide") {
    prepared?.reject(new Error("已取消召唤。"));
    visible = false;
    camera.stop();
    if (native) await call("window_mode", { mode: "hide" });
    else await handleAction("panel");
    scheduleUpdate();
  } else if (["skip", "center"].includes(action)) {
    command = { id: ++commandSequence, type: action };
    if (!native) {
      if (action === "skip") stage.skip();
      else stage.setPose({ ...homePose });
    }
    scheduleUpdate();
  } else if (action === "mouse") {
    mouseEnabled = !mouseEnabled;
    stage.mouse = mouseEnabled;
    await call("mouse_control", { enabled: mouseEnabled, dragging: false });
    command = {
      id: ++commandSequence,
      type: mouseEnabled ? "mouse-on" : "mouse-off",
    };
    scheduleUpdate();
  } else if (action === "toggle-wake") {
    draft.voice.wake = !config.voice.wake;
    await commit();
    render();
  } else if (action === "stop") {
    prepared?.reject(new Error("已停止召唤。"));
    command = { id: ++commandSequence, type: "stop" };
    stage.stop();
    scheduleUpdate();
    await runtime.stopAll();
  } else if (action === "spread") stage.setPose({ spread: 1 });
  else if (action === "assemble") stage.setPose({ spread: 0 });
  else if (action === "reset") stage.setPose({ ...homePose });
  else if (action === "play-in-panel") {
    stage.setConfig(draft);
    stage.play();
  } else if (action === "clear-demo") {
    demoMode = "";
    stage.runtime = runtime.state;
  } else if (action === "devices") {
    devices = await navigator.mediaDevices.enumerateDevices();
    render();
  } else if (action === "mic-test") {
    if (
      native &&
      (await call<string>("request_microphone_permission")) !== "authorized"
    )
      throw new Error("麦克风权限未获批准");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    devices = await navigator.mediaDevices.enumerateDevices();
    toast("麦克风可用，已释放测试音轨。");
    render();
  } else if (action === "connect-voice") {
    if (isDirty()) await commit();
    await runtime.startVoice();
  } else if (action === "end-voice") await runtime.endVoice();
  else if (action === "new-thread") await runtime.freshThread();
  else if (action === "resume-thread") {
    const id = prompt("输入已有 Codex thread ID（原线程不删除）");
    if (id?.trim()) await runtime.freshThread(id.trim());
  } else if (action === "choose-workspace") {
    if (!native)
      throw new Error("选择本机文件夹需要原生应用；浏览器可手动填写目录。");
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      draft.workspace.path = dir;
      saveDraft();
      render();
    }
  } else if (action === "import-skin") {
    if (!native) throw new Error("持久导入本机皮肤请使用原生版。");
    const source = await open({
      filters: [{ name: "GLB model", extensions: ["glb"] }],
      multiple: false,
    });
    if (typeof source === "string") {
      const skin = await call<Skin>("import_skin", { source });
      await stage.load(skinURL(skin));
      skins.push(skin);
      draft.appearance.skin = skin.id;
      saveDraft();
      render();
    }
  } else if (action === "assign-part") {
    if (!selectedPart) throw new Error("先点击预览中的一个部件。");
    draft.appearance.groups[selectedPart] =
      document.querySelector<HTMLSelectElement>("#part-group")!
        .value as PartGroup;
    saveDraft();
    stage.setConfig(draft);
    toast("部件分区已写入草稿，保存后应用。");
  } else if (action === "try-gestures") {
    if (runtime.state.paused) throw new Error("请先点击继续，再开始手势试用。");
    if (runtime instanceof RemoteSessionRuntime)
      await runtime.cameraPreview(true);
    await camera.start();
    devices = await navigator.mediaDevices.enumerateDevices();
    render();
  } else if (action === "camera-stop") {
    camera.stop();
    machine.reset();
    if (runtime instanceof RemoteSessionRuntime)
      await runtime.cameraPreview(false);
    cameraMessage = "摄像头已释放";
    render();
  } else if (action === "responsive-gestures") {
    draft.gestures.hand = "Auto";
    draft.gestures.sensitivity = 1.6;
    draft.gestures.holdMs = 200;
    draft.gestures.confidence = 0.55;
    draft.gestures.mapping = { ...defaults.gestures.mapping };
    machine.reset();
    saveDraft();
    render();
    toast("已恢复捏合移动、握拳旋转和张手展开，保存后应用到桌面。");
  } else if (action === "export-config")
    await saveDownload("jarvis-next-settings.json", draft);
  else if (action === "import-config")
    document.querySelector<HTMLInputElement>("#config-file")!.click();
  else if (action === "discard") {
    draft = structuredClone(config);
    localStorage.removeItem("jarvis-next.draft");
    await stage.load(
      skinURL(skins.find((s) => s.id === draft.appearance.skin) ?? builtinSkin),
    );
    render();
  } else if (action === "export-diagnostics")
    await saveDownload("jarvis-next-diagnostics.json", {
      version: "0.4.6",
      ...(await runtime.getDiagnostics()),
      native,
      model: stage.stats,
      mode: runtime.state.mode,
      voiceActive: runtime.state.voiceActive,
      wake: runtime.state.wakeStatus,
      camera: camera.running ? "试用中" : avatarCameraStatus,
      inferenceMs,
      error: runtime.state.error,
      renderError: appearanceError,
      environment,
    });
  else if (action === "check-environment") {
    environmentMessage = "正在检查 Codex 与 Voice 协议…";
    render();
    try {
      environment = await call<typeof environment>("check_environment");
      environmentMessage = environment
        ? `${environment.version} · ${environment.voiceV3 ? "支持 Voice V3" : environment.voiceError} · ${environment.loggedIn === true ? "已登录" : environment.loggedIn === false ? "需要先登录 Codex" : "登录状态未取得"}`
        : "未取得环境信息";
    } catch (error) {
      environmentMessage = `检查失败：${error}`;
    }
    if (currentPage === "system") render();
  } else if (action === "probe-engine") {
    const el = document.querySelector("#engine-result")!;
    el.textContent = "正在加载并运行本机识别器…";
    try {
      const ms = await probeGestureEngine();
      el.textContent = `引擎自检通过 · 空白帧 ${Math.round(ms)} ms · 未使用摄像头`;
    } catch (e) {
      el.textContent = `自检失败：${e}`;
      throw e;
    }
  } else if (action === "quit") {
    if (
      await confirmDialog(
        "退出 Jarvis Next？",
        runtime.state.taskActive
          ? "退出将停止当前任务、语音和唤醒监听。"
          : "退出后将不再监听唤醒词。",
      )
    ) {
      camera.stop();
      await call("quit_next");
    }
  }
}
function saveDraft() {
  localStorage.setItem("jarvis-next.draft", JSON.stringify(draft));
  updateSaved();
}
app.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "entrance-scrub") {
    stage.seek(Number(input.value));
    document.querySelector("#scrub-label")!.textContent =
      `${(Number(input.value) / 1000).toFixed(2)} s`;
    return;
  }
  if (!input.dataset.field) return;
  let value: unknown =
    input.type === "checkbox"
      ? input.checked
      : input.type === "range"
        ? Number(input.value)
        : input.value;
  if (input.dataset.field === "appearance.pixelRatio")
    value = Number(input.value);
  setAt(draft, input.dataset.field, value);
  saveDraft();
  stage.setConfig(draft);
  const output = input.closest("label")?.querySelector("output");
  if (output) output.textContent = String(value) + (input.dataset.suffix ?? "");
});
app.addEventListener("click", (e) => {
  const target = (e.target as Element).closest<HTMLElement>(
    "[data-page],[data-action],[data-skin],[data-demo],[data-approval]",
  );
  if (!target) return;
  if (target.dataset.page) navigate(target.dataset.page);
  else if (target.dataset.action)
    void guard(() => handleAction(target.dataset.action!));
  else if (target.dataset.skin) {
    void guard(async () => {
      const skin = skins.find((s) => s.id === target.dataset.skin)!;
      await stage.load(skinURL(skin));
      draft.appearance.skin = skin.id;
      saveDraft();
      render();
    });
  } else if (target.dataset.demo) {
    demoMode = target.dataset.demo;
    stage.runtime = {
      ...initialRuntime(),
      voiceActive: demoMode === "listening" || demoMode === "speaking",
      taskActive: demoMode === "working",
      mode: demoMode as RuntimeState["mode"],
      inputLevel: demoMode === "listening" ? 0.18 : 0,
      outputLevel: demoMode === "speaking" ? 0.5 : 0,
    };
    target.parentElement
      ?.querySelectorAll("button")
      .forEach((b) => b.classList.toggle("selected", b === target));
  } else if (target.dataset.approval) {
    const a = runtime.state.approvals[Number(target.dataset.approval)];
    if (a)
      void guard(() => runtime.approve(a.id, target.dataset.allow === "true"));
  }
});
app.addEventListener("submit", (e) => {
  if ((e.target as HTMLElement).id !== "command-form") return;
  e.preventDefault();
  const input = document.querySelector<HTMLTextAreaElement>("#command-input")!;
  const text = input.value.trim();
  void guard(async () => {
    await runtime.send(text);
    input.value = "";
  });
});
app.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "config-file" && input.files?.[0])
    void guard(async () => {
      const next = normalizeConfig(JSON.parse(await input.files![0].text()));
      const skin = skins.find((s) => s.id === next.appearance.skin);
      if (!skin) throw new Error("配置引用的皮肤尚未导入，请先导入对应 GLB。");
      await stage.load(skinURL(skin));
      draft = next;
      saveDraft();
      render();
    });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !native && visible) void handleAction("panel");
});
await on<string>("next-action", (a) => void guard(() => handleAction(a)));
await on<any>("next-feedback", (data) => {
  if (data.prepared === prepared?.id) prepared?.resolve();
  if (data.pose) {
    pose = data.pose;
    scheduleUpdate();
  }
  if (data.cameraStatus) {
    avatarCameraStatus = data.cameraStatus;
    const el = document.querySelector("#camera-diagnostic");
    if (el) el.textContent = avatarCameraStatus;
  }
  if (data.error) {
    appearanceError = data.error;
    toast(data.error);
    if (data.visualError) {
      prepared?.reject(new Error(data.error));
      runtime.fail(data.error);
      if (visible) void handleAction("panel");
    }
  }
  if (data.finished && command.type === "test") void handleAction("panel");
});
await on<{ kind: string }>(
  "next-system",
  (event) =>
    void guard(async () => {
      if (["lock", "sleep"].includes(event.kind)) {
        visible = false;
        camera.stop();
        stage.active = false;
        await runtime.suspend();
      } else if (event.kind === "resume") {
        await runtime.resume();
      } else if (event.kind === "displays") {
        monitors = await call<any[]>("monitor_list");
      }
      scheduleUpdate();
    }),
);
await on<boolean>("next-visibility", (show) => {
  visible = show;
  scheduleUpdate();
});
render();
stage.setConfig(draft);
void guard(() =>
  stage.load(
    skinURL(skins.find((s) => s.id === draft.appearance.skin) ?? builtinSkin),
  ),
);
await guard(() => runtime.init());
if (native && (await call<boolean>("startup_is_background")))
  stage.active = false;
scheduleUpdate();
void navigator.mediaDevices?.enumerateDevices().then((d) => {
  devices = d;
});
if (native)
  void call<any[]>("monitor_list").then((m) => {
    monitors = m;
  });
if (initialError) toast(initialError);
setInterval(() => {
  if (!visible && stage.stats)
    document.querySelector("#footer-info")!.textContent =
      `${stage.stats.meshes} 部件 · ${(stage.stats.triangles / 10000).toFixed(1)} 万三角面${stage.active ? ` · ${Math.round(stage.fps)} FPS` : ""}`;
}, 2000);

// Synthetic levels belong only to the explicitly selected panel preview.
setInterval(() => {
  if (!demoMode || !panelShown) return;
  const t = performance.now() / 1000;
  const syllable =
    Math.pow(Math.max(0, Math.sin(t * 8.4)), 2) *
    (0.55 + 0.45 * Math.sin(t * 2.1) ** 2);
  stage.runtime.outputLevel = demoMode === "speaking" ? syllable * 0.55 : 0;
  stage.runtime.inputLevel = demoMode === "listening" ? syllable * 0.3 : 0;
}, 50);
