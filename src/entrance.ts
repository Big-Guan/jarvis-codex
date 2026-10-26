export const duration = 5400;
export const impactCount = 16;
export const launchTime = 60;
export const blastTime = 2355;
export const floatTime = blastTime + 1150;
export const gatherTime = blastTime + 1500;
export const assembledTime = gatherTime + 1040;
const acceleration = 1.45;
export const contactInset = 6;
export const random = (seed: number) => {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return n - Math.floor(n);
};
export const clamp = (x: number, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, x));
export const smooth = (x: number) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
export const flightDepths = [
  -6.2, -4.6, -3.9, -3.3, -2.8, -2.35, -1.95, -1.6, -1.3, -1.04, -0.81, -0.61,
  -0.44, -0.29, -0.16, -0.045, 0.045,
];
export const releasedFractions = [
  0, 0, 0, 0, 0, 0, 0, 0, 0.012, 0.03, 0.065, 0.12, 0.2, 0.3, 0.43, 1,
];
const firstRelease = releasedFractions.findIndex((fraction) => fraction > 0);
export const impactProgress = (index: number) => index / (impactCount - 1);

export interface FlightViewport {
  width: number;
  height: number;
  modelWidth: number;
  modelHeight: number;
}
export interface FlightPoint {
  x: number;
  y: number;
  // Inward contact normal in screen coordinates (positive y points down).
  nx: number;
  ny: number;
}
export interface FlightPlan {
  points: FlightPoint[];
  distances: number[];
  length: number;
  impactTimes: number[];
  depthSlopes: number[];
  width: number;
  height: number;
}
const referenceViewport: FlightViewport = {
  width: 1600,
  height: 900,
  modelWidth: 285,
  modelHeight: 400,
};

export function createFlightPlan(
  seed: number,
  viewport = referenceViewport,
): FlightPlan {
  const width = Math.max(1, viewport.width),
    height = Math.max(1, viewport.height);
  const flipX = random(seed) > 0.5,
    flipY = random(seed + 1) > 0.5;
  const trace = (angle: number, fixedEnvelope = false) => {
    let vx = Math.cos(angle) * width,
      vy = Math.sin(angle) * height;
    const magnitude = Math.hypot(vx, vy);
    vx /= magnitude;
    vy /= magnitude;
    // Local +Y is the crown, now pointing along flight rather than screen-up.
    // Its projected reach determines when the helmet touches each screen edge.
    const bounds = flightDepths.map((depth) => {
      const reach = (viewport.modelHeight * 0.5) / (1 - depth);
      const x = Math.min(width * 0.34, reach * Math.abs(vx) + contactInset);
      const y = Math.min(height * 0.34, reach * Math.abs(vy) + contactInset);
      return { left: x, right: width - x, top: y, bottom: height - y };
    });
    const initial = bounds[fixedEnvelope ? impactCount : 0];
    const padding = Math.min(0.5, width * 0.01, height * 0.01);
    let x = clamp(
      width * 0.035,
      initial.left + padding,
      initial.right - padding,
    );
    let y = clamp(
      height * 0.055,
      initial.top + padding,
      initial.bottom - padding,
    );
    const points: FlightPoint[] = [{ x, y, nx: 0, ny: 0 }];
    const distances = [0];
    const sides = new Set<string>();
    let shortest = Infinity;
    for (let i = 0; i < impactCount; i++) {
      const edge = bounds[fixedEnvelope ? impactCount : i + 1];
      const dx = ((vx > 0 ? edge.right : edge.left) - x) / vx;
      const dy = ((vy > 0 ? edge.bottom : edge.top) - y) / vy;
      const travel = Math.min(dx, dy);
      // Reject a route that catches a growing corner or produces two contacts
      // at effectively the same point. Choose another launch angle instead.
      if (!Number.isFinite(travel) || travel < Math.min(width, height) * 1e-6)
        return null;
      x += vx * travel;
      y += vy * travel;
      let nx = 0,
        ny = 0;
      if (dx < dy) {
        nx = -Math.sign(vx);
        vx = -vx;
      } else {
        ny = -Math.sign(vy);
        vy = -vy;
      }
      points.push({ x, y, nx, ny });
      distances.push(distances[i] + travel);
      sides.add(nx + "/" + ny);
      if (i > 0) shortest = Math.min(shortest, travel);
    }
    return { points, distances, shortest, sides: sides.size };
  };
  // Pick one continuous reflected trajectory, not sixteen unrelated targets.
  // Maximise its shortest leg to avoid rapid, cramped corner-to-corner jitters.
  let best: NonNullable<ReturnType<typeof trace>> | null = null;
  let bestScore = -Infinity;
  const offset = random(seed + 17);
  for (const fixedEnvelope of [false, true]) {
    for (let i = 0; i < 192; i++) {
      const angle = 0.32 + ((i + offset) / 192) * 0.92;
      const candidate = trace(angle, fixedEnvelope);
      if (!candidate || candidate.sides < 4) continue;
      const total = candidate.distances[impactCount];
      const score = candidate.shortest / total;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best) break;
  }
  const route = best!;
  const points = route.points.map((point) => ({
    x: flipX ? 1 - point.x / width : point.x / width,
    y: flipY ? 1 - point.y / height : point.y / height,
    nx: flipX ? -point.nx : point.nx,
    ny: flipY ? -point.ny : point.ny,
  }));
  const distances = route.distances;
  const length = distances[impactCount];
  const times = distances
    .slice(1)
    .map(
      (distance) =>
        launchTime +
        Math.pow(distance / length, 1 / acceleration) *
          (blastTime - launchTime),
    );
  // Monotone cubic depth interpolation keeps the approach velocity continuous
  // through impacts while matching the projected helmet size at every contact.
  const slopes = flightDepths
    .slice(0, -1)
    .map(
      (depth, i) =>
        (flightDepths[i + 1] - depth) / (distances[i + 1] - distances[i]),
    );
  const depthSlopes = flightDepths.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === impactCount) return slopes[impactCount - 1];
    const before = distances[i] - distances[i - 1];
    const after = distances[i + 1] - distances[i];
    const w1 = 2 * after + before,
      w2 = after + 2 * before;
    return (w1 + w2) / (w1 / slopes[i - 1] + w2 / slopes[i]);
  });
  return {
    points,
    distances,
    length,
    impactTimes: times,
    depthSlopes,
    width,
    height,
  };
}

