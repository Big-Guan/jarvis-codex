import { pointerMode, pointerPose } from "../src/pointer-controls";
import { handFeatures } from "../src/hand-features";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  homePose,
  normalizeConfig,
  validateConfig,
} from "../src/domain";
import { GestureMachine, HandInput } from "../src/gesture-machine";
import { HandSelection } from "../src/hand-selection";
import {
  duration,
  blastTime,
  createFlightPlan,
  entrancePath,
  floatTime,
  gatherTime,
  impactCount,
  sampleEntrance,
} from "../src/entrance";
const config = defaults.gestures;
const hand = (patch: Partial<HandInput> = {}): HandInput => ({
  gesture: "Open_Palm",
  hand: "Right",
  score: 0.98,
  x: 0.5,
  y: 0.5,
  yaw: 0,
  pitch: 0,
  roll: 0,
  openness: 1,
  ...patch,
});

const pinch = (patch: Partial<HandInput> = {}) =>
  hand({
    gesture: "None",
    score: 0.2,
    pinchRatio: 0.12,
    pinchX: 0.5,
    pinchY: 0.5,
    ...patch,
  });
test("opening briefly after a drag never explodes the armor", () => {
  const g = new GestureMachine();
  g.step(pinch(), 0, homePose, config);
  g.step(pinch(), 180, homePose, config);
  assert.equal(g.step(hand(), 200, homePose, config), null);
  assert.equal(g.step(hand(), 400, homePose, config), null);
  assert.equal(g.step(hand(), 470, homePose, config)?.spread, 1);
  assert.equal(g.step(hand({ gesture: "None" }), 750, homePose, config), null);
});
test("a deliberate palm acquires quickly, rotates and changes spread without a canned label", () => {
  for (const side of ["Left", "Right"]) {
    const g = new GestureMachine();
    const palm = hand({
      hand: side,
      gesture: "None",
      score: 0.08,
      extendedFingers: 4,
      openness: 0.9,
    });
    const quick = { ...config, holdMs: 100 };
    assert.equal(g.step(palm, 0, homePose, quick), null);
    const open = g.step(palm, 100, homePose, quick)!;
    assert.equal(open.yaw, homePose.yaw);
    assert.equal(open.spread, 1);
    const relaxed = g.step(
      {
        ...palm,
        openness: 0.35,
        extendedFingers: 1,
        x: 0.65,
        pinchRatio: 0.15,
        pinchX: 0.65,
        pinchY: 0.5,
      },
      200,
      homePose,
      quick,
    )!;
    assert.ok(relaxed.spread! > 0 && relaxed.spread! < open.spread!);
    assert.ok(relaxed.yaw! > homePose.yaw);
    const wider = g.step({ ...palm, x: 0.65 }, 300, homePose, quick)!;
    assert.ok(wider.spread! > relaxed.spread!);
    assert.equal(wider.yaw, relaxed.yaw);
    assert.equal(g.action, "spread");
  }
});
test("an unacquired partial hand cannot trigger spread, and a returning palm reanchors rotation", () => {
  const g = new GestureMachine();
  const partial = hand({
    gesture: "None",
    score: 0.1,
    extendedFingers: 1,
    openness: 0.35,
  });
  assert.equal(g.step(partial, 0, homePose, config), null);
  assert.equal(g.step(partial, 300, homePose, config), null);
  const palm = hand({ extendedFingers: 4 });
  g.step(palm, 400, homePose, config);
  g.step(palm, 560, homePose, config);
  const moved = {
    ...homePose,
    ...g.step({ ...palm, x: 0.65 }, 620, homePose, config),
  };
  g.step(null, 660, moved, config);
  g.step({ ...palm, x: 0.3 }, 700, moved, config);
  assert.equal(g.step({ ...palm, x: 0.3 }, 860, moved, config)?.yaw, moved.yaw);
});
test("closing a scattered armor assembles it before a fist can rotate", () => {
  const g = new GestureMachine(),
    pose = { ...homePose, spread: 1 };
  const fist = hand({ gesture: "Closed_Fist", openness: 0 });
  g.step(fist, 0, pose, config);
  assert.deepEqual(g.step(fist, 200, pose, config), { spread: 0 });
  assert.deepEqual(g.step({ ...fist, x: 0.6 }, 800, pose, config), {
    spread: 0,
  });
  g.step({ ...fist, x: 0.6 }, 1000, homePose, config);
  assert.equal(
    g.step({ ...fist, x: 0.6 }, 1100, homePose, config)?.yaw,
    homePose.yaw,
  );
  assert.ok(
    g.step({ ...fist, x: 0.7 }, 1200, homePose, config)!.yaw! > homePose.yaw,
  );
});
test("pinch drag releases immediately and reacquires relative to the current armor", () => {
  const g = new GestureMachine(),
    pose = { ...homePose, x: 0.65 };
  const point = pinch({ pinchX: 0.2 });
  g.step(point, 0, pose, config);
  assert.equal(g.step(point, 200, pose, config)?.x, pose.x);
  const moved = g.step({ ...point, pinchX: 0.25 }, 250, pose, config)!;
  assert.ok(moved.x! > pose.x);
  assert.equal(g.step({ ...point, pinchRatio: 0.7 }, 280, pose, config), null);
  const back = { ...point, pinchX: 0.8 };
  assert.equal(g.step(back, 300, { ...pose, ...moved }, config), null);
  assert.equal(g.step(back, 500, { ...pose, ...moved }, config)?.x, moved.x);
});
test("pinch hysteresis tolerates a small gap but never mistakes a confident fist for pinch", () => {
  const g = new GestureMachine();
  assert.equal(g.step(pinch({ pinchRatio: 0.4 }), 0, homePose, config), null);
  g.step(pinch(), 100, homePose, config);
  g.step(pinch(), 300, homePose, config);
  assert.ok(
    g.step(pinch({ pinchRatio: 0.4, pinchX: 0.55 }), 350, homePose, config)
      ?.x! > 0.5,
  );
  const fist = pinch({ gesture: "Closed_Fist", score: 0.95 });
  assert.equal(g.step(fist, 400, homePose, config), null);
  assert.equal(g.step(fist, 600, homePose, config)?.spread, 0);
  assert.equal(g.action, "assembleRotate");
});
test("tracking loss and mouse input drop the grab instead of preserving a stale anchor", () => {
  const g = new GestureMachine();
  g.step(pinch(), 0, homePose, config);
  g.step(pinch(), 200, homePose, config);
  assert.equal(g.step(null, 230, homePose, config), null);
  assert.equal(g.anchor, null);
  assert.equal(g.step(pinch({ pinchX: 0.8 }), 260, homePose, config), null);
  assert.equal(g.step(pinch(), 500, homePose, config, true), null);
  assert.equal(g.acquired, false);
});
test("rotation follows fist position and ignores unstable occluded wrist angles", () => {
  for (const side of ["Left", "Right"]) {
    const g = new GestureMachine(),
      fist = hand({ hand: side, gesture: "Closed_Fist" });
    g.step(fist, 0, homePose, config);
    g.step(fist, 200, homePose, config);
    const p = g.step(
      { ...fist, yaw: 3.13, pitch: -2.5, roll: 2.8 },
      230,
      homePose,
      config,
    )!;
    assert.deepEqual(
      [p.yaw, p.pitch, p.roll],
      [homePose.yaw, homePose.pitch, homePose.roll],
    );
    assert.ok(
      g.step({ ...fist, x: 0.6 }, 260, homePose, config)!.yaw! > homePose.yaw,
    );
  }
});
test("left-hand selection and hand changes use fresh anchors", () => {
  const g = new GestureMachine(),
    left = pinch({ hand: "Left", pinchX: 0.2 });
  g.step(left, 0, homePose, config);
  assert.equal(g.step(left, 200, homePose, config)?.x, homePose.x);
  const moved = g.step({ ...left, pinchX: 0.3 }, 250, homePose, config)!;
  const right = pinch({ pinchX: 0.8 });
  assert.equal(g.step(right, 300, { ...homePose, ...moved }, config), null);
  assert.equal(
    g.step(right, 500, { ...homePose, ...moved }, config)?.x,
    moved.x,
  );
  assert.equal(g.step(left, 550, homePose, { ...config, hand: "Right" }), null);
});
test("two visible hands keep one controller until that hand leaves", () => {
  const selection = new HandSelection();
  const left = { hand: "Left" as const, x: 0.8, y: 0.5, score: 0.9 };
  const right = { hand: "Right" as const, x: 0.2, y: 0.5, score: 0.95 };
  assert.equal(selection.select([left], "Auto", 0), 0);
  assert.equal(selection.select([right, left], "Auto", 100), 1);
  assert.equal(selection.select([right], "Auto", 200), -1);
  assert.equal(selection.select([right], "Auto", 300), 0);
  assert.equal(selection.select([left], "Right", 400), -1);
  assert.equal(selection.select([left], "Left", 500), 0);
});
test("imported settings cannot create invalid calibration, unsafe colors or action conflicts", () => {
  const c = normalizeConfig({
    appearance: { height: NaN, accent: "url(example)" },
    gestures: { openness: [2, 5] },
    system: { autostart: "true" },
  });
  assert.deepEqual(c.gestures.openness, [0, 1]);
  assert.equal(c.appearance.height, 360);
  assert.equal(c.appearance.accent, defaults.appearance.accent);
  assert.equal(c.system.autostart, false);
  c.gestures.mapping.Closed_Fist = "spread";
  assert.ok(validateConfig(c));
  assert.equal(validateConfig(normalizeConfig(defaults)), null);
});
test("dense entrance reflects continuously, stays bounded and finishes at center", () => {
  assert.ok(impactCount >= 12);
  const starts = new Set<string>();
  for (let seed = 0; seed < 50; seed++) {
    const plan = createFlightPlan(seed);
    const path = entrancePath(seed, plan);
    const times = plan.impactTimes;
    assert.equal(times.length, impactCount);
    assert.equal(times.at(-1), blastTime);
    times.forEach((time, i) => assert.ok(time > (times[i - 1] ?? 0)));
    starts.add(path[0].join(","));
    assert.equal(new Set(path.map((p) => p.join(","))).size, impactCount + 1);
    for (const p of path) assert.ok(p.every((n) => n > 0 && n < 1));
    times.slice(0, -1).forEach((time, i) => {
      const s = sampleEntrance(time, seed, plan);
      assert.ok(Math.abs(s.x - path[i + 1][0]) < 1e-8);
      assert.ok(Math.abs(s.y - path[i + 1][1]) < 1e-8);
      const a = plan.points[i],
        b = plan.points[i + 1],
        c = plan.points[i + 2];
      const incoming = [(b.x - a.x) * plan.width, (b.y - a.y) * plan.height];
      const outgoing = [(c.x - b.x) * plan.width, (c.y - b.y) * plan.height];
      const inLength = Math.hypot(...incoming),
        outLength = Math.hypot(...outgoing);
      const ix = incoming[0] / inLength,
        iy = incoming[1] / inLength;
      const dot = ix * b.nx + iy * b.ny;
      assert.ok(dot < 0);
      assert.ok(
        Math.abs(outgoing[0] / outLength - (ix - 2 * dot * b.nx)) < 1e-8,
      );
      assert.ok(
        Math.abs(outgoing[1] / outLength - (iy - 2 * dot * b.ny)) < 1e-8,
      );
    });
    assert.equal(
      sampleEntrance((floatTime + gatherTime) / 2, seed).phase,
      "悬浮",
    );
    assert.ok(sampleEntrance(gatherTime + 300, seed).assembly > 0);
    const final = sampleEntrance(duration, seed);
    assert.deepEqual(
      [final.x, final.y, final.scattered, final.done],
      [0.5, 0.5, false, true],
    );
    assert.equal(final.assembly, 1);
  }
  assert.equal(starts.size, 4);
});

