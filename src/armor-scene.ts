import { pointerMode, pointerPose, frontPose } from "./pointer-controls";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  Config,
  defaults,
  homePose,
  PartGroup,
  Pose,
  RuntimeState,
  initialRuntime,
} from "./domain";
import {
  clamp,
  random,
  impactTimes,
  impactProgress,
  smooth,
  duration,
} from "./entrance";
import { ArmorMotion } from "./armor-motion";
import { ArmorEffects } from "./armor-effects";
import { ArmorPresence } from "./armor-presence";
import { ArmorBloom } from "./armor-bloom";
type Part = {
  name: string;
  mesh: THREE.Mesh;
  pivot: THREE.Group;
  home: THREE.Vector3;
  offset: THREE.Vector3;
  tilt: THREE.Euler;
  group: PartGroup;
  baseGroup: PartGroup;
  index: number;
};
export interface ModelStats {
  meshes: number;
  triangles: number;
  vertices: number;
}
interface Hooks {
  ready?: (stats: ModelStats) => void;
  error?: (message: string) => void;
  progress?: (value: number) => void;
  pose?: (pose: Pose) => void;
  picked?: (name: string, group: PartGroup) => void;
  finished?: () => void;
  dragging?: (value: boolean) => void;
  bounds?: (value: number[] | null) => void;
}
export class ArmorScene {
  config: Config = structuredClone(defaults);
  runtime: RuntimeState = initialRuntime();
  pose: Pose = { ...homePose };
  target: Pose = { ...homePose };
  parts: Part[] = [];
  ready = false;
  active = true;
  desktop = false;
  mouse = true;
  stats: ModelStats | null = null;
  fps = 0;
  phase = "";
  private renderer: THREE.WebGLRenderer;
  private bloom: ArmorBloom;
  private presence = new ArmorPresence();
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private modelHeight = 1;
  private modelSize = new THREE.Vector3(1, 1, 1);
  private motion: ArmorMotion | null = null;
  private motionEffects: ArmorEffects;
  private shaders: { shader: any; part: Part }[] = [];
  private env: THREE.WebGLRenderTarget;
  private raf = 0;
  private lastFrame = 0;
  private lastPose = 0;
  private gestureUntil = 0;
  private mouseUntil = 0;
  private zoom = 1;
  get gestureBlocked() {
    return !!this.drag || performance.now() < this.mouseUntil;
  }
  private measure = performance.now();
  private frames = 0;
  private loading = 0;
  private currentURL = "";
  private width = 1;
  private height = 1;
  private entrance: {
    time: number;
    mode: string;
    seed: number;
    impacts: Set<number>;
  } | null = null;
  private scrubTime: number | null = null;
  private pendingEntrance: Config["entrance"]["mode"] | null = null;
  private audio: AudioContext | null = null;
  private observer: ResizeObserver;
  private effects: HTMLCanvasElement;
  private fx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private drag: {
    x: number;
    y: number;
    mode: "move" | "rotate";
    pose: Pose;
    moved: boolean;
  } | null = null;
  constructor(
    private host: HTMLElement,
    private hooks: Hooks = {},
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "armor-canvas";
    this.canvas.setAttribute("aria-label", "可旋转的真实 3D 纳米装甲");
    this.host.append(this.canvas);
    this.effects = document.createElement("canvas");
    this.effects.className = "effects-canvas";
    this.host.append(this.effects);
    this.fx = this.effects.getContext("2d")!;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.bloom = new ArmorBloom(this.renderer);
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 50000);
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.env = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.8;
    room.dispose();
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xe4efff, 3.4);
    key.position.set(-300, 500, 800);
    const rim = new THREE.DirectionalLight(0x70bfff, 2.6);
    rim.position.set(500, 200, -300);
    const fill = new THREE.DirectionalLight(0xffd5b0, 0.8);
    fill.position.set(-500, 0, -200);
    this.scene.add(key, rim, fill, this.root);
    this.motionEffects = new ArmorEffects(this.scene);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("pointerdown", (e) => {
      const mode = pointerMode(e.button, e.shiftKey);
      if (!this.mouse || this.entrance || !mode) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        mode,
        pose: { ...this.target },
        moved: false,
      };
      this.hooks.dragging?.(true);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      this.drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
      this.setPose(
        pointerPose(
          this.drag.pose,
          this.drag.mode,
          dx,
          dy,
          this.width,
          this.height,
        ),
      );
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (this.drag && !this.drag.moved && !this.desktop) {
        const r = this.canvas.getBoundingClientRect(),
          ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            (-(e.clientY - r.top) / r.height) * 2 + 1,
          ),
          this.camera,
        );
        const hit = ray.intersectObjects(
          this.parts.map((p) => p.mesh),
          false,
        )[0];
        const p = this.parts.find((p) => p.mesh === hit?.object);
        if (p) this.hooks.picked?.(p.name, p.group);
      }
      if (this.drag) this.mouseUntil = performance.now() + 450;
      this.drag = null;
      this.hooks.dragging?.(false);
    });
    this.canvas.addEventListener("lostpointercapture", () => {
      if (this.drag) this.mouseUntil = performance.now() + 450;
      this.drag = null;
      this.hooks.dragging?.(false);
    });
    this.canvas.addEventListener("dblclick", () => {
      if (!this.mouse || this.entrance) return;
      this.mouseUntil = performance.now() + 450;
      this.setPose(frontPose());
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.mouse || this.entrance) return;
        e.preventDefault();
        this.mouseUntil = performance.now() + 450;
        this.zoom =
          clamp(
            this.config.appearance.height * this.zoom - e.deltaY * 0.12,
            180,
            650,
          ) / this.config.appearance.height;
      },
      { passive: false },
    );
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.hooks.error?.("图形上下文丢失，请重新打开机甲。会话仍在运行。");
    });
    this.resize();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }
  moveTo(host: HTMLElement) {
    this.host = host;
    host.append(this.canvas, this.effects);
    this.observer.disconnect();
    this.observer.observe(host);
    this.resize();
  }
  private resize() {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, this.config.appearance.pixelRatio),
    );
    this.renderer.setSize(this.width, this.height, false);
    this.bloom.resize(this.width, this.height, this.renderer.getPixelRatio());
    this.camera.aspect = this.width / this.height;
    // The z = 0 plane uses CSS-pixel world units; changing z gives real parallax.
    this.camera.position.z =
      this.height /
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const dpr = Math.min(devicePixelRatio, 2);
    this.effects.width = Math.round(this.width * dpr);
    this.effects.height = Math.round(this.height * dpr);
    this.fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setConfig(config: Config) {
    if (config.appearance.height !== this.config.appearance.height)
      this.zoom = 1;
    this.config = structuredClone(config);
    for (const p of this.parts)
      p.group = config.appearance.groups[p.name] ?? p.baseGroup;
    this.resize();
  }
  setPose(patch: Partial<Pose>, gesture = false) {
    if (gesture) this.gestureUntil = performance.now() + 180;
    Object.assign(this.target, patch);
    this.hooks.pose?.({ ...this.target });
  }
  get playing() {
    return !!this.entrance || !!this.pendingEntrance;
  }
  get playbackTime() {
    return this.entrance
      ? clamp(
          this.scrubTime ?? performance.now() - this.entrance.time,
          0,
          duration,
        )
      : duration;
  }
  resume() {
    if (!this.entrance || this.scrubTime === null) return;
    this.entrance.time = performance.now() - this.scrubTime;
    this.scrubTime = null;
    this.resumeAudio();
  }
  async load(url: string) {
    if (url === this.currentURL && this.ready) return;
    const generation = ++this.loading;
    this.hooks.progress?.(0);
    const gltf = await new GLTFLoader().loadAsync(url, (e) => {
      if (e.total) this.hooks.progress?.(e.loaded / e.total);
    });
    if (generation !== this.loading) {
      this.disposeObject(gltf.scene);
      return;
    }
    gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene),
      center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) {
      this.disposeObject(gltf.scene);
      throw new Error("模型没有可用的几何边界");
    }
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    if (!meshes.length) throw new Error("模型没有网格");
    const parts: Part[] = [];
    let triangles = 0,
      vertices = 0;
    this.shaders = [];
    for (const [i, source] of meshes.entries()) {
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      const pivotCenter = geometry.boundingBox!.getCenter(new THREE.Vector3());
      geometry.translate(-pivotCenter.x, -pivotCenter.y, -pivotCenter.z);
      triangles +=
        (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      vertices += geometry.attributes.position.count;
      const mesh = new THREE.Mesh(
          geometry,
          Array.isArray(source.material)
            ? source.material.map((m) => m.clone())
            : source.material.clone(),
        ),
        pivot = new THREE.Group();
      const home = pivotCenter.clone().sub(center);
      pivot.position.copy(home);
      pivot.add(mesh);
      const y = home.y / size.y,
        x = Math.abs(home.x) / size.y;
      const role: PartGroup =
        y > 0.2
          ? "forehead"
          : y < -0.22
            ? "jaw"
            : x > 0.22
              ? "temples"
              : y > -0.08
                ? "eyes"
                : "shell";
      const direction = home.clone().normalize();
      if (!direction.lengthSq()) direction.set(0, 1, 0);
      const part: Part = {
        name: source.name || `part_${i}`,
        mesh,
        pivot,
        home,
        offset: direction.multiplyScalar(size.y * (0.3 + random(i) * 0.22)),
        tilt: new THREE.Euler(
          (random(i + 1) - 0.5) * 0.8,
          (random(i + 2) - 0.5) * 0.8,
          (random(i + 3) - 0.5) * 0.6,
        ),
        group: role,
        baseGroup: role,
        index: i,
      };
      part.group = this.config.appearance.groups[part.name] ?? role;
      parts.push(part);
      for (const original of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        const mat = original as THREE.MeshStandardMaterial;
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.armorLight = { value: 0 };
          shader.uniforms.armorRim = { value: 0 };
          shader.uniforms.armorWork = { value: 0 };
          shader.uniforms.armorScan = { value: 0 };
          shader.uniforms.armorHome = { value: home.clone() };
          shader.uniforms.armorHeight = { value: size.y };
          shader.uniforms.armorColor = {
            value: new THREE.Color(this.config.appearance.accent),
          };
          shader.vertexShader =
            "uniform vec3 armorHome; uniform float armorHeight; varying vec3 vArmorPosition;\n" +
            shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvArmorPosition=(position+armorHome)/armorHeight;",
          );
          shader.fragmentShader =
            "uniform float armorLight; uniform float armorRim; uniform float armorWork; uniform float armorScan; uniform vec3 armorColor; varying vec3 vArmorPosition;\n" +
            shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
            float mask=smoothstep(.02,.20,diffuseColor.b-diffuseColor.r)*smoothstep(.06,.30,diffuseColor.g);
            float rim=pow(1.-max(0.,dot(normal,normalize(vViewPosition))),3.5);
            float region=max(smoothstep(.04,.23,vArmorPosition.y),smoothstep(.18,.30,abs(vArmorPosition.x)));
            float scan=exp(-pow((vArmorPosition.y-armorScan)/.055,2.));
            totalEmissiveRadiance+=armorColor*(mask*armorLight+rim*armorRim+scan*armorWork*region*(mask*4.5+rim*1.6+.10));`,
          );
          this.shaders.push({ shader, part });
        };
        mat.customProgramCacheKey = () => "jarvis-next-regional-light-v2";
      }
    }
    this.clearModel();
    this.parts = parts;
    this.modelHeight = size.y;
    this.modelSize.copy(size);
    for (const p of parts) this.root.add(p.pivot);
    this.motion = new ArmorMotion(this.scene, this.root, parts, size.y);
    this.currentURL = url;
    this.ready = true;
    this.stats = { meshes: parts.length, triangles, vertices };
    this.hooks.ready?.(this.stats);
    this.hooks.progress?.(1);
    if (this.pendingEntrance) {
      const mode = this.pendingEntrance;
      this.pendingEntrance = null;
      this.play(mode);
    }
  }
  private disposeObject(object: THREE.Object3D) {
    const materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const material of Array.isArray(m.material)
        ? m.material
        : [m.material]) {
        materials.add(material);
        for (const v of Object.values(material))
          if (v instanceof THREE.Texture) textures.add(v);
      }
    });
    for (const t of textures) t.dispose();
    for (const m of materials) m.dispose();
  }
  private clearModel() {
    this.motion = null;
    this.motionEffects.clear();
    for (const p of this.parts) p.pivot.removeFromParent();
    for (const p of this.parts) this.disposeObject(p.pivot);
    this.parts = [];
  }
  seek(time: number) {
    if (!this.ready) return;
    if (!this.entrance || this.entrance.mode !== "full") {
      this.resetParts();
      this.pose = { ...homePose };
      this.target = { ...homePose };
      this.entrance = {
        time: performance.now(),
        mode: "full",
        seed: 7,
        impacts: new Set(),
      };
      this.motion?.reset(7);
    }
    this.scrubTime = clamp(time, 0, duration);
    this.active = true;
  }
  get contactTimes(): readonly number[] {
    return this.motion?.contactTimes ?? impactTimes;
  }
  play(mode: Config["entrance"]["mode"] = this.config.entrance.mode) {
    this.scrubTime = null;
    if (!this.ready) {
      this.pendingEntrance = mode;
      return;
    }
    if (this.config.system.reduceMotion) mode = "off";
    if (this.parts.length < 2 && mode === "full") mode = "quick";
    this.resetParts();
    this.motionEffects.clear();
    if (mode === "full") this.target = { ...homePose };
    this.pose = { ...this.target };
    this.entrance = {
      time: performance.now(),
      mode,
      seed: Math.random() * 10000,
      impacts: new Set(),
    };
    this.motion?.reset(this.entrance.seed);
    this.active = true;
    this.phase = "出场";
    this.resumeAudio();
  }
  private resumeAudio() {
    if (this.config.entrance.sound > 0) {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    }
  }
  skip() {
    this.scrubTime = null;
    this.entrance = null;
    this.pendingEntrance = null;
    this.target.spread = 0;
    this.pose = { ...this.target };
    this.resetParts();
    this.fx.clearRect(0, 0, this.width, this.height);
    this.motionEffects.clear();
    this.canvas.style.opacity = "1";
    this.phase = "";
    this.hooks.finished?.();
  }
  stop() {
    this.target = { ...homePose };
    this.skip();
  }
  private resetParts() {
    this.motion?.reset();
    for (const p of this.parts) {
      if (p.pivot.parent !== this.root) this.root.add(p.pivot);
      p.pivot.position.copy(p.home);
      p.pivot.rotation.set(0, 0, 0);
      p.pivot.scale.setScalar(1);
    }
  }
  private impact(strength: number) {
    if (
      !this.audio ||
      this.audio.state !== "running" ||
      !this.config.entrance.sound
    )
      return;
    const c = this.audio;
    const time = c.currentTime;
    const quiet =
      Math.max(this.runtime.inputLevel, this.runtime.outputLevel) > 0.03
        ? 0.12
        : 1;
    const volume = this.config.entrance.sound * strength * quiet;
    const bus = c.createGain();
    bus.gain.value = volume;
    bus.connect(c.destination);
    const thud = c.createOscillator();
    const low = c.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(105 + strength * 12, time);
    thud.frequency.exponentialRampToValueAtTime(32, time + 0.14);
    low.gain.setValueAtTime(0.6, time);
    low.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    thud.connect(low).connect(bus);
    thud.start(time);
    thud.stop(time + 0.24);
    const buffer = c.createBuffer(
      1,
      Math.ceil(c.sampleRate * 0.16),
      c.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const crack = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const high = c.createGain();
    crack.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.value = 1800;
    high.gain.setValueAtTime(0.24, time);
    high.gain.exponentialRampToValueAtTime(0.001, time + 0.105);
    crack.connect(filter).connect(high).connect(bus);
    crack.start(time);
    thud.onended = () => {
      thud.disconnect();
      low.disconnect();
      crack.disconnect();
      filter.disconnect();
      high.disconnect();
      bus.disconnect();
    };
  }
  private tick(now: number) {
    this.raf = requestAnimationFrame(this.tick);
    if (
      !this.active ||
      !this.ready ||
      this.host.clientWidth < 2 ||
      this.host.clientHeight < 2
    )
      return;
    const live =
      now < this.gestureUntil ||
      this.entrance ||
      this.drag ||
      this.runtime.mode === "working" ||
      this.runtime.inputLevel > 0.02 ||
      this.runtime.outputLevel > 0.02 ||
      Math.abs(this.pose.spread - this.target.spread) > 0.002;
    if (now - this.lastFrame < (live ? 15 : 32)) return;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    for (const k of ["x", "y", "yaw", "pitch", "roll", "spread"] as const)
      this.pose[k] +=
        (this.target[k] - this.pose[k]) *
        (1 - Math.exp(-(now < this.gestureUntil ? 28 : 12) * dt));
    const h = Math.min(
      this.config.appearance.height * this.zoom,
      this.height * (this.desktop ? 0.45 : 0.72),
    );
    const modelScale = h / this.modelHeight;
    const presence = this.presence.sample(
      now,
      dt,
      this.runtime,
      this.config.system.reduceMotion,
      !!this.entrance || !!this.drag || now < this.gestureUntil,
    );
    const x = this.pose.x;
    const y = this.pose.y;
    this.root.scale.setScalar(modelScale * presence.scale);
    this.root.position.set(
      (x - 0.5) * this.width,
      (0.5 - y) * this.height + (this.entrance ? 0 : h * presence.lift),
      0,
    );
    this.root.rotation.set(
      this.pose.pitch + presence.pitch,
      this.pose.yaw,
      this.pose.roll,
    );
    if (this.entrance) {
      const time = this.scrubTime ?? now - this.entrance.time;
      const { mode } = this.entrance;
      if (mode === "full" && this.motion) {
        const sample = this.motion.update(time, {
          width: this.width,
          height: this.height,
          cameraDistance: this.camera.position.z,
          modelScale,
          modelSize: this.modelSize,
          yaw: this.pose.yaw,
          pitch: this.pose.pitch,
          roll: this.pose.roll,
        });
        this.phase = sample.phase;
        this.motionEffects.draw(
          time,
          this.motion.impacts,
          this.camera,
          this.fx,
          this.width,
          this.height,
          this.config.entrance.intensity,
          this.config.appearance.accent,
          this.renderer.getPixelRatio(),
        );
        for (const event of this.motion.impacts) {
          if (
            this.scrubTime === null &&
            !this.entrance.impacts.has(event.index)
          ) {
            this.entrance.impacts.add(event.index);
            if (time - event.time < 65)
              this.impact(0.65 + impactProgress(event.index) * 0.85);
          }
        }
        this.canvas.style.opacity = String(clamp(time / 140));
        if (sample.done && this.scrubTime === null) {
          this.entrance = null;
          this.resetParts();
          this.motionEffects.clear();
          this.fx.clearRect(0, 0, this.width, this.height);
          this.hooks.finished?.();
        }
      } else {
        const length = mode === "off" ? 150 : 900;
        const progress = clamp(time / length);
        const spread =
          mode === "off" ? this.pose.spread : (1 - smooth(progress)) * 1.15;
        this.canvas.style.opacity = String(progress);
        this.applySpread(spread);
        this.motionEffects.clear();
        this.fx.clearRect(0, 0, this.width, this.height);
        if (progress === 1 && this.scrubTime === null) {
          this.entrance = null;
          this.target.spread = 0;
          this.pose.spread = 0;
          this.hooks.finished?.();
        }
      }
    } else {
      this.applySpread(this.pose.spread);
      this.canvas.style.opacity = "1";
      this.motionEffects.clear();
      this.fx.clearRect(0, 0, this.width, this.height);
    }
    const color = new THREE.Color(
      presence.attention ? "#ffc170" : this.config.appearance.accent,
    );
    for (const { shader, part } of this.shaders) {
      let light = presence.light(part.group);
      if (this.entrance?.mode === "full")
        light = Math.max(light, 0.28) + (this.motion?.light(part) ?? 0);
      shader.uniforms.armorLight.value = light * this.config.appearance.glow;
      shader.uniforms.armorColor.value.copy(color);
      shader.uniforms.armorRim.value =
        presence.rim * this.config.appearance.glow;
      shader.uniforms.armorWork.value =
        presence.work * this.config.appearance.glow;
      shader.uniforms.armorScan.value = presence.scan;
    }
    this.bloom.render(
      this.scene,
      this.camera,
      presence.halo * this.config.appearance.glow,
    );
    this.frames++;
    if (now - this.measure > 1000) {
      this.fps = (this.frames * 1000) / (now - this.measure);
      this.frames = 0;
      this.measure = now;
    }
    if (now - this.lastPose > 180) {
      this.hooks.pose?.({ ...this.target });
      if (this.hooks.bounds) {
        if (this.entrance) this.hooks.bounds(null);
        else {
          const box = new THREE.Box3().setFromObject(this.root);
          const corners = [];
          for (const x of [box.min.x, box.max.x])
            for (const y of [box.min.y, box.max.y])
              for (const z of [box.min.z, box.max.z])
                corners.push(new THREE.Vector3(x, y, z).project(this.camera));
          this.hooks.bounds([
            (Math.min(...corners.map((p) => p.x)) + 1) / 2 - 8 / this.width,
            (1 - Math.max(...corners.map((p) => p.y))) / 2 - 8 / this.height,
            (Math.max(...corners.map((p) => p.x)) + 1) / 2 + 8 / this.width,
            (1 - Math.min(...corners.map((p) => p.y))) / 2 + 8 / this.height,
          ]);
        }
      }
      this.lastPose = now;
    }
  }
  private applySpread(spread: number) {
    for (const p of this.parts) {
      p.pivot.position.copy(p.home).addScaledVector(p.offset, spread);
      p.pivot.rotation.set(
        p.tilt.x * spread,
        p.tilt.y * spread,
        p.tilt.z * spread,
      );
    }
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.clearModel();
    this.motionEffects.dispose();
    this.env.dispose();
    this.bloom.dispose();
    this.renderer.dispose();
    void this.audio?.close();
    this.canvas.remove();
    this.effects.remove();
  }
}
