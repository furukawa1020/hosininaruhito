import {waitForOperation} from './requests.js';

// The advisory budget includes authentication, transport and reading the body.
export async function requestAdvice(body, {signal, headers}) {
  const controller = new AbortController();
  const owned = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const until = performance.now() + 1000;
  const guard = () => {
    owned.throwIfAborted();
    if (performance.now() >= until) throw new DOMException('助言の時間切れです。', 'TimeoutError');
  };
  const operation = Promise.resolve().then(async () => {
    guard();
    const auth = await headers(owned);
    guard();
    const response = await fetch('/api/reflex', {method:'POST', headers:auth, body:JSON.stringify(body), signal:owned});
    guard();
    if (!response.ok) throw Error('request_failed');
    return response.json();
  });
  try { return await waitForOperation(operation, owned, 1000, '助言の時間切れです。'); }
  finally { controller.abort(); }
}
