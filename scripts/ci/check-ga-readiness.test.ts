import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkAddonSeeds,
  checkReleasePackaging,
  checkWorkspaceManifests,
  evaluateGaReadiness,
} from './check-ga-readiness.mjs';

const REPO_ROOT = resolve(import.meta.dir, '../..');

function createTempRepo() {
  return mkdtempSync(join(tmpdir(), 'mw-ga-readiness-'));
}

describe('check-ga-readiness', () => {
  it('passes on the real repository and produces deterministic digest', () => {
    const first = evaluateGaReadiness(REPO_ROOT);
    const second = evaluateGaReadiness(REPO_ROOT);

    expect(first.schemaVersion).toBe(1);
    expect(first.ready).toBe(true);
    expect(first.summary.workspaceCount).toBeGreaterThan(0);
    expect(first.summary.addonCount).toBeGreaterThan(0);
    expect(first.summary.errorCount).toBe(0);
    expect(first.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.manifestDigest).toBe(second.manifestDigest);
  });

  it('detects duplicate workspace names and invalid semver', () => {
    const root = createTempRepo();
    try {
      mkdirSync(join(root, 'packages', 'pkg-a'), { recursive: true });
      mkdirSync(join(root, 'packages', 'pkg-b'), { recursive: true });
      writeFileSync(
        join(root, 'packages', 'pkg-a', 'package.json'),
        JSON.stringify({ name: '@test/dup', version: '1.0.0' })
      );
      writeFileSync(
        join(root, 'packages', 'pkg-b', 'package.json'),
        JSON.stringify({ name: '@test/dup', version: 'not-semver' })
      );

      const result = checkWorkspaceManifests(root);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Duplicate package name'))).toBe(true);
      expect(result.errors.some((e) => e.message.includes('Invalid or missing semver'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects missing addon seed files and missing AddonSeedManifest export', () => {
    const root = createTempRepo();
    try {
      mkdirSync(join(root, 'packages', 'orm-demo', 'src'), { recursive: true });
      writeFileSync(join(root, 'packages', 'orm-demo', 'src', 'index.ts'), 'export const x = 1;\n');

      const result = checkAddonSeeds(root);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Missing src/seed.ts'))).toBe(true);
      expect(result.errors.some((e) => e.message.includes('Missing AddonSeedManifest'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects missing lockfile and invalid root package.json', () => {
    const root = createTempRepo();
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
      const result = checkReleasePackaging(root);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.message.includes('missing workspaces array'))).toBe(true);
      expect(result.errors.some((e) => e.message.includes('Missing deterministic lockfile'))).toBe(
        true
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