test("old pointing settings migrate to pinch without losing camera preferences", () => {
  const c = normalizeConfig({
    ...defaults,
    gestures: {
      ...config,
      camera: "camera-123",
      calibrated: true,
      mapping: {
        Open_Palm: "spread",
        Closed_Fist: "assembleRotate",
        Pointing_Up: "move",
      },
    },
  });
  assert.deepEqual(c.gestures.mapping, defaults.gestures.mapping);
  assert.equal(c.gestures.camera, "camera-123");
  assert.equal(c.gestures.calibrated, true);
});

test("mouse rotation, alternate movement and unsupported buttons are distinct", () => {
  assert.equal(pointerMode(0, false), "rotate");
  assert.equal(pointerMode(0, true), "move");
  assert.equal(pointerMode(2, false), "move");
  assert.equal(pointerMode(1, false), null);
  const rotated = pointerPose(homePose, "rotate", 100, 20, 1200, 800);
  assert.ok(rotated.yaw! > homePose.yaw);
  assert.equal(rotated.x, undefined);
  const moved = pointerPose(homePose, "move", 120, 80, 1200, 800);
  assert.deepEqual(moved, { x: 0.6, y: 0.6 });
  assert.equal(moved.yaw, undefined);
});
test("pinch geometry is scale independent and rejects missing landmarks", () => {
  const p = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  p[0].y = 0.6;
  p[5].x = 0.46;
  p[17].x = 0.54;
  p[4].x = 0.5;
  p[8].x = 0.51;
  const a = handFeatures(p, p)!;
  const b = handFeatures(
    p,
    p.map((q) => ({ x: q.x * 2, y: q.y * 2, z: q.z * 2 })),
  )!;
  assert.equal(a.pinchRatio, b.pinchRatio);
  assert.ok(a.pinchRatio < 0.3);
  assert.equal(handFeatures(p.slice(0, 10), p), null);
});

