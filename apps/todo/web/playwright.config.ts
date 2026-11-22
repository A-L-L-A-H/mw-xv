import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const useDevServer = process.env.MW_E2E_DEV === '1';
const apiPort = process.env.MW_E2E_API_PORT ?? '4249';
const webPort = process.env.MW_E2E_WEB_PORT ?? '5179';
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;

const e2eHome = process.env.MOONWITNESS_DX_HOME ?? path.join(os.tmpdir(), `mw-dx-e2e-${apiPort}`);
fs.mkdirSync(e2eHome, { recursive: true });

const binaryName = process.platform === 'win32' ? 'moonwitness-dx.exe' : 'moonwitness-dx';
const binaryPath = path.resolve(import.meta.dirname, '..', 'target', 'release', binaryName);

const webServer = [
  {
    command: `"${binaryPath}" --port ${apiPort} --no-open`,
    cwd: path.resolve(import.meta.dirname, '..'),
    url: `${apiBase}/api/ping`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      MOONWITNESS_DX_HOME: e2eHome,
      RUST_LOG: 'warn',
    },
  },
];

if (useDevServer) {
  webServer.push({
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${webPort} --strictPort`,
    cwd: import.meta.dirname,
    url: webBase,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      MW_E2E_API_PORT: apiPort,
      MW_E2E_WEB_PORT: webPort,
    },
  });
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: '../../test-results/junit/todo-web-e2e.xml' }]],
  outputDir: '../../test-results/playwright',
  use: {
    baseURL: useDevServer ? webBase : apiBase,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer,
});
