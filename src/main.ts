import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openNativeDialog } from "@tauri-apps/plugin-dialog";
import { CameraGestureController, type GestureEvent } from "./gesture-camera";
import { parseSettingsCommand, type SettingsCommand } from "./settings-command.js";
import "./style.css";

type Mode = "booting" | "ready" | "voice-starting" | "listening" | "working" | "speaking" | "degraded" | "stopped";
type Message = { id?: number | string; method?: string; params?: any };
type Session = { threadId: string; cwd: string };
type DirectVoice = {
  codexConnected: boolean;
  voiceActive: boolean;
  phase: string;
  protocol: string;
  threadId?: string;
  realtimeSessionId?: string;
};
type WakeStatus = {
  enabled: boolean;
  ready: boolean;
  authorization: string;
};
type WakeEvent = {
  ok: boolean;
  error?: string;
  cold?: boolean;
};
type PermissionMode = "safe" | "auto" | "full";
type StudioTheme = "quantum" | "reactor" | "synthwave" | "matrix" | "arctic";
type StudioLayout = "balanced" | "focus" | "command";
type StudioPreviewState = "ready" | "listening" | "working" | "approval" | "complete" | "error";
type StudioConfig = {
  version: 1;
  callsign: string;
  subtitle: string;
  theme: StudioTheme;
  layout: StudioLayout;
  intensity: number;
  avatarScale: number;
  showWorkers: boolean;
  showDialogue: boolean;
  showWave: boolean;
  compactControls: boolean;
};

const state = {
  mode: "booting" as Mode,
  session: null as Session | null,
  directVoice: null as DirectVoice | null,
  wake: null as WakeStatus | null,
  level: 0,
  manualStop: false,
  agentWorking: false,
};

const WORKSPACE_KEY = "jarvis.workspace";
const THREAD_KEY_PREFIX = "jarvis.threadId:";
const PERMISSION_KEY = "jarvis.permissionMode";
const STUDIO_KEY = "jarvis.studio.v1";
const VOICE_KEY = "jarvis.voice";
const LANG_KEY = "jarvis.lang";
const WAKE_PHRASE_KEY = "jarvis.wakePhrase";
const DEFAULT_WAKE_PHRASE = "嗨 Jarvis / Hey Jarvis";

type VoiceId = "alloy" | "arbor" | "ash" | "ballad" | "breeze" | "cedar" | "coral" | "cove" | "echo" | "ember"
  | "juniper" | "maple" | "marin" | "sage" | "shimmer" | "sol" | "spruce" | "vale" | "verse";

const SUPPORTED_VOICES: readonly VoiceId[] = [
  "alloy", "arbor", "ash", "ballad", "breeze", "cedar", "coral", "cove", "echo", "ember",
  "juniper", "maple", "marin", "sage", "shimmer", "sol", "spruce", "vale", "verse",
] as const;

function validVoiceId(value: unknown): VoiceId {
  return typeof value === "string" && (SUPPORTED_VOICES as readonly string[]).includes(value as string)
    ? (value as VoiceId)
    : "cove";
}

function storedVoice(): VoiceId {
  return validVoiceId(localStorage.getItem(VOICE_KEY));
}

type Lang = "zh" | "en";

const T = {
  subtitle: { zh: "语音操作系统", en: "CODEX VOICE SYSTEM" },
  modeBooting: { zh: "初始化中", en: "INITIALIZING" },
  modeReady: { zh: "待命", en: "STANDBY" },
  modeVoiceStarting: { zh: "连接中", en: "CONNECTING" },
  modeListening: { zh: "聆听中", en: "LISTENING" },
  modeWorking: { zh: "执行中", en: "WORKING" },
  modeSpeaking: { zh: "说话中", en: "SPEAKING" },
  modeDegraded: { zh: "受限", en: "DEGRADED" },
  modeStopped: { zh: "已停止", en: "STOPPED" },
  settings: { zh: "设置", en: "Settings" },
  studio: { zh: "工作台", en: "Studio" },
  identityBooting: { zh: "系统启动中", en: "SYSTEM BOOT" },
  identityReady: { zh: "待命", en: "STANDBY" },
  identityListening: { zh: "聆听中", en: "LISTENING" },
  identityWorking: { zh: "执行中", en: "WORKING" },
  identitySpeaking: { zh: "说话中", en: "SPEAKING" },
  identityStopped: { zh: "已停止", en: "STOPPED" },
  workerConnecting: { zh: "连接中", en: "Connecting" },
  workerStandby: { zh: "待命", en: "Standby" },
  workerFresh: { zh: "新线程就绪", en: "Fresh thread ready" },
  dialogueYou: { zh: "你", en: "YOU" },
  dialogueJarvis: { zh: "贾维斯", en: "JARVIS" },
  codexVoice: { zh: "语音对话", en: "CODEX VOICE" },
  codexVoiceDesc: { zh: "V3 WebRTC 直连", en: "V3 WEBRTC · DIRECT" },
  cmdPlaceholder: { zh: "Voice 不可用时，发送文字指令…", en: "Type a command when Voice is unavailable…" },
  execute: { zh: "执行", en: "EXECUTE" },
  stop: { zh: "停止", en: "STOP" },
  stopDesc: { zh: "中断所有任务", en: "INTERRUPT ALL" },
  degradedTitle: { zh: "需要权限", en: "JARVIS NEEDS PERMISSION" },
  degradedCopy: { zh: "首次使用请允许麦克风和语音识别。", en: "Please allow microphone and speech recognition." },
  approvalTitle: { zh: "高风险操作确认", en: "High-Risk Operation" },
  approvalCopy: { zh: "Codex 请求执行需要确认的动作。", en: "Codex requested an action that needs approval." },
  deny: { zh: "拒绝", en: "Deny" },
  approve: { zh: "允许一次", en: "Approve Once" },
  transcriptWake: { zh: "嗨，贾维斯", en: "Hey, Jarvis" },
  transcriptConnecting: { zh: "正在连接 Codex 线程…", en: "Connecting to Codex thread…" },
  transcriptNew: { zh: "新开线程", en: "New Thread" },
  transcriptNewMsg: { zh: "新的 Codex thread 已创建。下一次唤醒和文字任务都会进入这个线程。", en: "A new Codex thread has been created. The next wake and text tasks will use it." },
  workspaceSaved: { zh: "工作目录已保存，重启 Jarvis 后生效。", en: "Workspace saved. Restart Jarvis to apply." },
  voiceSaved: { zh: (l: string) => `音色已切换为 ${l}，下一次唤醒生效。`, en: (l: string) => `Voice changed to ${l}, takes effect on next wake.` },
  permChanged: { zh: (l: string) => `权限已切换为"${l}"，下一次任务将续接当前 Codex thread。`, en: (l: string) => `Permission changed to "${l}". Next task resumes current thread.` },
  newThreadError: { zh: (m: string) => `新建线程失败，原线程仍可续接：${m}`, en: (m: string) => `Failed to create new thread: ${m}` },
  voiceDefault: { zh: "Codex 默认音色", en: "Codex default voice" },
  settingsVoiceSection: { zh: "语音音色", en: "Voice" },
  settingsVoiceHint: { zh: "下次唤醒生效", en: "Takes effect on next wake" },
  settingsWorkspaceSection: { zh: "工作目录", en: "Workspace" },
  settingsWorkspaceHint: { zh: "修改后需重启 Jarvis", en: "Restart Jarvis after changing" },
  settingsPermissionSection: { zh: "操作权限", en: "Permission" },
  settingsPermissionHint: { zh: "切换将重建 Codex 运行时", en: "Rebuilds Codex runtime" },
  settingsRuntimeSection: { zh: "运行状态", en: "Runtime status" },
  settingsCommandSection: { zh: "贾维斯控制", en: "Jarvis control" },
  settingsCommandCopy: { zh: "可直接说或输入设置指令，例如：打开摄像头、音色设为 Cove、权限改为安全模式、主题切换为矩阵。说“设置帮助”可查看全部能力。", en: "Speak or type settings commands, such as: enable camera, set voice to Cove, use safe permission mode, or set theme to Matrix. Say “settings help” for all options." },
  settingsSafe: { zh: "安全模式", en: "Safe" },
  settingsSafeDesc: { zh: "越界或高风险时询问确认", en: "Ask before risky operations" },
  settingsAuto: { zh: "自动办公", en: "Auto" },
  settingsAutoDesc: { zh: "目录内自主执行，越界自动阻止", en: "Autonomous within workspace" },
  settingsFull: { zh: "完全访问", en: "Full Access" },
  settingsFullDesc: { zh: "不限制目录不询问，谨慎使用", en: "No limits, use carefully" },
  settingsRecommended: { zh: "推荐", en: "Recommended" },
  settingsCaution: { zh: "谨慎", en: "Caution" },
  settingsInfo: { zh: "每个工作目录续接自己的 Codex thread，新开线程后原线程仍保留在 Codex 历史记录中。唤醒词在本机识别；Jarvis 通过 Codex app-server V3 WebRTC 进入官方 Voice 线程，复用本机 Codex 登录，不模拟点击、不建立第二套 GPT-Live 会话。", en: "Each workspace resumes its own Codex thread. New threads keep old ones in history. Wake phrase is recognized on-device. Jarvis enters Voice via Codex app-server V3 WebRTC, reusing local auth." },
  save: { zh: "保存", en: "Save" },
  close: { zh: "关闭", en: "Close" },
  newThread: { zh: "新建线程", en: "New Thread" },
  studioDialog: { zh: "DIY 工作台", en: "DIY STUDIO" },
  langLabel: { zh: "界面语言", en: "Language" },
  langZh: { zh: "简体中文", en: "简体中文" },
  langEn: { zh: "English", en: "English" },
  langHint: { zh: "语言偏好", en: "Language preference" },
  wakePhraseLabel: { zh: "唤醒词", en: "Wake phrase" },
  gestureLabel: { zh: "手势控制", en: "Gestures" },
  gestureToggleLabel: { zh: "启用摄像头手势识别", en: "Enable camera gesture control" },
  gestureToggleHint: { zh: "首次开启时 macOS 会弹出系统授权对话框，请点「允许」", en: "macOS will ask for camera permission on first enable — click Allow" },
  gestureHelp: { zh: "查看手势", en: "View gestures" },
  gestureGuideTitle: { zh: "手势控制说明", en: "Gesture controls" },
  gestureGuideIntro: { zh: "将手完整放入画面并保持约 0.3 秒；双手组合保持约 0.4 秒。", en: "Keep your hand in view for about 0.3 seconds, or a two-hand shortcut for 0.4 seconds." },
  gestureStopName: { zh: "停止 / 拒绝", en: "Stop / deny" },
  gestureStopDesc: { zh: "拇指向下；有授权弹窗时表示拒绝", en: "Thumbs down; denies an open approval prompt" },
  gestureDashboardName: { zh: "切换仪表盘", en: "Toggle dashboard" },
  gestureDashboardDesc: { zh: "单手张开手掌", en: "One open palm" },
  gestureConfirmName: { zh: "确认", en: "Confirm" },
  gestureConfirmDesc: { zh: "单手握拳；有授权弹窗时确认", en: "One closed fist; confirms an open approval prompt" },
  gestureApproveName: { zh: "批准", en: "Approve" },
  gestureApproveDesc: { zh: "拇指向上", en: "Thumbs up" },
  gestureCockpitName: { zh: "切换驾驶舱", en: "Toggle cockpit" },
  gestureCockpitDesc: { zh: "伸出食指和中指，比出 V 字", en: "Victory / V sign" },
  gestureSpinName: { zh: "360° 旋转", en: "360° spin" },
  gestureSpinDesc: { zh: "伸出拇指、食指和小指", en: "I-love-you hand sign" },
  gestureVoiceName: { zh: "切换语音对话", en: "Toggle Voice" },
  gestureVoiceDesc: { zh: "食指向上；再次触发可结束语音", en: "Point up; repeat after releasing to end Voice" },
  gestureSettingsName: { zh: "切换系统设置", en: "Toggle Settings" },
  gestureSettingsDesc: { zh: "双手同时张开", en: "Two open palms" },
  gestureStudioName: { zh: "切换 DIY 工作台", en: "Toggle DIY Studio" },
  gestureStudioDesc: { zh: "双手同时握拳", en: "Two closed fists" },
  gestureReleaseTip: { zh: "全局防误触：每次触发后必须让手势回到自然状态，再做下一项。", en: "Global release lock: return to a neutral pose before making the next gesture." },
  autostartLabel: { zh: "后台启动", en: "Background startup" },
  autostartToggleLabel: { zh: "登录 macOS 时后台启动 Jarvis", en: "Start Jarvis in the background at login" },
  autostartToggleHint: { zh: "可随时关闭；关闭后仍可手动启动 Jarvis", en: "You can disable this at any time and still launch Jarvis manually" },
  pickFolder: { zh: "选择目录", en: "Browse" },
  pickFolderError: { zh: "目录选择失败", en: "Failed to pick folder" },
  wakePhrasePlaceholder: { zh: "输入自定义唤醒短语", en: "Custom wake phrase" },
  autonomyLabel: { zh: "自治度", en: "Autonomy" },
  autonomyLow: { zh: "低", en: "Low" },
  autonomyMid: { zh: "中", en: "Mid" },
  autonomyHigh: { zh: "高", en: "High" },
  unsavedTitle: { zh: "设置已修改，尚未保存", en: "Unsaved changes" },
  unsavedSave: { zh: "保存并关闭", en: "Save & close" },
  unsavedDiscard: { zh: "放弃更改", en: "Discard" },
  unsavedKeep: { zh: "继续编辑", en: "Keep editing" },
  fullAccessConfirm: { zh: "完全访问将允许 Codex 访问工作目录外的文件且不再请求确认。确定启用吗？", en: "Full Access lets Codex access files outside the workspace without asking for approval. Enable it?" },
  wakePhraseHint: { zh: "自定义唤醒短语", en: "Custom wake phrase" },
  wakePhrase: { zh: "嗨 Jarvis / Hey Jarvis", en: "Hey Jarvis" },
  wakeListenerLabel: { zh: "唤醒监听", en: "Wake listener" },
  threadLabel: { zh: "Codex 线程", en: "Codex thread" },
  workspaceLabel: { zh: "工作目录", en: "Workspace" },
  voiceKernelLabel: { zh: "语音内核", en: "Voice kernel" },
  permissionLabel: { zh: "当前权限", en: "Permission" },
  checking: { zh: "检测中", en: "Checking" },
  notStarted: { zh: "未启动", en: "Not started" },
};

function storedLang(): Lang {
  const v = localStorage.getItem(LANG_KEY);
  return v === "en" ? "en" : "zh";
}
let currentLang = storedLang();

function $t(key: keyof typeof T, ...args: string[]): string {
  const entry = T[key];
  if (!entry) return key;
  const val = entry[currentLang];
  return typeof val === "function" ? (val as (...a: string[]) => string)(...args) : val;
}

