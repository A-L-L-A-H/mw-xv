#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT = resolve(__dirname, '../..');

const ADDON_EXCLUDED = new Set(['orm-cli', 'orm-base']);
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LOCKFILES = ['bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

/**
 * Reads and parses a JSON file, returning null on missing or invalid JSON.
 */
function readJsonSafe(filePath) {
  if (!existsSync(filePath)) {
    return { ok: false, error: 'missing' };
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Discovers workspace package directories under `apps/` and `packages/`.
 */
export function discoverWorkspaces(rootDir) {
  const results = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(rootDir, group);
    if (!existsSync(groupDir)) continue;
    const entries = readdirSync(groupDir).sort();
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullDir = join(groupDir, entry);
      if (!statSync(fullDir).isDirectory()) continue;
      const pkgPath = join(fullDir, 'package.json');
      if (!existsSync(pkgPath)) continue;
      results.push({
        group,
        dirName: entry,
        relPath: relative(rootDir, fullDir).replace(/\\/g, '/'),
        pkgPath,
      });
    }
  }
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * Validates all workspace package.json manifests.
 */
export function checkWorkspaceManifests(rootDir) {
  const workspaces = discoverWorkspaces(rootDir);
  const errors = [];
  const seenNames = new Map();
  const validated = [];

  for (const ws of workspaces) {
    const parsed = readJsonSafe(ws.pkgPath);
    if (!parsed.ok) {
      errors.push({
        scope: 'workspaceManifests',
        target: ws.relPath,
        message: `Invalid or unreadable package.json: ${parsed.error}`,
      });
      continue;
    }

    const pkg = parsed.data;
    const name = typeof pkg.name === 'string' ? pkg.name.trim() : '';
    const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';

    if (!name) {
      errors.push({
        scope: 'workspaceManifests',
        target: ws.relPath,
        message: 'Missing or empty package name',
      });
    } else if (seenNames.has(name)) {
      errors.push({
        scope: 'workspaceManifests',
        target: ws.relPath,
        message: `Duplicate package name "${name}" (already defined at ${seenNames.get(name)})`,
      });
    } else {
      seenNames.set(name, ws.relPath);
    }

    if (!version || !SEMVER_RE.test(version)) {
      errors.push({
        scope: 'workspaceManifests',
        target: ws.relPath,
        message: `Invalid or missing semver version: "${version}"`,
      });
    }

    validated.push({
      name: name || ws.dirName,
      version: version || '0.0.0',
      path: ws.relPath,
      private: Boolean(pkg.private),
    });
  }

  return {
    passed: errors.length === 0,
    workspaces: validated,
    errors,
  };
}

/**
 * Validates addon seed manifests under `packages/orm-*`.
 */
export function checkAddonSeeds(rootDir) {
  const packagesDir = join(rootDir, 'packages');
  const errors = [];
  const addons = [];

  if (!existsSync(packagesDir)) {
    return { passed: true, addons, errors };
  }

  const dirs = readdirSync(packagesDir)
    .filter((d) => d.startsWith('orm-') && !ADDON_EXCLUDED.has(d))
    .sort();

  for (const addon of dirs) {
    const addonDir = join(packagesDir, addon);
    if (!statSync(addonDir).isDirectory()) continue;

    const srcSeed = join(addonDir, 'src', 'seed.ts');
    const distSeed = join(addonDir, 'dist', 'seed.js');
    const hasSeed = existsSync(srcSeed) || existsSync(distSeed);

    if (!hasSeed) {
      errors.push({
        scope: 'addonSeeds',
        target: `packages/${addon}`,
        message: 'Missing src/seed.ts (or dist/seed.js)',
      });
    }

    const srcIndex = join(addonDir, 'src', 'index.ts');
    const distIndex = join(addonDir, 'dist', 'index.js');
    const indexPath = existsSync(srcIndex)
      ? srcIndex
      : existsSync(distIndex)
        ? distIndex
        : null;

    let hasManifestExport = false;
    if (!indexPath) {
      errors.push({
        scope: 'addonSeeds',
        target: `packages/${addon}`,
        message: 'Missing src/index.ts (or dist/index.js)',
      });
    } else {
      const content = readFileSync(indexPath, 'utf8');
      hasManifestExport =
        content.includes('AddonSeedManifest') || content.includes('seed-manifest');
      if (!hasManifestExport) {
        errors.push({
          scope: 'addonSeeds',
          target: `packages/${addon}`,
          message: 'Missing AddonSeedManifest export from seed-manifest',
        });
      }
    }

    addons.push({
      name: addon,
      hasSeed,
      hasManifestExport,
    });
  }

  return {
    passed: errors.length === 0,
    addons,
    errors,
  };
}

/**
 * Validates root release packaging determinism (root manifest + lockfile).
 */
export function checkReleasePackaging(rootDir) {
  const errors = [];
  const rootPkgPath = join(rootDir, 'package.json');
  const parsed = readJsonSafe(rootPkgPath);

  if (!parsed.ok) {
    errors.push({
      scope: 'releasePackaging',
      target: 'package.json',
      message: `Invalid or unreadable root package.json: ${parsed.error}`,
    });
  } else {
    const pkg = parsed.data;
    if (typeof pkg.name !== 'string' || !pkg.name.trim()) {
      errors.push({
        scope: 'releasePackaging',
        target: 'package.json',
        message: 'Root package.json missing name',
      });
    }
    if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version.trim())) {
      errors.push({
        scope: 'releasePackaging',
        target: 'package.json',
        message: `Root package.json has invalid version: "${pkg.version ?? ''}"`,
      });
    }
    if (!Array.isArray(pkg.workspaces) || pkg.workspaces.length === 0) {
      errors.push({
        scope: 'releasePackaging',
        target: 'package.json',
        message: 'Root package.json missing workspaces array',
      });
    }
  }

  const lockfile = LOCKFILES.find((file) => existsSync(join(rootDir, file))) ?? null;
  if (!lockfile) {
    errors.push({
      scope: 'releasePackaging',
      target: 'lockfile',
      message: `Missing deterministic lockfile (expected one of: ${LOCKFILES.join(', ')})`,
    });
  }

  return {
    passed: errors.length === 0,
    lockfile,
    errors,
  };
}

