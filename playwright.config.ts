import { defineConfig } from '@playwright/test';

// Remote runs should select site.spec.ts; extension tests use local fixtures.
const liveBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: liveBaseUrl || 'http://127.0.0.1:4173',
    headless: true,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: liveBaseUrl
    ? undefined
    : {
        command: 'npm run dev -- --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
      },
  reporter: [['list'], ['html', { open: 'never' }]],
});
