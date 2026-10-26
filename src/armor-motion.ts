import * as THREE from "three";
import { PartGroup } from "./domain";
import {
  blastTime,
  clamp,
  contactInset,
  createFlightPlan,
  duration,
  FlightPlan,
  gatherTime,
  impactCount,
  impactTimes,
  impactProgress,
  random,
  releasedFractions,
  sampleEntrance,
  sampleFlightRotation,
  smooth,
} from "./entrance";

export interface MotionPart {
  index: number;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  tilt: THREE.Euler;
  group: PartGroup;
}

export interface MotionLayout {
  width: number;
  height: number;
  cameraDistance: number;
  modelScale: number;
  modelSize: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface ArmorImpact {
  index: number;
  time: number;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  incoming: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  depthFactor: number;
}

interface Gather {
  start: number;
  duration: number;
  from: THREE.Vector3;
  control1: THREE.Vector3;
  control2: THREE.Vector3;
  to: THREE.Vector3;
  rotation: THREE.Quaternion;
}

interface Body {
  part: MotionPart;
  born: number;
  mass: number;
  radius: number;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  anchor: THREE.Vector3 | null;
  gatherAt: number;
  gather: Gather | null;
  lockedAt: number;
}

const STEP = 1000 / 120;
const CROWN_AXIS = new THREE.Vector3(0, 1, 0);
const SCREEN_AXIS = new THREE.Vector3(0, 0, 1);
const groupOrder: Record<PartGroup, number> = {
  jaw: 0,
  temples: 0.025,
  eyes: 0.045,
  shell: 0.065,
  forehead: 0.1,
};

// The render meshes are unmodified. Small collision proxies keep the physics
// independent of the 1.9 M triangle source asset.
export class ArmorMotion {
  readonly impacts: ArmorImpact[] = [];
  private seed = 0;
  private simulated = 0;
  private time = 0;
  private nextImpact = 0;
  private layoutKey = "";
  private plan: FlightPlan | null = null;
  private bodies: Body[] = [];
  private bodyByPart = new Map<number, Body>();
  private ranked: MotionPart[] = [];
  private masses = new Map<number, number>();
  private radii = new Map<number, number>();
  private gatherScheduled = false;
  private restQuaternion = new THREE.Quaternion();
  private workQuaternion = new THREE.Quaternion();
  private workVector = new THREE.Vector3();
  private crown = new THREE.Vector3();
  private headingQuaternion = new THREE.Quaternion();
  private spinQuaternion = new THREE.Quaternion();
  private flightQuaternion = new THREE.Quaternion();

  constructor(
    private scene: THREE.Scene,
    private root: THREE.Group,
    private parts: MotionPart[],
    modelHeight: number,
  ) {
    this.crown.set(0, modelHeight * 0.5, 0);
    for (const part of parts) {
      part.mesh.geometry.computeBoundingBox();
      const size = part.mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      const area = size.x * size.y + size.y * size.z + size.x * size.z;
      this.masses.set(
        part.index,
        clamp((area / modelHeight ** 2) * 75, 0.16, 8),
      );
      this.radii.set(part.index, Math.sqrt(area / 3) * 0.24);
    }
  }

  reset(seed = this.seed) {
    this.seed = seed;
    this.simulated = 0;
    this.time = 0;
    this.nextImpact = 0;
    this.layoutKey = "";
    this.plan = null;
    this.impacts.length = 0;
    this.bodies.length = 0;
    this.bodyByPart.clear();
    this.gatherScheduled = false;
    this.ranked = [...this.parts].sort(
      (a, b) => this.releaseRank(a) - this.releaseRank(b),
    );
    for (const part of this.parts) {
      this.root.add(part.pivot);
      part.pivot.position.copy(part.home);
      part.pivot.quaternion.identity();
      part.pivot.scale.setScalar(1);
    }
  }

  get contactTimes(): readonly number[] {
    return this.plan?.impactTimes ?? impactTimes;
  }

