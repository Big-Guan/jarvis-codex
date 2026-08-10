const VOICES = [
  "alloy", "arbor", "ash", "ballad", "breeze", "cedar", "coral", "cove", "echo", "ember",
  "juniper", "maple", "marin", "sage", "shimmer", "sol", "spruce", "vale", "verse",
];

const ENABLE_WORDS = /(?:打开|开启|启用|启动|显示|恢复|允许|enable|turn\s*on|show)/i;
const DISABLE_WORDS = /(?:关闭|关掉|停用|禁用|隐藏|不要|disable|turn\s*off|hide)/i;

function cleanCommand(input) {
  return String(input ?? "")
    .trim()
    .replace(/^(?:请|麻烦)?\s*(?:嗨|嘿|hey)?\s*(?:贾维斯|jarvis)\s*[,，:：]?\s*/i, "")
    .replace(/[。！!？?]+$/g, "")
    .trim();
}

function booleanIntent(text) {
  if (DISABLE_WORDS.test(text)) return false;
  if (ENABLE_WORDS.test(text)) return true;
  return null;
}
function capturedValue(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim().replace(/^[“”"'「『]+|[“”"'」』]+$/g, "") ?? "";
}

export function parseSettingsCommand(input) {
  const text = cleanCommand(input);
  const lower = text.toLowerCase();
  if (!text) return null;

  if (/^(?:打开|开启|显示|进入|open)\s*(?:系统)?设置(?:页面|面板)?$/i.test(text)) return { kind: "open-settings" };
  if (/^(?:关闭|退出|close)\s*(?:系统)?设置(?:页面|面板)?$/i.test(text)) return { kind: "close-settings" };
  if (/^(?:打开|开启|显示|进入|open)\s*(?:diy\s*)?(?:工作台|视觉设置|studio)$/i.test(text)) return { kind: "open-studio" };
  if (/^(?:关闭|退出|close)\s*(?:diy\s*)?(?:工作台|视觉设置|studio)$/i.test(text)) return { kind: "close-studio" };
  if (/^(?:查看|告诉我|读取|显示)?\s*(?:当前)?(?:设置状态|所有设置|配置状态|settings status)$/i.test(text)) return { kind: "show-status" };
  if (/(?:设置帮助|设置指令|能控制哪些设置|可以控制哪些设置|settings help)/i.test(text)) return { kind: "show-help" };

  if (/(?:摄像头|相机|手势识别|手势控制|camera|gesture)/i.test(text)) {
    const enabled = booleanIntent(text);
    if (enabled !== null) return { kind: "set-gesture", enabled };
  }
  if (/(?:后台启动|开机启动|登录启动|自动启动|自启动|autostart|launch at login)/i.test(text)) {
    const enabled = booleanIntent(text);
    if (enabled !== null) return { kind: "set-autostart", enabled };
  }

  if (/(?:语言|界面|language)/i.test(text) || /(?:切换到|改成|改为|设为)\s*(?:简体)?中文/i.test(text)) {
    if (/(?:简体中文|中文|chinese|zh-cn|\bzh\b)/i.test(text)) return { kind: "set-language", language: "zh" };
    if (/(?:英文|英语|english|\ben\b)/i.test(text)) return { kind: "set-language", language: "en" };
  }

  if (/(?:音色|声音|voice)/i.test(text)) {
    const voice = VOICES.find((candidate) => new RegExp(`(?:^|[^a-z])${candidate}(?:$|[^a-z])`, "i").test(lower));
    if (voice) return { kind: "set-voice", voice };
  }

  const wakePhrase = capturedValue(
    text,
    /(?:唤醒词|唤醒短语|wake\s*phrase)\s*(?:改成|改为|修改为|设置为|设为|换成|调整为|to|是|[:：])\s*(.+)$/i,
  );
  if (wakePhrase) return { kind: "set-wake-phrase", value: wakePhrase };

  const workspace = capturedValue(
    text,
    /(?:工作目录|工作路径|项目目录|workspace)\s*(?:改成|改为|修改为|设置为|设为|换成|调整为|to|是|[:：])\s*(.+)$/i,
  );
  if (workspace) return { kind: "set-workspace", path: workspace };

  if (/(?:权限|自治|permission|access mode)/i.test(text)) {
    if (/(?:安全|safe)/i.test(text)) return { kind: "set-permission", mode: "safe" };
    if (/(?:自动办公|自动模式|auto)/i.test(text)) return { kind: "set-permission", mode: "auto" };
    if (/(?:完全访问|全部访问|full)/i.test(text)) return { kind: "set-permission", mode: "full" };
  }

  if (/(?:恢复|重置).*(?:默认外观|默认视觉|工作台|studio)/i.test(text)) return { kind: "reset-studio" };

  if (/(?:主题|配色|颜色|theme)/i.test(text)) {
    if (/(?:量子蓝|量子|quantum)/i.test(text)) return { kind: "set-theme", theme: "quantum" };
    if (/(?:反应堆|金色|reactor)/i.test(text)) return { kind: "set-theme", theme: "reactor" };
    if (/(?:合成波|紫色|synthwave)/i.test(text)) return { kind: "set-theme", theme: "synthwave" };
    if (/(?:矩阵|绿色|matrix)/i.test(text)) return { kind: "set-theme", theme: "matrix" };
    if (/(?:极地|白色|arctic)/i.test(text)) return { kind: "set-theme", theme: "arctic" };
  }

  if (/(?:布局|界面模式|layout)/i.test(text)) {
    if (/(?:完整协作|完整布局|balanced)/i.test(text)) return { kind: "set-layout", layout: "balanced" };
    if (/(?:聚焦|focus)/i.test(text)) return { kind: "set-layout", layout: "focus" };
    if (/(?:指挥|command)/i.test(text)) return { kind: "set-layout", layout: "command" };
  }

  const intensity = text.match(/(?:能量强度|特效强度|效果强度|intensity)\D{0,12}(\d{1,3})/i)?.[1];
  if (intensity) return { kind: "set-intensity", value: Number(intensity) };
  const scale = text.match(/(?:核心比例|角色大小|角色比例|avatar\s*scale|scale)\D{0,12}(\d{1,3})/i)?.[1];
  if (scale) return { kind: "set-avatar-scale", value: Number(scale) };

  const callsign = capturedValue(
    text,
    /(?:系统代号|角色代号|代号|callsign)\s*(?:改成|改为|修改为|设置为|设为|换成|to|是|[:：])\s*(.+)$/i,
  );
  if (callsign) return { kind: "set-callsign", value: callsign };
  const subtitle = capturedValue(
    text,
    /(?:核心副标题|系统副标题|副标题|subtitle)\s*(?:改成|改为|修改为|设置为|设为|换成|to|是|[:：])\s*(.+)$/i,
  );
  if (subtitle) return { kind: "set-subtitle", value: subtitle };

  const enabled = booleanIntent(text);
  if (enabled !== null) {
    if (/(?:协作面板|角色状态|worker)/i.test(text)) return { kind: "set-module", module: "workers", enabled };
    if (/(?:对话字幕|实时转写|字幕|dialogue|transcript)/i.test(text)) return { kind: "set-module", module: "dialogue", enabled };
    if (/(?:声波反馈|音频可视化|声波|wave)/i.test(text)) return { kind: "set-module", module: "wave", enabled };
    if (/(?:极简控制|紧凑模式|compact)/i.test(text)) return { kind: "set-module", module: "compact", enabled };
  }

  return null;
}