/**
 * Computes a deterministic SHA-256 digest of the sorted workspace + addon inventory.
 */
export function computeManifestDigest(workspaces, addons, lockfile) {
  const payload = JSON.stringify({
    workspaces: workspaces.map((w) => ({ name: w.name, version: w.version, path: w.path })),
    addons: addons.map((a) => ({
      name: a.name,
      hasSeed: a.hasSeed,
      hasManifestExport: a.hasManifestExport,
    })),
    lockfile,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Evaluates full GA readiness for a repository root and returns a structured report.
 */
export function evaluateGaReadiness(rootDir = DEFAULT_ROOT) {
  const resolvedRoot = resolve(rootDir);
  const workspaceResult = checkWorkspaceManifests(resolvedRoot);
  const addonResult = checkAddonSeeds(resolvedRoot);
  const packagingResult = checkReleasePackaging(resolvedRoot);

  const errors = [
    ...workspaceResult.errors,
    ...addonResult.errors,
    ...packagingResult.errors,
  ];

  const manifestDigest = computeManifestDigest(
    workspaceResult.workspaces,
    addonResult.addons,
    packagingResult.lockfile
  );

  return {
    schemaVersion: 1,
    ready: errors.length === 0,
    root: resolvedRoot.replace(/\\/g, '/'),
    manifestDigest,
    summary: {
      workspaceCount: workspaceResult.workspaces.length,
      addonCount: addonResult.addons.length,
      errorCount: errors.length,
    },
    checks: {
      workspaceManifests: {
        passed: workspaceResult.passed,
        errors: workspaceResult.errors,
      },
      addonSeeds: {
        passed: addonResult.passed,
        errors: addonResult.errors,
      },
      releasePackaging: {
        passed: packagingResult.passed,
        lockfile: packagingResult.lockfile,
        errors: packagingResult.errors,
      },
    },
    workspaces: workspaceResult.workspaces,
    addons: addonResult.addons,
    errors,
  };
}

function main() {
  const args = process.argv.slice(2);
  const rootArg = args.find((arg) => !arg.startsWith('-'));
  const report = evaluateGaReadiness(rootArg ?? DEFAULT_ROOT);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ready ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
