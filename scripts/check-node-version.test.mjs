import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkNodeParity, parseMajorVersion } from './check-node-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parseMajorVersion extracts major integer from node and range strings', () => {
  assert.equal(parseMajorVersion('v24.22.1'), 24);
  assert.equal(parseMajorVersion('24.x'), 24);
  assert.equal(parseMajorVersion('24'), 24);
  assert.equal(parseMajorVersion('invalid'), null);
});

test('checkNodeParity reports clean parity for Node 24.x LTS', () => {
  const res = checkNodeParity({
    currentVersion: 'v24.22.1',
    expectedRange: '24.x',
    nvmrcVersion: '24',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings, []);
});

test('checkNodeParity rejects Node 26.x when the repository is pinned to 24.x', () => {
  const res = checkNodeParity({
    currentVersion: 'v26.0.0',
    expectedRange: '24.x',
    nvmrcVersion: '24',
  });
  assert.equal(res.ok, false);
  assert.match(res.warnings[0], /supported LTS/u);
});

test('checkNodeParity rejects odd-numbered and retired Node versions', () => {
  const oddRes = checkNodeParity({
    currentVersion: 'v25.5.0',
    expectedRange: '24.x',
    nvmrcVersion: '24',
  });
  assert.equal(oddRes.ok, false);
  assert.match(oddRes.warnings[0], /better-sqlite3/u);

  const oldRes = checkNodeParity({
    currentVersion: 'v22.14.0',
    expectedRange: '24.x',
    nvmrcVersion: '24',
  });
  assert.equal(oldRes.ok, false);
  assert.match(oldRes.warnings[0], /supported LTS/u);
});

test('checkNodeParity warns on repo parity drift between engines.node and .nvmrc', () => {
  const res = checkNodeParity({
    currentVersion: 'v24.22.1',
    expectedRange: '24.x',
    nvmrcVersion: '22',
  });
  assert.equal(res.ok, false);
  assert.match(res.warnings[0], /Repo Node parity drift/u);
});

test('repository .nvmrc, .node-version, and every workspace package match root engines.node LTS', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const nvmrc = (await readFile(path.join(root, '.nvmrc'), 'utf8')).trim();
  const nodeVersion = (await readFile(path.join(root, '.node-version'), 'utf8')).trim();
  assert.equal(pkg.engines.node, '24.x');
  assert.equal(parseMajorVersion(nvmrc), parseMajorVersion(pkg.engines.node));
  assert.equal(parseMajorVersion(nodeVersion), parseMajorVersion(pkg.engines.node));

  const workspace = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(workspace, /^nodeVersion:\s*24\./mu);
  assert.match(workspace, /^engineStrict:\s*true$/mu);

  for (const directory of ['apps', 'packages']) {
    for (const entry of readdirSync(path.join(root, directory))) {
      const manifestPath = path.join(root, directory, entry, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.equal(
        manifest.engines?.node,
        pkg.engines.node,
        `${directory}/${entry}/package.json engines.node must match root ${pkg.engines.node}`
      );
    }
  }
});
