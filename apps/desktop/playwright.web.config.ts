import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './desktop-web/tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4176',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'bun --filter @moonwitness/desktop build:web && bunx vite preview --config desktop-web/vite.config.ts --host 127.0.0.1 --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
