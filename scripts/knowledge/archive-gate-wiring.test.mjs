import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('archive invariant gates are wired into package scripts and CI', async () => {
  const packageJson = JSON.parse(await read('../../package.json'));
  const workflow = await read('../../.github/workflows/ci.yml');
  assert.match(packageJson.scripts['archive:check'], /check-canon-registry\.mjs/u);
  assert.match(packageJson.scripts['archive:check'], /build-idea-archive-index\.mjs --check/u);
  assert.match(packageJson.scripts['docs:check:built'], /pnpm archive:check/u);
  assert.match(workflow, /pnpm docs:check:built/u);
});
