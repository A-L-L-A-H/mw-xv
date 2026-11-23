import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const setupScript = fileURLToPath(new URL('./setup-git-hooks.mjs', import.meta.url));

test('setup-git-hooks skips when CI is set', () => {
  const result = spawnSync(process.execPath, [setupScript], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped/i);
});

test('setup-git-hooks skips when SKIP_GIT_HOOKS is set', () => {
  const result = spawnSync(process.execPath, [setupScript], {
    encoding: 'utf8',
    env: { ...process.env, SKIP_GIT_HOOKS: '1' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped/i);
});

test('setup-git-hooks skips in a directory without .git', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'no-git-'));
  const result = spawnSync(process.execPath, [setupScript], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, CI: undefined },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped/i);
});

test('setup-git-hooks sets core.hooksPath in a temp git repo', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'git-hooks-'));
  mkdirSync(join(tmp, '.githooks'));
  writeFileSync(join(tmp, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');

  spawnSync('git', ['init', '--quiet'], { cwd: tmp, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmp });

  const result = spawnSync(process.execPath, [setupScript], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, CI: undefined },
  });
  assert.equal(result.status, 0, result.stderr);

  const config = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(config.stdout.trim(), '.githooks');
});

test('prepare command in package.json is Docker-safe (guarded by existsSync)', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.prepare, /existsSync/u);
  assert.match(pkg.scripts.prepare, /setup-git-hooks/u);
});
