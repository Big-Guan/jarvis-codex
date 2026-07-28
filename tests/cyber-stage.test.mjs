import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readOptional(url) {
  try {
    return await readFile(url, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

const controllerSource = await readOptional(
  new URL("../src/cyber-stage.ts", import.meta.url),
);
const frontend = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

async function loadMathModule() {
  try {
    return await import("../src/cyber-math.mjs");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

const math = await loadMathModule();

test("visual controller clamps and smooths audio input", () => {
  assert.equal(typeof math.clampLevel, "function");
  assert.equal(typeof math.smoothValue, "function");
  assert.equal(math.clampLevel(-1), 0);
  assert.equal(math.clampLevel(2), 1);
  assert.equal(math.clampLevel(Number.NaN), 0);
  assert.equal(math.smoothValue(0, 1, 0.25), 0.25);
});

test("visual controller exposes the stage lifecycle contract", () => {
  assert.match(controllerSource, /export function createCyberStage/);
  assert.match(controllerSource, /setMode\(mode:\s*VisualMode\)/);
  assert.match(controllerSource, /setAudioLevels\(levels:\s*AudioLevels\)/);
  assert.match(controllerSource, /destroy\(\)/);
  assert.match(controllerSource, /visibilitychange/);
  assert.match(controllerSource, /prefers-reduced-motion/);
  assert.match(controllerSource, /ResizeObserver/);
  assert.match(
    controllerSource,
    /if \(staticFrame\) \{\s*frame = 0;\s*return;\s*\}/,
    "reduced-motion and stopped modes should render a single static frame",
  );
  assert.match(
    controllerSource,
    /const staticFrame = reducedMotion \|\| currentMode === "stopped"/,
  );
});

test("main stage contains far, middle, and near depth layers", () => {
  assert.match(frontend, /class="depth-scene"/);
  assert.match(frontend, /class="depth-layer depth-far"/);
  assert.match(frontend, /class="depth-layer depth-mid"/);
  assert.match(frontend, /class="depth-layer depth-near"/);
  assert.match(frontend, /id="fx-canvas"/);
  assert.ok(
    (frontend.match(/helmet-slice/g) ?? []).length >= 3,
    "the avatar should use at least three depth slices",
  );
  assert.match(frontend, /class="scan-cone"/);
  assert.match(frontend, /class="foreground-arc/);
});

test("business modes and audio levels drive the visual controller", () => {
  assert.match(frontend, /createCyberStage\(/);
  assert.match(frontend, /visualStage\.setMode\(mode\)/);
  assert.match(
    frontend,
    /visualStage\.setAudioLevels\(\{\s*mic:\s*micLevel,\s*speaker:\s*speakerLevel,\s*\}\)/,
  );
  assert.doesNotMatch(frontend, /function drawWave\(/);
});

test("cyber stage styles provide perspective, state motion, and a reduced-motion fallback", () => {
  assert.match(styles, /\.depth-scene\s*\{/);
  assert.match(styles, /transform-style:\s*preserve-3d/);
  assert.match(styles, /transition:\s*transform 360ms ease/);
  assert.match(styles, /translateZ\(-120px\)/);
  assert.match(styles, /\.scan-cone\s*\{/);
  assert.match(styles, /\.foreground-arc/);
  for (const mode of [
    "booting",
    "ready",
    "voice-starting",
    "listening",
    "working",
    "speaking",
    "degraded",
    "stopped",
  ]) {
    assert.match(styles, new RegExp(`data-mode=["']?${mode}`));
  }
  assert.match(
    styles,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
  );
  assert.match(styles, /animation-duration:\s*1ms/);
  for (const selector of [
    ".orbit-alpha",
    ".orbit-beta",
    ".reticle.outer",
    ".reticle.inner",
    ".ring-one",
    ".ring-two",
    ".ring-three",
  ]) {
    const escaped = selector.replaceAll(".", "\\.");
    const rule = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    assert.match(
      rule?.[1] ?? "",
      /transform:/,
      `${selector} should retain its positioning when animations are disabled`,
    );
  }
  for (const selector of [".helmet-main", ".ambient-orbit", ".status i"]) {
    assert.match(
      styles,
      new RegExp(
        `\\.shell\\[data-mode=["']stopped["']\\]\\s+${selector.replaceAll(".", "\\.")}`,
      ),
      `stopped mode should pause ${selector}`,
    );
  }
});
