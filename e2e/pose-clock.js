// Only synthetic-worker UI tests use this clock. Real SDK/video tests do not.
export async function installPoseClock(page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.addInitScript(() => {
    window.poseFixtureFrames = true;
    window.createImageBitmap = async () => ({ close() {} });
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
      return setTimeout(() => {
        if (!window.poseFixtureFrames) return;
        const at = performance.now();
        callback(at, { captureTime: at });
      }, 33);
    };
    HTMLVideoElement.prototype.cancelVideoFrameCallback = function(id) { clearTimeout(id); };
  });
}
