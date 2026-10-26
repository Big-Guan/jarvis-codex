import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { defaults, normalizeConfig } from "../src/domain";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let calls: string[] = [];
let invoke: (command: string) => Promise<unknown>;
let getUserMedia: () => Promise<MediaStream>;
const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    __TAURI_INTERNALS__: {
      invoke: (command: string) => {
        calls.push(command);
        return invoke(command);
      },
    },
  },
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
  Audio: class {
    autoplay = false;
    srcObject = null;
    setAttribute() {}
    pause() {}
    async play() {}
  },
  AudioContext: class {
    createAnalyser() {
      return { fftSize: 512 };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    async resume() {}
    async close() {}
  },
  document: { createElement: () => ({ pause() {}, srcObject: null }) },
  cancelAnimationFrame: () => {},
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { mediaDevices: { getUserMedia: () => getUserMedia() } },
});
const { SessionRuntime } = await import("../src/runtime");
const { GestureCamera } = await import("../src/gestures");
const runtime = () =>
  new SessionRuntime(
    () => structuredClone(defaults),
    () => {},
    () => {},
    () => {},
    () => {},
  );
beforeEach(() => {
  calls = [];
  storage.clear();
  invoke = async (name) =>
    name === "request_microphone_permission" ||
    name === "request_camera_permission"
      ? "authorized"
      : { ready: false, authorization: "disabled" };
  getUserMedia = async () => {
    throw new Error("Unexpected device acquisition");
  };
});

test("STOP while microphone permission is pending never starts capture or Voice", async () => {
  const permission = deferred<string>();
  invoke = async (name) =>
    name === "request_microphone_permission"
      ? permission.promise
      : { ready: false };
  const session = runtime();
  let opened = false;
  const starting = session.startVoice(async () => {
    opened = true;
  });
  await session.stopAll();
  permission.resolve("authorized");
  await starting;
  assert.equal(opened, false);
  assert.equal(calls.includes("start_codex_voice"), false);
  assert.equal(session.state.mode, "stopped");
});

test("a microphone that arrives after STOP is released immediately", async () => {
  const stream = deferred<MediaStream>();
  const acquiring = deferred<void>();
  let stopped = 0;
  getUserMedia = () => {
    acquiring.resolve();
    return stream.promise;
  };
  const session = runtime();
  const starting = session.startVoice();
  await acquiring.promise;
  await session.stopAll();
  stream.resolve({
    getTracks: () => [{ stop: () => stopped++ }],
  } as unknown as MediaStream);
  await starting;
  assert.equal(stopped, 1);
  assert.equal(session.state.voiceActive, false);
  assert.equal(calls.includes("start_codex_voice"), false);
});

test("STOP during thread startup prevents a queued text task from being submitted", async () => {
  const thread = deferred<{ threadId: string }>();
  invoke = async (name) =>
    name === "start_jarvis" ? thread.promise : { ready: false };
  const session = runtime();
  const sending = session.send("Only reply OK");
  await session.stopAll();
  thread.resolve({ threadId: "test-thread" });
  await sending;
  assert.equal(calls.includes("send_text"), false);
  assert.equal(session.state.taskActive, false);
  assert.equal(session.state.mode, "stopped");
});

test("leaving calibration while camera authorization is pending never opens the camera", async () => {
  const permission = deferred<string>();
  invoke = async () => permission.promise;
  const camera = new GestureCamera(
    () => defaults.gestures,
    () => {},
    () => {},
  );
  const starting = camera.start();
  camera.stop();
  permission.resolve("authorized");
  await starting;
  assert.equal(camera.running, false);
  assert.equal(camera.stream, null);
  assert.equal(camera.worker, null);
});

test("future configuration schemas are rejected without silently resetting preferences", () => {
  assert.throws(() => normalizeConfig({ schema: 99 }), /配置版本不兼容/);
  assert.deepEqual(normalizeConfig({}), defaults);
});

class FakePeer {
  static latest: FakePeer;
  connectionState = "new";
  iceGatheringState = "complete";
  localDescription = { sdp: "test-offer" };
  onconnectionstatechange: (() => void) | null = null;
  constructor() {
    FakePeer.latest = this;
  }
  addTrack() {}
  createDataChannel() {}
  async createOffer() {
    return this.localDescription;
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {
    this.connectionState = "closed";
  }
  connect() {
    this.connectionState = "connected";
    this.onconnectionstatechange?.();
  }
}
Object.assign(globalThis, { RTCPeerConnection: FakePeer });
function fakeMic() {
  const track = { stop() {}, enabled: true, muted: false, readyState: "live" };
  getUserMedia = async () =>
    ({
      getTracks: () => [track],
      getAudioTracks: () => [track],
    }) as unknown as MediaStream;
}
test("connected callbacks wait for both server and WebRTC; switching presentation reuses the call", async () => {
  fakeMic();
  const signalled = deferred<void>();
  invoke = async (name) => {
    if (name === "request_microphone_permission") return "authorized";
    if (name === "start_codex_voice") {
      signalled.resolve();
      return { threadId: "voice-thread" };
    }
    return { ready: false };
  };
  const session = runtime();
  let opened = 0;
  const starting = session.startVoice(async () => {
    opened++;
  });
  await signalled.promise;
  assert.equal(opened, 0);
  await (session as any).handle({
    method: "thread/realtime/started",
    params: { threadId: "voice-thread" },
  });
  assert.equal(opened, 0);
  FakePeer.latest.connect();
  await starting;
  assert.equal(opened, 1);
  assert.equal(session.state.voiceActive, true);
  await session.startVoice(async () => {
    opened++;
  });
  assert.equal(opened, 2);
  assert.equal(calls.filter((n) => n === "start_codex_voice").length, 1);
  await session.endVoice();
});
test("STOP during WebRTC setup cancels all queued connected callbacks", async () => {
  fakeMic();
  const signalled = deferred<void>();
  invoke = async (name) => {
    if (name === "request_microphone_permission") return "authorized";
    if (name === "start_codex_voice") {
      signalled.resolve();
      return { threadId: "voice-thread" };
    }
    return { ready: false };
  };
  const session = runtime();
  let opened = false;
  const starting = session.startVoice(async () => {
    opened = true;
  });
  await signalled.promise;
  const again = session.startVoice(async () => {
    opened = true;
  });
  await session.stopAll();
  await Promise.all([starting, again]);
  FakePeer.latest.connect();
  assert.equal(opened, false);
  assert.equal(session.state.voiceActive, false);
});

test("a timed-out microphone request releases a late stream", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = deferred<MediaStream>();
  let stopped = 0;
  getUserMedia = () => stream.promise;
  const session = runtime();
  const opening = (session as any).acquireMicrophone({ audio: true });
  const rejected = assert.rejects(opening, /麦克风打开超时/);
  t.mock.timers.tick(20000);
  await rejected;
  stream.resolve({
    getTracks: () => [{ stop: () => stopped++ }],
  } as unknown as MediaStream);
  await stream.promise;
  await Promise.resolve();
  assert.equal(stopped, 1);
});

