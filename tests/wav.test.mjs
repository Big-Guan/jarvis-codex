import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const frontend = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const stylesheet = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
const backend = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const wakeHelper = await readFile(
  new URL("../src-tauri/wake-helper/JarvisWakeListener.swift", import.meta.url),
  "utf8",
);
const entitlements = await readFile(
  new URL("../src-tauri/Entitlements.plist", import.meta.url),
  "utf8",
);
const helperEntitlements = await readFile(
  new URL("../src-tauri/wake-helper/Entitlements.plist", import.meta.url),
  "utf8",
);
const capability = JSON.parse(
  await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"),
);
const gestureController = await readFile(
  new URL("../src/gesture-camera.ts", import.meta.url),
  "utf8",
);
const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const gestureModel = await readFile(
  new URL("../public/gesture_recognizer.task", import.meta.url),
);

test("Voice uses Codex app-server V3 WebRTC directly", () => {
  assert.match(backend, /"version":\s*"v3"/);
  assert.match(backend, /"transport":\s*\{"type":\s*"webrtc"/);
  assert.match(backend, /"app-server",\s*"--enable",\s*"realtime_conversation",\s*"--stdio"/);
  assert.doesNotMatch(frontend, /OPENAI_API_KEY|ChatGPT.*button|hotkey/i);
});

test("wake phrase opens the same direct Voice path", () => {
  assert.match(frontend, /listen<WakeEvent>\("jarvis-wake"/);
  assert.match(frontend, /void startDirectVoice\(\{ coldStart: payload\.cold === true \}\)/);
  assert.match(frontend, /const attempts = coldStart \? 6 : 1/);
  assert.match(frontend, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(frontend, /recoverableColdStartError/);
  assert.match(backend, /"--host-app"/);
  assert.match(wakeHelper, /NSWorkspace\.shared\.openApplication/);
  assert.match(wakeHelper, /configuration\.arguments\s*=\s*\["--jarvis-wake"\]/);
  assert.match(frontend, /consume_cold_wake/);
  assert.match(backend, /AVAudioEngine releases the input device asynchronously/);
  assert.match(backend, /matches!\(authorization, "denied" \| "restricted"\)/);
  assert.match(backend, /requestAccessForMediaType_completionHandler/);
  assert.match(frontend, /request_microphone_permission/);
  assert.match(frontend, /startup_is_background/);
  assert.match(entitlements, /com\.apple\.security\.device\.audio-input/);
  assert.match(helperEntitlements, /com\.apple\.security\.device\.audio-input/);
  assert.match(backend, /tauri_plugin_autostart/);
  assert.match(frontend, /onCloseRequested/);
  assert.match(wakeHelper, /"--test-wake"/);
  assert.match(frontend, /wakePhrase:\s*storedWakePhrase\(\)/);
  assert.match(backend, /validated_wake_phrase/);
  assert.match(backend, /"--wake-phrase"/);
  assert.match(wakeHelper, /argumentValue\("--wake-phrase"\)/);
  assert.doesNotMatch(backend, /\/usr\/bin\/pkill/);
});

test("STOP suppresses transcript-tail handoffs and interrupts late turns", () => {
  assert.match(backend, /"flushTranscriptTailOnSessionEnd":\s*false/);
  assert.match(backend, /for _ in 0\.\.6/);
  assert.match(backend, /"turn\/interrupt"/);
});

test("text input can join the active Voice conversation", () => {
  assert.match(frontend, /append_codex_voice_text/);
  assert.match(backend, /"thread\/realtime\/appendText"/);
});

test("production configuration persists workspace and resumes threads", () => {
  assert.match(frontend, /jarvis\.workspace/);
  assert.match(frontend, /jarvis\.threadId:/);
  assert.match(backend, /"thread\/resume"/);
  assert.match(backend, /validated_workspace/);
  assert.match(wakeHelper, /requiresOnDeviceRecognition = true/);
});

test("user can create a fresh Codex thread without deleting history", () => {
  assert.match(frontend, /id="new-thread"/);
  assert.match(frontend, /threadId:\s*null/);
  assert.match(frontend, /invoke<Session>\("start_jarvis"/);
  assert.match(frontend, /freshSession\.threadId/);
  assert.match(frontend, /原线程仍保留在 Codex 历史记录中/);
});

test("permission profiles are persisted and mapped by the trusted backend", () => {
  assert.match(frontend, /jarvis\.permissionMode/);
  assert.match(frontend, /type PermissionMode = "safe" \| "auto" \| "full"/);
  assert.match(frontend, /permissionMode,/);
  assert.match(backend, /enum PermissionMode/);
  assert.match(backend, /approval_policy: "on-request"/);
  assert.match(backend, /approval_policy: "never"/);
  assert.match(backend, /sandbox: "workspace-write"/);
  assert.match(backend, /sandbox: "danger-full-access"/);
  assert.match(backend, /existing\.permission_mode == permission_mode/);
});

test("wake activates the macOS app before focusing the Jarvis window", () => {
  assert.match(backend, /fn raise_jarvis_window/);
  assert.match(backend, /activateIgnoringOtherApps\(true\)/);
  assert.match(backend, /set_always_on_top\(true\)/);
  assert.match(backend, /set_always_on_top\(false\)/);
  assert.match(backend, /raise_jarvis_window\(&app\)/);
});

test("settings dialog keeps a unique interactive overlay contract", () => {
  const template = frontend.match(/document\.querySelector<HTMLDivElement>\("#app"\)!\.innerHTML = `([\s\S]*?)`;\s*\n\s*const \$/)?.[1];
  assert.ok(template, "app template should be discoverable");

  const ids = [...template.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `duplicate DOM ids: ${duplicates.join(", ")}`);

  for (const id of ["settings-dialog", "cockpit", "wake-auth", "thread-id", "workspace", "permission-mode-label", "voice-auth"]) {
    assert.ok(ids.includes(id), `missing required settings/runtime node #${id}`);
  }
  assert.equal(ids.filter((id) => id === "cockpit").length, 1);
  assert.doesNotMatch(template, /id="cockpit"[^>]*>\s*<div id="dashboard"/);
  assert.match(stylesheet, /dialog:modal\{[^}]*pointer-events:auto/);
});

test("Tauri capabilities cover every privileged frontend interaction", () => {
  assert.ok(capability.permissions.includes("core:window:allow-hide"));
  assert.ok(capability.permissions.includes("core:window:allow-start-dragging"));
  assert.ok(capability.permissions.includes("dialog:allow-open"));
});

test("settings preview, defaults, and autostart remain transactional", () => {
  assert.match(frontend, /applyLanguage\(lang, false\)/);
  assert.match(frontend, /applyLanguage\(settingsLanguageSnapshot, false\)/);
  assert.match(frontend, /enteredWakePhrase[\s\S]*\? enteredWakePhrase[\s\S]*: null/);
  assert.match(frontend, /localStorage\.removeItem\(WAKE_PHRASE_KEY\)/);
  assert.match(frontend, /invoke\("set_autostart", \{ enabled: nextAutostart \}\)/);
  assert.match(backend, /fn set_autostart/);
  assert.equal([...backend.matchAll(/app\.autolaunch\(\)\.enable\(\)/g)].length, 1);
});

test("approval and media resources have bounded lifecycles", () => {
  assert.match(frontend, /const approvalQueue: ApprovalRequest\[\]/);
  assert.match(frontend, /async function resolveActiveApproval/);
  assert.doesNotMatch(frontend, /let approvalId/);
  assert.match(frontend, /document\.addEventListener\("visibilitychange"/);
  assert.match(frontend, /async function prepareForBackground/);
  assert.match(gestureController, /this\.recognizer\?\.close\(\)/);
});

test("camera opens before gesture model initialization and falls back to CPU", () => {
  const cameraOpen = gestureController.indexOf("this.stream = await navigator.mediaDevices.getUserMedia");
  const modelInit = gestureController.indexOf("FilesetResolver.forVisionTasks");
  assert.ok(cameraOpen >= 0 && modelInit >= 0 && cameraOpen < modelInit);
  assert.match(gestureController, /WASM_ROOT = "\/wasm"/);
  assert.match(gestureController, /MODEL_PATH = "\/gesture_recognizer\.task"/);
  assert.match(gestureController, /await fetch\(MODEL_PATH\)/);
  assert.match(gestureController, /modelAssetBuffer: modelAssetBuffer\.slice\(\)/);
  assert.match(gestureController, /delegate: "GPU"/);
  assert.match(gestureController, /delegate: "CPU"/);
  assert.match(tauriConfig.app.security.csp, /connect-src 'self' blob:/);
  assert.match(frontend, /jarvis\.camera\.lastError/);
  assert.match(frontend, /button\.disabled = true/);
  assert.match(frontend, /button\.disabled = false/);
});

test("bundled gesture model is a complete MediaPipe task archive", () => {
  assert.ok(gestureModel.length > 8_000_000, `gesture model is unexpectedly small: ${gestureModel.length}`);
  assert.ok(gestureModel.lastIndexOf(Buffer.from("PK\x05\x06", "binary")) > 0, "gesture model has no ZIP directory");
});

test("gesture controls cover stop, spin, cockpit, and draggable camera preview", () => {
  assert.match(gestureController, /Thumb_Down:\s*\{\s*action:\s*"stop"/);
  assert.match(gestureController, /ILoveYou:\s*\{\s*action:\s*"spin"/);
  assert.match(gestureController, /latchedGesture/);
  assert.match(gestureController, /RELEASE_FRAMES/);
  assert.match(frontend, /case "spin":\s*spinCharacter\(\)/);
  assert.match(frontend, /case "cockpit":\s*toggleCockpit\(true\)/);
  assert.match(frontend, /GESTURE_HUD_POSITION_KEY = "jarvis\.gestureHudPosition\.v1"/);
  assert.match(frontend, /gestureHud\.addEventListener\("pointerdown"/);
  assert.match(frontend, /gestureHud\.addEventListener\("pointermove"/);
  assert.match(frontend, /id="gesture-help"[^>]*>查看手势<\/button>/);
  assert.match(frontend, /id="gesture-guide-dialog"/);
  const hudStart = frontend.indexOf('<div id="gesture-hud"');
  const hudEnd = frontend.indexOf('<div id="dashboard"', hudStart);
  const hudMarkup = frontend.slice(hudStart, hudEnd);
  assert.match(hudMarkup, /<video id="gesture-video"/);
  assert.doesNotMatch(hudMarkup, /gesture-info|gesture-hint|手势识别中/);
  const guideStart = frontend.indexOf('<dialog id="gesture-guide-dialog"');
  const guideEnd = frontend.indexOf('<dialog id="studio-dialog"', guideStart);
  assert.equal((frontend.slice(guideStart, guideEnd).match(/class="gesture-guide-card"/g) ?? []).length, 6);
  assert.match(stylesheet, /\.gesture-hud\.dragging\{[^}]*cursor:grabbing/);
  assert.match(stylesheet, /\.gesture-toggle-line\{[^}]*display:flex/);
  assert.match(stylesheet, /@keyframes character-spin\{[^}]*rotateY\(0\)[\s\S]*rotateY\(360deg\)/);
});
