import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { installAddons } from '../../packages/orm/dist/index.js';
import {
  isFeatureFlagEnabled,
  manifest as baseManifest,
} from '../../packages/orm-base/dist/index.js';
import { collectSanitizedSignals } from './collect-signals.mjs';
import { scanExpiredExperiments } from './prune-expired-experiments.mjs';
import { scaffoldExperimentalAddon } from './scaffold-exp-addon.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromApi = createRequire(path.join(repositoryRoot, 'apps/api/package.json'));
const knex = requireFromApi('knex');

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Wave 5 Self-Evolving Features & Organism', () => {
  it('installs IrFeatureFlag and enforces company scope, rollout_pct, and expires_at TTL', async () => {
    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    try {
      assert.equal(
        await isFeatureFlagEnabled(db, 'missing_table_flag', { defaultEnabled: false }),
        false
      );

      await installAddons(db, [baseManifest]);
      const [companyId] = await db('companies').insert({ name: 'Evo Co' });

      await db('ir_feature_flags').insert([
        {
          key: 'exp.enabled_global',
          name: 'Enabled Global',
          enabled: true,
          rollout_pct: 100,
          proposal_id: 'EVO-100',
        },
        {
          key: 'exp.scoped_company',
          name: 'Scoped Company',
          enabled: true,
          rollout_pct: 50,
          company_id: companyId,
          proposal_id: 'EVO-101',
        },
        {
          key: 'exp.expired_flag',
          name: 'Expired Flag',
          enabled: true,
          rollout_pct: 100,
          expires_at: '2020-01-01T00:00:00.000Z',
          proposal_id: 'EVO-102',
        },
      ]);

      assert.equal(await isFeatureFlagEnabled(db, 'exp.enabled_global'), true);
      assert.equal(await isFeatureFlagEnabled(db, 'exp.scoped_company', { companyId }), true);
      assert.equal(
        await isFeatureFlagEnabled(db, 'exp.scoped_company', { companyId: Number(companyId) + 99 }),
        false
      );
      assert.equal(
        await isFeatureFlagEnabled(db, 'exp.expired_flag', {
          now: new Date('2026-11-21T00:00:00.000Z'),
        }),
        false
      );
    } finally {
      await db.destroy();
    }
  });

  it('scaffolds exp-* addons in dry-run and temp directory with TTL metadata', async () => {
    const preview = await scaffoldExperimentalAddon({
      name: 'exp-smart-triage',
      flag: 'exp.smart_triage',
      proposal: 'EVO-200',
      ttlDays: 7,
      dryRun: true,
    });
    assert.equal(preview.packageName, '@moonwitness/orm-exp-smart-triage');
    assert.equal(preview.experimental.flagKey, 'exp.smart_triage');
    assert.ok(preview.files['src/manifest.ts'].includes('ExperimentalRecord'));

    const outDir = await mkdtemp(path.join(os.tmpdir(), 'mw-exp-addon-'));
    tempDirs.push(outDir);
    const created = await scaffoldExperimentalAddon({
      name: 'exp-smart-triage',
      outDir,
    });
    assert.ok(created.writtenDir?.endsWith('orm-exp-smart-triage'));
  });

  it('detects expired experiments across registry and experiments manifest', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mw-evo-prune-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, 'evolution'), { recursive: true });
    await writeFile(
      path.join(dir, 'evolution/experiments.json'),
      JSON.stringify([
        { flagKey: 'exp.old', expiresAt: '2025-01-01T00:00:00.000Z', proposalId: 'EVO-1' },
        { flagKey: 'exp.live', expiresAt: '2099-01-01T00:00:00.000Z', proposalId: 'EVO-2' },
      ])
    );

    const outcome = await scanExpiredExperiments({
      repositoryRoot: dir,
      now: new Date('2026-11-21T00:00:00.000Z'),
    });
    assert.equal(outcome.shouldPrune, true);
    assert.equal(outcome.expiredCount, 1);
    assert.equal(outcome.activeCount, 1);
    assert.equal(outcome.expired[0].flagKey, 'exp.old');
  });

  it('scrubs PII and secrets before aggregating telemetry friction signals', async () => {
    const report = await collectSanitizedSignals({
      events: [
        {
          route: '/whatsapp/send',
          category: 'timeout',
          email: 'user@example.com',
          token: 'secret-jwt-value',
          detail: 'Timeout for 6281234567890@s.whatsapp.net and alice@corp.id',
        },
        {
          route: '/whatsapp/send',
          category: 'timeout',
          phone: '+62 812 3456 7890',
        },
      ],
    });

    assert.equal(report.totalSignals, 2);
    assert.ok(report.scrubbedFieldsCount >= 4);
    assert.equal(report.candidates[0].occurrences, 2);
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('user@example.com'));
    assert.ok(!serialized.includes('secret-jwt-value'));
    assert.ok(!serialized.includes('6281234567890'));
  });
});
