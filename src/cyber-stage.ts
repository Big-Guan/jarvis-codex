import { clampLevel, smoothValue } from "./cyber-math.mjs";

export type VisualMode =
  | "booting"
  | "ready"
  | "voice-starting"
  | "listening"
  | "working"
  | "speaking"
  | "degraded"
  | "stopped";

export type AudioLevels = {
  mic: number;
  speaker: number;
};

export type CyberStageOptions = {
  root: HTMLElement;
  scene: HTMLElement;
  waveCanvas: HTMLCanvasElement;
  fxCanvas: HTMLCanvasElement;
};

export interface CyberStageController {
  setMode(mode: VisualMode): void;
  setAudioLevels(levels: AudioLevels): void;
  destroy(): void;
}

type CanvasSize = {
  width: number;
  height: number;
};

type Particle = {
  angle: number;
  radius: number;
  z: number;
  speed: number;
  phase: number;
};

const MODE_ACCENTS: Record<VisualMode, string> = {
  booting: "#20c7ff",
  ready: "#20c7ff",
  "voice-starting": "#63dcff",
  listening: "#20c7ff",
  working: "#ff9b2f",
  speaking: "#7de8ff",
  degraded: "#ffb24d",
  stopped: "#ff493e",
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function fitCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): CanvasSize {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const renderWidth = Math.round(width * pixelRatio);
  const renderHeight = Math.round(height * pixelRatio);
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width, height };
}