  private releaseRank(part: MotionPart) {
    const face = part.group === "eyes" || part.group === "forehead" ? 1.7 : 1;
    return (
      this.masses.get(part.index)! *
      face *
      (0.7 + random(this.seed + part.index) * 0.6)
    );
  }

  update(time: number, layout: MotionLayout) {
    time = clamp(time, 0, duration);
    const key = [
      layout.width,
      layout.height,
      layout.modelScale,
      layout.cameraDistance,
      layout.modelSize.x,
      layout.modelSize.y,
    ].join("/");
    if ((this.layoutKey && this.layoutKey !== key) || time + 0.01 < this.time) {
      this.reset();
    }
    this.layoutKey = key;
    this.plan ??= createFlightPlan(this.seed, {
      width: layout.width,
      height: layout.height,
      modelWidth: layout.modelSize.x * layout.modelScale,
      modelHeight: layout.modelSize.y * layout.modelScale,
    });
    this.restQuaternion.setFromEuler(
      new THREE.Euler(layout.pitch, layout.yaw, layout.roll),
    );
    // A fixed clock makes a scrub to a moment produce the same debris as playback.
    while (this.simulated + STEP <= time + 0.001) {
      this.simulated += STEP;
      this.step(this.simulated, STEP / 1000, layout);
    }
    // A contact can fall between physics ticks. Release plates before rendering
    // that instant, especially before the root returns to the assembly center.
    this.contactsThrough(time, layout);
    this.time = time;
    this.setRoot(time, layout);
    this.attachedVibration(time, layout);
    return sampleEntrance(time, this.seed, this.plan);
  }

  light(part: MotionPart) {
    const body = this.bodyByPart.get(part.index);
    if (body?.lockedAt)
      return 1.7 * Math.exp(-(this.time - body.lockedAt) / 130);
    if (body) return 0.45 * Math.exp(-(this.time - body.born) / 220);
    let pulse = 0;
    for (const impact of this.impacts) {
      const elapsed = this.time - impact.time;
      if (elapsed >= 0 && elapsed < 110)
        pulse +=
          Math.exp(-elapsed / 30) *
          (0.65 + impactProgress(impact.index) * 0.65);
    }
    return pulse;
  }

  private flightPosition(
    time: number,
    layout: MotionLayout,
    out = new THREE.Vector3(),
  ) {
    // sampleEntrance switches to the assembly origin after the final contact.
    const sample = sampleEntrance(
      Math.min(time, blastTime - 0.001),
      this.seed,
      this.plan!,
    );
    const depthFactor = 1 - sample.depth;
    out.set(
      (sample.x - 0.5) * layout.width * depthFactor,
      (0.5 - sample.y) * layout.height * depthFactor,
      sample.depth * layout.cameraDistance,
    );
    return out;
  }

  private setRoot(time: number, layout: MotionLayout) {
    this.root.scale.setScalar(layout.modelScale);
    if (time >= blastTime) {
      this.root.position.set(0, 0, 0);
      this.root.quaternion.copy(this.restQuaternion);
      this.root.updateMatrixWorld(true);
      return;
    }
    this.flightPosition(time, layout, this.root.position);
    this.aimAlongFlight(time, layout);
    this.root.quaternion.copy(this.flightQuaternion);
    this.root.updateMatrixWorld(true);
  }

  private aimAlongFlight(time: number, layout: MotionLayout) {
    const rotation = sampleFlightRotation(time, this.seed, this.plan!);
    this.headingQuaternion.setFromAxisAngle(SCREEN_AXIS, rotation.heading);
    this.spinQuaternion.setFromAxisAngle(
      CROWN_AXIS,
      layout.yaw + rotation.spin,
    );
    this.flightQuaternion
      .copy(this.headingQuaternion)
      .multiply(this.spinQuaternion);
  }

