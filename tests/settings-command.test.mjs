import assert from "node:assert/strict";
import test from "node:test";

import { parseSettingsCommand } from "../src/settings-command.js";

test("settings command parser covers every main setting", () => {
  assert.deepEqual(parseSettingsCommand("贾维斯，打开摄像头手势"), { kind: "set-gesture", enabled: true });
  assert.deepEqual(parseSettingsCommand("关闭后台启动"), { kind: "set-autostart", enabled: false });
  assert.deepEqual(parseSettingsCommand("把界面语言改成英文"), { kind: "set-language", language: "en" });
  assert.deepEqual(parseSettingsCommand("音色设置为 Cove"), { kind: "set-voice", voice: "cove" });
  assert.deepEqual(parseSettingsCommand("唤醒词改为 星期五"), { kind: "set-wake-phrase", value: "星期五" });
  assert.deepEqual(parseSettingsCommand("工作目录设为 /Users/reson/Projects"), { kind: "set-workspace", path: "/Users/reson/Projects" });
  assert.deepEqual(parseSettingsCommand("权限改为安全模式"), { kind: "set-permission", mode: "safe" });
  assert.deepEqual(parseSettingsCommand("权限改为完全访问"), { kind: "set-permission", mode: "full" });
});

test("settings command parser covers every DIY setting", () => {
  assert.deepEqual(parseSettingsCommand("主题切换为矩阵绿色"), { kind: "set-theme", theme: "matrix" });
  assert.deepEqual(parseSettingsCommand("布局改成聚焦模式"), { kind: "set-layout", layout: "focus" });
  assert.deepEqual(parseSettingsCommand("能量强度设为 88"), { kind: "set-intensity", value: 88 });
  assert.deepEqual(parseSettingsCommand("角色大小调整为 115"), { kind: "set-avatar-scale", value: 115 });
  assert.deepEqual(parseSettingsCommand("系统代号改为 Friday"), { kind: "set-callsign", value: "Friday" });
  assert.deepEqual(parseSettingsCommand("副标题改成 智能操作核心"), { kind: "set-subtitle", value: "智能操作核心" });
  assert.deepEqual(parseSettingsCommand("隐藏协作面板"), { kind: "set-module", module: "workers", enabled: false });
  assert.deepEqual(parseSettingsCommand("打开声波反馈"), { kind: "set-module", module: "wave", enabled: true });
  assert.deepEqual(parseSettingsCommand("恢复默认外观"), { kind: "reset-studio" });
});

test("settings command parser recognizes panels and avoids conversational false positives", () => {
  assert.deepEqual(parseSettingsCommand("打开设置"), { kind: "open-settings" });
  assert.deepEqual(parseSettingsCommand("显示所有设置"), { kind: "show-status" });
  assert.deepEqual(parseSettingsCommand("设置帮助"), { kind: "show-help" });
  assert.equal(parseSettingsCommand("摄像头可以做什么"), null);
  assert.equal(parseSettingsCommand("我喜欢绿色"), null);
});