function applyLanguage(lang: Lang | null = null, persist = true) {
  const next = lang ?? currentLang;
  if (persist) localStorage.setItem(LANG_KEY, next);
  currentLang = next;
  const s = document.querySelector(".shell");
  if (s) s.setAttribute("data-lang", next);

  const m = state.mode;
  const modeLabels: Record<Mode, keyof typeof T> = {
    booting: "modeBooting", ready: "modeReady", "voice-starting": "modeVoiceStarting",
    listening: "modeListening", working: "modeWorking", speaking: "modeSpeaking",
    degraded: "modeDegraded", stopped: "modeStopped",
  };
  $("#brand-subtitle").textContent = $t("subtitle");
  $<HTMLElement>("#mode-label").textContent = $t(modeLabels[m] ?? "modeBooting");
  ($("#settings") as HTMLButtonElement).ariaLabel = $t("settings");
  ($("#studio") as HTMLButtonElement).ariaLabel = $t("studio");

  const identityStates: Partial<Record<Mode, keyof typeof T>> = {
    booting: "identityBooting", ready: "identityReady", listening: "identityListening",
    working: "identityWorking", speaking: "identitySpeaking", stopped: "identityStopped",
  };
  $<HTMLElement>("#identity-state").textContent = $t(identityStates[m] ?? "identityBooting");

  ($("#command-input") as HTMLInputElement).placeholder = $t("cmdPlaceholder");
  ($("#command-form button") as HTMLButtonElement).textContent = $t("execute");
  const micB = document.querySelector<HTMLElement>(".mic b");
  if (micB) micB.textContent = $t("codexVoice");
  const micS = document.querySelector<HTMLElement>(".mic small");
  if (micS) micS.textContent = $t("codexVoiceDesc");
  const stopB = document.querySelector<HTMLElement>(".stop b");
  if (stopB) stopB.textContent = $t("stop");
  const stopS = document.querySelector<HTMLElement>(".stop small");
  if (stopS) stopS.textContent = $t("stopDesc");

  ($("#degraded-banner b") as HTMLElement).textContent = $t("degradedTitle");

  ($("#approval h2") as HTMLElement).textContent = $t("approvalTitle");
  ($("#approve") as HTMLElement).textContent = $t("approve");
  ($("#deny") as HTMLElement).textContent = $t("deny");

  const youB = document.querySelector<HTMLElement>(".dialogue b:first-of-type");
  if (youB) youB.textContent = $t("dialogueYou");
  const jarvisB = document.querySelector<HTMLElement>(".dialogue .jarvis");
  if (jarvisB) jarvisB.textContent = $t("dialogueJarvis");

  // Refresh settings dialog if it's open
  if (settings.open) {
    $<HTMLElement>("#settings-dialog .settings-header h2").textContent = $t("settings");
    const cards = document.querySelectorAll<HTMLElement>("#settings-dialog .settings-card .section-heading");
    const cardTitles: (keyof typeof T)[] = [
      "wakePhraseLabel", "gestureLabel", "autostartLabel", "langLabel", "settingsVoiceSection",
      "settingsWorkspaceSection", "settingsPermissionSection", "settingsRuntimeSection", "settingsCommandSection",
    ];
    for (let i = 0; i < cards.length && i < cardTitles.length; i++) {
      const b = cards[i].querySelector("b");
      if (b) b.textContent = $t(cardTitles[i]);
    }
    const permLabels = document.querySelectorAll<HTMLElement>("#settings-dialog .permission-options label span b");
    const permDescs = document.querySelectorAll<HTMLElement>("#settings-dialog .permission-options label span small");
    const permTags = document.querySelectorAll<HTMLElement>("#settings-dialog .permission-options em");
    if (permLabels[0]) permLabels[0].textContent = $t("settingsSafe");
    if (permLabels[1]) permLabels[1].textContent = $t("settingsAuto");
    if (permLabels[2]) permLabels[2].textContent = $t("settingsFull");
    if (permDescs[0]) permDescs[0].textContent = $t("settingsSafeDesc");
    if (permDescs[1]) permDescs[1].textContent = $t("settingsAutoDesc");
    if (permDescs[2]) permDescs[2].textContent = $t("settingsFullDesc");
    if (permTags[0]) permTags[0].textContent = $t("settingsRecommended");
    if (permTags[1]) permTags[1].textContent = $t("settingsCaution");
    ($("#settings-dialog .info-block") as HTMLElement).textContent = $t("settingsInfo");
    ($("#save-settings") as HTMLElement).textContent = $t("save");
    ($("#close-settings") as HTMLElement).textContent = $t("close");
    ($("#new-thread") as HTMLElement).textContent = $t("newThread");
    ($("#open-studio") as HTMLElement).textContent = $t("studioDialog");
    ($("#gesture-toggle-label") as HTMLElement).textContent = $t("gestureToggleLabel");
    ($("#gesture-toggle-hint") as HTMLElement).textContent = $t("gestureToggleHint");
    ($("#gesture-help") as HTMLElement).textContent = $t("gestureHelp");
    ($("#gesture-guide-title") as HTMLElement).textContent = $t("gestureGuideTitle");
    ($("#gesture-guide-intro") as HTMLElement).textContent = $t("gestureGuideIntro");
    ($("#gesture-stop-name") as HTMLElement).textContent = $t("gestureStopName");
    ($("#gesture-stop-desc") as HTMLElement).textContent = $t("gestureStopDesc");
    ($("#gesture-dashboard-name") as HTMLElement).textContent = $t("gestureDashboardName");
    ($("#gesture-dashboard-desc") as HTMLElement).textContent = $t("gestureDashboardDesc");
    ($("#gesture-confirm-name") as HTMLElement).textContent = $t("gestureConfirmName");
    ($("#gesture-confirm-desc") as HTMLElement).textContent = $t("gestureConfirmDesc");
    ($("#gesture-approve-name") as HTMLElement).textContent = $t("gestureApproveName");
    ($("#gesture-approve-desc") as HTMLElement).textContent = $t("gestureApproveDesc");
    ($("#gesture-cockpit-name") as HTMLElement).textContent = $t("gestureCockpitName");
    ($("#gesture-cockpit-desc") as HTMLElement).textContent = $t("gestureCockpitDesc");
    ($("#gesture-spin-name") as HTMLElement).textContent = $t("gestureSpinName");
    ($("#gesture-spin-desc") as HTMLElement).textContent = $t("gestureSpinDesc");
    ($("#gesture-voice-name") as HTMLElement).textContent = $t("gestureVoiceName");
    ($("#gesture-voice-desc") as HTMLElement).textContent = $t("gestureVoiceDesc");
    ($("#gesture-settings-name") as HTMLElement).textContent = $t("gestureSettingsName");
    ($("#gesture-settings-desc") as HTMLElement).textContent = $t("gestureSettingsDesc");
    ($("#gesture-studio-name") as HTMLElement).textContent = $t("gestureStudioName");
    ($("#gesture-studio-desc") as HTMLElement).textContent = $t("gestureStudioDesc");
    ($("#gesture-release-tip") as HTMLElement).textContent = $t("gestureReleaseTip");
    ($("#close-gesture-guide") as HTMLButtonElement).ariaLabel = $t("close");
    ($("#autostart-toggle-label") as HTMLElement).textContent = $t("autostartToggleLabel");
    ($("#autostart-toggle-hint") as HTMLElement).textContent = $t("autostartToggleHint");
    ($("#pick-workspace") as HTMLElement).textContent = $t("pickFolder");
    ($("#autonomy-label") as HTMLElement).textContent = $t("autonomyLabel");
    ($("#autonomy-tick-low") as HTMLElement).textContent = $t("autonomyLow");
    ($("#autonomy-tick-mid") as HTMLElement).textContent = $t("autonomyMid");
    ($("#autonomy-tick-high") as HTMLElement).textContent = $t("autonomyHigh");
    ($("#autonomy-output") as HTMLOutputElement).textContent = autonomyText(permissionMode);
    ($("#runtime-wake-label") as HTMLElement).textContent = $t("wakeListenerLabel");
    ($("#runtime-thread-label") as HTMLElement).textContent = $t("threadLabel");
    ($("#runtime-workspace-label") as HTMLElement).textContent = $t("workspaceLabel");
    ($("#runtime-permission-label") as HTMLElement).textContent = $t("permissionLabel");
    ($("#runtime-voice-label") as HTMLElement).textContent = $t("voiceKernelLabel");
    ($("#settings-command-copy") as HTMLElement).textContent = $t("settingsCommandCopy");
    ($("#wake-phrase-input") as HTMLInputElement).placeholder = $t("wakePhrasePlaceholder");
    ($("#settings-unsaved-text") as HTMLElement).textContent = $t("unsavedTitle");
    ($("#unsaved-save") as HTMLElement).textContent = $t("unsavedSave");
    ($("#unsaved-discard") as HTMLElement).textContent = $t("unsavedDiscard");
    ($("#unsaved-keep") as HTMLElement).textContent = $t("unsavedKeep");
    syncVoiceSelectText();
  }
}

function $voiceLabel(voice: VoiceId) {
  const labels: Record<VoiceId, { zh: string; en: string }> = {
    alloy: { zh: "Alloy · 中性", en: "Alloy · Neutral" },
    arbor: { zh: "Arbor · 温和", en: "Arbor · Warm" },
    ash: { zh: "Ash · 沉稳", en: "Ash · Calm" },
    ballad: { zh: "Ballad · 歌谣", en: "Ballad" },
    breeze: { zh: "Breeze · 轻快", en: "Breeze · Light" },
    cedar: { zh: "Cedar · 木纹", en: "Cedar" },
    coral: { zh: "Coral · 珊瑚", en: "Coral" },
    cove: { zh: "Cove · 湾区", en: "Cove" },
    echo: { zh: "Echo · 回声", en: "Echo" },
    ember: { zh: "Ember · 余烬", en: "Ember" },
    juniper: { zh: "Juniper · 杜松", en: "Juniper" },
    maple: { zh: "Maple · 枫木", en: "Maple" },
    marin: { zh: "Marin · 海滨", en: "Marin" },
    sage: { zh: "Sage · 智者", en: "Sage" },
    shimmer: { zh: "Shimmer · 微光", en: "Shimmer" },
    sol: { zh: "Sol · 阳光", en: "Sol" },
    spruce: { zh: "Spruce · 云杉", en: "Spruce" },
    vale: { zh: "Vale · 河谷", en: "Vale" },
    verse: { zh: "Verse · 诗篇", en: "Verse" },
  };
  return labels[voice]?.[currentLang] ?? voice;
}

function syncVoiceSelectText() {
  const select = $("#voice-select") as HTMLSelectElement;
  const defaultOpt = select.querySelector("option[value='']") as HTMLOptionElement;
  if (defaultOpt) defaultOpt.textContent = $t("voiceDefault");
  for (const opt of select.querySelectorAll<HTMLOptionElement>("option:not([value=''])")) {
    const voice = opt.value as VoiceId;
    if (SUPPORTED_VOICES.includes(voice)) opt.textContent = $voiceLabel(voice);
  }
}
const STUDIO_DEFAULTS: StudioConfig = {
  version: 1,
  callsign: "JARVIS",
  subtitle: "CODEX VOICE SYSTEM",
  theme: "quantum",
  layout: "balanced",
  intensity: 72,
  avatarScale: 100,
  showWorkers: true,
  showDialogue: true,
  showWave: true,
  compactControls: false,
};
const STUDIO_THEMES: Record<StudioTheme, { accent: string; rgb: string; label: string }> = {
  quantum: { accent: "#20c7ff", rgb: "32,199,255", label: "QUANTUM BLUE" },
  reactor: { accent: "#ffb02e", rgb: "255,176,46", label: "ARC REACTOR" },
  synthwave: { accent: "#e657ff", rgb: "230,87,255", label: "SYNTHWAVE" },
  matrix: { accent: "#53f59a", rgb: "83,245,154", label: "MATRIX GRID" },
  arctic: { accent: "#d9f7ff", rgb: "217,247,255", label: "ARCTIC CORE" },
};

function normalizeStudioConfig(value: unknown): StudioConfig {
  const input = value && typeof value === "object" ? value as Partial<StudioConfig> : {};
  const theme = input.theme && input.theme in STUDIO_THEMES ? input.theme : STUDIO_DEFAULTS.theme;
  const layout = input.layout === "focus" || input.layout === "command"
    ? input.layout
    : STUDIO_DEFAULTS.layout;
  return {
    version: 1,
    callsign: typeof input.callsign === "string" && input.callsign.trim()
      ? input.callsign.trim().slice(0, 18)
      : STUDIO_DEFAULTS.callsign,
    subtitle: typeof input.subtitle === "string" && input.subtitle.trim()
      ? input.subtitle.trim().slice(0, 36)
      : STUDIO_DEFAULTS.subtitle,
    theme,
    layout,
    intensity: Math.min(100, Math.max(20, Number(input.intensity) || STUDIO_DEFAULTS.intensity)),
    avatarScale: Math.min(125, Math.max(75, Number(input.avatarScale) || STUDIO_DEFAULTS.avatarScale)),
    showWorkers: input.showWorkers ?? STUDIO_DEFAULTS.showWorkers,
    showDialogue: input.showDialogue ?? STUDIO_DEFAULTS.showDialogue,
    showWave: input.showWave ?? STUDIO_DEFAULTS.showWave,
    compactControls: input.compactControls ?? STUDIO_DEFAULTS.compactControls,
  };
}

function storedStudioConfig(): StudioConfig {
  try {
    return normalizeStudioConfig(JSON.parse(localStorage.getItem(STUDIO_KEY) ?? "null"));
  } catch {
    return { ...STUDIO_DEFAULTS };
  }
}
const permissionLabels: Record<PermissionMode, string> = {
  safe: "安全模式 · 需要时确认",
  auto: "自动办公 · 当前目录自主执行",
  full: "完全访问 · 高风险",
};
function storedPermissionMode(): PermissionMode {
  const value = localStorage.getItem(PERMISSION_KEY);
  return value === "safe" || value === "full" ? value : "auto";
}
let workspace = "";
let permissionMode = storedPermissionMode();
let studioConfig = storedStudioConfig();
let studioPreviewState: StudioPreviewState = "ready";
let selectedVoice = storedVoice();
let settingsDirty = false;
let settingsLanguageSnapshot = currentLang;
let autostartEnabled = false;
const savedThreadId = () => localStorage.getItem(`${THREAD_KEY_PREFIX}${workspace}`);
let peer: RTCPeerConnection | null = null;
let microphoneStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let microphoneAnalyser: AnalyserNode | null = null;
let remoteAnalyser: AnalyserNode | null = null;
let userTranscriptBuffer = "";
let assistantTranscriptBuffer = "";
let agentMessageBuffer = "";
let voiceStartInFlight = false;
let recoverableColdStartError = false;
const voiceAudio = new Audio();
voiceAudio.autoplay = true;
const previewParams = new URLSearchParams(window.location.search);
const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
const currentWindow = typeof tauriInternals?.invoke === "function" ? getCurrentWindow() : null;
const previewModeValue = previewParams.get("preview");
const previewActionValue = previewParams.get("action");
const visualPreviewMode: Mode = ["booting", "ready", "voice-starting", "listening", "working", "speaking", "degraded", "stopped"].includes(previewModeValue ?? "")
  ? previewModeValue as Mode
  : "ready";
