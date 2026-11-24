import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const baseURL = 'http://127.0.0.1:4194/moonwitness-xiv/components/';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/ui-catalog-exp',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  use: {
    baseURL,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
<<<<<<< HEAD
    command: 'bun exec vite preview --host 127.0.0.1 --port 4194 --strictPort',
=======
    command: 'bunx vite preview --host 127.0.0.1 --port 4194 --strictPort',
>>>>>>> dfd36578 (fix(bun): fix ui-catalog preview, restore preview description, complete Dockerfile manifests)
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
