const cameraErrors = {
  NotAllowedError: 'denied',
  SecurityError: 'denied',
  NotFoundError: 'missing',
  NotReadableError: 'unavailable',
  AbortError: 'unavailable',
  OverconstrainedError: 'unavailable'
};

function release(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

// getUserMedia cannot be aborted. Keep one acquisition pending and release any
// late stream before attaching it, even after this session has been disposed.
export class CameraSession {
  constructor({ video, mediaDevices = globalThis.navigator?.mediaDevices,
    isVisible = () => !document.hidden, isSecure = () => globalThis.isSecureContext,
    onChange = () => {} }) {
    this.video = video;
    this.mediaDevices = mediaDevices;
    this.isVisible = isVisible;
    this.isSecure = isSecure;
    this.onChange = onChange;
    this.state = 'idle';
    this.reason = 'idle';
    this.pending = false;
    this.generation = 0;
    this.stream = null;
    this.listeners = [];
    this.disposed = false;
  }

  snapshot() { return { state: this.state, reason: this.reason, pending: this.pending }; }
  notify() { if (!this.disposed) this.onChange(this.snapshot()); }
  setState(state, reason) { this.state = state; this.reason = reason; this.notify(); }

  detach() {
    for (const remove of this.listeners) remove();
    this.listeners = [];
    const stream = this.stream;
    this.stream = null;
    this.cancelPlayback?.();
    this.video.pause();
    this.video.srcObject = null;
    release(stream);
  }

  stop(reason = 'manual') {
    if (this.disposed) return;
    this.generation++;
    this.detach();
    this.setState('paused', reason);
  }

  dispose() {
    this.stop('disposed');
    this.disposed = true;
    this.onChange = () => {};
  }

  async start({ consent = false } = {}) {
    if (this.disposed || this.pending || this.stream) return;
    if (!consent) { this.setState('error', 'consent'); return; }
    if (!this.isVisible()) { this.setState('paused', 'hidden'); return; }
    if (!this.isSecure() || !this.mediaDevices?.getUserMedia) {
      this.setState('error', 'unsupported'); return;
    }
    const generation = ++this.generation;
    const current = () => !this.disposed && generation === this.generation && this.isVisible();
    this.pending = true;
    this.setState('requesting', 'requesting');
    let acquired;
    try {
      acquired = await this.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (!current()) {
        release(acquired);
        if (!this.disposed && generation === this.generation) this.stop('hidden');
        return;
      }
      if (!acquired.getVideoTracks().some(track => track.readyState === 'live')) {
        release(acquired);
        this.setState('error', 'unavailable');
        return;
      }
      this.stream = acquired;
      // Audio was not requested. Never keep unexpected audio tracks active.
      for (const track of acquired.getAudioTracks()) track.stop();
      const listen = (target, event, reason) => {
        const handler = () => { if (generation === this.generation) this.stop(reason); };
        target.addEventListener(event, handler);
        this.listeners.push(() => target.removeEventListener(event, handler));
      };
      for (const track of acquired.getVideoTracks()) {
        listen(track, 'ended', 'disconnected');
        listen(track, 'mute', 'interrupted');
      }
      listen(acquired, 'inactive', 'disconnected');
      this.video.srcObject = acquired;
      let timer;
      try {
        await new Promise((resolve, reject) => {
          this.cancelPlayback = resolve;
          timer = setTimeout(() => reject(new Error('Playback timeout')), 8000);
          Promise.resolve(this.video.play()).then(resolve, reject);
        });
      } finally {
        clearTimeout(timer);
        this.cancelPlayback = null;
      }
      if (!current()) {
        release(acquired);
        if (!this.disposed && generation === this.generation) this.stop('hidden');
        return;
      }
      if (acquired.getVideoTracks().some(track => track.muted)) {
        this.stop('interrupted');
        return;
      }
      this.setState('preview', 'preview');
    } catch (error) {
      release(acquired);
      if (generation === this.generation && !this.disposed) {
        this.detach();
        this.setState('error', cameraErrors[error?.name] || 'failed');
      }
    } finally {
      this.pending = false;
      this.notify();
    }
  }
}