if (!currentWindow) {
  document.documentElement.classList.add("visual-preview");
  if (previewParams.get("grid") === "1") document.documentElement.classList.add("transparency-grid");
}
if (currentWindow) {
  void currentWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await prepareForBackground();
      await currentWindow.hide();
    } catch (error) {
      reportAsyncError("转入后台失败", error);
    }
  });
}

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<main class="shell" data-mode="booting">
  <canvas id="particle-field" width="1440" height="900" aria-hidden="true"></canvas>
  <header class="topbar hud-panel">
    <div class="brand"><i></i><strong id="brand-callsign">JARVIS</strong><span></span><em id="brand-subtitle">语音操作系统</em></div>
    <div class="status"><i></i><b id="mode-label">初始化中</b></div>
    <button id="studio" class="icon-button studio-button" aria-label="工作台">◇</button>
    <button id="camera-gesture" class="icon-button camera-button" aria-label="手势控制"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
    <button id="settings" class="icon-button" aria-label="设置">⌘</button>
  </header>
  <section class="stage">
    <div class="avatar-window">
      <div class="character-aura"></div>
      <div class="character-rig">
        <div class="assembly-orbits" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="armor-shards" aria-hidden="true"></div>
        <img id="jarvis-character" class="helmet-character" src="/assets/jarvis-character-v2.png" alt="Jarvis holographic helmet">
        <div class="helmet-scan"></div>
        <div class="mouth-visor" aria-hidden="true"></div>
        <div class="assembly-flash" aria-hidden="true"></div>
      </div>
      <canvas id="wave" width="900" height="120"></canvas>
    </div>
    <div class="identity"><span id="identity-callsign">JARVIS CORE</span><b id="identity-state">系统启动中</b></div>
  </section>
  <section class="dialogue hud-panel">
    <b>你</b><p id="user-transcript">"嗨，贾维斯"</p>
    <b class="jarvis">贾维斯</b><p id="assistant-transcript">正在连接 Codex 线程…</p>
  </section>
  <footer class="controls">
    <button id="steer" class="control steer-ctl"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.5 5.5l2 2M16.5 16.5l2 2M5.5 18.5l2-2M16.5 7.5l2-2"/></svg></span><b>转向</b><small>执行中插话</small></button>
    <button id="mic" class="control mic"><span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="8.25" y="3" width="7.5" height="11.5" rx="3.75"></rect><path d="M5.5 11.25v.75a6.5 6.5 0 0 0 13 0v-.75M12 18.5V22M8.75 22h6.5"></path></svg></span><b>语音对话</b><small>V3 WebRTC 直连</small></button>
    <form id="command-form" class="command"><input id="command-input" aria-label="文字指令" placeholder="Voice 不可用时，发送文字指令…" autocomplete="off"><button>执行</button></form>
    <button id="stop" class="control stop"><span aria-hidden="true"><svg viewBox="0 0 24 24"><rect class="stop-mark" x="6.5" y="6.5" width="11" height="11" rx="1.8"></rect></svg></span><b>停止</b><small>中断所有任务</small></button>
  </footer>
  <div id="degraded-banner" class="degraded-banner" hidden><b>需要权限</b><span id="degraded-copy">首次使用请允许麦克风和语音识别。</span></div>

  <div id="gesture-hud" class="gesture-hud hidden">
    <span class="gesture-drag-handle" aria-hidden="true" title="拖动调整摄像头窗口位置">⠿</span>
    <div class="gesture-video-frame">
      <video id="gesture-video" autoplay playsinline muted></video>
      <div class="gesture-video-scan"></div>
      <span class="gesture-corner tl"></span><span class="gesture-corner tr"></span><span class="gesture-corner bl"></span><span class="gesture-corner br"></span>
    </div>
  </div>

  <div id="dashboard" class="dashboard hidden">
    <div class="dashboard-panel hud-panel">
      <div class="dashboard-header"><i></i><b>仪表盘</b><button id="close-dashboard" class="dashboard-close">×</button></div>
      <div class="dashboard-stream" id="dashboard-stream">
        <div class="dash-entry dash-ready">◈ 系统就绪</div>
      </div>
      <div class="dashboard-footer"><span id="dashboard-stats">等待事件…</span></div>
    </div>
  </div>

  <div id="cockpit" class="cockpit hidden" aria-hidden="true">
    <div class="cockpit-panel">
      <div class="cockpit-header"><i></i><b>对话驾驶舱</b><i></i></div>
      <div class="cockpit-body">
        <div class="cockpit-transcript"><b>你</b><p id="cockpit-user">—</p><b class="jarvis">贾维斯</b><p id="cockpit-assistant">—</p></div>
        <div class="cockpit-controls">
          <button class="cockpit-btn cockpit-steer" title="转向">转向</button>
          <button class="cockpit-btn cockpit-stop" title="停止">停止</button>
        </div>
      </div>
      <div class="cockpit-footer"><span>按 Esc 关闭</span></div>
    </div>
  </div>
  <dialog id="approval"><h2>高风险操作确认</h2><p id="approval-copy">Codex 请求执行需要确认的动作。</p><div><button id="deny">拒绝</button><button id="approve">允许一次</button></div></dialog>
  <dialog id="settings-dialog">
    <div class="settings-header">
      <h2 class="drag-handle">系统设置</h2>
      <button id="close-settings-top" class="settings-close-btn" aria-label="关闭">×</button>
    </div>

    <section class="settings-card">
      <div class="section-heading"><span>01</span><div><b>唤醒词</b></div></div>
      <input id="wake-phrase-input" aria-label="唤醒短语" autocomplete="off" spellcheck="false" placeholder="输入自定义唤醒短语">
    </section>

    <section class="settings-card">
      <div class="section-heading"><span>02</span><div><b>手势控制</b></div></div>
      <div class="gesture-toggle-row">
        <div class="gesture-toggle-line">
          <label class="gesture-toggle">
            <input id="gesture-toggle" type="checkbox">
            <span class="gesture-toggle-switch"><i></i></span>
            <span class="gesture-toggle-label" id="gesture-toggle-label">启用摄像头手势识别</span>
          </label>
          <button id="gesture-help" class="gesture-help-btn" type="button">查看手势</button>
        </div>
        <p class="settings-hint" id="gesture-toggle-hint">首次开启时 macOS 会弹出系统授权对话框，请点「允许」</p>
      </div>
    </section>

    <section class="settings-card">
      <div class="section-heading"><span>03</span><div><b>后台启动</b></div></div>
      <div class="gesture-toggle-row">
        <label class="gesture-toggle">
          <input id="autostart-toggle" type="checkbox">
          <span class="gesture-toggle-switch"><i></i></span>
          <span class="gesture-toggle-label" id="autostart-toggle-label">登录 macOS 时后台启动 Jarvis</span>
        </label>
        <p class="settings-hint" id="autostart-toggle-hint">可随时关闭；关闭后仍可手动启动 Jarvis</p>
      </div>
    </section>

    <section class="settings-card">
      <div class="section-heading"><span>04</span><div><b>界面语言</b></div></div>
      <select id="lang-select" aria-label="选择界面语言">
        <option value="zh">简体中文</option>
        <option value="en">English</option>
      </select>
    </section>

    <section class="settings-card">
      <div class="section-heading"><span>05</span><div><b>语音音色</b></div></div>
      <select id="voice-select" aria-label="选择语音音色"><option value="">Codex 默认音色</option></select>
    </section>

    <section class="settings-card">
      <div class="section-heading"><span>06</span><div><b>工作目录</b></div></div>
      <div class="workspace-picker">
        <span id="workspace-path" class="workspace-path">加载中…</span>
        <button id="pick-workspace" class="pick-folder">选择目录</button>
      </div>
    </section>

    <section class="settings-card">
      <div class="section-heading"><span>07</span><div><b>操作权限</b></div></div>
      <label class="autonomy-slider">
        <span><i id="autonomy-label">自治度</i> <output id="autonomy-output">中</output></span>
        <input id="autonomy-range" type="range" min="0" max="100" step="33" value="50">
        <div class="autonomy-ticks"><span id="autonomy-tick-low">低</span><span id="autonomy-tick-mid">中</span><span id="autonomy-tick-high">高</span></div>
      </label>
      <div class="permission-options">
        <label><input type="radio" name="permission-mode" value="safe"><span><b>安全模式</b><small>越界或高风险时询问确认</small></span></label>
        <label class="recommended"><input type="radio" name="permission-mode" value="auto"><span><b>自动办公</b><small>目录内自主执行，越界自动阻止</small></span><em>推荐</em></label>
        <label class="danger"><input type="radio" name="permission-mode" value="full"><span><b>完全访问</b><small>不限制目录不询问，谨慎使用</small></span><em>谨慎</em></label>
      </div>
    </section>

    <section class="settings-card runtime-status-card" aria-live="polite">
      <div class="section-heading"><span>08</span><div><b>运行状态</b></div></div>
      <dl class="runtime-status">
        <div><dt id="runtime-wake-label">唤醒监听</dt><dd id="wake-auth">检测中</dd></div>
        <div><dt id="runtime-thread-label">Codex 线程</dt><dd id="thread-id">—</dd></div>
        <div><dt id="runtime-workspace-label">工作目录</dt><dd id="workspace">—</dd></div>
        <div><dt id="runtime-permission-label">当前权限</dt><dd id="permission-mode-label">—</dd></div>
        <div><dt id="runtime-voice-label">语音内核</dt><dd id="voice-auth">检测中</dd></div>
      </dl>
    </section>

    <section class="settings-card settings-command-card">
      <div class="section-heading"><span>09</span><div><b>贾维斯控制</b></div></div>
      <p id="settings-command-copy">可直接说或输入设置指令，例如：打开摄像头、音色设为 Cove、权限改为安全模式、主题切换为矩阵。说“设置帮助”可查看全部能力。</p>
      <div class="settings-command-examples" aria-hidden="true"><span>打开摄像头</span><span>切换英文</span><span>音色 Cove</span><span>主题矩阵</span></div>
    </section>

    <p class="info-block">每个工作目录续接自己的 Codex thread，新开线程后原线程仍保留在 Codex 历史记录中。唤醒词在本机识别；Jarvis 通过 Codex app-server V3 WebRTC 进入官方 Voice 线程，复用本机 Codex 登录，不模拟点击、不建立第二套 GPT-Live 会话。</p>

    <div id="settings-unsaved" class="settings-unsaved" hidden>
      <span id="settings-unsaved-text">设置已修改，尚未保存</span>
      <div class="settings-unsaved-actions">
        <button id="unsaved-save" class="primary-action">保存并关闭</button>
        <button id="unsaved-discard">放弃更改</button>
        <button id="unsaved-keep">继续编辑</button>
      </div>
    </div>

    <div class="settings-actions">
      <button id="new-thread" class="new-thread">＋ 新建线程</button>
      <span class="spacer"></span>
      <button id="open-studio" class="studio-entry">◇ DIY 工作台</button>
      <button id="save-settings" class="primary-action">保存</button>
      <button id="close-settings">关闭</button>
    </div>
  </dialog>
  <dialog id="gesture-guide-dialog" class="gesture-guide-dialog" aria-labelledby="gesture-guide-title">
    <header class="gesture-guide-header">
      <div><span>CAMERA GESTURES</span><h2 id="gesture-guide-title">手势控制说明</h2></div>
      <button id="close-gesture-guide" class="settings-close-btn" aria-label="关闭">×</button>
    </header>
    <p id="gesture-guide-intro" class="gesture-guide-intro">将手完整放入画面并保持约 0.3 秒；双手组合保持约 0.4 秒。</p>
    <div class="gesture-guide-grid">
      <article class="gesture-guide-card"><span class="gesture-guide-icon">👎</span><div><b id="gesture-stop-name">停止 / 拒绝</b><small id="gesture-stop-desc">拇指向下；有授权弹窗时表示拒绝</small></div></article>
      <article class="gesture-guide-card"><span class="gesture-guide-icon">✋</span><div><b id="gesture-dashboard-name">切换仪表盘</b><small id="gesture-dashboard-desc">单手张开手掌</small></div></article>
      <article class="gesture-guide-card"><span class="gesture-guide-icon">✊</span><div><b id="gesture-confirm-name">确认</b><small id="gesture-confirm-desc">单手握拳；有授权弹窗时确认</small></div></article>
      <article class="gesture-guide-card"><span class="gesture-guide-icon">👍</span><div><b id="gesture-approve-name">批准</b><small id="gesture-approve-desc">拇指向上</small></div></article>
      <article class="gesture-guide-card"><span class="gesture-guide-icon">✌️</span><div><b id="gesture-cockpit-name">切换驾驶舱</b><small id="gesture-cockpit-desc">伸出食指和中指，比出 V 字</small></div></article>
      <article class="gesture-guide-card"><span class="gesture-guide-icon">🤟</span><div><b id="gesture-spin-name">360° 旋转</b><small id="gesture-spin-desc">伸出拇指、食指和小指</small></div></article>
      <article class="gesture-guide-card"><span class="gesture-guide-icon">☝️</span><div><b id="gesture-voice-name">切换语音对话</b><small id="gesture-voice-desc">食指向上；再次触发可结束语音</small></div></article>
      <article class="gesture-guide-card"><span class="gesture-guide-icon">✋✋</span><div><b id="gesture-settings-name">切换系统设置</b><small id="gesture-settings-desc">双手同时张开</small></div></article>
      <article class="gesture-guide-card"><span class="gesture-guide-icon">✊✊</span><div><b id="gesture-studio-name">切换 DIY 工作台</b><small id="gesture-studio-desc">双手同时握拳</small></div></article>
    </div>
    <p id="gesture-release-tip" class="gesture-release-tip">全局防误触：每次触发后必须让手势回到自然状态，再做下一项。</p>
  </dialog>
  <dialog id="studio-dialog" class="studio-dialog">
    <header class="studio-header">
      <div><span>视觉核心 · 自定义</span><h2>DIY 工作台</h2><p>装配你的视觉核心、身份标识与 HUD 模块。</p></div>
      <button id="close-studio" class="studio-close" aria-label="关闭">×</button>
    </header>
    <div class="studio-grid">
      <section class="studio-preview-bar">
        <div class="preview-bar-left">
          <div class="preview-mini-reactor"><i></i><i></i><b></b></div>
          <div class="preview-bar-info">
            <strong id="studio-preview-name">JARVIS</strong>
            <small id="studio-preview-theme">QUANTUM BLUE</small>
          </div>
        </div>
        <div class="preview-state-switcher">
          <button data-studio-preview-state="ready" title="待机">待机</button>
          <button data-studio-preview-state="listening" title="监听">监听</button>
          <button data-studio-preview-state="working" title="执行">执行</button>
          <button data-studio-preview-state="approval" title="确认">确认</button>
          <button data-studio-preview-state="complete" title="完成">完成</button>
          <button data-studio-preview-state="error" title="异常">异常</button>
        </div>
        <div class="preview-bar-status"><i></i><span id="studio-preview-status">READY // 实时预览</span></div>
      </section>

      <div class="studio-columns">
        <section class="studio-section identity-editor">
          <div class="section-heading"><span>01</span><div><b>系统身份</b><small>定义代号与副标题</small></div></div>
          <label>系统代号<input id="studio-callsign" maxlength="18" autocomplete="off" placeholder="JARVIS"></label>
          <label>核心副标题<input id="studio-subtitle" maxlength="36" autocomplete="off" placeholder="语音操作系统"></label>
        </section>
        <section class="studio-section layout-editor">
          <div class="section-heading"><span>02</span><div><b>HUD 布局</b><small>选择界面方案</small></div></div>
          <div class="layout-grid">
            <button data-studio-layout="balanced"><i>◫</i><span><b>完整协作</b><small>全部界面</small></span></button>
            <button data-studio-layout="focus"><i>◎</i><span><b>聚焦模式</b><small>角色优先</small></span></button>
            <button data-studio-layout="command"><i>⌘</i><span><b>指挥模式</b><small>任务优先</small></span></button>
          </div>
        </section>
      </div>

      <section class="studio-section theme-editor">
        <div class="section-heading"><span>03</span><div><b>能源光谱</b><small>切换主题配色</small></div></div>
        <div class="theme-grid">
          <button class="theme-chip" data-studio-theme="quantum"><i></i><b>量子蓝</b><small>默认</small></button>
          <button class="theme-chip" data-studio-theme="reactor"><i></i><b>反应堆</b><small>金色</small></button>
          <button class="theme-chip" data-studio-theme="synthwave"><i></i><b>合成波</b><small>紫色</small></button>
          <button class="theme-chip" data-studio-theme="matrix"><i></i><b>矩阵</b><small>绿色</small></button>
          <button class="theme-chip" data-studio-theme="arctic"><i></i><b>极地</b><small>白色</small></button>
        </div>
      </section>

      <div class="studio-columns">
        <section class="studio-section tuning-editor">
          <div class="section-heading"><span>04</span><div><b>视觉调校</b><small>强度与比例</small></div></div>
          <label class="range-control"><span>能量强度 <output id="studio-intensity-output">72%</output></span><input id="studio-intensity" type="range" min="20" max="100" step="1"></label>
          <label class="range-control"><span>核心比例 <output id="studio-scale-output">100%</output></span><input id="studio-scale" type="range" min="75" max="125" step="1"></label>
        </section>
        <section class="studio-section module-editor">
          <div class="section-heading"><span>05</span><div><b>HUD 模块</b><small>装卸界面组件</small></div></div>
          <div class="module-grid">
            <label><input id="studio-workers" type="checkbox"><span><b>协作面板</b><small>角色状态</small></span><i></i></label>
            <label><input id="studio-dialogue" type="checkbox"><span><b>对话字幕</b><small>实时转写</small></span><i></i></label>
            <label><input id="studio-wave" type="checkbox"><span><b>声波反馈</b><small>音频可视化</small></span><i></i></label>
            <label><input id="studio-compact" type="checkbox"><span><b>极简控制</b><small>紧凑模式</small></span><i></i></label>
          </div>
        </section>
      </div>
    </div>
    <footer class="studio-actions">
      <span>所有调整实时预览并保存在本机</span>
      <button id="reset-studio" class="ghost">恢复默认</button>
      <button id="export-studio" class="ghost">导出配置</button>
      <label class="import-studio">导入配置<input id="import-studio" type="file" accept="application/json,.json"></label>
      <button id="apply-studio">装配完成</button>
    </footer>
  </dialog>
