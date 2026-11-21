import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkNodeParity, parseMajorVersion } from './check-node-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parseMajorVersion extracts major integer from node and range strings', () => {
  assert.equal(parseMajorVersion('v22.14.0'), 22);
  assert.equal(parseMajorVersion('22.x'), 22);
  assert.equal(parseMajorVersion('22'), 22);
  assert.equal(parseMajorVersion('invalid'), null);
});

test('checkNodeParity reports clean parity for Node 22.x', () => {
  const res = checkNodeParity({
    currentVersion: 'v22.14.0',
    expectedRange: '22.x',
    nvmrcVersion: '22',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings, []);
});

test('checkNodeParity warns on local runtime drift without crashing', () => {
  const res = checkNodeParity({
    currentVersion: 'v24.22.1',
    expectedRange: '22.x',
    nvmrcVersion: '22',
  });
  assert.equal(res.ok, false);
  assert.match(res.warnings[0], /better-sqlite3/u);
});

test('repository .nvmrc and .node-version match package.json engines.node', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const nvmrc = (await readFile(path.join(root, '.nvmrc'), 'utf8')).trim();
  const nodeVersion = (await readFile(path.join(root, '.node-version'), 'utf8')).trim();
  assert.equal(parseMajorVersion(nvmrc), parseMajorVersion(pkg.engines.node));
  assert.equal(parseMajorVersion(nodeVersion), parseMajorVersion(pkg.engines.node));
});
