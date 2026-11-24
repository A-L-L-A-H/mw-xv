#!/usr/bin/env node

import { program } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import type { Knex } from 'knex';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SeedContext {
  db: Knex;
  companyId?: number;
  ownerId?: number;
}

interface SeedResult {
  inserted: number;
  updated: number;
  skipped: number;
}

interface AddonSeedManifest {
  seedVersion: string;
  dependencies: string[];
  seed: (ctx: SeedContext) => Promise<SeedResult>;
}

interface DiscoveredAddon {
  name: string;
  path: string;
  manifest: AddonSeedManifest;
}

function discoverAddons(): DiscoveredAddon[] {
  const packagesDir = resolve(__dirname, '../../');
  const addons: DiscoveredAddon[] = [];

  if (!existsSync(packagesDir)) {
    console.error(`Packages directory not found: ${packagesDir}`);
    process.exit(1);
  }

  const dirs = readdirSync(packagesDir);

  for (const dir of dirs) {
    if (!dir.startsWith('orm-') || dir === 'orm-cli' || dir === 'orm-isp') continue;

    const seedPath = join(packagesDir, dir, 'src', 'seed.ts');
    const distSeedPath = join(packagesDir, dir, 'dist', 'seed.js');
    const hasSeed = existsSync(seedPath) || existsSync(distSeedPath);

    if (!hasSeed) {
      console.warn(`[warn] ${dir}: no seed.ts found, skipping`);
      continue;
    }

    try {
      const modulePath = existsSync(distSeedPath) ? distSeedPath : seedPath;
      const mod = require(modulePath);
      const manifest = mod.manifest as AddonSeedManifest;

      if (!manifest || typeof manifest.seed !== 'function') {
        console.warn(`[warn] ${dir}: missing or invalid manifest, skipping`);
        continue;
      }

      addons.push({ name: dir, path: modulePath, manifest });
    } catch (e) {
      console.error(`[error] ${dir}: failed to load seed: ${e}`);
      process.exit(1);
    }
  }

  return addons;
}

function topologicalSort(addons: DiscoveredAddon[]): DiscoveredAddon[] {
  const map = new Map(addons.map((a) => [a.name, a]));
  const visited = new Set<string>();
  const temp = new Set<string>();
  const result: DiscoveredAddon[] = [];

  function visit(name: string) {
    if (temp.has(name)) {
      throw new Error(`Dependency cycle detected involving: ${name}`);
    }
    if (visited.has(name)) return;

    temp.add(name);
    const addon = map.get(name);
    if (addon) {
      for (const dep of addon.manifest.dependencies) {
        if (map.has(dep)) visit(dep);
      }
    }
    temp.delete(name);
    visited.add(name);
    if (addon) result.push(addon);
  }

  for (const addon of addons) {
    if (!visited.has(addon.name)) visit(addon.name);
  }

  return result;
}

async function runSeeds(
  db: Knex,
  verifyOnly: boolean
): Promise<{
  totalInserted: number;
  totalUpdated: number;
  totalSkipped: number;
  coverage: number;
}> {
  const addons = discoverAddons();

  if (addons.length === 0) {
    console.error('No addons with valid seeds found');
    process.exit(1);
  }

  console.log(`Discovered ${addons.length} addon(s) with seeds`);

  const sorted = topologicalSort(addons);
  console.log('Execution order:', sorted.map((a) => a.name).join(' -> '));

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let seededCount = 0;

  for (const addon of sorted) {
    console.log(`\n[${addon.name}] Running seed v${addon.manifest.seedVersion}...`);

    const trx = await db.transaction();
    try {
      const ctx: SeedContext = { db: trx };
      const result = await addon.manifest.seed(ctx);

      totalInserted += result.inserted;
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
      seededCount++;

      console.log(
        `  inserted: ${result.inserted}, updated: ${result.updated}, skipped: ${result.skipped}`
      );

      if (verifyOnly) {
        await trx.rollback();
        console.log('  [verify-only] rolled back');
      } else {
        await trx.commit();
      }
    } catch (e) {
      await trx.rollback();
      console.error(`  [error] ${addon.name}: ${e}`);
      process.exit(3);
    }
  }

  const coverage = (seededCount / addons.length) * 100;
  return { totalInserted, totalUpdated, totalSkipped, coverage };
}

async function createKnex() {
  const knex = require('knex');
  const pg = require('pg');

  const config = {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'moonwitness',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },
    pool: { min: 1, max: 5 },
  };

  return knex(config);
}

program
  .name('db:seed')
  .description('Run addon seed data in topological order')
  .option('--verify-only', 'Run seeds but rollback transactions, report coverage')
  .action(async (opts) => {
    console.log('Starting seed runner...');
    console.log('Mode:', opts.verifyOnly ? 'VERIFY ONLY' : 'APPLY');

    const db = await createKnex();
    try {
      await db.raw('SELECT 1');
      console.log('Database connected');

      const result = await runSeeds(db, opts.verifyOnly);

      console.log('\n=== SUMMARY ===');
      console.log(`Total inserted: ${result.totalInserted}`);
      console.log(`Total updated: ${result.totalUpdated}`);
      console.log(`Total skipped: ${result.totalSkipped}`);
      console.log(`Coverage: ${result.coverage.toFixed(1)}%`);

      if (opts.verifyOnly) {
        if (result.coverage < 100) {
          console.error('VERIFY FAILED: Not all addons seeded');
          process.exit(1);
        }
        console.log('VERIFY PASSED: 100% addon coverage');
      }

      process.exit(0);
    } catch (e) {
      console.error('Fatal error:', e);
      process.exit(3);
    } finally {
      await db.destroy();
    }
  });

program.parse(process.argv);
