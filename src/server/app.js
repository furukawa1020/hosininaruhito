import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { bodyLimit } from 'hono/body-limit';
import { observeSky, decideReflex, planWithCodex } from '../providers/live.js';
export function createApp(env = process.env, providers = { observeSky, decideReflex, planWithCodex }) {
  const app = new Hono();
  app.get('/api/status', c => c.json({ mode: 'live', configured: ['HCR_ACCESS_TOKEN','HOSHIMIRU_API_TOKEN','TYPESAFE_API_KEY','OPENAI_API_KEY','CODEX_MODEL'].every(k => !!env[k]) }));
  app.use('/api/*', bodyLimit({ maxSize: 16384 }));
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!env.HCR_ACCESS_TOKEN) return c.json({ error: 'HCR_ACCESS_TOKEN not configured' }, 503);
    const a = Buffer.from(c.req.header('Authorization') || ''), b = Buffer.from(`Bearer ${env.HCR_ACCESS_TOKEN}`);
    if (a.length !== b.length || !timingSafeEqual(a,b)) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  });
  let busy = false;
  app.use('/api/*', async (c,next) => {
    if (busy) return c.json({ error: 'Busy' },429);
    busy = true; try { await next(); } finally { busy = false; }
  });
  app.post('/api/sky', async c => c.json(await providers.observeSky(await c.req.json(), env)));
  app.post('/api/reflex', async c => c.json(await providers.decideReflex(await c.req.json(), env)));
  app.post('/api/program', async c => c.json(await providers.planWithCodex(await c.req.json(), env)));
  app.onError((err,c) => c.json({ error: err.publicMessage || 'Invalid request or upstream failure' },err.status || 502));
  return app;
}
export const app = createApp();