  private attachedVibration(time: number, layout: MotionLayout) {
    if (time >= blastTime) return;
    let shake = 0;
    for (const event of this.impacts) {
      const age = time - event.time;
      if (age >= 0 && age < 100)
        shake +=
          Math.exp(-age / 30) * (0.3 + impactProgress(event.index) * 0.5);
    }
    const localAmplitude = layout.modelSize.y * 0.0035 * shake;
    for (const part of this.parts) {
      if (part.pivot.parent !== this.root) continue;
      part.pivot.position.copy(part.home);
      const phase = time / 14 + part.index * 2.4;
      part.pivot.position.x += Math.sin(phase) * localAmplitude;
      part.pivot.position.y += Math.cos(phase * 1.1) * localAmplitude * 0.6;
      part.pivot.rotation.set(
        part.tilt.x * shake * 0.03,
        part.tilt.y * shake * 0.03,
        part.tilt.z * shake * 0.03,
      );
    }
  }

  private step(time: number, dt: number, layout: MotionLayout) {
    this.contactsThrough(time, layout);
    if (time >= gatherTime && !this.gatherScheduled) {
      this.gatherScheduled = true;
      const diagonal = Math.hypot(layout.width, layout.height);
      for (const body of this.bodies) {
        const distance = body.part.pivot.position.length() / diagonal;
        body.gatherAt =
          gatherTime +
          (1 - clamp(distance)) * 130 +
          groupOrder[body.part.group] * 1000 +
          Math.sqrt(body.mass) * 17;
      }
    }
    for (const body of this.bodies) {
      if (body.lockedAt) continue;
      if (time >= body.gatherAt) {
        this.gather(body, time, layout);
        continue;
      }
      this.integrate(
        body,
        time,
        Math.min(dt, (time - body.born) / 1000),
        layout,
      );
    }
    this.resolveContacts(time);
  }

  private contactsThrough(time: number, layout: MotionLayout) {
    const times = this.plan!.impactTimes;
    while (this.nextImpact < times.length && time >= times[this.nextImpact]) {
      this.collide(this.nextImpact++, layout);
    }
  }

  private collide(index: number, layout: MotionLayout) {
    const plan = this.plan!;
    const time = plan.impactTimes[index];
    this.setRoot(time - 0.001, layout);
    this.attachedVibration(time - 0.001, layout);
    this.root.updateMatrixWorld(true);
    const point = plan.points[index + 1];
    const normal = new THREE.Vector3(point.nx, -point.ny, 0);
    const position = this.root.localToWorld(this.crown.clone());
    const depthFactor = 1 - position.z / layout.cameraDistance;
    if (normal.x)
      position.x = -normal.x * (layout.width / 2 - contactInset) * depthFactor;
    if (normal.y)
      position.y = -normal.y * (layout.height / 2 - contactInset) * depthFactor;
    const interval = time - (plan.impactTimes[index - 1] ?? 0);
    const sampleGap = Math.min(6, interval / 4);
    const incoming = this.flightPosition(time - 0.001, layout)
      .sub(this.flightPosition(time - 0.001 - sampleGap, layout))
      .multiplyScalar(1000 / sampleGap);
    const rotation = sampleFlightRotation(time, this.seed, plan);
    const angularVelocity = CROWN_AXIS.clone()
      .applyQuaternion(this.root.quaternion)
      .multiplyScalar(rotation.spinSpeed)
      .addScaledVector(SCREEN_AXIS, rotation.turnSpeed);
    const impact = {
      index,
      time,
      position,
      normal,
      incoming,
      angularVelocity,
      depthFactor,
    };
    this.impacts.push(impact);
    const count = Math.round(this.parts.length * releasedFractions[index]);
    while (this.bodies.length < count) {
      this.release(this.ranked[this.bodies.length], impact, layout);
    }
  }

