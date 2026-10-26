import { test } from "node:test";
import assert from "node:assert/strict";
import { ArmorPresence } from "../src/armor-presence";
import { initialRuntime } from "../src/domain";

test("speaking remains visible during a task and reacts to real audio levels", () => {
  const presence = new ArmorPresence();
  const state = {
    ...initialRuntime(),
    mode: "working" as const,
    voiceActive: true,
    taskActive: true,
  };
  const quiet = presence.sample(1000, 1, state, false, false);
  const loud = presence.sample(
    1000,
    1,
    { ...state, outputLevel: 0.4 },
    false,
    false,
  );
  assert.ok(loud.work > 0.9);
  assert.ok(loud.light("eyes") > quiet.light("eyes") * 2);
  const after = presence.sample(1000, 1, state, false, false);
  assert.ok(after.light("eyes") < loud.light("eyes") * 0.6);
});
test("pause extinguishes active cues and reduced motion removes ambient movement", () => {
  const presence = new ArmorPresence();
  const speaking = {
    ...initialRuntime(),
    mode: "speaking" as const,
    voiceActive: true,
    outputLevel: 1,
  };
  presence.sample(1150, 1, speaking, false, false);
  const paused = presence.sample(
    1150,
    5,
    { ...speaking, paused: true },
    false,
    false,
  );
  assert.ok(paused.light("eyes") < 0.1);
  assert.equal(paused.work, 0);
  const reduced = presence.sample(1150, 5, initialRuntime(), true, false);
  assert.ok(Math.abs(reduced.lift) < 0.0001);
  assert.ok(Math.abs(reduced.pitch) < 0.0001);
  const idle = presence.sample(1150, 5, initialRuntime(), false, false);
  assert.ok(idle.lift > 0.01);
});
