import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';


let model;
let initializing = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    if (model || initializing) return;
    initializing = true;
    try {
      const assets = await FilesetResolver.forVisionTasks(new URL('/pose/wasm', self.location.origin).href, true);
      model = await PoseLandmarker.createFromOptions(assets, {
        baseOptions: { modelAssetPath: new URL('/models/pose_landmarker_lite.task', self.location.origin).href, delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 2, outputSegmentationMasks: false,
        // Model candidates use SDK defaults; core wrist visibility 0.8 and age 150ms remain unchanged.
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
      });
      // Initialize the detector before accepting sensor timestamps.
      const blank = new OffscreenCanvas(256, 256);
      blank.getContext('2d').fillRect(0, 0, 256, 256);
      model.detectForVideo(blank, 0).close();
      self.postMessage({ type: 'ready' });
    } catch {
      model?.close();
      model = null;
      self.postMessage({ type: 'error', reason: 'model_failed' });
    } finally { initializing = false; }
  } else if (data.type === 'frame') {
    let result;
    try {
      if (!model) throw new Error('Model unavailable');
      result = model.detectForVideo(data.bitmap, data.at);
      self.postMessage({ type: 'pose', id: data.id, at: data.at, result: { landmarks: result.landmarks } });
    } catch {
      self.postMessage({ type: 'error', reason: 'inference_failed' });
    } finally {
      result?.close();
      data.bitmap?.close();
    }
  } else if (data.type === 'close') {
    model?.close();
    model = null;
    self.close();
  }
};