</main>`;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const shell = $<HTMLElement>(".shell");
const transcript = $("#user-transcript");
const response = $("#assistant-transcript");
const banner = $("#degraded-banner") as HTMLDivElement;
const mic = $("#mic") as HTMLButtonElement;
const approval = $("#approval") as HTMLDialogElement;
const settings = $("#settings-dialog") as HTMLDialogElement;
const gestureGuide = $("#gesture-guide-dialog") as HTMLDialogElement;
const studio = $("#studio-dialog") as HTMLDialogElement;
const characterRig = $<HTMLElement>(".character-rig");
const hoverControls = $<HTMLElement>(".controls");
const settingsButton = $<HTMLButtonElement>("#settings");
let controlsHideTimer: number | undefined;
let characterActionTimer: number | undefined;

function reportAsyncError(context: string, error: unknown) {
  triggerCharacterAction("error");
  response.textContent = `${context}：${String(error)}`;
}

function runAsync(context: string, task: Promise<unknown>) {
  void task.catch((error) => reportAsyncError(context, error));
}

function applyStudioConfig(config: StudioConfig, persist = true) {
  studioConfig = normalizeStudioConfig(config);
  const theme = STUDIO_THEMES[studioConfig.theme];
  shell.dataset.theme = studioConfig.theme;
  shell.dataset.studioLayout = studioConfig.layout;
  shell.style.setProperty("--theme-accent", theme.accent);
  shell.style.setProperty("--theme-rgb", theme.rgb);
  shell.style.setProperty("--fx-intensity", String(studioConfig.intensity / 100));
  shell.style.setProperty("--avatar-scale", String(studioConfig.avatarScale / 100));
  shell.classList.toggle("hide-workers", !studioConfig.showWorkers);
  shell.classList.toggle("hide-dialogue", !studioConfig.showDialogue);
  shell.classList.toggle("hide-wave", !studioConfig.showWave);
  shell.classList.toggle("compact-controls", studioConfig.compactControls);
  $("#brand-callsign").textContent = studioConfig.callsign.toUpperCase();
  $("#brand-subtitle").textContent = studioConfig.subtitle.toUpperCase();
  $("#identity-callsign").textContent = `${studioConfig.callsign.toUpperCase()} CORE`;
  $("#studio-preview-name").textContent = studioConfig.callsign.toUpperCase();
  $("#studio-preview-theme").textContent = theme.label;
  if (persist) localStorage.setItem(STUDIO_KEY, JSON.stringify(studioConfig));
}

function syncStudioControls() {
  ($("#studio-callsign") as HTMLInputElement).value = studioConfig.callsign;
  ($("#studio-subtitle") as HTMLInputElement).value = studioConfig.subtitle;
  ($("#studio-intensity") as HTMLInputElement).value = String(studioConfig.intensity);
  ($("#studio-scale") as HTMLInputElement).value = String(studioConfig.avatarScale);
  ($("#studio-workers") as HTMLInputElement).checked = studioConfig.showWorkers;
  ($("#studio-dialogue") as HTMLInputElement).checked = studioConfig.showDialogue;
  ($("#studio-wave") as HTMLInputElement).checked = studioConfig.showWave;
  ($("#studio-compact") as HTMLInputElement).checked = studioConfig.compactControls;
  $("#studio-intensity-output").textContent = `${studioConfig.intensity}%`;
  $("#studio-scale-output").textContent = `${studioConfig.avatarScale}%`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-studio-theme]")) {
    button.classList.toggle("active", button.dataset.studioTheme === studioConfig.theme);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-studio-layout]")) {
    button.classList.toggle("active", button.dataset.studioLayout === studioConfig.layout);
  }
}

function studioConfigFromControls(): StudioConfig {
  return normalizeStudioConfig({
    ...studioConfig,
    callsign: ($("#studio-callsign") as HTMLInputElement).value,
    subtitle: ($("#studio-subtitle") as HTMLInputElement).value,
    intensity: Number(($("#studio-intensity") as HTMLInputElement).value),
    avatarScale: Number(($("#studio-scale") as HTMLInputElement).value),
    showWorkers: ($("#studio-workers") as HTMLInputElement).checked,
    showDialogue: ($("#studio-dialogue") as HTMLInputElement).checked,
    showWave: ($("#studio-wave") as HTMLInputElement).checked,
    compactControls: ($("#studio-compact") as HTMLInputElement).checked,
  });
}

function applyStudioLayout(layout: StudioLayout) {
  const presets: Record<StudioLayout, Pick<StudioConfig, "showWorkers" | "showDialogue" | "showWave" | "compactControls">> = {
    balanced: { showWorkers: true, showDialogue: true, showWave: true, compactControls: false },
    focus: { showWorkers: false, showDialogue: true, showWave: true, compactControls: true },
    command: { showWorkers: true, showDialogue: false, showWave: false, compactControls: false },
  };
  applyStudioConfig({ ...studioConfig, ...presets[layout], layout });
  syncStudioControls();
}

function setStudioPreviewState(previewState: StudioPreviewState) {
  studioPreviewState = previewState;
  const preview = $<HTMLElement>(".studio-preview-bar");
  preview.dataset.previewState = previewState;
  const labels: Record<StudioPreviewState, string> = {
    ready: "就绪 · 实时预览",
    listening: "聆听 · 语音在线",
    working: "执行 · 任务进行中",
    approval: "确认 · 等待授权",
    complete: "完成 · 任务结束",
    error: "异常 · 核心中断",
  };
  $("#studio-preview-status").textContent = labels[previewState];
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-studio-preview-state]")) {
    button.classList.toggle("active", button.dataset.studioPreviewState === previewState);
  }
}

function openStudio() {
  if (settings.open) {
    requestCloseSettings();
    if (settings.open) return;
  }
  syncStudioControls();
  setStudioPreviewState(studioPreviewState);
  studio.showModal();
}

applyStudioConfig(studioConfig, false);

function revealControls() {
  if (controlsHideTimer !== undefined) window.clearTimeout(controlsHideTimer);
  shell.classList.add("controls-visible");
}

function scheduleControlsHide() {
  if (controlsHideTimer !== undefined) window.clearTimeout(controlsHideTimer);
  controlsHideTimer = window.setTimeout(() => shell.classList.remove("controls-visible"), 1500);
}

type CharacterAction = "acknowledge" | "approval" | "complete" | "error";

function triggerCharacterAction(action: CharacterAction, duration = 1100) {
  if (characterActionTimer !== undefined) window.clearTimeout(characterActionTimer);
  for (const name of ["acknowledge", "approval", "complete", "error"] as const) {
    shell.classList.remove(`action-${name}`);
  }
  void shell.clientWidth;
  shell.classList.add(`action-${action}`);
  characterActionTimer = window.setTimeout(() => shell.classList.remove(`action-${action}`), duration);
}

for (const area of [characterRig, hoverControls, settingsButton]) {
  area.addEventListener("pointerenter", revealControls);
  area.addEventListener("pointerleave", scheduleControlsHide);
}
shell.addEventListener("focusin", (event) => {
  if (event.target instanceof Element && (hoverControls.contains(event.target) || settingsButton.contains(event.target))) revealControls();
});
shell.addEventListener("focusout", scheduleControlsHide);

type ApprovalRequest = { id: number | string; method: string };
const approvalQueue: ApprovalRequest[] = [];
let activeApproval: ApprovalRequest | null = null;

function showNextApproval() {
  if (activeApproval || approval.open) return;
  activeApproval = approvalQueue.shift() ?? null;
  if (!activeApproval) return;
  $("#approval-copy").textContent = `Codex 请求：${activeApproval.method}`;
  approval.showModal();
}

function enqueueApproval(request: ApprovalRequest) {
  approvalQueue.push(request);
  triggerCharacterAction("approval", 1800);
  showNextApproval();
}

async function resolveActiveApproval(approved: boolean) {
  const request = activeApproval;
  if (!request) return;
  const buttons = [$("#approve") as HTMLButtonElement, $("#deny") as HTMLButtonElement];
  for (const button of buttons) button.disabled = true;
  try {
    await invoke("resolve_server_request", { requestId: request.id, approved });
    activeApproval = null;
    approval.close();
    queueMicrotask(showNextApproval);
  } catch (error) {
    response.textContent = `处理 Codex 授权请求失败：${String(error)}`;
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

approval.addEventListener("cancel", (event) => event.preventDefault());
const copy: Record<Mode, [string, string]> = {
  booting: ["初始化中", "系统启动中"], ready: ["待命", "Codex Voice 就绪"],
  "voice-starting": ["连接中", "正在打开 Codex Voice"], listening: ["聆听中", "官方 Voice 已上线"],
  working: ["执行中", "任务处理中"], speaking: ["说话中", "语音输出中"],
  degraded: ["需要权限", "唤醒系统离线"], stopped: ["已中断", "所有系统已停止"],
};

function setMode(mode: Mode) {
  state.mode = mode; shell.setAttribute("data-mode", mode);
  $("#mode-label").textContent = copy[mode][0]; $("#identity-state").textContent = copy[mode][1];
  if (mode === "voice-starting") {
    shell.classList.remove("is-forming");
    void shell.clientWidth;
    shell.classList.add("is-forming");
    startParticleFormation();
  }
  if (mode === "speaking") {
    characterRig.classList.remove("spin-active");
    void characterRig.clientWidth;
  }
}
const cockpit = $<HTMLElement>("#cockpit");
let cockpitOpen = false;

function toggleCockpit(force?: boolean) {
  cockpitOpen = force ?? !cockpitOpen;
  cockpit.classList.toggle("hidden", !cockpitOpen);
  cockpit.setAttribute("aria-hidden", String(!cockpitOpen));
  if (cockpitOpen) {
    ($("#cockpit-user") as HTMLElement).textContent = userTranscriptBuffer || "—";
    ($("#cockpit-assistant") as HTMLElement).textContent = assistantTranscriptBuffer || response.textContent || "—";
  }
}

function spinCharacter() {
  characterRig.classList.remove("spin-active");
  void characterRig.clientWidth;
  characterRig.classList.add("spin-active");
  setTimeout(() => characterRig.classList.remove("spin-active"), 1500);
}

function setWorker(role: string, label: string, active = true) {
  const card = document.querySelector<HTMLElement>(`.worker[data-role="${role}"]`);
  if (!card) return;
  const small = card.querySelector("small");
  if (small) small.textContent = label;
  card.classList.toggle("active", active);
}

function setupGestures() {
  if (!currentWindow) return;
  const rig = characterRig;
  const STUDIO_THEMES_KEYS: StudioTheme[] = ["quantum", "reactor", "synthwave", "matrix", "arctic"];

  // 滚轮：垂直调强度，水平切主题
  let themeDebounce = 0;
  rig.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const now = Date.now();
      if (now - themeDebounce < 300) return;
      themeDebounce = now;
      const idx = STUDIO_THEMES_KEYS.indexOf(studioConfig.theme);
      const next = STUDIO_THEMES_KEYS[(idx + (e.deltaX > 0 ? 1 : -1) + STUDIO_THEMES_KEYS.length) % STUDIO_THEMES_KEYS.length];
      studioConfig.theme = next;
      applyStudioConfig(studioConfig);
    } else {
      studioConfig.intensity = Math.min(100, Math.max(20, studioConfig.intensity + Math.round(-e.deltaY * 0.3)));
      applyStudioConfig(studioConfig);
    }
  }, { passive: false });

  // 拖动窗口（区分点击和拖拽）
  let dragging = false;
  let dragStartX = 0, dragStartY = 0;
  rig.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    rig.setPointerCapture(e.pointerId);
  });
  rig.addEventListener("pointermove", (e) => {
    if (e.buttons === 0) return;
    if (!dragging && Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY) > 6) {
      dragging = true;
      runAsync("拖动窗口失败", currentWindow.startDragging());
    }
  });
  rig.addEventListener("pointerup", () => { dragging = false; });

  // 长按快速语音
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  rig.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    longPressTimer = setTimeout(() => void startDirectVoice(), 550);
  });
  rig.addEventListener("pointerup", () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  });
  rig.addEventListener("pointercancel", () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  });

  // 捏合缩放（macOS WebKit gesture 事件）
  let pinchStartScale = studioConfig.avatarScale;
  document.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    pinchStartScale = studioConfig.avatarScale;
  });
  document.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    const ge = e as unknown as { scale: number };
    studioConfig.avatarScale = Math.min(125, Math.max(75, Math.round(pinchStartScale * ge.scale)));
    applyStudioConfig(studioConfig);
  });
  document.addEventListener("gestureend", (e) => { e.preventDefault(); });
}

setupGestures();

function roleOf(params: any) {
  const text = JSON.stringify(params ?? {}).toLowerCase();
  return text.includes("research") ? "researcher" : text.includes("review") ? "reviewer" :
    text.includes("developer") || text.includes("commandexecution") || text.includes("filechange") ? "developer" : "orchestrator";
}
let waveAnimationFrame: number | null = null;
let particleAnimationFrame: number | null = null;
let audioMeterAnimationFrame: number | null = null;

function drawWave() {
  waveAnimationFrame = null;
  if (document.hidden) return;
  const canvas = $("#wave") as HTMLCanvasElement, context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const time = performance.now() / 370, amplitude = 5 + state.level * 42 + (state.mode === "speaking" ? 22 : 0);
  context.beginPath();
  for (let x = 0; x <= canvas.width; x += 3) {
    const y = canvas.height / 2 + (Math.sin(x * .085 + time * 2.2) + Math.sin(x * .031 - time) * .55) * amplitude * Math.sin(x / canvas.width * Math.PI) * .48;
    x ? context.lineTo(x, y) : context.moveTo(x, y);
  }
  context.strokeStyle = state.mode === "working" ? "#ff9d2e" : state.mode === "stopped" ? "#ff3d33" : "#22c7ff";
  context.shadowColor = context.strokeStyle; context.shadowBlur = 15; context.lineWidth = 2; context.stroke();
  state.level *= .9;
  waveAnimationFrame = requestAnimationFrame(drawWave);
}

type VisualParticle = {
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  size: number;
  phase: number;
  delay: number;
  curve: number;
  amber: boolean;
};

const particleCanvas = $("#particle-field") as HTMLCanvasElement;
const particleContext = particleCanvas.getContext("2d")!;
const characterImage = $("#jarvis-character") as HTMLImageElement;
const armorShardLayer = $<HTMLElement>(".armor-shards");
const armorShardSpecs = [
  ["polygon(35% 4%,65% 4%,63% 23%,37% 23%)", 0, -390, -8, 80],
  ["polygon(17% 9%,37% 4%,38% 31%,22% 35%)", -430, -280, -24, 0],
  ["polygon(63% 4%,83% 9%,78% 35%,62% 31%)", 430, -280, 24, 20],
  ["polygon(37% 22%,63% 22%,61% 45%,39% 45%)", 30, -320, 10, 170],
  ["polygon(20% 31%,39% 27%,43% 48%,19% 49%)", -470, -120, -32, 100],
  ["polygon(61% 27%,80% 31%,81% 49%,57% 48%)", 470, -120, 32, 120],
  ["polygon(16% 45%,43% 44%,46% 57%,20% 59%)", -520, -20, -18, 220],
  ["polygon(57% 44%,84% 45%,80% 59%,54% 57%)", 520, -20, 18, 240],
  ["polygon(42% 43%,58% 43%,59% 70%,41% 70%)", 0, 390, -10, 300],
  ["polygon(19% 56%,42% 54%,41% 73%,24% 78%)", -480, 180, -28, 280],
  ["polygon(58% 54%,81% 56%,76% 78%,59% 73%)", 480, 180, 28, 300],
  ["polygon(24% 73%,42% 68%,45% 84%,31% 88%)", -340, 330, 22, 390],
  ["polygon(58% 68%,76% 73%,69% 88%,55% 84%)", 340, 330, -22, 410],
  ["polygon(41% 68%,59% 68%,56% 88%,44% 88%)", 40, 430, 14, 470],
  ["polygon(31% 85%,45% 82%,44% 96%,36% 94%)", -250, 460, -30, 500],
  ["polygon(55% 82%,69% 85%,64% 94%,56% 96%)", 250, 460, 30, 520],
  ["polygon(43% 86%,57% 86%,56% 98%,44% 98%)", 0, 520, -12, 560],
  ["polygon(12% 25%,24% 19%,22% 45%,14% 52%)", -560, -210, -38, 180],
  ["polygon(76% 19%,88% 25%,86% 52%,78% 45%)", 560, -210, 38, 200],
] as const;

for (const [clip, translateX, translateY, rotation, delay] of armorShardSpecs) {
  const shard = document.createElement("i");
  shard.className = "armor-shard";
  shard.style.setProperty("--shard-clip", clip);
  shard.style.setProperty("--shard-x", `${translateX}px`);
  shard.style.setProperty("--shard-y", `${translateY}px`);
  shard.style.setProperty("--shard-rotation", `${rotation}deg`);
  shard.style.setProperty("--shard-delay", `${delay}ms`);
  if (Math.abs(rotation) >= 28 || delay % 3 === 0) shard.classList.add("amber-edge");
  armorShardLayer.append(shard);
}

let visualParticles: VisualParticle[] = [];
let formationStartedAt = -10_000;
let particleTargetBounds = { left: 0, top: 0, width: 1, height: 1 };
const FORMATION_DURATION = 3200;

function scatterParticleFromWindowEdge(particle: VisualParticle) {
  const edge = Math.floor(Math.random() * 4);
  const inset = Math.random() * 24;
  if (edge === 0) {
    particle.fromX = inset;
    particle.fromY = Math.random() * particleCanvas.height;
  } else if (edge === 1) {
    particle.fromX = particleCanvas.width - inset;
    particle.fromY = Math.random() * particleCanvas.height;
  } else {
    particle.fromX = Math.random() * particleCanvas.width;
    particle.fromY = edge === 2 ? inset : particleCanvas.height - inset;
  }
}

function syncParticleCanvasSize() {
  const bounds = shell.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  if (particleCanvas.width !== width) particleCanvas.width = width;
  if (particleCanvas.height !== height) particleCanvas.height = height;
}

function prepareVisualParticles() {
  if (!characterImage.naturalWidth) return;
  syncParticleCanvasSize();
  const sample = document.createElement("canvas");
  sample.width = particleCanvas.width;
  sample.height = particleCanvas.height;
  const context = sample.getContext("2d", { willReadFrequently: true })!;
  const shellBounds = shell.getBoundingClientRect();
  const characterBounds = characterImage.getBoundingClientRect();
  const left = characterBounds.left - shellBounds.left;
  const top = characterBounds.top - shellBounds.top;
  particleTargetBounds = { left, top, width: characterBounds.width, height: characterBounds.height };
  context.drawImage(characterImage, left, top, characterBounds.width, characterBounds.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  visualParticles = [];
  for (let y = 0; y < sample.height; y += 7) {
    for (let x = 0; x < sample.width; x += 7) {
      const alpha = pixels[(y * sample.width + x) * 4 + 3];
      if (alpha < 46 || Math.random() > .82) continue;
      const particle: VisualParticle = {
        fromX: 0,
        fromY: 0,
        targetX: x + (Math.random() - .5) * 5,
        targetY: y + (Math.random() - .5) * 5,
        size: Math.random() > .965 ? 2.6 + Math.random() * 1.8 : .45 + Math.random() * 1.65,
        phase: Math.random() * Math.PI * 2,
        delay: Math.random() * .3,
        curve: (Math.random() - .5) * (90 + Math.random() * 190),
        amber: Math.random() < .16,
      };
      scatterParticleFromWindowEdge(particle);
      visualParticles.push(particle);
    }
  }
}

function startParticleFormation() {
  if (!visualParticles.length) prepareVisualParticles();
  formationStartedAt = performance.now();
  for (const particle of visualParticles) scatterParticleFromWindowEdge(particle);
}

function easeFormation(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function particlePosition(particle: VisualParticle, progress: number) {
  const eased = easeFormation(progress);
  const deltaX = particle.targetX - particle.fromX;
  const deltaY = particle.targetY - particle.fromY;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const bend = Math.sin(eased * Math.PI) * particle.curve;
  return {
    x: particle.fromX + deltaX * eased - deltaY / distance * bend,
    y: particle.fromY + deltaY * eased + deltaX / distance * bend,
  };
}

function drawFormationEnergy(now: number, rawProgress: number) {
  if (rawProgress < 0 || rawProgress > 1.12) return;
  const progress = Math.max(0, Math.min(1, rawProgress));
  const centerX = particleTargetBounds.left + particleTargetBounds.width / 2;
  const centerY = particleTargetBounds.top + particleTargetBounds.height / 2;
  const intensity = Math.sin(progress * Math.PI);
  const outerRadius = Math.max(particleCanvas.width, particleCanvas.height) * .56;
  const targetRadius = Math.max(particleTargetBounds.width, particleTargetBounds.height) * .48;
  const radius = outerRadius + (targetRadius - outerRadius) * easeFormation(progress);

  particleContext.save();
  particleContext.globalCompositeOperation = "lighter";
  particleContext.translate(centerX, centerY);
  particleContext.scale(1, .72);
  for (let index = 0; index < 4; index += 1) {
    const ringRadius = radius + index * 34;
    particleContext.beginPath();
    particleContext.setLineDash([16 + index * 5, 34 + index * 7]);
    particleContext.lineDashOffset = (index % 2 ? 1 : -1) * now / (12 + index * 3);
    particleContext.arc(0, 0, ringRadius, 0, Math.PI * 2);
    particleContext.lineWidth = index === 0 ? 1.8 : .75;
    particleContext.strokeStyle = index === 2
      ? `rgba(255,155,47,${intensity * .48})`
      : `rgba(34,199,255,${intensity * (.56 - index * .08)})`;
    particleContext.stroke();
  }
  particleContext.restore();

  const shock = Math.max(0, Math.min(1, (progress - .68) / .25));
  if (shock > 0 && shock < 1) {
    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    particleContext.beginPath();
    particleContext.ellipse(
      centerX,
      centerY,
      targetRadius * (.65 + shock * 1.35),
      targetRadius * (.48 + shock * .95),
      0,
      0,
      Math.PI * 2,
    );
    particleContext.strokeStyle = `rgba(134,229,255,${(1 - shock) * .85})`;
    particleContext.shadowColor = "#22c7ff";
    particleContext.shadowBlur = 28;
    particleContext.lineWidth = 2.4;
    particleContext.stroke();
    particleContext.restore();
  }
}

function drawParticleField(now: number) {
  particleAnimationFrame = null;
  if (document.hidden) return;
  particleContext.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
  if (visualParticles.length) {
    const rawProgress = (now - formationStartedAt) / FORMATION_DURATION;
    const forming = rawProgress >= 0 && rawProgress < 1.08;
    const idleStrength = state.mode === "speaking" ? .18 + state.level * .48 : state.mode === "working" ? .12 : .045;
    particleContext.globalCompositeOperation = "lighter";
    for (const particle of visualParticles) {
      const localRaw = forming ? (rawProgress - particle.delay) / (1 - particle.delay) : 1;
      const progress = Math.max(0, Math.min(1, localRaw));
      const point = particlePosition(particle, progress);
      const previous = particlePosition(particle, Math.max(0, progress - (.035 + particle.size * .008)));
      const drift = forming ? 0 : Math.sin(now / 760 + particle.phase) * (1.1 + state.level * 3.2);
      const x = point.x + drift;
      const y = point.y + Math.cos(now / 830 + particle.phase) * (forming ? 0 : 1.4);
      const alpha = forming
        ? localRaw < 0
          ? .12 + Math.sin(now / 180 + particle.phase) * .08
          : .34 + Math.sin(progress * Math.PI) * .66
        : idleStrength;
      const color = state.mode === "working"
        ? "255,155,47"
        : state.mode === "stopped"
          ? "255,73,62"
          : particle.amber
            ? "255,155,47"
            : "34,199,255";
      if (forming) {
        particleContext.beginPath();
        particleContext.moveTo(previous.x, previous.y);
        particleContext.lineTo(x, y);
        particleContext.strokeStyle = `rgba(${color},${alpha * (particle.size > 2.5 ? .62 : .28)})`;
        particleContext.lineWidth = particle.size > 2.5 ? 1.5 : .65;
        particleContext.stroke();
      }
      particleContext.beginPath();
      particleContext.arc(x, y, particle.size * (forming ? 1.3 : 1), 0, Math.PI * 2);
      particleContext.fillStyle = `rgba(${color},${alpha})`;
      particleContext.fill();
    }
    if (forming) drawFormationEnergy(now, rawProgress);
    particleContext.globalCompositeOperation = "source-over";
  }
  particleAnimationFrame = requestAnimationFrame(drawParticleField);
}

if (characterImage.complete && characterImage.naturalWidth) prepareVisualParticles();
else characterImage.addEventListener("load", prepareVisualParticles, { once: true });
new ResizeObserver(() => prepareVisualParticles()).observe(shell);

function analyserLevel(analyser: AnalyserNode | null) {
  if (!analyser) return 0;
  const samples = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(samples);
  let energy = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    energy += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(energy / samples.length) * 5);
}

function updateAudioMeters() {
  audioMeterAnimationFrame = null;
  if (document.hidden) return;
  if (!currentWindow) {
    const time = performance.now();
    state.level = state.mode === "speaking"
      ? .52 + Math.sin(time / 125) * .16
      : state.mode === "working"
        ? .2 + Math.sin(time / 310) * .08
        : state.mode === "listening"
          ? .08 + Math.sin(time / 430) * .035
          : 0;
    shell.style.setProperty("--voice-pulse", String(1 + state.level * .026));
    shell.style.setProperty("--voice-glow", String(.45 + state.level * .55));
    audioMeterAnimationFrame = requestAnimationFrame(updateAudioMeters);
    return;
  }
  const micLevel = analyserLevel(microphoneAnalyser);
  const speakerLevel = analyserLevel(remoteAnalyser);
  state.level = Math.max(state.level, micLevel, speakerLevel);
  shell.style.setProperty("--voice-pulse", String(1 + state.level * .026));
  shell.style.setProperty("--voice-glow", String(.45 + state.level * .55));
  if (state.directVoice?.voiceActive && !state.agentWorking) {
    if (speakerLevel > 0.08 && state.mode !== "speaking") setMode("speaking");
    if (speakerLevel < 0.025 && state.mode === "speaking") setMode("listening");
  }
  audioMeterAnimationFrame = requestAnimationFrame(updateAudioMeters);
}

function startVisualAnimations() {
  if (document.hidden) return;
  waveAnimationFrame ??= requestAnimationFrame(drawWave);
  particleAnimationFrame ??= requestAnimationFrame(drawParticleField);
  audioMeterAnimationFrame ??= requestAnimationFrame(updateAudioMeters);
}

function stopVisualAnimations() {
  if (waveAnimationFrame !== null) cancelAnimationFrame(waveAnimationFrame);
  if (particleAnimationFrame !== null) cancelAnimationFrame(particleAnimationFrame);
  if (audioMeterAnimationFrame !== null) cancelAnimationFrame(audioMeterAnimationFrame);
  waveAnimationFrame = null;
  particleAnimationFrame = null;
  audioMeterAnimationFrame = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopVisualAnimations();
  else startVisualAnimations();
});
startVisualAnimations();

function updateVoiceInfo(info: DirectVoice) {
  state.directVoice = info;
  mic.classList.toggle("active", info.voiceActive);
  const va = $<HTMLElement>("#voice-auth");
  if (va) va.textContent = info.codexConnected
    ? `${info.protocol} · ${info.voiceActive ? "connected" : info.phase}`
    : `${info.protocol} · standby`;
  if (info.threadId) {
    state.session = { threadId: info.threadId, cwd: workspace };
    $("#thread-id").textContent = info.threadId;
    localStorage.setItem(`${THREAD_KEY_PREFIX}${workspace}`, info.threadId);
  }
}

async function handle(message: Message) {
  if (message.id !== undefined && message.method) {
    enqueueApproval({ id: message.id, method: message.method });
    return;
  }
  const method = message.method, params = message.params;
  if (method === "thread/realtime/sdp") {
    if (!peer || !params?.sdp) return;
    try {
      await peer.setRemoteDescription({ type: "answer", sdp: params.sdp });
    } catch (error) {
      triggerCharacterAction("error");
      setMode("degraded");
      response.textContent = `Codex Voice SDP 连接失败：${String(error)}`;
    }
  } else if (method === "thread/realtime/started") {
    updateVoiceInfo({
      codexConnected: true,
      voiceActive: true,
      phase: "connected",
      protocol: "Codex app-server V3 · WebRTC",
      threadId: params?.threadId,
      realtimeSessionId: params?.realtimeSessionId,
    });
    banner.hidden = true;
    setMode("listening");
    triggerCharacterAction("acknowledge");
    setWorker("orchestrator", "Voice 已上线");
    response.textContent = "Codex 官方 Voice 已上线。你现在可以直接和 Jarvis 对话。";
    addDashboardEntry("Voice 会话已建立", "ready");
  } else if (method === "thread/realtime/transcript/delta") {
    const delta = typeof params?.delta === "string" ? params.delta : "";
    if (params?.role === "assistant") {
      assistantTranscriptBuffer += delta;
      response.textContent = assistantTranscriptBuffer;
      if (!state.agentWorking) setMode("speaking");
    } else {
      userTranscriptBuffer += delta;
      transcript.textContent = userTranscriptBuffer;
      if (!state.agentWorking) setMode("listening");
    }
  } else if (method === "thread/realtime/transcript/done") {
    const text = typeof params?.text === "string" ? params.text.trim() : "";
    if (params?.role === "assistant") {
      if (text) response.textContent = text;
      assistantTranscriptBuffer = "";
      if (!state.agentWorking) setMode("listening");
    } else {
      if (text) transcript.textContent = text;
      userTranscriptBuffer = "";
      if (text) triggerCharacterAction("acknowledge");
      if (text) await handleSettingsCommandText(text, "voice");
    }
  } else if (method === "thread/realtime/itemAdded") {
    const itemType = String(params?.item?.type ?? "");
    if (itemType.includes("handoff") || itemType.includes("delegation")) {
      setMode("working");
      setWorker("orchestrator", "委派给 Codex");
    }
  } else if (method === "thread/realtime/error") {
    triggerCharacterAction("error");
    setMode("degraded");
    banner.hidden = false;
    const detail = params?.message ?? "Codex Voice realtime error";
    $("#degraded-copy").textContent = detail;
    response.textContent = detail;
    addDashboardEntry(`Voice 异常：${detail}`, "error");
  } else if (method === "thread/realtime/closed") {
    cleanupPeer();
    updateVoiceInfo({
      codexConnected: true,
      voiceActive: false,
      phase: "closed",
      protocol: "Codex app-server V3 · WebRTC",
      threadId: params?.threadId ?? state.session?.threadId,
    });
    if (!state.manualStop) {
      setMode("ready");
      response.textContent = "Codex Voice 已结束。再次说“嗨 Jarvis”即可唤醒。";
      await armWakeListener();
    }
  } else if (method === "turn/started") {
    if (state.manualStop) return;
    agentMessageBuffer = "";
    state.agentWorking = true;
    setMode("working"); setWorker("orchestrator", "执行中");
    addDashboardEntry("任务开始执行", "working");
  } else if (method === "item/agentMessage/delta") {
    const delta = typeof params?.delta === "string" ? params.delta : "";
    agentMessageBuffer += delta;
    if (agentMessageBuffer) response.textContent = agentMessageBuffer;
  } else if (method === "turn/completed") {
    state.agentWorking = false;
    if (!state.manualStop) triggerCharacterAction("complete", 1400);
    setMode(state.manualStop ? "stopped" : state.directVoice?.voiceActive ? "listening" : "ready");
    setWorker("orchestrator", state.manualStop ? "已中断" : "待命", !state.manualStop);
    for (const role of ["developer", "researcher", "reviewer"]) {
      setWorker(role, state.manualStop ? "已中断" : "待命", false);
    }
  } else if (method === "item/started") {
    if (!state.manualStop) { setWorker(roleOf(params), "工作中"); addDashboardEntry(`工具调用：${roleOf(params)}`, "tool"); }
  }
  else if (method === "item/completed") {
    setWorker(roleOf(params), "完成", false); addDashboardEntry(`工具完成：${roleOf(params)}`, "done");
    if (params?.item?.type === "agentMessage") {
      const text = typeof params.item.text === "string" ? params.item.text : agentMessageBuffer;
      if (text) response.textContent = text;
    }
  }
}

async function waitForIceGathering(connection: RTCPeerConnection) {
  if (connection.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      connection.removeEventListener("icegatheringstatechange", changed);
      reject(new Error("WebRTC ICE gathering timed out"));
    }, 12_000);
    const changed = () => {
      if (connection.iceGatheringState !== "complete") return;
      window.clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", changed);
      resolve();
    };
    connection.addEventListener("icegatheringstatechange", changed);
  });
}

function attachAnalyser(stream: MediaStream, target: "microphone" | "remote") {
  audioContext ??= new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  if (target === "microphone") microphoneAnalyser = analyser;
  else remoteAnalyser = analyser;
}

function cleanupPeer() {
  peer?.close();
  peer = null;
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  remoteStream?.getTracks().forEach((track) => track.stop());
  remoteStream = null;
  voiceAudio.pause();
  voiceAudio.srcObject = null;
  microphoneAnalyser = null;
  remoteAnalyser = null;
  const context = audioContext;
  audioContext = null;
  if (context && context.state !== "closed") void context.close().catch(() => {});
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function isNotAllowedError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "NotAllowedError"
    : String(error).includes("NotAllowedError");
}

async function acquireMicrophone(coldStart: boolean) {
  const attempts = coldStart ? 6 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      if (!coldStart || !isNotAllowedError(error) || attempt === attempts) throw error;
      response.textContent = `正在等待系统释放麦克风… ${attempt}/${attempts - 1}`;
      await sleep(700);
    }
  }
  throw new Error("麦克风初始化失败");
}

async function startDirectVoice({ coldStart = false } = {}) {
  if (!currentWindow) {
    setMode("voice-starting");
    window.setTimeout(() => setMode("listening"), FORMATION_DURATION);
    return;
  }
  if (voiceStartInFlight || peer || state.directVoice?.voiceActive) return;
  voiceStartInFlight = true;
  state.manualStop = false;
  recoverableColdStartError = false;
  setMode("voice-starting");
  banner.hidden = true;
  response.textContent = "正在建立 Codex 官方 Voice V3 WebRTC 会话…";
  try {
    const microphoneAuthorization = await invoke<string>("request_microphone_permission");
    if (microphoneAuthorization !== "authorized") {
      throw new Error("请在系统设置 → 隐私与安全性 → 麦克风中允许 Jarvis Codex。");
    }
    await invoke("disarm_wake_listener");
    if (coldStart) {
      // A newly created WKWebView can reject an otherwise-authorized
      // getUserMedia call until its first visible/focused render cycle.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await sleep(900);
    }
    microphoneStream = await acquireMicrophone(coldStart);
    attachAnalyser(microphoneStream, "microphone");

    const connection = new RTCPeerConnection();
    peer = connection;
    const track = microphoneStream.getAudioTracks()[0];
    if (!track) throw new Error("未找到麦克风音轨");
    connection.addTrack(track, microphoneStream);
    connection.createDataChannel("oai-events");
    connection.ontrack = (event) => {
      remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      voiceAudio.srcObject = remoteStream;
      attachAnalyser(remoteStream, "remote");
      void audioContext?.resume();
      void voiceAudio.play();
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") {
        setMode("degraded");
        response.textContent = "Codex Voice WebRTC 连接失败。";
      }
    };
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await waitForIceGathering(connection);
    const sdp = connection.localDescription?.sdp;
    if (!sdp) throw new Error("WebRTC 未生成 SDP offer");

    const info = await invoke<DirectVoice>("start_codex_voice", {
      cwd: workspace,
      threadId: savedThreadId(),
      permissionMode,
      sdp,
      voice: selectedVoice,
    });
    updateVoiceInfo(info);
  } catch (error) {
    cleanupPeer();
    recoverableColdStartError = coldStart && isNotAllowedError(error);
    setMode("degraded");
    banner.hidden = false;
    $("#degraded-copy").textContent = String(error);
    response.textContent = String(error);
    await armWakeListener();
  } finally {
    voiceStartInFlight = false;
  }
}

async function stopDirectVoice() {
  try {
    const info = await invoke<DirectVoice>("stop_codex_voice");
    updateVoiceInfo(info);
  } finally {
    cleanupPeer();
  }
}

if (currentWindow) {
  await listen<Message>("codex-event", ({ payload }) => runAsync("处理 Codex 事件失败", handle(payload)));
  await listen<WakeStatus>("jarvis-wake-status", ({ payload }) => {
    state.wake = payload;
    const wa = $<HTMLElement>("#wake-auth");
    if (wa) wa.textContent = payload.ready
      ? "Local listener ready"
      : payload.authorization === "authorized"
        ? "Waiting to re-arm"
        : payload.authorization;
    if (payload.ready) {
      if (recoverableColdStartError && state.mode === "degraded") {
        recoverableColdStartError = false;
        banner.hidden = true;
        setMode("ready");
      }
      if (state.mode === "ready") {
        response.textContent = "我在。直接说“嗨 Jarvis”。";
        setWorker("orchestrator", "Wake word armed");
      }
    }
  });
  await listen<WakeEvent>("jarvis-wake", ({ payload }) => {
    transcript.textContent = "“嗨，Jarvis”";
    state.manualStop = false;
    if (!payload.ok) {
      setMode("degraded");
      banner.hidden = false;
      $("#degraded-copy").textContent = payload.error ?? "无法打开官方 Codex Voice。";
      response.textContent = payload.error ?? "无法打开官方 Codex Voice。";
      return;
    }
    banner.hidden = true;
    void startDirectVoice({ coldStart: payload.cold === true });
  });
}

type SettingsCommandSource = "text" | "voice";
let lastVoiceSettingsCommand = "";
let lastVoiceSettingsCommandAt = 0;

function settingCopy(zh: string, en: string) {
  return currentLang === "en" ? en : zh;
}

function configuredWorkspace() {
  return localStorage.getItem(WORKSPACE_KEY) ?? workspace;
}

function canArmWakeListenerNow() {
  return Boolean(currentWindow && !voiceStartInFlight && !state.directVoice?.voiceActive && !peer);
}

function announceSettingChange(message: string, source: SettingsCommandSource) {
  response.textContent = message;
  triggerCharacterAction("complete");
  addDashboardEntry(`${source === "voice" ? "语音设置" : "设置指令"}：${message}`, "done");
}

function syncAllSettingsControls() {
  syncPermissionControls();
  syncVoiceSelect();
  syncWakePhrase();
  ($("#lang-select") as HTMLSelectElement).value = currentLang;
  ($("#autostart-toggle") as HTMLInputElement).checked = autostartEnabled;
  ($("#gesture-toggle") as HTMLInputElement).checked = gestureController.active;
  ($("#workspace-path") as HTMLElement).textContent = configuredWorkspace() || "—";
  syncStudioControls();
}

function settingsStatusCopy() {
  const gestureEnabled = gestureController.active;
  const workspaceValue = configuredWorkspace() || "—";
  if (currentLang === "en") {
    return `Settings: gestures ${gestureEnabled ? "on" : "off"}; launch at login ${autostartEnabled ? "on" : "off"}; language ${currentLang}; voice ${selectedVoice}; permission ${permissionMode}; workspace ${workspaceValue}; theme ${studioConfig.theme}; layout ${studioConfig.layout}.`;
  }
  return `当前设置：手势${gestureEnabled ? "已开启" : "已关闭"}；后台启动${autostartEnabled ? "已开启" : "已关闭"}；语言${currentLang === "zh" ? "中文" : "英文"}；音色 ${selectedVoice}；权限${permissionLabels[permissionMode]}；目录 ${workspaceValue}；主题 ${studioConfig.theme}；布局 ${studioConfig.layout}。`;
}

function settingsHelpCopy() {
  return settingCopy(
    "我可以控制：摄像头手势、后台启动、中文/英文、19 种音色、唤醒词、工作目录、权限模式、系统代号、副标题、主题、布局、能量强度、角色比例和 HUD 模块。示例：‘打开摄像头’、‘音色设为 Cove’、‘权限改为安全模式’、‘主题切换为矩阵’。",
    "I can control camera gestures, launch at login, language, 19 voices, wake phrase, workspace, permission mode, callsign, subtitle, theme, layout, intensity, avatar scale, and HUD modules. Try: ‘enable camera’, ‘set voice to Cove’, ‘use safe permission mode’, or ‘set theme to Matrix’.",
  );
}

async function executeSettingsCommand(command: SettingsCommand, source: SettingsCommandSource) {
  switch (command.kind) {
    case "open-settings":
      if (studio.open) studio.close();
      if (!settings.open) ($("#settings") as HTMLButtonElement).click();
      announceSettingChange(settingCopy("设置已打开。", "Settings opened."), source);
      break;
    case "close-settings":
      if (settings.open) requestCloseSettings();
      announceSettingChange(settingCopy("已处理关闭设置请求。", "Settings close request handled."), source);
      break;
    case "open-studio":
      if (!studio.open) openStudio();
      announceSettingChange(settingCopy("DIY 工作台已打开。", "DIY Studio opened."), source);
      break;
    case "close-studio":
      if (studio.open) studio.close();
      announceSettingChange(settingCopy("DIY 工作台已关闭。", "DIY Studio closed."), source);
      break;
    case "show-status":
      announceSettingChange(settingsStatusCopy(), source);
      break;
    case "show-help":
      announceSettingChange(settingsHelpCopy(), source);
      break;
    case "set-gesture": {
      const changed = await setGestureControlEnabled(command.enabled);
      if (changed) announceSettingChange(settingCopy(
        `摄像头手势已${command.enabled ? "开启" : "关闭"}。`,
        `Camera gestures ${command.enabled ? "enabled" : "disabled"}.`,
      ), source);
      break;
    }
    case "set-autostart":
      if (command.enabled !== autostartEnabled) {
        if (currentWindow) await invoke("set_autostart", { enabled: command.enabled });
        autostartEnabled = command.enabled;
      }
      ($("#autostart-toggle") as HTMLInputElement).checked = autostartEnabled;
      announceSettingChange(settingCopy(
        `后台启动已${command.enabled ? "开启" : "关闭"}。`,
        `Launch at login ${command.enabled ? "enabled" : "disabled"}.`,
      ), source);
      break;
    case "set-language":
      applyLanguage(command.language);
      ($("#lang-select") as HTMLSelectElement).value = command.language;
      announceSettingChange(settingCopy("界面语言已切换为中文。", "Interface language changed to English."), source);
      break;
    case "set-voice":
      selectedVoice = validVoiceId(command.voice);
      localStorage.setItem(VOICE_KEY, selectedVoice);
      syncVoiceSelect();
      announceSettingChange($t("voiceSaved", $voiceLabel(selectedVoice)), source);
      break;
    case "set-wake-phrase": {
      const useDefault = /^(?:默认|重置|default|reset)$/i.test(command.value);
      const nextPhrase = useDefault ? null : command.value.slice(0, 64);
      if (nextPhrase) localStorage.setItem(WAKE_PHRASE_KEY, nextPhrase);
      else localStorage.removeItem(WAKE_PHRASE_KEY);
      syncWakePhrase();
      if (canArmWakeListenerNow()) {
        await invoke("disarm_wake_listener");
        await armWakeListener();
      }
      announceSettingChange(settingCopy(
        `唤醒词已设为“${nextPhrase ?? DEFAULT_WAKE_PHRASE}”。`,
        `Wake phrase set to “${nextPhrase ?? DEFAULT_WAKE_PHRASE}”.`,
      ), source);
      break;
    }
    case "set-workspace": {
      const nextWorkspace = command.path.trim();
      if (!nextWorkspace.startsWith("/")) {
        announceSettingChange(settingCopy("工作目录必须使用以 / 开头的绝对路径。", "Workspace must be an absolute path beginning with /."), source);
        break;
      }
      localStorage.setItem(WORKSPACE_KEY, nextWorkspace);
      ($("#workspace-path") as HTMLElement).textContent = nextWorkspace;
      announceSettingChange(settingCopy(`工作目录已保存为 ${nextWorkspace}，重启后生效。`, `Workspace saved as ${nextWorkspace}; restart to apply.`), source);
      break;
    }
    case "set-permission": {
      const changed = await applyPermissionMode(command.mode);
      if (changed) announceSettingChange($t("permChanged", permissionLabels[permissionMode]), source);
      break;
    }
    case "reset-studio":
      applyStudioConfig({ ...STUDIO_DEFAULTS });
      syncStudioControls();
      announceSettingChange(settingCopy("视觉外观已恢复默认。", "Visual appearance restored to defaults."), source);
      break;
    case "set-theme":
      applyStudioConfig({ ...studioConfig, theme: command.theme });
      syncStudioControls();
      announceSettingChange(settingCopy(`主题已切换为 ${STUDIO_THEMES[command.theme].label}。`, `Theme changed to ${STUDIO_THEMES[command.theme].label}.`), source);
      break;
    case "set-layout":
      applyStudioLayout(command.layout);
      announceSettingChange(settingCopy(`布局已切换为 ${command.layout}。`, `Layout changed to ${command.layout}.`), source);
      break;
    case "set-intensity":
      applyStudioConfig({ ...studioConfig, intensity: command.value });
      syncStudioControls();
      announceSettingChange(settingCopy(`能量强度已调整为 ${studioConfig.intensity}%。`, `Effect intensity set to ${studioConfig.intensity}%.`), source);
      break;
    case "set-avatar-scale":
      applyStudioConfig({ ...studioConfig, avatarScale: command.value });
      syncStudioControls();
      announceSettingChange(settingCopy(`角色比例已调整为 ${studioConfig.avatarScale}%。`, `Avatar scale set to ${studioConfig.avatarScale}%.`), source);
      break;
    case "set-callsign":
      applyStudioConfig({ ...studioConfig, callsign: command.value });
      syncStudioControls();
      announceSettingChange(settingCopy(`系统代号已改为 ${studioConfig.callsign.toUpperCase()}。`, `Callsign changed to ${studioConfig.callsign.toUpperCase()}.`), source);
      break;
    case "set-subtitle":
      applyStudioConfig({ ...studioConfig, subtitle: command.value });
      syncStudioControls();
      announceSettingChange(settingCopy(`核心副标题已改为 ${studioConfig.subtitle}。`, `Core subtitle changed to ${studioConfig.subtitle}.`), source);
      break;
    case "set-module": {
      const nextConfig = { ...studioConfig };
      if (command.module === "workers") nextConfig.showWorkers = command.enabled;
      if (command.module === "dialogue") nextConfig.showDialogue = command.enabled;
      if (command.module === "wave") nextConfig.showWave = command.enabled;
      if (command.module === "compact") nextConfig.compactControls = command.enabled;
      applyStudioConfig(nextConfig);
      syncStudioControls();
      const labels = { workers: "协作面板", dialogue: "对话字幕", wave: "声波反馈", compact: "极简控制" };
      announceSettingChange(`${labels[command.module]}已${command.enabled ? "开启" : "关闭"}。`, source);
      break;
    }
  }
  // Preserve unrelated edits that the user has made in an open settings dialog.
  if (!settingsDirty) syncAllSettingsControls();
}

async function handleSettingsCommandText(text: string, source: SettingsCommandSource) {
  const command = parseSettingsCommand(text);
  if (!command) return false;
  if (source === "voice") {
    const now = Date.now();
    if (text === lastVoiceSettingsCommand && now - lastVoiceSettingsCommandAt < 2500) return true;
    lastVoiceSettingsCommand = text;
    lastVoiceSettingsCommandAt = now;
  } else {
    transcript.textContent = text;
  }
  try {
    await executeSettingsCommand(command, source);
  } catch (error) {
    reportAsyncError(settingCopy("设置指令执行失败", "Settings command failed"), error);
  }
  return true;
}

$("#command-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const input = $("#command-input") as HTMLInputElement, text = input.value.trim();
  if (!text) return;
  input.value = "";

  if (await handleSettingsCommandText(text, "text")) return;

  // 本地指令拦截
  const cmd = text.toLowerCase();
  if (cmd === "驾驶舱" || cmd === "打开驾驶舱" || cmd === "cockpit") { toggleCockpit(true); return; }
  if (cmd === "关闭驾驶舱" || cmd === "关闭" || cmd === "close cockpit") { toggleCockpit(false); return; }
  if (cmd === "转动" || cmd === "转一下" || cmd === "spin" || cmd === "旋转") { spinCharacter(); return; }
  if (cmd === "停止" || cmd === "stop") { ($("#stop") as HTMLButtonElement).click(); return; }
  if (cmd === "仪表盘" || cmd === "dashboard" || cmd === "面板") { toggleDashboard(); return; }
  if (cmd === "手势" || cmd === "摄像头" || cmd === "gesture" || cmd === "camera") { ($("#camera-gesture") as HTMLButtonElement).click(); return; }

  try {
    state.manualStop = false;
    transcript.textContent = text;
    if (!currentWindow) {
      response.textContent = "视觉预览：文字任务已切换为 Codex 工作态。";
      setMode("working");
      return;
    }
    if (state.directVoice?.voiceActive) {
      response.textContent = "已转向 — 指令已注入当前会话，Jarvis 正在调整执行方向。";
      shell.classList.add("steering");
      setTimeout(() => shell.classList.remove("steering"), 2200);
      await invoke("append_codex_voice_text", { text });
      return;
    }
    if (!state.session) {
      state.session = await invoke<Session>("start_jarvis", {
        cwd: workspace,
        threadId: savedThreadId(),
        permissionMode,
      });
      localStorage.setItem(`${THREAD_KEY_PREFIX}${workspace}`, state.session.threadId);
      $("#thread-id").textContent = state.session.threadId;
      $("#workspace").textContent = state.session.cwd;
    }
    setMode("working");
    await invoke("send_text", { text });
  } catch (error) {
    setMode("degraded");
    reportAsyncError("发送指令失败", error);
  }
});
mic.addEventListener("click", () => {
  if (state.directVoice?.voiceActive || peer) runAsync("停止语音失败", stopDirectVoice());
  else runAsync("启动语音失败", startDirectVoice());
});
$("#stop").addEventListener("click", async () => {
  triggerCharacterAction("error", 700);
  state.manualStop = true; setMode("stopped");
  shell.classList.remove("steering");
  state.agentWorking = false;
  for (const role of ["orchestrator", "developer", "researcher", "reviewer"]) setWorker(role, "Interrupted", false);
  if (!currentWindow) return;
  if (state.directVoice?.voiceActive || peer) {
    try { await stopDirectVoice(); } catch { /* task interruption still continues */ }
  }
  try {
    await invoke("stop_all");
    await armWakeListener();
  } catch (error) {
    reportAsyncError("停止任务失败", error);
  }
});

$("#steer").addEventListener("click", () => {
  if (!state.directVoice?.voiceActive && !state.session) {
    void startDirectVoice();
    return;
  }
  const input = $("#command-input") as HTMLInputElement;
  input.value = "转向：";
  input.focus();
  input.setSelectionRange(3, 3);
  shell.classList.add("steering");
  response.textContent = "方向盘已激活 — 在输入框中输入你的新指令，Jarvis 将立即调整方向。";
  setTimeout(() => shell.classList.remove("steering"), 3000);
});
function autonomyText(mode: PermissionMode): string {
  return mode === "safe" ? $t("autonomyLow") : mode === "auto" ? $t("autonomyMid") : $t("autonomyHigh");
}

function syncPermissionControls() {
  const input = document.querySelector<HTMLInputElement>(
    `input[name="permission-mode"][value="${permissionMode}"]`,
  );
  if (input) input.checked = true;
  const slider = $("#autonomy-range") as HTMLInputElement;
  if (slider) {
    slider.value = String(permissionMode === "safe" ? 16 : permissionMode === "auto" ? 50 : 84);
    ($("#autonomy-output") as HTMLOutputElement).textContent = autonomyText(permissionMode);
  }
  const pml = $<HTMLElement>("#permission-mode-label");
  if (pml) pml.textContent = permissionLabels[permissionMode];
  // 自治度驱动角色呼吸速度
  const rate = permissionMode === "safe" ? "5.5s" : permissionMode === "auto" ? "4s" : "2.5s";
  characterRig.style.animationDuration = rate;
  shell.style.setProperty("--autonomy-level", permissionMode === "safe" ? "0.5" : permissionMode === "auto" ? "0.7" : "1");
}

$("#autonomy-range").addEventListener("input", () => {
  // 只更新 UI 预览，不写 permissionMode —— 真正切换在 saveSettings 里发生，
  // 否则保存时 nextPermission === permissionMode，重建运行时的分支永远进不去
  const val = Number(($("#autonomy-range") as HTMLInputElement).value);
  const mode: PermissionMode = val <= 33 ? "safe" : val <= 66 ? "auto" : "full";
  ($("#autonomy-output") as HTMLOutputElement).textContent = autonomyText(mode);
  const radio = document.querySelector<HTMLInputElement>(`input[name="permission-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  settingsDirty = true;
});