const referencePlans = new Map<number, FlightPlan>();
function referencePlan(seed: number) {
  let plan = referencePlans.get(seed);
  if (!plan) {
    plan = createFlightPlan(seed);
    if (referencePlans.size >= 8)
      referencePlans.delete(referencePlans.keys().next().value!);
    referencePlans.set(seed, plan);
  }
  return plan;
}
export const impactTimes = referencePlan(7).impactTimes;
export const firstReleaseTime = impactTimes[firstRelease];
export function entrancePath(seed: number, plan = referencePlan(seed)) {
  return plan.points.map(({ x, y }) => [x, y]);
}

export function sampleEntrance(
  time: number,
  seed: number,
  plan = referencePlan(seed),
) {
  const elapsed = clamp((time - launchTime) / (blastTime - launchTime));
  const distance = plan.length * Math.pow(elapsed, acceleration);
  let segment = 0;
  while (segment < impactCount - 1 && distance >= plan.distances[segment + 1])
    segment++;
  const stride = plan.distances[segment + 1] - plan.distances[segment];
  const progress = clamp((distance - plan.distances[segment]) / stride);
  const start = plan.points[segment],
    end = plan.points[segment + 1];
  const x = start.x + (end.x - start.x) * progress;
  const y = start.y + (end.y - start.y) * progress;
  const t2 = progress * progress,
    t3 = t2 * progress;
  const depth =
    (2 * t3 - 3 * t2 + 1) * flightDepths[segment] +
    (t3 - 2 * t2 + progress) * stride * plan.depthSlopes[segment] +
    (-2 * t3 + 3 * t2) * flightDepths[segment + 1] +
    (t3 - t2) * stride * plan.depthSlopes[segment + 1];
  const assembly = smooth((time - gatherTime) / (assembledTime - gatherTime));
  const origin = plan.points[plan.points.length - 1];
  return {
    x: time >= blastTime ? 0.5 : x,
    y: time >= blastTime ? 0.5 : y,
    depth,
    segment,
    progress,
    scale: 1 / (1 - depth),
    loosen: 0,
    scattered: time >= blastTime && time < assembledTime,
    assembly,
    done: time >= duration,
    phase:
      time < plan.impactTimes[0]
        ? "远处逼近"
        : time < plan.impactTimes[firstRelease]
          ? "高速连撞"
          : time < blastTime
            ? "撞击 · 脱甲"
            : time < floatTime
              ? "惯性散落"
              : time < gatherTime
                ? "悬浮"
                : time < assembledTime
                  ? "聚合"
                  : "就绪",
    origin: [origin.x, origin.y],
  };
}

export function sampleFlightRotation(
  time: number,
  seed: number,
  plan: FlightPlan,
) {
  const { segment } = sampleEntrance(
    Math.min(time, blastTime - 0.001),
    seed,
    plan,
  );
  const headingAt = (index: number) => {
    const a = plan.points[index],
      b = plan.points[index + 1];
    // Rz(heading) maps the crown's local +Y onto the screen-space flight ray.
    return Math.atan2(-(b.x - a.x) * plan.width, -(b.y - a.y) * plan.height);
  };
  let heading = headingAt(segment),
    turnSpeed = 0;
  if (segment > 0) {
    const previous = headingAt(segment - 1);
    const delta = Math.atan2(
      Math.sin(heading - previous),
      Math.cos(heading - previous),
    );
    const leg = plan.impactTimes[segment] - plan.impactTimes[segment - 1];
    const turnDuration = Math.min(52, leg * 0.42);
    const u = clamp((time - plan.impactTimes[segment - 1]) / turnDuration);
    heading = previous + delta * smooth(u);
    turnSpeed = (delta * 6 * u * (1 - u) * 1000) / turnDuration;
  }
  // Impacts add angular momentum; roll never restarts or reverses on each leg.
  // Rotating about local +Y keeps the crown leading through every full revolution.
  const sign = random(seed + 53) > 0.5 ? 1 : -1;
  const elapsed = Math.max(0, time - plan.impactTimes[0]) / 1000;
  let spin = elapsed * 3.2;
  let spinSpeed = time >= plan.impactTimes[0] ? 3.2 : 0;
  for (const [index, impactTime] of plan.impactTimes.entries()) {
    if (time < impactTime) break;
    const age = (time - impactTime) / 1000;
    const kick = 7 + impactProgress(index) * 9;
    const decay = Math.exp(-age / 0.085);
    spin += kick * 0.085 * (1 - decay);
    spinSpeed += kick * decay;
  }
  return { heading, turnSpeed, spin: spin * sign, spinSpeed: spinSpeed * sign };
}
