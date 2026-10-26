import { call, on, skinURL, loadConfig } from "./platform";
import { Snapshot, builtinSkin, normalizeConfig } from "./domain";
import { ArmorScene } from "./armor-scene";
import { GestureCamera } from "./gestures";
import { GestureMachine } from "./gesture-machine";
import { SessionRuntime } from "./runtime";
import { executeSessionRequest, SessionRequest } from "./session-bridge";
let sessionConfig = await loadConfig();
let sessionReady = false;
let cameraPreview = false;
document.documentElement.dataset.surface = "desktop";
const session = new SessionRuntime(
  () => sessionConfig,
  () => {
    void publishSession();
  },
  (input, output) => {
    void call("publish_levels", { input, output });
  },
  (cold) => {
    void call("session_signal", { signal: { type: "wake", cold } });
  },
  (action) => {
    void call("session_signal", { signal: { type: "action", action } });
  },
);
async function publishSession() {
  void syncCamera();
  await call("publish_session", {
    session: {
      ready: sessionReady,
      state: session.state,
      connecting: session.connecting,
      connectionStep: session.connectionStep,
    },
  });
}
document.documentElement.classList.add("avatar-window");
const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = '<div id="avatar-stage"></div>';
let snapshot: Snapshot | null = null,
  lastCommand = 0,
  lastRevision = 0,
  shown = false,
  lastPoseSent = 0,
  configuredSkin = "",
  loadingSkin = "",
  cameraKey = "",
  failedCameraKey = "";
const machine = new GestureMachine();
const feedback = (data: Record<string, unknown>) =>
  void call("avatar_feedback", { feedback: data }).catch(console.error);
const stage = new ArmorScene(document.querySelector("#avatar-stage")!, {
  error: (error) => feedback({ error, visualError: true }),
  pose: (pose) => {
    if (performance.now() - lastPoseSent > 150) {
      lastPoseSent = performance.now();
      feedback({ pose });
    }
  },
  finished: () => {
    feedback({ finished: true });
    if (snapshot) enqueue(snapshot);
  },
  bounds: (bounds) => feedback({ bounds }),
  dragging: (dragging) =>
    void call("mouse_control", { enabled: stage.mouse, dragging }),
});
stage.desktop = true;
stage.mouse = true;
stage.active = false;
stage.runtime = session.state;
app.style.visibility = "hidden";
const camera = new GestureCamera(
  () => snapshot!.config.gestures,
  (input) => {
    if (!snapshot) return;
    const patch = machine.step(
      input,
      performance.now(),
      { ...stage.target, spread: stage.pose.spread },
      snapshot.config.gestures,
      stage.playing || stage.gestureBlocked || !shown || session.state.paused,
    );
    if (patch) stage.setPose(patch, true);
  },
  (status) => feedback({ cameraStatus: status }),
);
async function syncCamera() {
  if (!snapshot) return;
  const key = JSON.stringify(snapshot.config.gestures);
  if (
    session.state.paused ||
    cameraPreview ||
    !shown ||
    !snapshot.config.gestures.enabled ||
    snapshot.command.type === "test"
  ) {
    camera.stop();
    machine.reset();
    cameraKey = "";
    failedCameraKey = "";
    return;
  }
  if ((camera.running && key === cameraKey) || failedCameraKey === key) return;
  if (camera.running) camera.stop();
  cameraKey = key;
  try {
    await camera.start();
  } catch (error) {
    failedCameraKey = key;
    feedback({ error: String(error), cameraStatus: String(error) });
  }
}
async function update(next: Snapshot) {
  if (!next?.config) return;
  snapshot = next;
  shown = next.visible;
  stage.active = shown;
  stage.runtime = session.state;
  sessionConfig = next.config;
  app.style.visibility = shown ? "visible" : "hidden";
  const newCommand = next.command.id !== lastCommand;
  if (stage.playing && !newCommand) return;
  if (lastRevision !== next.revision || newCommand) {
    stage.setConfig(next.config);
    lastRevision = next.revision;
  }
  const skin =
    next.skins.find((s) => s.id === next.config.appearance.skin) ?? builtinSkin;
  if (configuredSkin !== skin.id && loadingSkin !== skin.id) {
    loadingSkin = skin.id;
    try {
      await stage.load(skinURL(skin));
      configuredSkin = skin.id;
    } catch (error) {
      feedback({ error: `模型载入失败：${error}`, visualError: true });
      return;
    } finally {
      loadingSkin = "";
    }
  }
  if (newCommand) {
    lastCommand = next.command.id;
    const type = next.command.type;
    if (type === "prepare") {
      app.style.visibility = "hidden";
      stage.active = false;
      camera.stop();
      feedback({ bounds: null });
      feedback({ prepared: next.command.id });
      return;
    }
    app.style.visibility = shown ? "visible" : "hidden";
    if (type === "summon" || type === "test") {
      stage.setPose(next.pose);
      stage.play();
    } else if (type === "restore") {
      stage.skip();
      stage.setPose(next.pose);
    } else if (type === "skip") stage.skip();
    else if (type === "stop") {
      machine.reset();
      stage.stop();
    } else if (type === "center") {
      stage.stop();
    } else if (type === "mouse-on") stage.mouse = true;
    else if (type === "mouse-off") stage.mouse = false;
  }
  void syncCamera();
}
let pending: Snapshot | null = null,
  updating = false;
function enqueue(next: Snapshot) {
  pending = next;
  if (updating) return;
  updating = true;
  void (async () => {
    try {
      while (pending) {
        const value = pending;
        pending = null;
        await update(value);
      }
    } catch (error) {
      feedback({ error: String(error) });
    } finally {
      updating = false;
    }
  })();
}
await on<Snapshot>("next-state", enqueue);
await on<{ input: number; output: number }>("next-levels", (levels) => {
  stage.runtime.inputLevel = levels.input;
  stage.runtime.outputLevel = levels.output;
});
await on<boolean>("next-visibility", (visible) => {
  shown = visible;
  app.style.visibility = visible ? "visible" : "hidden";
  document.documentElement.dataset.surface = visible
    ? "desktop"
    : "hidden-artwork";
  stage.active = visible;
  if (snapshot) snapshot.visible = visible;
  void syncCamera();
});
await on<SessionRequest>("next-session-request", (request) => {
  void (async () => {
    try {
      sessionConfig = normalizeConfig(request.config);
      let value: unknown;
      if (request.method === "cameraPreview") {
        cameraPreview = request.args[0] === true;
        await syncCamera();
      } else value = await executeSessionRequest(session, request);
      await publishSession();
      await call("reply_session", { reply: { id: request.id, value } });
    } catch (error) {
      await publishSession();
      await call("reply_session", {
        reply: { id: request.id, error: String(error) },
      });
    }
  })();
});
await session.init(false);
sessionReady = true;
await publishSession();
const initial = await call<Snapshot>("read_snapshot");
if (initial?.config) enqueue(initial);
window.addEventListener("pagehide", () => {
  camera.stop();
  stage.dispose();
});
