import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { SignalSource, manifest } from '../src/index.js';
import { SIGNAL_SOURCE_SEEDS, SIGNAL_SOURCE_SEED_COUNT, seedManifest, seedSignalSources } from '../src/seed.js';

async function installAndReset(db: Knex): Promise<void> {
  await installAddons(db, [manifest, baseManifest]);
  // The manifest's declarative data already seeds the 9 sources; clear them so
  // the standalone seeder's insert path is exercised against a clean table.
  await db(SignalSource.tableName).delete();
}

describe('seedSignalSources', () => {
  let db: Knex;

  beforeEach(() => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(conn: { pragma: (sql: string) => void }, done: () => void) {
          conn.pragma('foreign_keys = OFF');
          done();
        },
      },
    });
  });

  afterEach(async () => db.destroy());

  it('inserts one disabled source per adapter kind', async () => {
    await installAndReset(db);
    const { inserted, total } = await seedSignalSources(db);

    expect(SIGNAL_SOURCE_SEED_COUNT).toBe(9);
    expect(inserted).toBe(SIGNAL_SOURCE_SEED_COUNT);
    expect(total).toBe(SIGNAL_SOURCE_SEED_COUNT);

    const rows = await db(SignalSource.tableName).select();
    expect(rows.length).toBe(SIGNAL_SOURCE_SEED_COUNT);
    for (const row of rows) {
      expect(Number(row.is_active)).toBe(0);
    }
    const expectedKinds = new Set(SIGNAL_SOURCE_SEEDS.map((seed) => seed.kind));
    const actualKinds = new Set(rows.map((row) => row.kind));
    expect(actualKinds).toEqual(expectedKinds);
  });

  it('is idempotent: second run inserts nothing', async () => {
    await installAndReset(db);
    await seedSignalSources(db);
    const second = await seedSignalSources(db);
    expect(second.inserted).toBe(0);
    expect(second.total).toBe(SIGNAL_SOURCE_SEED_COUNT);
  });

  it('seedManifest.seed reports correct counts via the addon seed contract', async () => {
    await installAndReset(db);
    // Reset the seed ledger for this model so the manifest contract path
    // performs fresh inserts instead of skipping pre-seeded rows.
    await db('_orm_data').where({ model: SignalSource.modelName }).delete();

    const company = await db('companies').first('id');
    const result = await seedManifest.seed({ db, companyId: Number(company.id) });
    expect(result.inserted).toBe(SIGNAL_SOURCE_SEED_COUNT);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);

    const again = await seedManifest.seed({ db, companyId: Number(company.id) });
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(SIGNAL_SOURCE_SEED_COUNT);
  });

  it('fails when no company exists', async () => {
    await installAndReset(db);
    await db('companies').delete();
    await expect(seedSignalSources(db)).rejects.toThrow(/no company record/);
  });
});
