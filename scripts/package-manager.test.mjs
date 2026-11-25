import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execPath, platform } from 'node:process';
import test from 'node:test';
import { resolvePackageManager } from './package-manager.mjs';

test('uses the CLI path supplied by a package-manager script', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'moonwitness-bun-'));
  const cli = path.join(directory, 'bun.mjs');
  writeFileSync(cli, '');
  try {
    assert.deepEqual(resolvePackageManager({ npm_execpath: cli }, 'linux'), {
      command: execPath,
      prefixArgs: [cli],
      shell: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('falls back to the installed bun command when npm_execpath is absent', () => {
  const result = resolvePackageManager({}, platform);

  assert.equal(typeof result?.shell, 'boolean');
  assert.deepEqual(result?.prefixArgs, []);
  assert.match(result?.command ?? '', /bun(?:\.(?:exe|cmd))?$/iu);
});

test('ignores a stale npm_execpath and uses PATH fallback', () => {
  const result = resolvePackageManager({ npm_execpath: 'missing-bun-runtime.cjs' }, platform);

  assert.deepEqual(result, resolvePackageManager({}, platform));
});