  private release(part: MotionPart, impact: ArmorImpact, layout: MotionLayout) {
    const mass = this.masses.get(part.index)!;
    const n = part.index * 17 + this.seed + impact.index * 193;
    const final = impact.index === impactCount - 1;
    const tangent = new THREE.Vector3(-impact.normal.y, impact.normal.x, 0);
    const angle = (random(n + 1) - 0.5) * (final ? 2.5 : 1.9);
    const direction = impact.normal
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(tangent, Math.sin(angle));
    direction.z = (random(n + 2) - 0.35) * (final ? 0.8 : 0.45);
    direction.normalize();
    const reflected = impact.incoming.clone();
    reflected.addScaledVector(
      impact.normal,
      -1.35 * reflected.dot(impact.normal),
    );
    const speed =
      (Math.max(layout.width * 0.68, layout.height * 0.95) *
        (final ? 1 : 0.45) *
        (0.66 + random(n + 3) * 0.78)) /
      Math.pow(mass, 0.16);
    const velocity = direction
      .multiplyScalar(speed)
      .addScaledVector(reflected, final ? 0.1 : 0.12);
    // Transform continuity matters: detached plates stay exactly where they were.
    this.scene.attach(part.pivot);
    const offset = part.pivot.position.clone().sub(this.root.position);
    velocity.add(
      new THREE.Vector3().crossVectors(impact.angularVelocity, offset),
    );
    const body: Body = {
      part,
      born: impact.time,
      mass,
      radius: clamp(
        this.radii.get(part.index)! * layout.modelScale,
        1.1,
        layout.height * 0.038,
      ),
      velocity,
      spin: new THREE.Vector3(
        random(n + 4) - 0.5,
        random(n + 5) - 0.5,
        random(n + 6) - 0.5,
      )
        .multiplyScalar((final ? 5 : 3.5) / Math.pow(mass, 0.3))
        .add(impact.angularVelocity),
      anchor: null,
      gatherAt: Infinity,
      gather: null,
      lockedAt: 0,
    };
    this.bodies.push(body);
    this.bodyByPart.set(part.index, body);
  }

  private integrate(
    body: Body,
    time: number,
    dt: number,
    layout: MotionLayout,
  ) {
    const age = (time - body.born) / 1000;
    const position = body.part.pivot.position;
    const lift = smooth((age - 0.58) / 0.65);
    body.velocity.y -= layout.height * 0.76 * (1 - lift) * dt;
    body.velocity.multiplyScalar(Math.exp(-(0.28 + lift * 0.9) * dt));
    if (age > 0.98) {
      body.anchor ??= position.clone().addScaledVector(body.velocity, 0.1);
      const phase = time / 1000 + body.part.index * 2.7;
      // The field first cancels gravity, then catches momentum. It never teleports
      // debris into a random layout or stops every piece at the same instant.
      this.workVector.copy(body.anchor).sub(position);
      this.workVector.y += Math.sin(phase * 1.1) * 1.7;
      body.velocity.addScaledVector(this.workVector, 22 * dt);
      body.velocity.multiplyScalar(Math.exp(-8 * dt));
    }
    position.addScaledVector(body.velocity, dt);
    const angularSpeed = body.spin.length();
    if (angularSpeed > 0.0001) {
      this.workVector.copy(body.spin).multiplyScalar(1 / angularSpeed);
      this.workQuaternion.setFromAxisAngle(this.workVector, angularSpeed * dt);
      body.part.pivot.quaternion.premultiply(this.workQuaternion).normalize();
    }
    body.spin.multiplyScalar(Math.exp(-(0.26 + lift * 1.15) * dt));
    this.screenBounds(body, layout);
  }

  private screenBounds(body: Body, layout: MotionLayout) {
    const p = body.part.pivot.position;
    const f = Math.max(0.55, 1 - p.z / layout.cameraDistance);
    const x = Math.max(1, layout.width * 0.5 * f - body.radius - 12 * f);
    const y = Math.max(1, layout.height * 0.5 * f - body.radius - 12 * f);
    const zMin = -layout.cameraDistance * 3;
    const zMax = layout.cameraDistance * 0.22;
    for (const [axis, lo, hi] of [
      ["x", -x, x],
      ["y", -y, y],
      ["z", zMin, zMax],
    ] as const) {
      const before = p[axis];
      p[axis] = clamp(before, lo, hi);
      if (p[axis] === before) continue;
      if (
        (before < lo && body.velocity[axis] < 0) ||
        (before > hi && body.velocity[axis] > 0)
      ) {
        body.velocity[axis] *= -0.28;
        body.spin.multiplyScalar(0.77);
      }
      if (body.anchor) body.anchor[axis] = clamp(body.anchor[axis], lo, hi);
    }
  }

