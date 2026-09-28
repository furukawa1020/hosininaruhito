// Warm the real CPU model before accepting camera measurements.
export async function createPoseModel({create, modelAssetPath, createCanvas = () => new OffscreenCanvas(256,256)}) {
  let model;
  try {
    model = await create({
      baseOptions: {modelAssetPath, delegate:'CPU'},
      runningMode:'VIDEO', numPoses:2, outputSegmentationMasks:false,
      minPoseDetectionConfidence:.5, minPosePresenceConfidence:.5, minTrackingConfidence:.5
    });
    const blank = createCanvas();
    blank.getContext('2d').fillRect(0,0,256,256);
    model.detectForVideo(blank,0).close();
    return model;
  } catch {
    try { model?.close(); } catch { /* Worker termination releases remaining resources. */ }
    throw new Error('model_failed');
  }
}
