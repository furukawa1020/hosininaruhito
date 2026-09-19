import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/setup.js',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8799',
    browserName: 'chromium',
    ...(process.env.HCR_BROWSER_CHANNEL ? { channel: process.env.HCR_BROWSER_CHANNEL } : {}),
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node src/server/index.js',
    url: 'http://127.0.0.1:8799/api/status',
    reuseExistingServer: false,
    env: {
      PORT: '8799', HCR_BIND: '127.0.0.1', HCR_ACCESS_TOKEN: '',
      HOSHIMIRU_API_TOKEN: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '', CODEX_MODEL: ''
    }
  }
});