test("capture waits for a visible session view; STOP during the window switch cancels capture", async () => {
  const shown = deferred<void>();
  invoke = async (name) =>
    name === "ensure_session_visible" ? shown.promise : { ready: false };
  const session = runtime();
  const starting = session.startVoice();
  assert.deepEqual(calls, ["ensure_session_visible"]);
  await session.stopAll();
  shown.resolve();
  await starting;
  assert.equal(calls.includes("request_microphone_permission"), false);
  assert.equal(calls.includes("start_codex_voice"), false);
  assert.equal(session.state.mode, "stopped");
});

const { executeSessionRequest } = await import("../src/session-bridge");
test("panel commands reach one session owner and STOP interrupts a pending voice request", async () => {
  const permission = deferred<string>();
  const acquiring = deferred<void>();
  invoke = async (name) => {
    if (name === "request_microphone_permission") {
      acquiring.resolve();
      return permission.promise;
    }
    return { ready: false };
  };
  const session = runtime();
  const request = {
    id: 1,
    config: structuredClone(defaults),
    method: "startVoice",
    args: [false],
  };
  const starting = executeSessionRequest(session, request);
  await acquiring.promise;
  await executeSessionRequest(session, {
    ...request,
    id: 2,
    method: "stopAll",
    args: [],
  });
  permission.resolve("authorized");
  assert.equal(await starting, false);
  assert.equal(calls.includes("start_codex_voice"), false);
  assert.equal(session.state.mode, "stopped");
});
test("the panel bridge rejects arbitrary member access", async () => {
  await assert.rejects(
    executeSessionRequest(runtime(), {
      id: 3,
      config: structuredClone(defaults),
      method: "constructor",
      args: [],
    }),
    /未知会话操作/,
  );
});

test("pause releases capture and playback, leaves the current task intact and suppresses wake", async () => {
  const session = runtime();
  let microphoneStops = 0,
    outputStops = 0,
    closedPeers = 0;
  Object.assign(session, {
    mic: { getTracks: () => [{ stop: () => microphoneStops++ }] },
    remote: { getTracks: () => [{ stop: () => outputStops++ }] },
    peer: { close: () => closedPeers++ },
  });
  session.state.voiceActive = true;
  session.state.taskActive = true;
  session.state.threadId = "preserved-thread";
  await session.pauseInteraction();
  assert.equal(session.state.paused, true);
  assert.equal(session.state.voiceActive, false);
  assert.equal(session.state.taskActive, true);
  assert.equal(session.state.threadId, "preserved-thread");
  assert.equal(microphoneStops, 1);
  assert.equal(outputStops, 1);
  assert.equal(closedPeers, 1);
  assert.equal(calls.includes("stop_all"), false);
  assert.equal(calls.includes("arm_wake_listener"), false);
  assert.equal(session.connectionStep, "已暂停");
});
test("resume from a visual-only pause does not open a microphone", async () => {
  const session = runtime();
  await session.pauseInteraction();
  await session.continueInteraction();
  assert.equal(session.state.paused, false);
  assert.equal(calls.includes("request_microphone_permission"), false);
});
test("STOP after pausing a call prevents Continue from reconnecting the stopped call", async () => {
  const session = runtime();
  session.state.voiceActive = true;
  await session.pauseInteraction();
  await session.stopAll();
  await session.continueInteraction();
  assert.equal(session.state.paused, false);
  assert.equal(session.state.voiceActive, false);
  assert.equal(calls.includes("request_microphone_permission"), false);
  assert.equal(calls.includes("start_codex_voice"), false);
});
test("pause during microphone acquisition releases late capture and never starts Voice", async () => {
  const stream = deferred<MediaStream>();
  const acquiring = deferred<void>();
  let stopped = 0;
  getUserMedia = () => {
    acquiring.resolve();
    return stream.promise;
  };
  const session = runtime();
  const starting = session.startVoice();
  await acquiring.promise;
  await session.pauseInteraction();
  stream.resolve({
    getTracks: () => [{ stop: () => stopped++ }],
  } as unknown as MediaStream);
  await starting;
  assert.equal(stopped, 1);
  assert.equal(session.state.paused, true);
  assert.equal(calls.includes("start_codex_voice"), false);
});
