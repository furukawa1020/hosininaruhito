export function fail(message, status = 400, code = 'invalid_request') {
  throw Object.assign(new Error(message), { publicMessage: message, status, code });
}

export function required(env, key) {
  if (typeof env[key] !== 'string' || !env[key].trim()) {
    fail(`${key} not configured`, 503, 'not_configured');
  }
  return env[key];
}

// Bound both time and bytes; never expose provider bodies, URLs or credentials.
export async function getJSON(url, options, { signal, timeoutMs = 12000 } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let reader;
  try {
    combined.throwIfAborted();
    const response = await fetch(url, { ...options, signal: combined, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      fail(`Upstream HTTP ${response.status}`, 502, 'upstream_http');
    }
    reader = response.body?.getReader();
    if (!reader) fail('Empty upstream response', 502, 'invalid_response');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) fail('Upstream response too large', 502, 'invalid_response');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('Invalid upstream JSON', 502, 'invalid_response'); }
  } catch (error) {
    if (signal?.aborted) fail('Request cancelled', 499, 'cancelled');
    if (timeout.aborted) fail('Upstream timed out', 504, 'upstream_timeout');
    if (error.publicMessage) throw error;
    fail('Upstream unavailable', 502, 'upstream_unavailable');
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
