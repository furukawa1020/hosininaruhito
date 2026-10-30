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

// Bound both transport and body reading, even when they ignore cancellation.
export async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const operation = Promise.resolve().then(async () => {
    signal.throwIfAborted();
    const response = await fetch(url, {...options, signal});
    signal.throwIfAborted();
    const data = await response.json();
    return {response, data};
  });
  try { return await waitForOperation(operation, signal, timeoutMs, '通信が時間内に終わりませんでした。'); }
  finally { controller.abort(); }
}

// SDK token refresh cannot necessarily be cancelled, but its consumer can be.
export function waitForAuth(promise, signal, timeoutMs = 10000) {
  return waitForOperation(promise, signal, timeoutMs, '認証情報の確認が時間内に終わりませんでした。');
}

function waitForOperation(promise, signal, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const until = performance.now() + timeoutMs;
    let settled = false;
    const finish = (done, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); done(value);
    };
    const timeout = () => finish(reject, new DOMException(message, 'TimeoutError'));
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
