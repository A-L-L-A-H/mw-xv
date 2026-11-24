import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, exit, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import { resolvePackageManager } from './package-manager.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageManager = resolvePackageManager();
if (!packageManager) {
  stderr.write('Run the visual browser matrix through pnpm.\n');
  exit(2);
}

const requiredBrowsers = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];
const missingBrowsers = requiredBrowsers.filter(
  ([, browser]) => !existsSync(browser.executablePath())
);
if (missingBrowsers.length > 0) {
  stderr.write(
    'Visual browser matrix preflight failed; all three browser projects are required.\n'
  );
  for (const [name, browser] of missingBrowsers) {
    stderr.write(`Missing Playwright ${name} executable: ${browser.executablePath()}\n`);
    stderr.write(
      `Install it with: pnpm --filter @moonwitness/board exec playwright install ${name}\n`
    );
  }
  stderr.write('No visual matrix projects were skipped.\n');
  exit(2);
}

const result = spawnSync(
  packageManager.command,
  [
    ...packageManager.prefixArgs,
    '--filter',
    '@moonwitness/board',
    'exec',
    'playwright',
    'test',
    'e2e/visual-audit.spec.ts',
    '--config',
    'playwright.visual.config.ts',
  ],
  {
    cwd: repositoryRoot,
    env: { ...env, MW_VISUAL_BROWSER_MATRIX: 'true' },
    stdio: 'inherit',
    ...(packageManager.shell ? { shell: true } : {}),
  }
);

exit(result.status ?? 1);
