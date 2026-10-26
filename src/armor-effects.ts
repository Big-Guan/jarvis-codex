import * as THREE from "three";
import { ArmorImpact } from "./armor-motion";
import {
  assembledTime,
  clamp,
  random,
  impactProgress,
  impactCount,
} from "./entrance";

const MAX_SPARKS = 720;

// Sparks live in the same 3D space as the armour: perspective and mesh occlusion
// apply to them too. The canvas layer only adds the brief pressure at contact.
export class ArmorEffects {
  private pointsGeometry = new THREE.BufferGeometry();
  private linesGeometry = new THREE.BufferGeometry();
  private positions = new Float32Array(MAX_SPARKS * 3);
  private colors = new Float32Array(MAX_SPARKS * 3);
  private sizes = new Float32Array(MAX_SPARKS);
  private alphas = new Float32Array(MAX_SPARKS);
  private linePositions = new Float32Array(MAX_SPARKS * 6);
  private lineColors = new Float32Array(MAX_SPARKS * 6);
  private pointMaterial: THREE.ShaderMaterial;
  private lineMaterial: THREE.LineBasicMaterial;
  private points: THREE.Points;
  private streaks: THREE.LineSegments;
  private projected = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    this.pointsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.pointsGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(this.colors, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.pointsGeometry.setAttribute(
      "aSize",
      new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.pointsGeometry.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(this.alphas, 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.linesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.linePositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.linesGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(this.lineColors, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: { cameraDistance: { value: 1000 }, pixelRatio: { value: 1 } },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: [
        "attribute float aSize;",
        "attribute float aAlpha;",
        "uniform float cameraDistance;",
        "uniform float pixelRatio;",
        "varying vec3 sparkColor;",
        "varying float sparkAlpha;",
        "void main() {",
        "  vec4 p = modelViewMatrix * vec4(position, 1.0);",
        "  gl_Position = projectionMatrix * p;",
        "  gl_PointSize = clamp(aSize * pixelRatio * cameraDistance / max(1.0, -p.z), 0.7, 15.0);",
        "  sparkColor = color; sparkAlpha = aAlpha;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "varying vec3 sparkColor;",
        "varying float sparkAlpha;",
        "void main() {",
        "  float radius = length(gl_PointCoord - 0.5) * 2.0;",
        "  float glow = pow(max(0.0, 1.0 - radius), 1.7);",
        "  gl_FragColor = vec4(sparkColor, glow * sparkAlpha);",
        "}",
      ].join("\n"),
    });
    this.lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.pointsGeometry, this.pointMaterial);
    this.streaks = new THREE.LineSegments(
      this.linesGeometry,
      this.lineMaterial,
    );
    this.points.frustumCulled = this.streaks.frustumCulled = false;
    this.points.renderOrder = this.streaks.renderOrder = 2;
    scene.add(this.points, this.streaks);
    this.clear();
  }

  clear() {
    this.pointsGeometry.setDrawRange(0, 0);
    this.linesGeometry.setDrawRange(0, 0);
  }

