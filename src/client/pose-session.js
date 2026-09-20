import { normalizePose, isFreshPoseTime, MAX_POSE_AGE_MS } from '../core/pose.js';

export class PoseSession {
  constructor({ video, createWorker, createBitmap = () => createImageBitmap(video),
    now = () => performance.now(), isVisible = () => !document.hidden,
    onChange = () => {}, onSample = () => {} }) {
    Object.assign(this, { video, createWorker, createBitmap, now, isVisible, onChange, onSample });
    this.generation = 0;
    this.nextId = 0;
    this.state = 'idle';
    this.reason = 'idle';
    this.worker = null;
    this.callbackId = null;
    this.timer = null;
    this.inFlight = null;
    this.lastAt = null;
    this.disposed = false;
  }
  get active() { return this.state === 'loading' || this.state === 'tracking'; }
  snapshot() { return { state: this.state, reason: this.reason }; }
  notify() { if (!this.disposed) this.onChange(this.snapshot()); }
  deadline(ms, reason) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(reason), ms);
  }
  stop(reason = 'manual', state = 'paused') {
    this.generation++;
    clearTimeout(this.timer);
    if (this.callbackId !== null) this.video.cancelVideoFrameCallback(this.callbackId);
    this.callbackId = null;
    if (this.worker) {
      try { this.worker.postMessage({ type: 'close' }); } catch { /* already closed */ }
      this.worker.terminate();
      this.worker = null;
    }
    this.inFlight = null;
    this.lastAt = null;
    this.state = state;
    this.reason = reason;
    this.onSample(null);
    this.notify();
  }
  dispose() {
    this.stop('disposed');
    this.disposed = true;
    this.onChange = this.onSample = () => {};
  }
  start() {
    if (this.disposed || this.active) return;
    if (!this.isVisible() || !this.video.srcObject) { this.stop('camera_stopped'); return; }
    if (!this.video.requestVideoFrameCallback || !this.video.cancelVideoFrameCallback) {
      this.stop('unsupported', 'error'); return;
    }
    this.stop('loading', 'loading');
    const generation = this.generation;
    try {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (generation !== this.generation || worker !== this.worker) return;
        if (!this.isVisible()) { this.stop('hidden'); return; }
        if (data?.type === 'ready' && this.state === 'loading') {
          this.state = 'tracking';
          this.reason = 'tracking';
          this.notify();
          this.deadline(MAX_POSE_AGE_MS, 'frame_gap');
          this.schedule(generation);
        } else if (data?.type === 'pose' && this.state === 'tracking') {
          if (!this.inFlight || data.id !== this.inFlight.id) return;
          if (data.at !== this.inFlight.at || !isFreshPoseTime(data.at, this.now(), this.lastAt)) {
            this.stop('stale_pose'); return;
          }
          const frame = normalizePose(data.result, data.at);
          if (!frame.tracked) { this.stop(frame.reason); return; }
          this.lastAt = frame.at;
          this.inFlight = null;
          this.onSample({ ...frame, latencyMs: this.now() - frame.at });
          this.deadline(Math.max(0, MAX_POSE_AGE_MS - (this.now() - frame.at)), 'frame_gap');
          this.schedule(generation);
        } else if (data?.type === 'error') {
          this.stop(data.reason === 'model_failed' ? 'model_failed' : 'inference_failed', 'error');
        }
      };
      worker.onerror = event => {
        event.preventDefault?.();
        if (generation === this.generation) this.stop('inference_failed', 'error');
      };
      worker.onmessageerror = () => {
        if (generation === this.generation) this.stop('invalid_pose', 'error');
      };
      this.deadline(20000, 'model_timeout');
      worker.postMessage({ type: 'init' });
    } catch { this.stop('unsupported', 'error'); }
  }
  schedule(generation) {
    if (generation !== this.generation || this.inFlight) return;
    this.callbackId = this.video.requestVideoFrameCallback((_, metadata) => {
      this.callbackId = null;
      this.capture(generation, metadata);
    });
  }
  async capture(generation, metadata) {
    if (generation !== this.generation || this.inFlight) return;
    if (!this.isVisible()) { this.stop('hidden'); return; }
    // All timestamps stay in the Window performance clock, never worker time.
    // captureTime is optional; presentationTime is the frame's browser arrival.
    const at = metadata?.captureTime ?? metadata?.presentationTime;
    if (!isFreshPoseTime(at, this.now(), this.lastAt)) { this.stop('stale_pose'); return; }
    const id = ++this.nextId;
    this.inFlight = { id, at };
    this.deadline(Math.max(0, MAX_POSE_AGE_MS - (this.now() - at)), 'stale_pose');
    let bitmap;
    try {
      bitmap = await this.createBitmap();
      if (generation !== this.generation) { bitmap.close(); return; }
      if (!this.isVisible() || !isFreshPoseTime(at, this.now(), this.lastAt)) {
        bitmap.close(); this.stop('stale_pose'); return;
      }
      this.worker.postMessage({ type: 'frame', id, at, bitmap }, [bitmap]);
      // Ownership is transferred to the worker, which closes it in finally.
    } catch {
      bitmap?.close();
      if (generation === this.generation) this.stop('inference_failed', 'error');
    }
  }
}
