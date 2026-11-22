import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  computeWorkspaceContractDigest,
  mapChangedFilesToPackages,
  parseGitPorcelainPaths,
  runBoundaryGates,
  runPreflightFast,
} from './preflight-fast.mjs';

test('parseGitPorcelainPaths normalizes modified, untracked, and renamed paths', () => {
  const porcelain = [
    ' M apps/api/src/routes/health.ts',
    '?? packages\\orm-ai\\src\\models\\agent.ts',
    'R  apps/board/src/old.tsx -> apps/board/src/new.tsx',
    'A  "package.json"',
  ].join('\n');

  const parsed = parseGitPorcelainPaths(porcelain);
  assert.deepEqual(parsed, [
    'apps/api/src/routes/health.ts',
    'apps/board/src/new.tsx',
    'package.json',
    'packages/orm-ai/src/models/agent.ts',
  ]);
});

test('mapChangedFilesToPackages computes direct and transitive affected workspace packages', () => {
  const projects = [
    { name: '@moonwitness/types', path: 'packages/types', dependencies: [] },
    { name: '@moonwitness/orm', path: 'packages/orm', dependencies: ['@moonwitness/types'] },
    { name: '@moonwitness/api', path: 'apps/api', dependencies: ['@moonwitness/orm'] },
    { name: '@moonwitness/board', path: 'apps/board', dependencies: ['@moonwitness/types'] },
  ];

  const mapped = mapChangedFilesToPackages(['packages/orm/src/model.ts'], projects);
  assert.deepEqual(mapped.directPackages, ['@moonwitness/orm']);
  assert.deepEqual(mapped.affectedPackages, ['@moonwitness/api', '@moonwitness/orm']);
  assert.equal(mapped.contractTouched, false);

  const routeTouch = mapChangedFilesToPackages(['apps/api/src/routes/ai.routes.ts'], projects);
  assert.equal(routeTouch.contractTouched, true);
});

test('computeWorkspaceContractDigest produces deterministic SHA-256 across contract files', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'mw-preflight-digest-'));
  try {
    await mkdir(path.join(tempRoot, 'packages/orm-sample/src'), { recursive: true });
    await mkdir(path.join(tempRoot, 'apps/api/src/routes'), { recursive: true });
    await writeFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' })
    );
    await writeFile(
      path.join(tempRoot, 'packages/orm-sample/package.json'),
      JSON.stringify({ name: '@moonwitness/orm-sample', version: '1.0.0' })
    );
    await writeFile(
      path.join(tempRoot, 'packages/orm-sample/src/manifest.ts'),
      'export const manifest = { name: "sample" };\n'
    );
    await writeFile(
      path.join(tempRoot, 'apps/api/src/routes/sample.ts'),
      'export async function routes(fastify) { fastify.get("/api/sample", async () => ({})); }\n'
    );

    const first = await computeWorkspaceContractDigest(tempRoot);
    const second = await computeWorkspaceContractDigest(tempRoot);
    assert.equal(first.contractSha256, second.contractSha256);
    assert.equal(first.fileCount, 4);

    await writeFile(
      path.join(tempRoot, 'apps/api/src/routes/sample.ts'),
      'export async function routes(fastify) { fastify.get("/api/sample/v2", async () => ({})); }\n'
    );
    const third = await computeWorkspaceContractDigest(tempRoot);
    assert.notEqual(first.contractSha256, third.contractSha256);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('runBoundaryGates detects violations and passes clean fixture trees', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'mw-preflight-gates-'));
  try {
    await mkdir(path.join(tempRoot, 'apps/api/src'), { recursive: true });
    await mkdir(path.join(tempRoot, 'apps/board/src'), { recursive: true });
    await mkdir(path.join(tempRoot, 'apps/desktop/src'), { recursive: true });

    await writeFile(path.join(tempRoot, 'apps/api/src/clean.ts'), 'export const ok = true;\n');
    await writeFile(
      path.join(tempRoot, 'apps/board/src/clean.tsx'),
      'export function Clean() { return <div>ok</div>; }\n'
    );
    await writeFile(
      path.join(tempRoot, 'apps/desktop/src/clean.ts'),
      'export const sidecar = 1;\n'
    );

    const cleanResult = await runBoundaryGates(tempRoot);
    assert.equal(cleanResult.passed, true);

    await writeFile(
      path.join(tempRoot, 'apps/desktop/src/bad.ts'),
      'export const bad = defineModel("bad", {});\n'
    );
    const dirtyResult = await runBoundaryGates(tempRoot);
    assert.equal(dirtyResult.passed, false);
    assert.equal(dirtyResult.gates.desktopNonOverlap.passed, false);
    assert.equal(dirtyResult.gates.desktopNonOverlap.violations.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('runPreflightFast caches contract digest and triggers syncGenerators when --sync is active', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'mw-preflight-run-'));
  try {
    await writeFile(
      path.join(tempRoot, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n  - "packages/*"\n'
    );
    await writeFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' })
    );
    await mkdir(path.join(tempRoot, 'apps/api/src'), { recursive: true });
    await mkdir(path.join(tempRoot, 'packages/types'), { recursive: true });
    await writeFile(
      path.join(tempRoot, 'apps/api/package.json'),
      JSON.stringify({ name: '@moonwitness/api', version: '1.0.0' })
    );
    await writeFile(
      path.join(tempRoot, 'packages/types/package.json'),
      JSON.stringify({ name: '@moonwitness/types', version: '1.0.0' })
    );

    const cachePath = path.join(tempRoot, '.cache/contract.json');
    let syncCalls = 0;
    const mockSync = async () => {
      syncCalls += 1;
      return ['mock-generator'];
    };

    const firstRun = await runPreflightFast({
      workspaceRoot: tempRoot,
      cachePath,
      changedFiles: ['apps/api/src/index.ts'],
      sync: true,
      syncGenerators: mockSync,
    });

    assert.equal(firstRun.passed, true);
    assert.equal(firstRun.contractChanged, true);
    assert.equal(syncCalls, 1);
    assert.deepEqual(firstRun.syncedGenerators, ['mock-generator']);
    assert.deepEqual(firstRun.affectedPackages, ['@moonwitness/api']);

    const secondRun = await runPreflightFast({
      workspaceRoot: tempRoot,
      cachePath,
      changedFiles: ['apps/api/src/index.ts'],
      sync: true,
      syncGenerators: mockSync,
    });
    assert.equal(secondRun.contractChanged, false);
    assert.equal(syncCalls, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
