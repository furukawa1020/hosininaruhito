import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { app } from './app.js';
app.use('/*', serveStatic({ root: fileURLToPath(new URL('../../dist/', import.meta.url)) }));
const server = serve({ fetch: app.fetch, hostname: process.env.HCR_BIND || (process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1'), port: Number(process.env.PORT || 8787) });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close());
