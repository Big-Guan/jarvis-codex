import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
let recognizer: GestureRecognizer | null = null;
self.onmessage = async (e: MessageEvent) => {
  const data = e.data;
  try {
    if (data.type === "init") {
      const files = await FilesetResolver.forVisionTasks(
        `${data.base}/wasm`,
        true,
      );
      recognizer = await GestureRecognizer.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: `${data.base}/gesture_recognizer.task`,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame" && recognizer) {
      const started = performance.now();
      try {
        const result = recognizer.recognizeForVideo(data.image, data.time);
        self.postMessage({
          type: "result",
          result,
          ms: performance.now() - started,
        });
      } finally {
        data.image.close();
      }
    }
  } catch (error) {
    if (data.image) data.image.close();
    self.postMessage({ type: "error", message: String(error) });
  }
};