function handGeometry(curl: number, fan: number) {
  const p = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [i, base] of [5, 9, 13, 17].entries()) {
    p[base] = { x: (i - 1.5) * 0.02, y: 0.055, z: 0 };
    for (let joint = 1; joint <= 3; joint++) {
      const angle = [0, 0.6, 1.15, 1.55][joint] * Math.PI * curl;
      const length = [0, 0.035, 0.024, 0.019][joint];
      const previous = p[base + joint - 1];
      p[base + joint] = {
        x: previous.x + ((i - 1.5) / 1.5) * 0.014 * fan * (1 - curl),
        y: previous.y + Math.cos(angle) * length,
        z: previous.z + Math.sin(angle) * length,
      };
    }
  }
  return p;
}
test("aperture follows finger curl and fan, not hand scale, rotation or camera position", () => {
  const open = handGeometry(0, 1),
    relaxed = handGeometry(0.55, 0.3),
    closed = handGeometry(1, 0);
  const aperture = (p: typeof open) => handFeatures(p, p)!;
  assert.ok(aperture(open).openness > aperture(relaxed).openness + 0.25);
  assert.ok(aperture(relaxed).openness > aperture(closed).openness + 0.15);
  assert.ok(
    aperture(open).openness > aperture(handGeometry(0, 0)).openness + 0.15,
  );
  assert.equal(aperture(open).extendedFingers, 4);
  assert.equal(aperture(closed).extendedFingers, 0);
  const transformed = open.map((p) => ({
    x: p.z * 2 + 0.3,
    y: p.y * 2 - 0.4,
    z: -p.x * 2 + 0.7,
  }));
  assert.ok(
    Math.abs(aperture(open).openness - aperture(transformed).openness) < 1e-8,
  );
});
