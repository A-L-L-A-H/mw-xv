import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReadOnlyRepoInspector } from '../src/repo-inspector.js';
import { buildRepoSnapshot } from '../src/repo-snapshot.js';

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mw-repo-snapshot-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('buildRepoSnapshot', () => {
  it('builds a deterministic revision-pinned snapshot with manifests, redacted scripts, docs, entryPoints, observations, and inferences', async () => {
    const rootDir = await createTempRepo();
    await mkdir(path.join(rootDir, 'src'), { recursive: true });
    await mkdir(path.join(rootDir, 'docs'), { recursive: true });
    await mkdir(path.join(rootDir, '.git'), { recursive: true });

    await writeFile(
      path.join(rootDir, 'package.json'),
      JSON.stringify(
        {
          name: '@example/demo',
          version: '1.2.3',
          scripts: {
            test: 'vitest run',
            deploy: 'curl -H "Authorization: Bearer supersecretvalue12345" https://api.example.com',
            build: 'tsc -p tsconfig.json',
          },
        },
        null,
        2
      ),
      'utf8'
    );
    await writeFile(
      path.join(rootDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
      'utf8'
    );
    await writeFile(
      path.join(rootDir, 'README.md'),
      '# Demo Workspace\n\n## Architecture\n\nSome details.\n',
      'utf8'
    );
    await writeFile(
      path.join(rootDir, 'docs', 'guide.md'),
      '# Developer Guide\n\n### Setup\n',
      'utf8'
    );
    await writeFile(path.join(rootDir, 'src', 'index.ts'), 'export const ok = true;\n', 'utf8');
    await writeFile(path.join(rootDir, '.env'), 'API_KEY=sk-proj-1234567890abcdef\n', 'utf8');
    await writeFile(path.join(rootDir, '.git', 'HEAD'), 'ref: refs/heads/dev\n', 'utf8');

    const inspector = new ReadOnlyRepoInspector({
      rootDir,
      allowlistedPaths: ['.'],
    });

    const first = await buildRepoSnapshot(inspector, {
      rootLabel: 'demo-repo',
      capturedAt: '2026-11-22T10:00:00.000Z',
      gitRevision: {
        headCommit: 'abcdef1234567890',
        branch: 'dev',
        dirty: false,
        capturedAt: '2026-11-22T10:00:00.000Z',
      },
    });

    const second = await buildRepoSnapshot(inspector, {
      rootLabel: 'demo-repo',
      capturedAt: '2026-11-22T12:30:00.000Z',
      gitRevision: {
        headCommit: 'abcdef1234567890',
        branch: 'dev',
        dirty: false,
        capturedAt: '2026-11-22T12:30:00.000Z',
      },
    });

    expect(first.schemaVersion).toBe(1);
    expect(first.rootLabel).toBe('demo-repo');
    expect(first.incomplete).toBe(false);
    expect(first.omittedReasons).toEqual([]);
    expect(first.gitRevision).toEqual({
      headCommit: 'abcdef1234567890',
      branch: 'dev',
      dirty: false,
      capturedAt: '2026-11-22T10:00:00.000Z',
    });

    // Manifests sorted by path
    expect(first.manifests.map((m) => m.path)).toEqual(['package.json', 'tsconfig.json']);
    expect(first.manifests[0].name).toBe('@example/demo');
    expect(first.manifests[0].version).toBe('1.2.3');
    expect(first.manifests[0].sha256).toMatch(/^[a-f0-9]{64}$/u);

    // Scripts sorted and secrets redacted
    expect(first.scripts.map((s) => s.name)).toEqual(['build', 'deploy', 'test']);
    const deployScript = first.scripts.find((s) => s.name === 'deploy');
    expect(deployScript?.command).toContain('[REDACTED]');
    expect(deployScript?.command).not.toContain('supersecretvalue12345');

    // Docs sorted with H1 title
    expect(first.docs.map((d) => ({ path: d.path, title: d.title }))).toEqual([
      { path: 'README.md', title: 'Demo Workspace' },
      { path: 'docs/guide.md', title: 'Developer Guide' },
    ]);

    // Entry points detected
    expect(first.entryPoints.map((e) => e.path)).toEqual(['src/index.ts']);

    // Sensitive files never leak
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('.env');
    expect(serialized).not.toContain('.git/HEAD');
    expect(serialized).not.toContain('sk-proj-1234567890abcdef');

    // Observations cite path + sha256; inferences are separated
    expect(first.observations.length).toBeGreaterThan(0);
    for (const obs of first.observations) {
      expect(obs.path.length).toBeGreaterThan(0);
      expect(obs.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(first.inferences.map((inf) => inf.tag)).toEqual(['node', 'typescript']);

    // Deterministic contentSha256 across different capturedAt timestamps; snapshotSha256 differs
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(first.snapshotSha256).not.toBe(second.snapshotSha256);
  });

  it('flags incomplete and records omittedReasons when maxFiles cap or maxManifestBytes truncation is hit', async () => {
    const rootDir = await createTempRepo();
    await writeFile(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ name: 'big-pkg', description: 'x'.repeat(200) }),
      'utf8'
    );
    await writeFile(path.join(rootDir, 'README.md'), '# Title\n', 'utf8');
    await writeFile(path.join(rootDir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8');

    const inspector = new ReadOnlyRepoInspector({
      rootDir,
      allowlistedPaths: ['.'],
    });

    const capped = await buildRepoSnapshot(inspector, {
      maxFiles: 2,
      capturedAt: '2026-11-22T10:00:00.000Z',
    });
    expect(capped.incomplete).toBe(true);
    expect(capped.scannedFileCount).toBe(2);
    expect(capped.omittedReasons.some((r) => r.includes('maxFiles cap (2)'))).toBe(true);

    const truncated = await buildRepoSnapshot(inspector, {
      maxManifestBytes: 32,
      capturedAt: '2026-11-22T10:00:00.000Z',
    });
    expect(truncated.incomplete).toBe(true);
    expect(truncated.omittedReasons.some((r) => r.includes('manifest truncated'))).toBe(true);
  });
});
