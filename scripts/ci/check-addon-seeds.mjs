#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolvePackageManager } from '../package-manager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '../..');
const PACKAGES_DIR = join(ROOT, 'packages');

const EXCLUDED = new Set(['orm-cli', 'orm-base']);

function findAddons() {
  const dirs = readdirSync(PACKAGES_DIR);
  return dirs
    .filter(d => d.startsWith('orm-') && !EXCLUDED.has(d))
    .sort();
}

function checkSeedFile(addon) {
  const seedPath = join(PACKAGES_DIR, addon, 'src', 'seed.ts');
  const distSeedPath = join(PACKAGES_DIR, addon, 'dist', 'seed.js');

  if (!existsSync(seedPath) && !existsSync(distSeedPath)) {
    console.error(`[FAIL] ${addon}: missing seed.ts`);
    return false;
  }
  return true;
}

function checkManifestExport(addon) {
  const indexPath = join(PACKAGES_DIR, addon, 'src', 'index.ts');
  const distIndexPath = join(PACKAGES_DIR, addon, 'dist', 'index.js');

  const checkPath = existsSync(distIndexPath) ? distIndexPath :
                    existsSync(indexPath) ? indexPath : null;

  if (!checkPath) {
    console.error(`[FAIL] ${addon}: missing index.ts`);
    return false;
  }

  const content = readFileSync(checkPath, 'utf-8');
  if (!content.includes('AddonSeedManifest') && !content.includes('seed-manifest')) {
    console.error(`[FAIL] ${addon}: missing AddonSeedManifest export from seed-manifest`);
    return false;
  }
  return true;
}

function runTests(addon) {
  const pkgJsonPath = join(PACKAGES_DIR, addon, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    console.error(`[FAIL] ${addon}: missing package.json`);
    return false;
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const pkgName = pkg.name || `@moonwitness/${addon}`;

  const packageManager = resolvePackageManager();
  if (!packageManager) {
    console.error(`[FAIL] ${addon}: could not resolve package manager (bun)`);
    return false;
  }

  console.log(`[TEST] Running tests for ${pkgName}...`);
  const result = spawnSync(
    packageManager.command,
    [...packageManager.prefixArgs, '--filter', pkgName, 'test'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      shell: packageManager.shell,
      encoding: 'utf-8',
    }
  );

  if (result.status !== 0) {
    console.error(`[FAIL] ${addon}: tests failed (exit ${result.status})`);
    return false;
  }

  console.log(`[PASS] ${addon}: tests passed`);
  return true;
}

function main() {
  console.log('=== Addon Seed CI Gate ===\n');

  const addons = findAddons();
  console.log(`Found ${addons.length} addons to validate: ${addons.join(', ')}\n`);

  let allPassed = true;

  for (const addon of addons) {
    console.log(`--- Validating ${addon} ---`);

    const checks = [
      checkSeedFile(addon),
      checkManifestExport(addon),
      runTests(addon),
    ];

    if (!checks.every(c => c)) {
      allPassed = false;
    }
    console.log('');
  }

  console.log('=== RESULT ===');
  if (allPassed) {
    console.log('ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.error('SOME CHECKS FAILED');
    process.exit(1);
  }
}

main();