function setupDialogDrag(dialog: HTMLDialogElement) {
  if (dialog.dataset.dragReady) return; // 幂等：重复打开不再叠加监听
  dialog.dataset.dragReady = "1";
  const handle = dialog.querySelector<HTMLElement>(".drag-handle");
  if (!handle) return;
  handle.style.cursor = "move";
  let startX = 0, startY = 0, left = 0, top = 0;
  const onMove = (e: MouseEvent) => {
    const rect = dialog.getBoundingClientRect();
    const nextLeft = Math.min(Math.max(left + e.clientX - startX, 8 - rect.width * 0.5), window.innerWidth - rect.width * 0.5 - 8);
    const nextTop = Math.min(Math.max(top + e.clientY - startY, 8), Math.max(8, window.innerHeight - 80));
    dialog.style.top = `${nextTop}px`;
    dialog.style.left = `${nextLeft}px`;
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // 只响应左键
    const rect = dialog.getBoundingClientRect();
    left = rect.left;
    top = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    dialog.style.position = "fixed";
    dialog.style.margin = "0";
    dialog.style.top = `${top}px`;
    dialog.style.left = `${left}px`;
    dialog.style.translate = "0 0";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
}

function syncVoiceSelect() {
  const select = $("#voice-select") as HTMLSelectElement;
  if (select.children.length <= 1) {
    for (const voice of SUPPORTED_VOICES) {
      const option = document.createElement("option");
      option.value = voice;
      option.textContent = $voiceLabel(voice);
      select.append(option);
    }
  }
  select.value = selectedVoice;
  syncVoiceSelectText();
}

function storedWakePhrase(): string | null {
  const phrase = localStorage.getItem(WAKE_PHRASE_KEY)?.trim();
  return phrase && phrase !== DEFAULT_WAKE_PHRASE ? phrase : null;
}

function syncWakePhrase() {
  const input = $("#wake-phrase-input") as HTMLInputElement;
  input.value = storedWakePhrase() ?? DEFAULT_WAKE_PHRASE;
}

$("#settings").addEventListener("click", () => {
  if (settings.open) return; // 已打开时 showModal 会抛异常
  syncPermissionControls();
  syncVoiceSelect();
  syncWakePhrase();
  settingsLanguageSnapshot = currentLang;
  ($("#lang-select") as HTMLSelectElement).value = currentLang;
  ($("#autostart-toggle") as HTMLInputElement).checked = autostartEnabled;
  ($("#workspace-path") as HTMLElement).textContent = configuredWorkspace() || "—";
  ($("#gesture-toggle") as HTMLInputElement).checked = gestureController.active;
  settingsDirty = false;
  ($("#settings-unsaved") as HTMLElement).hidden = true;
  try {
    settings.showModal();
    applyLanguage(currentLang, false);
    setupDialogDrag(settings);
  } catch (error) {
    response.textContent = `打开设置失败：${String(error)}`;
  }
});
settings.addEventListener("input", (e) => {
  if (e.target instanceof HTMLElement && e.target.id === "gesture-toggle") return; // 手势开关即时生效，不算未保存改动
  settingsDirty = true;
});
settings.addEventListener("change", (e) => {
  if (e.target instanceof HTMLElement && e.target.id === "gesture-toggle") return;
  settingsDirty = true;
});

function hideUnsavedBar() {
  ($("#settings-unsaved") as HTMLElement).hidden = true;
}

function requestCloseSettings() {
  if (settingsDirty) {
    ($("#settings-unsaved") as HTMLElement).hidden = false;
    ($("#settings-unsaved-text") as HTMLElement).textContent = $t("unsavedTitle");
    ($("#unsaved-save") as HTMLElement).textContent = $t("unsavedSave");
    ($("#unsaved-discard") as HTMLElement).textContent = $t("unsavedDiscard");
    ($("#unsaved-keep") as HTMLElement).textContent = $t("unsavedKeep");
    return;
  }
  hideUnsavedBar();
  settings.close();
}

// Esc 原生触发 cancel，拦截后走统一确认流程
settings.addEventListener("cancel", (e) => {
  e.preventDefault();
  requestCloseSettings();
});
// 任何路径关闭后都复位确认条
settings.addEventListener("close", hideUnsavedBar);

$("#close-settings").addEventListener("click", requestCloseSettings);
$("#close-settings-top").addEventListener("click", requestCloseSettings);
$("#gesture-help").addEventListener("click", () => {
  if (!gestureGuide.open) gestureGuide.showModal();
});
$("#close-gesture-guide").addEventListener("click", () => gestureGuide.close());
gestureGuide.addEventListener("click", (event) => {
  if (event.target === gestureGuide) gestureGuide.close();
});
$("#unsaved-save").addEventListener("click", () => { void saveSettings(); });
$("#unsaved-discard").addEventListener("click", () => {
  applyLanguage(settingsLanguageSnapshot, false);
  settingsDirty = false;
  hideUnsavedBar();
  settings.close();
});
$("#unsaved-keep").addEventListener("click", hideUnsavedBar);

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
  if (event.key === "Escape" && cockpitOpen) { toggleCockpit(false); return; }
  if (event.key === "c" || event.key === "C") { toggleCockpit(); return; }
  if (event.key === "s" || event.key === "S") { spinCharacter(); return; }
  if (event.key === "d" || event.key === "D") { toggleDashboard(); return; }
  if (event.key === "k" || event.key === "K") { ($("#camera-gesture") as HTMLButtonElement).click(); return; }
  if (event.key === " ") { event.preventDefault(); toggleCockpit(); }
});

