import { defineConfig } from '@playwright/test';

// Explicit smoke tests against deployed services; CI stays isolated and local.
export default defineConfig({
  testDir: './tests/production',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.LIVEROOMS_BASE_URL || 'https://rooms.aadithya.dev',
    permissions: ['camera', 'microphone'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
});