  private resolveContacts(time: number) {
    for (let i = 0; i < this.bodies.length; i++) {
      const a = this.bodies[i];
      if (a.gather || a.lockedAt || time - a.born < 120) continue;
      for (let j = i + 1; j < this.bodies.length; j++) {
        const b = this.bodies[j];
        if (b.gather || b.lockedAt || time - b.born < 120) continue;
        const pa = a.part.pivot.position,
          pb = b.part.pivot.position;
        const dx = pb.x - pa.x,
          dy = pb.y - pa.y,
          dz = pb.z - pa.z;
        const radius = a.radius + b.radius;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq >= radius * radius || distanceSq < 0.000001) continue;
        const distance = Math.sqrt(distanceSq);
        const nx = dx / distance,
          ny = dy / distance,
          nz = dz / distance;
        const ia = 1 / a.mass,
          ib = 1 / b.mass,
          inverseMass = ia + ib;
        const correction =
          (Math.max(0, radius - distance - 0.1) * 0.65) / inverseMass;
        pa.x -= nx * correction * ia;
        pa.y -= ny * correction * ia;
        pa.z -= nz * correction * ia;
        pb.x += nx * correction * ib;
        pb.y += ny * correction * ib;
        pb.z += nz * correction * ib;
        const approach =
          (b.velocity.x - a.velocity.x) * nx +
          (b.velocity.y - a.velocity.y) * ny +
          (b.velocity.z - a.velocity.z) * nz;
        if (approach >= 0) continue;
        const impulse = (-(1 + 0.22) * approach) / inverseMass;
        a.velocity.x -= impulse * nx * ia;
        a.velocity.y -= impulse * ny * ia;
        a.velocity.z -= impulse * nz * ia;
        b.velocity.x += impulse * nx * ib;
        b.velocity.y += impulse * ny * ib;
        b.velocity.z += impulse * nz * ib;
        a.spin.multiplyScalar(0.94);
        b.spin.multiplyScalar(0.94);
      }
    }
  }

  private gather(body: Body, time: number, layout: MotionLayout) {
    const part = body.part;
    if (!body.gather) {
      const to = part.home
        .clone()
        .multiplyScalar(layout.modelScale)
        .applyQuaternion(this.restQuaternion);
      const direction = to.clone().normalize();
      const from = part.pivot.position.clone();
      body.gather = {
        start: body.gatherAt,
        duration: 660 + Math.sqrt(body.mass) * 36,
        from,
        control1: from.clone().addScaledVector(body.velocity, 0.12),
        control2: to
          .clone()
          .addScaledVector(
            direction,
            layout.modelSize.y * layout.modelScale * 0.23,
          ),
        to,
        rotation: part.pivot.quaternion.clone(),
      };
    }
    const g = body.gather;
    const progress = clamp((time - g.start) / g.duration);
    const u = smooth(progress),
      v = 1 - u;
    part.pivot.position
      .copy(g.from)
      .multiplyScalar(v * v * v)
      .addScaledVector(g.control1, 3 * v * v * u)
      .addScaledVector(g.control2, 3 * v * u * u)
      .addScaledVector(g.to, u * u * u);
    part.pivot.quaternion
      .copy(g.rotation)
      .slerp(this.restQuaternion, smooth(clamp(progress * 1.12)));
    if (progress === 1) {
      this.root.add(part.pivot);
      part.pivot.position.copy(part.home);
      part.pivot.quaternion.identity();
      part.pivot.scale.setScalar(1);
      body.lockedAt = time;
    }
  }
}
