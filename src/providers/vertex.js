import { GoogleAuth } from 'google-auth-library';
import { getJSON, fail, required } from './http.js';
import { planWithProvider, PLANNER_LIMITS } from './planner.js';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
export function vertexConfig(env) {
  const project = required(env, 'VERTEX_PROJECT_ID');
  const location = required(env, 'VERTEX_LOCATION');
  const model = required(env, 'VERTEX_MODEL');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
      !/^(global|[a-z]+-[a-z]+[0-9]+)$/.test(location) ||
      !/^gemini-[a-z0-9.-]{1,100}$/.test(model))
    fail('Invalid Vertex configuration', 503, 'planner_configuration');
  return { project, location, model };
}

// ADC may still finish refreshing after cancellation. Never start generation afterwards.
async function accessToken(authClient, signal) {
  signal.throwIfAborted();
  let abort;
  try {
    const token = await Promise.race([
      authClient.getAccessToken(),
      new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })
    ]);
    signal.throwIfAborted();
    if (typeof token !== 'string' || !token.trim()) throw Error();
    return token;
  } catch {
    signal.throwIfAborted();
    fail('Vertex credentials unavailable', 502, 'upstream_auth');
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}

export async function runVertexTurn(prompt, { env, signal, outputSchema, authClient = auth, request = getJSON }) {
  const { project, location, model } = vertexConfig(env);
  const token = await accessToken(authClient, signal);
  const host = location === 'global' ? 'aiplatform.googleapis.com' : location + '-aiplatform.googleapis.com';
  const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  // Only the supported Vertex schema subset. Local validation rejects extra keys.
  const responseSchema = { type: 'OBJECT', required: ['order'], properties: { order: {
    type: 'ARRAY', minItems: outputSchema.properties.order.minItems, maxItems: outputSchema.properties.order.maxItems,
    items: { type: 'STRING', enum: outputSchema.properties.order.items.enum }
  } } };
  signal.throwIfAborted();
  const data = await request(url, { method: 'POST', headers: {
    Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'
  }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { candidateCount: 1, maxOutputTokens: 1024, responseMimeType: 'application/json', responseSchema }
  }) }, { signal, timeoutMs: PLANNER_LIMITS.timeoutMs });
  signal.throwIfAborted();
  const candidate = data?.candidates?.[0], usage = data?.usageMetadata;
  if (data?.candidates?.length !== 1 || candidate?.finishReason !== 'STOP' ||
      candidate.content?.role !== 'model' || !Array.isArray(candidate.content.parts) || !candidate.content.parts.length ||
      candidate.content.parts.some(p => !p || typeof p.text !== 'string' ||
        Object.keys(p).some(k => !['text', 'thought', 'thoughtSignature'].includes(k)) ||
        (p.thought !== undefined && typeof p.thought !== 'boolean')) ||
      !usage || !['promptTokenCount', 'totalTokenCount'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0) ||
      usage.totalTokenCount < usage.promptTokenCount)
    fail('Invalid Vertex response', 502, 'invalid_response');
  return { finalResponse: candidate.content.parts.filter(p => !p.thought).map(p => p.text).join(''),
    // total includes thought tokens; do not undercount reasoning as free output.
    usage: { input_tokens: usage.promptTokenCount, output_tokens: usage.totalTokenCount - usage.promptTokenCount } };
}

export async function planWithVertex(input, env, options = {}) {
  const { model } = vertexConfig(env);
  return planWithProvider(input, env, { ...options, run: options.run || runVertexTurn, model, source: 'vertex-live' });
}
