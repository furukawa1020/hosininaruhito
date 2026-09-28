import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {createPoseModel} from './pose-model.js';


let model;
let initializing = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    if (model || initializing) return;
    initializing = true;
    try {
      const assets = await FilesetResolver.forVisionTasks(new URL('/pose/wasm', self.location.origin).href, true);
      model = await createPoseModel({
        create: options => PoseLandmarker.createFromOptions(assets, options),
        modelAssetPath: new URL('/models/pose_landmarker_lite.task', self.location.origin).href
      });
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
