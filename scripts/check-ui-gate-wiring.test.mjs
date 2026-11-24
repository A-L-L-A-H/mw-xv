import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');

test('UI design gate has local commands, CI execution, and pre-push enforcement', async () => {
  const packageJson = JSON.parse(await read('../package.json'));
  const workflow = await read('../.github/workflows/ci.yml');
  const prePush = await read('../.githooks/pre-push');

  assert.match(packageJson.scripts['ui:check'], /board:ui:check/u);
  assert.match(packageJson.scripts['ui:check'], /desktop:ui:check/u);
  assert.match(packageJson.scripts['ui:check'], /ui:design:check/u);
  assert.match(packageJson.scripts['ui:design:check'], /test:ui-design-check/u);
  assert.match(packageJson.scripts['ui:design:check'], /check-ui-design-system\.mjs/u);
  assert.match(packageJson.scripts['lint:ui'], /eslint packages\/ui\/src/u);
  assert.match(packageJson.scripts['lint:ui'], /@moonwitness\/board lint/u);
  assert.match(packageJson.scripts.verify, /bun run ui:check/u);
  assert.match(packageJson.scripts.verify, /bun run lint:ui/u);

  assert.match(workflow, /bun run ui:design:check/u);
  assert.match(workflow, /bun run lint:ui/u);
  assert.match(prePush, /bun run ui:check/u);
  assert.match(prePush, /bun run lint:ui/u);
});

test('desktop boundary CLI uses the relative-path collector and has an integration test', async () => {
  const checker = await read('./check-desktop-non-overlap.mjs');
  const spec = await read('./check-desktop-non-overlap.test.mjs');
  assert.match(checker, /collectDesktopNonOverlapViolations/u);
  assert.match(checker, /path\.relative\(workspaceRoot, file\)/u);
  assert.match(spec, /collectDesktopNonOverlapViolations/u);
  assert.match(spec, /absolute filenames/u);
});

test('shared token CSS defines the aliases referenced by consuming apps', async () => {
  const tokens = await read('../packages/ui/src/styles/tokens.css');
  for (const token of [
    '--mw-cyan:',
    '--mw-color-ink-muted:',
    '--mw-border-strong:',
    '--mw-border-subtle:',
  ]) {
    assert.ok(tokens.includes(token), `tokens.css must define ${token}`);
  }
});
