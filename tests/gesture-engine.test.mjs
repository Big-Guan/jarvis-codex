import assert from "node:assert/strict";
import test from "node:test";

import { GESTURE_ACTION_COUNT, GestureLatch, selectGestureCandidate } from "../src/gesture-engine.js";

const detection = (name, score = 0.95) => ({ name, score });

test("gesture v2 gives every single-hand pose a distinct control", () => {
  const expected = {
    Open_Palm: "dashboard",
    Thumb_Down: "stop",
    Closed_Fist: "confirm",
    Thumb_Up: "approve",
    Victory: "cockpit",
    ILoveYou: "spin",
    Pointing_Up: "voice",
  };
  for (const [name, action] of Object.entries(expected)) {
    assert.equal(selectGestureCandidate([detection(name)]).action, action);
  }
});

test("gesture v2 recognizes two deliberate two-hand shortcuts", () => {
  assert.equal(GESTURE_ACTION_COUNT, 9);
  assert.equal(
    selectGestureCandidate([detection("Open_Palm"), detection("Open_Palm")]).action,
    "settings",
  );
  assert.equal(
    selectGestureCandidate([detection("Closed_Fist"), detection("Closed_Fist")]).action,
    "studio",
  );
  assert.deepEqual(
    selectGestureCandidate([detection("Open_Palm"), detection("Thumb_Up")]),
    { state: "ambiguous" },
  );
});

test("global release lock blocks transition misfires until the hand is neutral", () => {
  const latch = new GestureLatch({ releaseFrames: 3, cooldownMs: 0 });
  const fist = selectGestureCandidate([detection("Closed_Fist")]);
  const thumb = selectGestureCandidate([detection("Thumb_Up")]);
  const idle = selectGestureCandidate([]);

  assert.equal(latch.update(fist, 0), null);
  assert.equal(latch.update(fist, 90), null);
  assert.equal(latch.update(fist, 180)?.action, "confirm");
  assert.equal(latch.update(thumb, 270), null);
  assert.equal(latch.update(thumb, 360), null);
  assert.equal(latch.update(thumb, 450), null);
  assert.equal(latch.update(idle, 540), null);
  assert.equal(latch.update(idle, 630), null);
  assert.equal(latch.update(idle, 720), null);
  assert.equal(latch.update(thumb, 810), null);
  assert.equal(latch.update(thumb, 900), null);
  assert.equal(latch.update(thumb, 990)?.action, "approve");
});

test("low-confidence poses stay ambiguous instead of firing", () => {
  assert.deepEqual(selectGestureCandidate([detection("Thumb_Up", 0.4)]), { state: "ambiguous" });
  assert.deepEqual(selectGestureCandidate([detection("None")]), { state: "idle" });
});
