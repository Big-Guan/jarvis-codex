import "./motion-preview.css";
import { ArmorScene } from "./armor-scene";
import { builtinSkin, defaults } from "./domain";
import {
  duration,
  impactCount,
  blastTime,
  floatTime,
  gatherTime,
} from "./entrance";

document.documentElement.classList.add("motion-preview");
document.title = "Jarvis · 出场动效";
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div id="motion-stage"></div>
  <header class="motion-heading">
    <span>J A R V I S <i>/</i> MOTION 06</span>
    <p>头顶领航 · 整体旋转 · ${impactCount} 次高速撞击</p>
  </header>
  <div id="motion-loading" role="status"><span>正在载入装甲</span><i><b></b></i></div>
  <div class="motion-controls" aria-label="出场播放控制" hidden>
    <div class="motion-actions">
      <button id="motion-replay" class="primary">重播</button>
      <button id="motion-pause">暂停</button>
      <span id="motion-phase" role="status">准备就绪</span>
      <button id="motion-clean" class="quiet">纯净观看</button>
    </div>
    <div class="motion-track">
      <span id="motion-time">0.00</span>
      <input id="motion-scrub" type="range" min="0" max="${duration}" value="0" step="5" aria-label="出场时间">
      <span>${(duration / 1000).toFixed(2)} s</span>
    </div>
    <div class="motion-beats" aria-label="跳转到动画阶段">
      <button data-time="180">逼近</button>
      <button data-impact="4">连撞</button>
      <button data-impact="12">脱甲</button>
      <button data-time="${blastTime + 200}">炸开</button>
      <button data-time="${floatTime + 150}">悬浮</button>
      <button data-time="${gatherTime + 450}">合拢</button>
    </div>
  </div>
  <span class="motion-key">空格 暂停 / 继续 · R 重播 · Esc 暂停并显示控制</span>
`;

const host = document.querySelector<HTMLElement>("#motion-stage")!;
const controls = document.querySelector<HTMLElement>(".motion-controls")!;
const loading = document.querySelector<HTMLElement>("#motion-loading")!;
const slider = document.querySelector<HTMLInputElement>("#motion-scrub")!;
const phase = document.querySelector<HTMLElement>("#motion-phase")!;
const counter = document.querySelector<HTMLElement>("#motion-time")!;
const pause = document.querySelector<HTMLButtonElement>("#motion-pause")!;
let paused = false;
let begun = false;
let raf = 0;
const stage = new ArmorScene(host, {
  progress(value) {
    loading.querySelector<HTMLElement>("b")!.style.width = value * 100 + "%";
  },
  ready() {
    loading.hidden = true;
    controls.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(replay));
  },
  finished() {
    paused = true;
    pause.textContent = "播放";
    phase.textContent = "就绪";
    document.documentElement.classList.remove("motion-playing");
  },
  error(message) {
    loading.hidden = false;
    loading.textContent = message;
  },
});
const config = structuredClone(defaults);
config.appearance.height = 400;
config.entrance.sound = 0;
stage.desktop = true;
stage.setConfig(config);
void stage.load(builtinSkin.path).catch((error: unknown) => {
  loading.textContent = "装甲载入失败：" + String(error);
});

function replay() {
  if (!stage.ready) return;
  begun = true;
  paused = false;
  pause.textContent = "暂停";
  stage.play("full");
  document.documentElement.classList.add("motion-playing");
}
function seek(time: number) {
  begun = true;
  paused = true;
  stage.seek(time);
  pause.textContent = "继续";
  document.documentElement.classList.remove("motion-playing");
}
function toggle() {
  if (!stage.ready) return;
  if (!begun || !stage.playing || stage.playbackTime >= duration) replay();
  else if (paused) {
    paused = false;
    stage.resume();
    pause.textContent = "暂停";
    document.documentElement.classList.add("motion-playing");
  } else seek(stage.playbackTime);
}
document.querySelector("#motion-replay")!.addEventListener("click", replay);
pause.addEventListener("click", toggle);
slider.addEventListener("input", () => seek(Number(slider.value)));
document.querySelector("#motion-clean")!.addEventListener("click", () => {
  document.documentElement.classList.add("motion-clean");
  replay();
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-time], [data-impact]",
)) {
  button.addEventListener("click", () => {
    const impact = button.dataset.impact;
    const time =
      impact === undefined
        ? Number(button.dataset.time)
        : stage.contactTimes[Number(impact)] + 20;
    seek(time);
  });
}
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault();
    toggle();
  }
  if (event.code === "KeyR") replay();
  if (event.code === "Escape") {
    document.documentElement.classList.remove("motion-clean");
    if (stage.playing && !paused) seek(stage.playbackTime);
  }
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
    event.preventDefault();
    seek(
      Math.max(
        0,
        Math.min(
          duration,
          stage.playbackTime + (event.code === "ArrowLeft" ? -100 : 100),
        ),
      ),
    );
  }
});
function update() {
  if (begun) {
    const time = stage.playbackTime;
    slider.value = String(time);
    counter.textContent = (time / 1000).toFixed(2);
    phase.textContent = stage.phase || "就绪";
  }
  raf = requestAnimationFrame(update);
}
update();
window.addEventListener(
  "pagehide",
  () => {
    cancelAnimationFrame(raf);
    stage.dispose();
  },
  { once: true },
);