$("#cockpit").addEventListener("click", (e) => { if (e.target === cockpit) toggleCockpit(false); });

const dashboard = $<HTMLElement>("#dashboard");
const dashboardStream = $<HTMLElement>("#dashboard-stream");
const dashboardStats = $<HTMLElement>("#dashboard-stats");
let dashboardOpen = false;
let dashboardToolCount = 0;

function toggleDashboard(force?: boolean) {
  dashboardOpen = force ?? !dashboardOpen;
  dashboard.classList.toggle("hidden", !dashboardOpen);
}

function addDashboardEntry(text: string, kind: "tool" | "working" | "done" | "error" | "ready" = "tool") {
  const entry = document.createElement("div");
  entry.className = `dash-entry dash-${kind}`;
  const icon = { tool: "⚙", working: "◎", done: "✓", error: "✕", ready: "◈" }[kind];
  const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  entry.textContent = `${icon} ${time}  ${text}`;
  dashboardStream.appendChild(entry);
  if (dashboardStream.children.length > 50) dashboardStream.removeChild(dashboardStream.firstChild!);
  dashboardStream.scrollTop = dashboardStream.scrollHeight;
  if (kind === "tool") dashboardToolCount++;
  dashboardStats.textContent = `工具调用 ${dashboardToolCount} 次`;
}

