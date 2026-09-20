import { defineConfig } from 'vite';
import { browserPolicy } from './src/server/security.js';
export default defineConfig({
  worker: { format: 'es' },
  server: { headers: { 'Content-Security-Policy': browserPolicy }, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { target: 'es2022' }
});
