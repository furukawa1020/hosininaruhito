import { normalizePose, isFreshPoseTime, MAX_POSE_AGE_MS } from '../core/pose.js';
import {createPoseBitmap} from './pose-bitmap.js';
export const PERSON_SEARCH_MS = 15000;
export const INITIAL_STABLE_MS = 500;
export const MODEL_LOAD_MS = 20000;

export class PoseSession {
  constructor({ video, createWorker, createBitmap = () => createPoseBitmap(video),
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
    this.lastInputAt = null;
    this.stableSince = null;
    this.stableCount = 0;
    this.disposed = false;
  }
  get active() { return ['loading', 'searching', 'tracking'].includes(this.state); }
  snapshot() { return { state: this.state, reason: this.reason, ...(this.searchReason ? {searchReason:this.searchReason} : {}) }; }
  notify() { if (!this.disposed) this.onChange(this.snapshot()); }
  deadline(ms, reason) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(reason), ms);
  }
  searchAgain(reason) {
    if (this.state !== 'searching') return false;
    if (this.now() >= this.searchUntil) { this.stop('person_timeout'); return true; }
    this.inFlight = null;
    this.stableSince = null; this.stableCount = 0;
    const next = 'searching_' + reason;
    if (this.reason !== next) { this.reason = next; this.notify(); }
    this.schedule(this.generation);
    return true;
  }
  staleDuringSearch(at) {
    return Number.isFinite(at) && at >= 0 && this.now() >= at && this.now() - at > MAX_POSE_AGE_MS && this.searchAgain('slow');
  }
  stop(reason = 'manual', state = 'paused') {
    // Presentation only: retain the last search outcome, never a sensor sample.
    this.searchReason = reason === 'person_timeout' && this.state === 'searching' &&
      ['searching_slow','searching_no_person','searching_occluded','searching_out_of_frame','searching_multiple_people','searching_stable'].includes(this.reason)
      ? this.reason : null;
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
    this.lastInputAt = null;
    this.stableSince = null;
    this.stableCount = 0;
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
    this.startupUntil = this.now() + 2 * MODEL_LOAD_MS;
    this.loadWorker(this.generation, 'GPU');
  }
  loadWorker(generation, delegate) {
    if (generation !== this.generation || this.state !== 'loading') return;
    if (this.now() >= this.startupUntil) { this.stop('model_timeout'); return; }
    const loadUntil = Math.min(this.startupUntil, this.now() + MODEL_LOAD_MS);
    let worker = null;
    const fail = (reason, state = 'error') => {
      if (generation !== this.generation || worker !== this.worker) return;
      clearTimeout(this.timer);
      if (!this.isVisible()) { this.stop('hidden'); return; }
      if (delegate === 'GPU' && this.state === 'loading') {
        // Termination cancels a blocked GPU initializer before CPU work begins.
        try { worker?.postMessage({ type: 'close' }); } catch { /* already closed */ }
        worker?.terminate();
        this.worker = null;
        this.reason = 'loading_cpu'; this.notify();
        this.loadWorker(generation, 'CPU');
      } else this.stop(reason, state);
    };
    try {
      worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (generation !== this.generation || worker !== this.worker) return;
        if (!this.isVisible()) { this.stop('hidden'); return; }
        if (this.state === 'loading' && this.now() >= loadUntil) { fail('model_timeout', 'paused'); return; }
        if (data?.type === 'ready' && this.state === 'loading') {
          this.state = this.reason = 'searching';
          this.searchUntil = this.now() + PERSON_SEARCH_MS;
          this.notify();
          this.deadline(PERSON_SEARCH_MS, 'person_timeout');
          this.schedule(generation);
        } else if (data?.type === 'pose' && ['searching','tracking'].includes(this.state)) {
          if (!this.inFlight || data.id !== this.inFlight.id) return;
          if (this.state === 'searching' && this.now() >= this.searchUntil) { this.stop('person_timeout'); return; }
          if (data.at !== this.inFlight.at) { this.stop('stale_pose'); return; }
          if (!isFreshPoseTime(data.at, this.now(), this.lastAt)) {
            if (this.staleDuringSearch(data.at)) return;
            this.stop('stale_pose'); return;
          }
          const frame = normalizePose(data.result, data.at);
          if (!frame.tracked) {
            if (['no_person','occluded','multiple_people','out_of_frame'].includes(frame.reason) && this.searchAgain(frame.reason)) return;
            this.stop(frame.reason); return;
          }
          // A single lucky frame must not end the framing period. Require a
          // continuous fresh sequence before enabling calibration or capture.
          if (this.state === 'searching') {
            const deliveryGap = this.stableSince !== null && this.lastAt !== null && this.now() - this.lastAt > MAX_POSE_AGE_MS;
            if (this.stableSince === null || deliveryGap) {
              this.stableSince = frame.at; this.stableCount = 0;
            }
            this.stableCount++;
            this.lastAt = frame.at;
            this.inFlight = null;
            if (frame.at - this.stableSince < INITIAL_STABLE_MS || this.stableCount < 5) {
              const reason = deliveryGap ? 'searching_slow' : 'searching_stable';
              if (this.reason !== reason) { this.reason = reason; this.notify(); }
              this.schedule(generation);
              return;
            }
            this.state = this.reason = 'tracking'; this.notify();
          }
          this.lastAt = frame.at;
          this.inFlight = null;
          this.onSample({ ...frame, latencyMs: this.now() - frame.at });
          this.deadline(Math.max(0, MAX_POSE_AGE_MS - (this.now() - frame.at)), 'frame_gap');
          this.schedule(generation);
        } else if (data?.type === 'error') {
          fail(data.reason === 'model_failed' ? 'model_failed' : 'inference_failed');
        }
      };
      worker.onerror = event => {
        event.preventDefault?.();
        fail('inference_failed');
      };
      worker.onmessageerror = () => {
        if (generation === this.generation && worker === this.worker) this.stop('invalid_pose', 'error');
      };
      this.timer = setTimeout(() => fail('model_timeout', 'paused'), Math.max(0, loadUntil - this.now()));
      worker.postMessage({ type: 'init', delegate });
    } catch { fail('unsupported'); }
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
    if (this.state === 'searching' && this.now() >= this.searchUntil) { this.stop('person_timeout'); return; }
    // All timestamps stay in the Window performance clock, never worker time.
    // captureTime is optional; presentationTime is the frame's browser arrival.
    const at = metadata?.captureTime ?? metadata?.presentationTime;
    if (this.lastInputAt !== null && at <= this.lastInputAt) { this.stop('stale_pose'); return; }
    if (!isFreshPoseTime(at, this.now(), this.lastAt)) { if (!this.staleDuringSearch(at)) this.stop('stale_pose'); return; }
    this.lastInputAt = at;
    const id = ++this.nextId;
    this.inFlight = { id, at };
    if (this.state === 'tracking') this.deadline(Math.max(0, MAX_POSE_AGE_MS - (this.now() - at)), 'stale_pose');
    let bitmap;
    try {
      bitmap = await this.createBitmap();
      if (generation !== this.generation) { bitmap.close(); return; }
      if (!this.isVisible()) { bitmap.close(); this.stop('hidden'); return; }
      if (this.state === 'searching' && this.now() >= this.searchUntil) { bitmap.close(); this.stop('person_timeout'); return; }
      if (!isFreshPoseTime(at, this.now(), this.lastAt)) { bitmap.close(); if (!this.staleDuringSearch(at)) this.stop('stale_pose'); return; }
      this.worker.postMessage({ type: 'frame', id, at, bitmap }, [bitmap]);
      // Ownership is transferred to the worker, which closes it in finally.
    } catch {
      bitmap?.close();
      if (generation === this.generation) this.stop('inference_failed', 'error');
    }
  }
}
