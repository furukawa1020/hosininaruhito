// Warm the selected real model before accepting camera measurements.
export async function createPoseModel({create, modelAssetPath, delegate = 'GPU', createCanvas = (width=256,height=256) => new OffscreenCanvas(width,height), now = () => performance.now()}) {
  let model;
  try {
    if (!['GPU', 'CPU'].includes(delegate)) throw new Error('unsupported_delegate');
    model = await create({
      baseOptions: {modelAssetPath, delegate},
      ...(delegate === 'GPU' ? {canvas: createCanvas()} : {}),
      runningMode:'VIDEO', numPoses:2, outputSegmentationMasks:false,
      minPoseDetectionConfidence:.5, minPosePresenceConfidence:.5, minTrackingConfidence:.5
    });
    const blank = delegate === 'GPU' ? createCanvas(640,640) : createCanvas();
    blank.getContext('2d').fillRect(0,0,256,256);
    model.detectForVideo(blank,0).close();
    if (delegate === 'GPU') {
      // Some browsers expose a software GPU. Reject a slow backend before ready,
      // leaving room for camera transport within the unchanged 150ms contract.
      const started = now();
      model.detectForVideo(blank,1).close();
      const elapsed = now() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 100) throw new Error('slow_gpu');
    }
    return model;
  } catch {
    try { model?.close(); } catch { /* Worker termination releases remaining resources. */ }
    throw new Error('model_failed');
  }
}