$("#close-dashboard").addEventListener("click", () => toggleDashboard(false));

const gestureController = new CameraGestureController();
const gestureHud = $<HTMLElement>("#gesture-hud");
const GESTURE_HUD_POSITION_KEY = "jarvis.gestureHudPosition.v1";
const GESTURE_HUD_MARGIN = 8;

interface GestureHudPosition {
  x: number;
  y: number;
}

function gestureHudBounds() {
  const parent = (gestureHud.offsetParent as HTMLElement | null) ?? shell;
  return {
    parent,
    maxX: Math.max(GESTURE_HUD_MARGIN, parent.clientWidth - gestureHud.offsetWidth - GESTURE_HUD_MARGIN),
    maxY: Math.max(GESTURE_HUD_MARGIN, parent.clientHeight - gestureHud.offsetHeight - GESTURE_HUD_MARGIN),
  };
}

function clampGestureHudPosition(position: GestureHudPosition): GestureHudPosition {
  const { maxX, maxY } = gestureHudBounds();
  return {
    x: Math.min(maxX, Math.max(GESTURE_HUD_MARGIN, position.x)),
    y: Math.min(maxY, Math.max(GESTURE_HUD_MARGIN, position.y)),
  };
}

function applyGestureHudPosition(position: GestureHudPosition) {
  const clamped = clampGestureHudPosition(position);
  gestureHud.style.left = `${clamped.x}px`;
  gestureHud.style.top = `${clamped.y}px`;
  gestureHud.style.bottom = "auto";
  gestureHud.style.transform = "none";
}

function saveGestureHudPosition() {
  if (!gestureHud.style.top) return;
  const position = clampGestureHudPosition({ x: gestureHud.offsetLeft, y: gestureHud.offsetTop });
  localStorage.setItem(GESTURE_HUD_POSITION_KEY, JSON.stringify(position));
}

function restoreGestureHudPosition() {
  try {
    const stored = localStorage.getItem(GESTURE_HUD_POSITION_KEY);
    if (!stored) return;
    const position = JSON.parse(stored) as Partial<GestureHudPosition>;
    if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
      applyGestureHudPosition({ x: position.x!, y: position.y! });
    }
  } catch {
    localStorage.removeItem(GESTURE_HUD_POSITION_KEY);
  }
}

function setupGestureHudDragging() {
  let pointerId: number | null = null;
  let grabOffsetX = 0;
  let grabOffsetY = 0;

  gestureHud.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const { parent } = gestureHudBounds();
    const rect = gestureHud.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    grabOffsetX = event.clientX - rect.left;
    grabOffsetY = event.clientY - rect.top;
    applyGestureHudPosition({ x: rect.left - parentRect.left, y: rect.top - parentRect.top });
    pointerId = event.pointerId;
    gestureHud.setPointerCapture(pointerId);
    gestureHud.classList.add("dragging");
    event.preventDefault();
  });

  gestureHud.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const { parent } = gestureHudBounds();
    const parentRect = parent.getBoundingClientRect();
    applyGestureHudPosition({
      x: event.clientX - parentRect.left - grabOffsetX,
      y: event.clientY - parentRect.top - grabOffsetY,
    });
  });

  const finishDragging = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    if (gestureHud.hasPointerCapture(pointerId)) gestureHud.releasePointerCapture(pointerId);
    pointerId = null;
    gestureHud.classList.remove("dragging");
    saveGestureHudPosition();
  };
  gestureHud.addEventListener("pointerup", finishDragging);
  gestureHud.addEventListener("pointercancel", finishDragging);

  window.addEventListener("resize", () => {
    if (!gestureHud.style.top) return;
    applyGestureHudPosition({ x: gestureHud.offsetLeft, y: gestureHud.offsetTop });
    saveGestureHudPosition();
  });

  requestAnimationFrame(restoreGestureHudPosition);
}

setupGestureHudDragging();

function stopGestureControl() {
  gestureController.stop();
  gestureHud.classList.add("hidden");
  ($("#camera-gesture") as HTMLButtonElement).classList.remove("active");
  ($("#gesture-toggle") as HTMLInputElement).checked = false;
}

async function prepareForBackground() {
  stopVisualAnimations();
  if (gestureController.active) stopGestureControl();
  if (state.directVoice?.voiceActive || peer) {
    try {
      await stopDirectVoice();
    } catch {
      cleanupPeer();
    }
  }
  await armWakeListener();
}

