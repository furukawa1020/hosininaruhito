// Only the current request may update the UI, even if transport ignores abort.
export class RequestSession {
  current = null;
  begin() {
    this.cancel();
    const controller = new AbortController();
    this.current = controller;
    return { signal: controller.signal, isCurrent: () => this.current === controller && !controller.signal.aborted };
  }
  cancel() {
    this.current?.abort();
    this.current = null;
  }
}

export function parseCoordinates(lat, lng) {
  if (lat.trim() === '' || lng.trim() === '') throw new Error('緯度と経度を両方入力してください。');
  const coordinates = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(coordinates.lat) || Math.abs(coordinates.lat) > 90 ||
      !Number.isFinite(coordinates.lng) || Math.abs(coordinates.lng) > 180) {
    throw new Error('緯度は−90〜90、経度は−180〜180で入力してください。');
  }
  return coordinates;
}

// SDK token refresh cannot necessarily be cancelled, but its consumer can be.
export function waitForAuth(promise, signal, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const until = performance.now() + timeoutMs;
    let settled = false;
    const finish = (done, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); done(value);
    };
    const timeout = () => finish(reject, new DOMException('認証情報の確認が時間内に終わりませんでした。', 'TimeoutError'));
    const abort = () => finish(reject, signal.reason);
    const timer = setTimeout(timeout, timeoutMs);
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
    Promise.resolve(promise).then(value => {
      if (performance.now() >= until) timeout();
      else finish(resolve, value);
    }, error => {
      if (performance.now() >= until) timeout();
      else finish(reject, error);
    });
  });
}