export function createCyberStage({
  root,
  scene,
  waveCanvas,
  fxCanvas,
}: CyberStageOptions): CyberStageController {
  const waveContext = waveCanvas.getContext("2d");
  const fxContext = fxCanvas.getContext("2d");
  if (!waveContext || !fxContext) {
    throw new Error("Cyber stage requires two 2D canvas contexts");
  }

  let currentMode: VisualMode = "booting";
  let targetMic = 0;
  let targetSpeaker = 0;
  let mic = 0;
  let speaker = 0;
  let targetPointerX = 0;
  let targetPointerY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let frame = 0;
  let previousTime = performance.now();
  let destroyed = false;
  let waveSize: CanvasSize = { width: 1, height: 1 };
  let fxSize: CanvasSize = { width: 1, height: 1 };
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = reducedMotionQuery.matches;

  const random = seededRandom(0x4a415256);
  const particles: Particle[] = Array.from({ length: 76 }, () => ({
    angle: random() * Math.PI * 2,
    radius: 0.16 + random() * 0.7,
    z: random(),
    speed: 0.035 + random() * 0.085,
    phase: random() * Math.PI * 2,
  }));

  const resize = () => {
    waveSize = fitCanvas(waveCanvas, waveContext);
    fxSize = fitCanvas(fxCanvas, fxContext);
    if (reducedMotion || currentMode === "stopped") start();
  };

  const drawWave = (time: number) => {
    const { width, height } = waveSize;
    waveContext.clearRect(0, 0, width, height);
    const accent = MODE_ACCENTS[currentMode];
    const voiceEnergy =
      currentMode === "speaking"
        ? Math.max(0.12, speaker)
        : Math.max(mic, speaker * 0.52);
    const idleEnergy = currentMode === "ready" ? 0.025 : 0.045;
    const amplitude = 5 + (voiceEnergy + idleEnergy) * height * 0.35;
    const centerY = height / 2;

    for (let pass = 0; pass < 2; pass += 1) {
      waveContext.beginPath();
      for (let x = 0; x <= width; x += 3) {
        const envelope = Math.sin((x / width) * Math.PI);
        const direction = pass === 0 ? 1 : -1;
        const wave =
          Math.sin(x * 0.078 + time * 0.0042 * direction) +
          Math.sin(x * 0.026 - time * 0.0024 * direction) * 0.55;
        const y = centerY + wave * amplitude * envelope * (pass ? 0.28 : 0.52);
        if (x === 0) waveContext.moveTo(x, y);
        else waveContext.lineTo(x, y);
      }
      waveContext.globalAlpha = pass === 0 ? 0.95 : 0.34;
      waveContext.strokeStyle = accent;
      waveContext.shadowColor = accent;
      waveContext.shadowBlur = pass === 0 ? 18 : 8;
      waveContext.lineWidth = pass === 0 ? 1.8 : 1;
      waveContext.stroke();
    }
    waveContext.globalAlpha = 1;
    waveContext.shadowBlur = 0;
  };

  const drawParticles = (deltaSeconds: number, time: number) => {
    const { width, height } = fxSize;
    fxContext.clearRect(0, 0, width, height);
    if (reducedMotion) return;

    const accent = MODE_ACCENTS[currentMode];
    const speedMultiplier =
      currentMode === "working"
        ? 2.25
        : currentMode === "voice-starting"
          ? 1.65
          : currentMode === "stopped" || currentMode === "degraded"
            ? 0.16
            : 0.72;
    const centerX = width * 0.5;
    const centerY = height * 0.47;

    fxContext.fillStyle = accent;
    for (const particle of particles) {
      particle.z += particle.speed * deltaSeconds * speedMultiplier;
      if (particle.z > 1) {
        particle.z -= 1;
        particle.angle += 0.45;
      }
      const depth = 0.22 + particle.z * 1.18;
      const orbit =
        Math.sin(time * 0.00018 + particle.phase) * 0.025 +
        particle.radius * depth;
      const x =
        centerX +
        Math.cos(particle.angle) * orbit * width * 0.56 +
        pointerX * particle.z * width * 0.018;
      const y =
        centerY +
        Math.sin(particle.angle) * orbit * height * 0.54 +
        pointerY * particle.z * height * 0.015;
      const size = 0.45 + particle.z * 1.8;
      fxContext.globalAlpha = 0.08 + particle.z * 0.48;
      fxContext.fillRect(x, y, size * 1.7, size * 0.62);
    }

    if (currentMode === "speaking" && speaker > 0.025) {
      const limit = Math.min(width, height) * 0.43;
      for (let index = 0; index < 3; index += 1) {
        const progress = (time * 0.00045 + index / 3) % 1;
        fxContext.beginPath();
        fxContext.arc(centerX, centerY, 38 + progress * limit, 0, Math.PI * 2);
        fxContext.globalAlpha = (1 - progress) * speaker * 0.5;
        fxContext.strokeStyle = accent;
        fxContext.lineWidth = 1.2;
        fxContext.stroke();
      }
    }
    fxContext.globalAlpha = 1;
  };

  const tick = (time: number) => {
    if (destroyed || document.hidden) return;
    const staticFrame = reducedMotion || currentMode === "stopped";
    const deltaSeconds = Math.min(0.05, Math.max(0, (time - previousTime) / 1000));
    previousTime = time;
    const pointerFactor = reducedMotion ? 1 : 0.075;
    pointerX = smoothValue(pointerX, reducedMotion ? 0 : targetPointerX, pointerFactor);
    pointerY = smoothValue(pointerY, reducedMotion ? 0 : targetPointerY, pointerFactor);
    mic = staticFrame ? 0 : smoothValue(mic, targetMic, 0.16);
    speaker = staticFrame ? 0 : smoothValue(speaker, targetSpeaker, 0.14);

    root.style.setProperty("--tilt-x", `${pointerY * -2.5}deg`);
    root.style.setProperty("--tilt-y", `${pointerX * 4}deg`);
    root.style.setProperty("--mic-level", mic.toFixed(3));
    root.style.setProperty("--speaker-level", speaker.toFixed(3));
    drawWave(staticFrame ? 0 : time);
    drawParticles(staticFrame ? 0 : deltaSeconds, staticFrame ? 0 : time);
    if (staticFrame) {
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  const start = () => {
    if (destroyed || document.hidden || frame) return;
    previousTime = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (reducedMotion) return;
    const bounds = root.getBoundingClientRect();
    targetPointerX = clampLevel((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    targetPointerY = clampLevel((event.clientY - bounds.top) / bounds.height) * 2 - 1;
  };

  const onPointerLeave = () => {
    targetPointerX = 0;
    targetPointerY = 0;
  };

  const onVisibilityChange = () => {
    if (document.hidden) stop();
    else start();
  };

  const onReducedMotionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    root.classList.toggle("reduced-motion", reducedMotion);
    if (reducedMotion) onPointerLeave();
    stop();
    start();
  };

  root.addEventListener("pointermove", onPointerMove, { passive: true });
  root.addEventListener("pointerleave", onPointerLeave);
  document.addEventListener("visibilitychange", onVisibilityChange);
  reducedMotionQuery.addEventListener("change", onReducedMotionChange);
  root.classList.toggle("reduced-motion", reducedMotion);

  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  resizeObserver?.observe(scene);
  resize();
  start();

  return {
    setMode(mode: VisualMode) {
      currentMode = mode;
      scene.dataset.visualMode = mode;
      if (!frame) start();
    },
    setAudioLevels(levels: AudioLevels) {
      targetMic = clampLevel(levels.mic);
      targetSpeaker = clampLevel(levels.speaker);
    },
    destroy() {
      destroyed = true;
      stop();
      resizeObserver?.disconnect();
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
    },
  };
}
