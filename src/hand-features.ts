/** Geometry uses world landmarks so pinch thresholds do not depend on camera distance. */
export interface HandPoint {
  x: number;
  y: number;
  z: number;
}
const clamp = (value: number) => Math.min(1, Math.max(0, value));
export function handFeatures(points: HandPoint[], world: HandPoint[]) {
  if (
    points?.length !== 21 ||
    world?.length !== 21 ||
    ![...points, ...world].every((p) => [p.x, p.y, p.z].every(Number.isFinite))
  )
    return null;
  const distance = (a: HandPoint, b: HandPoint) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const width = distance(world[5], world[17]);
  const length = distance(world[0], world[9]);
  if (width < 0.005 || length < 0.005) return null;
  const center = [0, 5, 9, 13, 17];
  // Finger extension + finger fan, measured in palm-relative world geometry.
  // Moving the whole hand towards the camera must not change the aperture.
  const fingers = [5, 9, 13, 17].map((base) => {
    const chain =
      distance(world[base], world[base + 1]) +
      distance(world[base + 1], world[base + 2]) +
      distance(world[base + 2], world[base + 3]);
    if (chain < length * 0.2) return null;
    const straight = clamp(
      (distance(world[base], world[base + 3]) / chain - 0.35) / 0.6,
    );
    const reach = clamp(
      (distance(world[0], world[base + 3]) / length - 1) / 1.2,
    );
    return straight * 0.78 + reach * 0.22;
  });
  const validFingers = fingers.filter((v): v is number => v !== null);
  const extension = validFingers.length
    ? validFingers.reduce((sum, v) => sum + v, 0) / validFingers.length
    : 0;
  const fan = clamp((distance(world[8], world[20]) / width - 0.85) / 1.2);
  return {
    x: 1 - center.reduce((s, i) => s + points[i].x, 0) / center.length,
    y: center.reduce((s, i) => s + points[i].y, 0) / center.length,
    pinchX: 1 - (points[4].x + points[8].x) / 2,
    pinchY: (points[4].y + points[8].y) / 2,
    pinchRatio: distance(world[4], world[8]) / width,
    openness: clamp(extension * (0.7 + fan * 0.3)),
    extendedFingers:
      validFingers.length === 4
        ? validFingers.filter((value) => value >= 0.55).length
        : undefined,
    yaw: 0,
    pitch: 0,
    roll: 0,
  };
}
