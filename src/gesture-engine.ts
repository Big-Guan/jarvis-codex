export function openGestureEngine() {
  const worker = new Worker(new URL("./gesture.worker.ts", import.meta.url), {
    type: "module",
  });
  let cancel = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("本机手势引擎加载超时"));
    }, 20000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      cancel = () => {};
      if (error) reject(error);
      else resolve();
    };
    cancel = () => {
      worker.terminate();
      finish(new DOMException("已停止加载", "AbortError"));
    };
    worker.onerror = (e) => finish(new Error(e.message || "手势引擎异常"));
    worker.onmessage = (e) => {
      if (e.data.type === "ready") finish();
      else if (e.data.type === "error") finish(new Error(e.data.message));
    };
    worker.postMessage({
      type: "init",
      base: new URL("/mediapipe", location.href).href,
    });
  });
  return { worker, ready, cancel: () => cancel() };
}

// Runs the real recognizer on an empty frame, without acquiring a camera.
export async function probeGestureEngine() {
  const engine = openGestureEngine();
  try {
    await engine.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const frame = await createImageBitmap(canvas);
    return await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("手势引擎推理超时")),
        10000,
      );
      engine.worker.onmessage = (e) => {
        clearTimeout(timer);
        if (e.data.type === "result") resolve(e.data.ms);
        else reject(new Error(e.data.message));
      };
      engine.worker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message));
      };
      engine.worker.postMessage(
        { type: "frame", image: frame, time: performance.now() },
        [frame],
      );
    });
  } finally {
    engine.cancel();
    engine.worker.terminate();
  }
}