window.addEventListener("pagehide", () => {
  stopVisualAnimations();
  if (gestureController.active) stopGestureControl();
  cleanupPeer();
});

function handleGestureEvent(event: GestureEvent) {
  gestureHud.classList.remove("gesture-flash");
  void gestureHud.clientWidth;
  gestureHud.classList.add("gesture-flash");
  addDashboardEntry(`手势：${event.label} · ${Math.round(event.score * 100)}%`, "ready");
  switch (event.action) {
    case "stop":
      if (approval.open) void resolveActiveApproval(false);
      else ($("#stop") as HTMLButtonElement).click();
      break;
    case "confirm":
      if (approval.open) void resolveActiveApproval(true);
      else {
        triggerCharacterAction("acknowledge");
        response.textContent = "手势已确认。";
      }
      break;
    case "approve":
      if (approval.open) {
        void resolveActiveApproval(true);
      } else {
        triggerCharacterAction("complete");
      }
      break;
    case "dashboard":
      toggleDashboard();
      break;
    case "cockpit":
      toggleCockpit();
      break;
    case "spin":
      spinCharacter();
      break;
    case "voice":
      if (state.directVoice?.voiceActive || peer) runAsync("手势停止语音失败", stopDirectVoice());
      else runAsync("手势启动语音失败", startDirectVoice());
      break;
    case "settings":
      if (settings.open) requestCloseSettings();
      else {
        if (studio.open) studio.close();
        ($("#settings") as HTMLButtonElement).click();
      }
      break;
    case "studio":
      if (studio.open) studio.close();
      else openStudio();
      break;
  }
}

async function startGestureControl() {
  const button = $("#camera-gesture") as HTMLButtonElement;
  if (gestureController.active) return true;
  if (button.disabled) return false;
  button.classList.add("active");
  gestureHud.classList.remove("hidden");
  ($("#gesture-toggle") as HTMLInputElement).checked = true;
  button.disabled = true;
  let ok = false;
  try {
    ok = await gestureController.start(
      $("#gesture-video") as HTMLVideoElement,
      handleGestureEvent,
      (message) => {
        localStorage.setItem("jarvis.camera.lastError", `${new Date().toISOString()} ${message}`);
        response.textContent = `摄像头手势不可用：${message}`;
        stopGestureControl();
      },
      (message) => {
        response.textContent = message;
        addDashboardEntry(message, "ready");
      },
    );
    if (ok) {
      localStorage.removeItem("jarvis.camera.lastError");
    }
  } finally {
    button.disabled = false;
  }
  return ok;
}

async function setGestureControlEnabled(enabled: boolean) {
  if (!enabled) {
    stopGestureControl();
    return true;
  }
  if (gestureController.active) {
    ($("#gesture-toggle") as HTMLInputElement).checked = true;
    return true;
  }
  try {
    if (currentWindow) {
      const status = await invoke<string>("request_camera_permission");
      if (status !== "authorized") {
        ($("#gesture-toggle") as HTMLInputElement).checked = false;
        response.textContent = "摄像头权限未授予，请在系统弹窗中点击「允许」后重试。";
        return false;
      }
    }
    return await startGestureControl();
  } catch (error) {
    stopGestureControl();
    response.textContent = `摄像头授权失败：${String(error)}`;
    return false;
  }
}

$("#camera-gesture").addEventListener("click", async () => {
  if (gestureController.active) await setGestureControlEnabled(false);
  else await setGestureControlEnabled(true);
});
cockpit.querySelector(".cockpit-stop")?.addEventListener("click", () => { toggleCockpit(false); ($("#stop") as HTMLButtonElement).click(); });
cockpit.querySelector(".cockpit-steer")?.addEventListener("click", () => {
  toggleCockpit(false);
  const input = $("#command-input") as HTMLInputElement;
  input.value = "转向 ";
  input.focus();
});
$("#studio").addEventListener("click", openStudio);
$("#open-studio").addEventListener("click", openStudio);
$("#pick-workspace").addEventListener("click", async () => {
  // 原生目录选择：webkitdirectory 只能拿到相对路径，拼出来的是假绝对路径
  try {
    const picked = await openNativeDialog({
      directory: true,
      multiple: false,
      defaultPath: workspace || undefined,
      title: $t("settingsWorkspaceSection"),
    });
    if (typeof picked === "string" && picked) {
      // 注意：不写全局 workspace —— saveSettings 靠"显示路径 ≠ workspace"来判断是否要保存
      ($("#workspace-path") as HTMLElement).textContent = picked;
      settingsDirty = true;
    }
  } catch (error) {
    response.textContent = `${$t("pickFolderError")}：${String(error)}`;
  }
});
$("#lang-select").addEventListener("change", () => {
  const lang = ($("#lang-select") as HTMLSelectElement).value as Lang;
  if (lang !== currentLang) applyLanguage(lang, false);
});
$("#close-studio").addEventListener("click", () => studio.close());
$("#apply-studio").addEventListener("click", () => studio.close());
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-studio-theme]")) {
  button.addEventListener("click", () => {
    const theme = button.dataset.studioTheme as StudioTheme;
    applyStudioConfig({ ...studioConfig, theme });
    syncStudioControls();
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-studio-layout]")) {
  button.addEventListener("click", () => {
    applyStudioLayout(button.dataset.studioLayout as StudioLayout);
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-studio-preview-state]")) {
  button.addEventListener("click", () => {
    setStudioPreviewState(button.dataset.studioPreviewState as StudioPreviewState);
  });
}
for (const selector of [
  "#studio-callsign",
  "#studio-subtitle",
  "#studio-intensity",
  "#studio-scale",
  "#studio-workers",
  "#studio-dialogue",
  "#studio-wave",
  "#studio-compact",
]) {
  $(selector).addEventListener("input", () => {
    applyStudioConfig(studioConfigFromControls());
    syncStudioControls();
  });
}
$("#reset-studio").addEventListener("click", () => {
  applyStudioConfig({ ...STUDIO_DEFAULTS });
  syncStudioControls();
});
$("#export-studio").addEventListener("click", () => {
  const blob = new Blob([`${JSON.stringify(studioConfig, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${studioConfig.callsign.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "jarvis"}-core.json`;
  link.click();
  URL.revokeObjectURL(url);
});
$("#import-studio").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    applyStudioConfig(normalizeStudioConfig(JSON.parse(await file.text())));
    syncStudioControls();
    response.textContent = `已装配配置：${studioConfig.callsign.toUpperCase()} CORE`;
  } catch (error) {
    response.textContent = `DIY 配置导入失败：${String(error)}`;
  } finally {
    input.value = "";
  }
});
$("#new-thread").addEventListener("click", async () => {
  if (settingsDirty) {
    requestCloseSettings();
    return;
  }
  const button = $("#new-thread") as HTMLButtonElement;
  button.disabled = true;
  state.manualStop = true;
  if (settings.open) settings.close();
  response.textContent = "正在结束当前任务并创建新的 Codex thread…";
  try {
    if (state.directVoice?.voiceActive || peer) {
      try { await stopDirectVoice(); } catch { cleanupPeer(); }
    }
    try { await invoke("stop_all"); } catch { /* no active runtime */ }
    await invoke("shutdown");
    const freshSession = await invoke<Session>("start_jarvis", {
      cwd: workspace,
      threadId: null,
      permissionMode,
    });
    state.session = freshSession;
    state.directVoice = null;
    localStorage.setItem(`${THREAD_KEY_PREFIX}${workspace}`, freshSession.threadId);
    $("#thread-id").textContent = freshSession.threadId;
    $("#workspace").textContent = freshSession.cwd;
    userTranscriptBuffer = "";
    assistantTranscriptBuffer = "";
    agentMessageBuffer = "";
    transcript.textContent = `"${$t("transcriptNew")}"`;
    response.textContent = $t("transcriptNewMsg");
    setMode("ready");
    setWorker("orchestrator", $t("workerFresh"));
  } catch (error) {
    try { await invoke("shutdown"); } catch { /* already stopped */ }
    state.session = null;
    state.directVoice = null;
    setMode("degraded");
    response.textContent = `新建线程失败，原线程仍可续接：${String(error)}`;
  } finally {
    button.disabled = false;
    await armWakeListener();
  }
});

async function applyPermissionMode(nextPermission: PermissionMode, confirmFull = true) {
  if (
    confirmFull
    && nextPermission === "full"
    && permissionMode !== "full"
    && !window.confirm($t("fullAccessConfirm"))
  ) {
    response.textContent = settingCopy("已取消开启完全访问。", "Full Access was not enabled.");
    return false;
  }
  if (nextPermission === permissionMode) {
    syncPermissionControls();
    return true;
  }

  state.manualStop = true;
  if (currentWindow) {
    if (state.directVoice?.voiceActive || peer) {
      try { await stopDirectVoice(); } catch { cleanupPeer(); }
    }
    try { await invoke("stop_all"); } catch { /* no active runtime */ }
    await invoke("shutdown");
  }
  permissionMode = nextPermission;
  localStorage.setItem(PERMISSION_KEY, permissionMode);
  state.session = null;
  state.directVoice = null;
  syncPermissionControls();
  setMode("ready");
  if (currentWindow) await armWakeListener();
  return true;
}

async function saveSettings() {
  try {
    const nextWorkspace = ($("#workspace-path") as HTMLElement).textContent?.trim() || "";
    if (!nextWorkspace || nextWorkspace === "—") return;

    const nextLang = ($("#lang-select") as HTMLSelectElement).value as Lang;

    const enteredWakePhrase = ($("#wake-phrase-input") as HTMLInputElement).value.trim();
    const nextWakePhrase = enteredWakePhrase && enteredWakePhrase !== DEFAULT_WAKE_PHRASE
      ? enteredWakePhrase
      : null;
    const wakePhraseChanged = nextWakePhrase !== storedWakePhrase();

    const selectedPermission = document.querySelector<HTMLInputElement>(
      'input[name="permission-mode"]:checked',
    )?.value as PermissionMode | undefined;
    const nextPermission = selectedPermission ?? permissionMode;
    if (nextPermission === "full" && permissionMode !== "full" && !window.confirm($t("fullAccessConfirm"))) {
      return;
    }
    const nextAutostart = ($("#autostart-toggle") as HTMLInputElement).checked;
    const nextVoice = validVoiceId(($("#voice-select") as HTMLSelectElement).value);

    applyLanguage(nextLang);
    if (nextWakePhrase) localStorage.setItem(WAKE_PHRASE_KEY, nextWakePhrase);
    else localStorage.removeItem(WAKE_PHRASE_KEY);

    if (nextAutostart !== autostartEnabled) {
      await invoke("set_autostart", { enabled: nextAutostart });
      autostartEnabled = nextAutostart;
    }
    if (nextVoice !== selectedVoice) {
      selectedVoice = nextVoice;
      localStorage.setItem(VOICE_KEY, selectedVoice);
      response.textContent = typeof T.voiceSaved.zh === "function" ? $t("voiceSaved", $voiceLabel(selectedVoice)) : "";
    }
    if (nextWorkspace !== workspace) {
      localStorage.setItem(WORKSPACE_KEY, nextWorkspace);
      response.textContent = $t("workspaceSaved");
    }
    const canRearmWakeListener = canArmWakeListenerNow();
    if (wakePhraseChanged && canRearmWakeListener) await invoke("disarm_wake_listener");
    const permissionChanged = nextPermission !== permissionMode;
    if (nextPermission !== permissionMode) {
      await applyPermissionMode(nextPermission, false);
      response.textContent = $t("permChanged", permissionLabels[permissionMode]);
    }
    if (wakePhraseChanged && !permissionChanged && canRearmWakeListener) await armWakeListener();
    settingsLanguageSnapshot = currentLang;
    settingsDirty = false;
    settings.close();
  } catch (error) {
    response.textContent = `保存设置失败：${String(error)}`;
  }
}

$("#save-settings").addEventListener("click", () => saveSettings());

$("#gesture-toggle").addEventListener("change", async () => {
  const checked = ($("#gesture-toggle") as HTMLInputElement).checked;
  await setGestureControlEnabled(checked);
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="permission-mode"]')) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    // 同上：只同步滑块与文案预览，不提前改写 permissionMode
    const mode = radio.value as PermissionMode;
    ($("#autonomy-range") as HTMLInputElement).value = String(mode === "safe" ? 16 : mode === "auto" ? 50 : 84);
    ($("#autonomy-output") as HTMLOutputElement).textContent = autonomyText(mode);
    settingsDirty = true;
  });
}
for (const [selector, approved] of [["#approve", true], ["#deny", false]] as const) {
  $(selector).addEventListener("click", () => { void resolveActiveApproval(approved); });
}

if (currentWindow) {
  try {
    workspace = localStorage.getItem(WORKSPACE_KEY)
      ?? await invoke<string>("default_workspace");
    localStorage.setItem(WORKSPACE_KEY, workspace);
    try {
      autostartEnabled = await invoke<boolean>("autostart_status");
    } catch {
      autostartEnabled = false;
    }
    $("#thread-id").textContent = $t("notStarted");
    $("#workspace").textContent = workspace;
    $("#workspace-path").textContent = workspace;
    syncPermissionControls();
    setWorker("orchestrator", "唤醒词启动中");
    applyLanguage();
    setMode("ready");
    const backgroundStart = await invoke<boolean>("startup_is_background");
    if (!backgroundStart) {
      const microphoneAuthorization = await invoke<string>("request_microphone_permission");
      if (microphoneAuthorization !== "authorized") {
        setMode("degraded");
        banner.hidden = false;
        $("#degraded-copy").textContent =
          "请在系统设置 → 隐私与安全性 → 麦克风中允许 Jarvis Codex。";
      }
    }
    updateVoiceInfo(await invoke<DirectVoice>("direct_voice_status"));
    const coldWake = await invoke<boolean>("consume_cold_wake");
    if (coldWake) {
      transcript.textContent = "“嗨，Jarvis”";
    } else {
      await armWakeListener();
    }
  } catch (error) { setMode("stopped"); response.textContent = `启动失败：${String(error)}`; }
} else {
  workspace = "/Users/reson/JarvisWorkspace";
  $("#thread-id").textContent = "Preview only";
  const wp = $<HTMLElement>("#workspace");
  if (wp) wp.textContent = workspace;
  ($("#workspace-path") as HTMLElement).textContent = workspace;
  const wa2 = $<HTMLElement>("#wake-auth");
  if (wa2) wa2.textContent = "Preview · not connected";
  const va2 = $<HTMLElement>("#voice-auth");
  if (va2) va2.textContent = "Preview · not connected";
  transcript.textContent = visualPreviewMode === "stopped" ? "“停下”" : "“嗨，Jarvis”";
  response.textContent = visualPreviewMode === "voice-starting"
    ? "正在从粒子中重构 Jarvis 核心…"
    : visualPreviewMode === "working"
      ? "Codex 正在执行任务，装甲能量切换为工作态。"
      : visualPreviewMode === "speaking"
        ? "语音输出正在驱动角色光效与声波。"
        : visualPreviewMode === "stopped"
          ? "所有任务已中断，等待下一次唤醒。"
          : "Jarvis 视觉系统预览就绪。";
  setMode(visualPreviewMode);
  if (["acknowledge", "approval", "complete", "error"].includes(previewActionValue ?? "")) {
    window.setTimeout(() => triggerCharacterAction(previewActionValue as CharacterAction, 1800), 180);
  }
  setWorker("orchestrator", visualPreviewMode === "working" ? "Codex working" : "Visual preview");
  if (visualPreviewMode === "working") {
    setWorker("developer", "Working");
  }
}

async function armWakeListener() {
  try {
    state.wake = await invoke<WakeStatus>("arm_wake_listener", { wakePhrase: storedWakePhrase() });
    const wa3 = $<HTMLElement>("#wake-auth");
    if (wa3) wa3.textContent = state.wake.ready ? "Local listener ready" : state.wake.authorization;
    if (["denied", "restricted"].includes(state.wake.authorization)) {
      setMode("degraded");
      banner.hidden = false;
      $("#degraded-copy").textContent = "请在系统设置 → 隐私与安全性中允许麦克风和语音识别。";
    }
  } catch (error) {
    const wa4 = $<HTMLElement>("#wake-auth");
    if (wa4) wa4.textContent = String(error);
  }
}
