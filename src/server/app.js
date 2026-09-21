import { Hono } from 'hono';
import { browserPolicy } from './security.js';
import { timingSafeEqual } from 'node:crypto';
import { bodyLimit } from 'hono/body-limit';
import { projectConstellation } from '../providers/projection.js';
import { getConstellationCatalog } from '../providers/catalog.js';
import { observeSky, decideReflex } from '../providers/live.js';
import { planProgram, plannerStatus } from '../providers/planning.js';

export function createApp(env = process.env, providers = { observeSky, decideReflex, planProgram, getConstellationCatalog, projectConstellation }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('Content-Security-Policy', browserPolicy);
    c.header('Permissions-Policy', 'camera=(self), microphone=()');
    await next();
  });
  const configured = key => typeof env[key] === 'string' && !!env[key].trim();
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/api/status', c => {
    const planner = plannerStatus(env);
    const services = {
      access: configured('HCR_ACCESS_TOKEN'), sky: configured('HOSHIMIRU_API_TOKEN'),
      reflex: configured('TYPESAFE_API_KEY'), planner: planner.configured
    };
    return c.json({ mode: 'live', configured: Object.values(services).every(Boolean), services, plannerProvider: planner.provider });
  });
  app.use('/api/*', async (c, next) => {
    if (!configured('HCR_ACCESS_TOKEN')) return c.json({ error: 'HCR_ACCESS_TOKEN not configured', code: 'not_configured' }, 503);
    const a = Buffer.from(c.req.header('Authorization') || ''), b = Buffer.from('Bearer ' + env.HCR_ACCESS_TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: 'Unauthorized', code: 'unauthorized' }, 401);
    await next();
  });
  let busy = false;
  app.use('/api/*', async (c, next) => {
    if (busy) { c.header('Retry-After', '1'); return c.json({ error: 'Busy', code: 'busy' }, 429); }
    busy = true;
    try { await next(); } finally { busy = false; }
  });
  app.use('/api/*', bodyLimit({
    maxSize: 16384,
    onError: c => c.json({ error: 'Payload too large', code: 'payload_too_large' }, 413)
  }));
  for (const [path, provider] of [
    ['/api/project', 'projectConstellation'], ['/api/catalog', 'getConstellationCatalog'], ['/api/sky', 'observeSky'], ['/api/reflex', 'decideReflex'], ['/api/program', 'planProgram']
  ]) {
    app.post(path, async c => {
      if (path === '/api/program' && c.req.header('X-HCR-Planner') !== plannerStatus(env).provider)
        return c.json({ error: 'Planner destination changed', code: 'planner_destination_changed' }, 409);
      let input;
      try { input = await c.req.json(); }
      catch { return c.json({ error: 'Invalid JSON', code: 'invalid_json' }, 400); }
      return c.json(await providers[provider](input, env, { signal: c.req.raw.signal }));
    });
  }
  app.notFound(c => c.json({ error: 'Not found', code: 'not_found' }, 404));
  app.onError((err, c) => {
    if (c.req.raw.signal.aborted) return c.json({ error: 'Request cancelled', code: 'cancelled' }, 499);
    return c.json({
      error: err.publicMessage || 'Invalid request or upstream failure',
      code: err.publicMessage ? err.code || 'upstream_failure' : 'upstream_failure'
    }, err.publicMessage ? err.status || 502 : 502);
  });
  return app;
}
export const app = createApp();