  draw(
    time: number,
    impacts: ArmorImpact[],
    camera: THREE.PerspectiveCamera,
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    intensity: number,
    accent: string,
    pixelRatio: number,
  ) {
    ctx.clearRect(0, 0, width, height);
    this.clear();
    if (intensity <= 0) return;
    this.pointMaterial.uniforms.cameraDistance.value = camera.position.z;
    this.pointMaterial.uniforms.pixelRatio.value = pixelRatio;
    let count = 0;
    // Give the newest contact priority when bursts overlap at high speed.
    for (
      let impactIndex = impacts.length - 1;
      impactIndex >= 0;
      impactIndex--
    ) {
      const impact = impacts[impactIndex];
      const t = (time - impact.time) / 1000;
      const final = impact.index === impactCount - 1;
      if (t < 0 || t > (final ? 0.8 : 0.36)) continue;
      const number = final
        ? 180
        : Math.round(30 + impactProgress(impact.index) * 26);
      const tangentX = -impact.normal.y,
        tangentY = impact.normal.x;
      for (let j = 0; j < number && count < MAX_SPARKS; j++) {
        const n = impact.index * 479 + j * 7;
        const life = final
          ? 0.24 + random(n + 1) * 0.5
          : 0.11 + random(n + 1) * 0.23;
        if (t > life) continue;
        const angle = (random(n + 2) - 0.5) * 2.7;
        const speed =
          (120 + random(n + 3) * 620) *
          impact.depthFactor *
          (final ? 1.35 : 1.05);
        const vx =
          (impact.normal.x * Math.cos(angle) + tangentX * Math.sin(angle)) *
          speed;
        const vy =
          (impact.normal.y * Math.cos(angle) + tangentY * Math.sin(angle)) *
          speed;
        const vz = (random(n + 4) - 0.45) * speed * 0.5;
        const drag = 1.8;
        const travel = (1 - Math.exp(-drag * t)) / drag;
        const gravity = height * 0.62 * impact.depthFactor;
        const x = impact.position.x + vx * travel;
        const y = impact.position.y + vy * travel - 0.5 * gravity * t * t;
        const z = impact.position.z + vz * travel;
        const remaining = clamp(1 - t / life);
        const alpha = remaining * remaining * intensity;
        const cold = j % 9 === 0;
        const r = cold ? 0.42 : 1;
        const g = cold ? 0.82 : 0.48 + remaining * 0.5;
        const b = cold ? 1 : 0.17 + remaining * 0.7;
        this.positions.set([x, y, z], count * 3);
        this.colors.set([r, g, b], count * 3);
        this.sizes[count] = (1.5 + random(n + 5) * 2.7) * impact.depthFactor;
        this.alphas[count] = alpha;
        // Individual hot flecks leave only millisecond streaks, never a beam.
        const trail = 0.005 + random(n + 6) * 0.009;
        const damping = Math.exp(-drag * t);
        this.linePositions.set(
          [
            x - vx * damping * trail,
            y - (vy * damping - gravity * t) * trail,
            z - vz * damping * trail,
            x,
            y,
            z,
          ],
          count * 6,
        );
        this.lineColors.set(
          [
            r * alpha * 0.05,
            g * alpha * 0.05,
            b * alpha * 0.05,
            r * alpha * 0.9,
            g * alpha * 0.9,
            b * alpha * 0.9,
          ],
          count * 6,
        );
        count++;
      }
      this.pressure(impact, t, camera, ctx, width, height, intensity, accent);
    }
    for (const attr of Object.values(this.pointsGeometry.attributes))
      attr.needsUpdate = true;
    for (const attr of Object.values(this.linesGeometry.attributes))
      attr.needsUpdate = true;
    this.pointsGeometry.setDrawRange(0, count);
    this.linesGeometry.setDrawRange(0, count * 2);
    const lockAge = time - assembledTime;
    if (lockAge > -120 && lockAge < 170) {
      const alpha =
        Math.max(0, 1 - Math.abs(lockAge - 15) / 145) * 0.05 * intensity;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha;
      const glow = ctx.createRadialGradient(
        width / 2,
        height / 2,
        6,
        width / 2,
        height / 2,
        110,
      );
      glow.addColorStop(0, accent);
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.fillRect(width / 2 - 110, height / 2 - 110, 220, 220);
      ctx.restore();
    }
  }

  private pressure(
    impact: ArmorImpact,
    age: number,
    camera: THREE.PerspectiveCamera,
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    intensity: number,
    accent: string,
  ) {
    const final = impact.index === impactCount - 1;
    if (age > (final ? 0.34 : 0.14)) return;
    this.projected.copy(impact.position).project(camera);
    const x = (this.projected.x * 0.5 + 0.5) * w;
    const y = (-this.projected.y * 0.5 + 0.5) * h;
    const radius = 8 + Math.sqrt(age) * (final ? 230 : 125);
    const strength = Math.exp(-age * (final ? 14 : 28)) * intensity;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(-impact.normal.y, impact.normal.x));
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = strength * 0.24;
    // A flattened pressure fan pressed against the surface, not a HUD ring.
    ctx.scale(0.62, 1);
    const pressure = ctx.createRadialGradient(0, 0, 1, 0, 0, radius);
    pressure.addColorStop(0, "#e5eafa");
    pressure.addColorStop(0.15, "#a0bed2");
    pressure.addColorStop(0.65, "#495e72");
    pressure.addColorStop(1, "transparent");
    ctx.fillStyle = pressure;
    ctx.beginPath();
    ctx.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = strength * 0.38;
    ctx.strokeStyle = age < 0.055 ? "#fff1d9" : accent;
    ctx.lineWidth = age < 0.055 ? 2.2 : 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.8, -1.12, 1.12);
    ctx.stroke();
    ctx.restore();
  }

  dispose() {
    this.scene.remove(this.points, this.streaks);
    this.pointsGeometry.dispose();
    this.linesGeometry.dispose();
    this.pointMaterial.dispose();
    this.lineMaterial.dispose();
  }
}
