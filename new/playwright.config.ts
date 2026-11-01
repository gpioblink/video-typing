import { defineConfig } from '@playwright/test';
export default defineConfig({
  testIgnore: process.env.LIVE_YOUTUBE ? [] : ['**/youtube-live.spec.ts'],
  testDir: './e2e', timeout: 180_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, launchOptions: { channel: 'chromium', executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } },
  webServer: { command: 'pnpm preview:web --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
