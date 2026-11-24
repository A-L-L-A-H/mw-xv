import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { SignalAlert, SignalObservation, SignalScore, SignalSource, manifest } from '../src/index.js';
import { SIGNAL_SOURCE_SEED_COUNT } from '../src/seed.js';

describe('@moonwitness/orm-signal addon', () => {
  let db: Knex;

  beforeEach(() => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(
          connection: { pragma(sql: string): unknown },
          done: (error: Error | null, connection: unknown) => void
        ) {
          connection.pragma('foreign_keys = ON');
          done(null, connection);
        },
      },
    });
  });

  afterEach(async () => db.destroy());

  it('installs signal tables, seeds 9 disabled sources, and is idempotent', async () => {
    await installAddons(db, [manifest, baseManifest]);
    await installAddons(db, [baseManifest, manifest]);

    expect(manifest.depends).toEqual(['base']);
    expect(await db(SignalSource.tableName).count({ count: '*' }).first()).toMatchObject({
      count: SIGNAL_SOURCE_SEED_COUNT,
    });

    const sources = await db(SignalSource.tableName).select();
    expect(sources.every((row: { is_active: unknown }) => row.is_active === 0 || row.is_active === false)).toBe(true);
    const kinds = new Set(sources.map((row: { kind: string }) => row.kind));
    expect(kinds.size).toBe(SIGNAL_SOURCE_SEED_COUNT);

    expect(await db(SignalObservation.tableName).count({ count: '*' }).first()).toMatchObject({ count: 0 });
    expect(await db(SignalScore.tableName).count({ count: '*' }).first()).toMatchObject({ count: 0 });
    expect(await db(SignalAlert.tableName).count({ count: '*' }).first()).toMatchObject({ count: 0 });

    for (const model of manifest.models) {
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }
  });

  it('rejects duplicate source codes (unique constraint)', async () => {
    await installAddons(db, [manifest, baseManifest]);
    const company = await db('companies').first('id');
    await expect(
      db(SignalSource.tableName).insert({ company_id: company.id, code: 'rss_generic', name: 'Dup', kind: 'rss', is_active: false })
    ).rejects.toThrow();
  });

  it('rejects observations whose source does not exist (foreign key)', async () => {
    await installAddons(db, [manifest, baseManifest]);
    await expect(
      db(SignalObservation.tableName).insert({ source_id: 999999, title: 'Ghost', content_hash: 'h' })
    ).rejects.toThrow();
  });

  it('rejects alerts with an invalid status enum value', async () => {
    await installAddons(db, [manifest, baseManifest]);
    const company = await db('companies').first('id');
    const [sourceId] = await db(SignalSource.tableName)
      .insert({ company_id: company.id, code: 'rss_test', name: 'Test RSS', kind: 'rss', is_active: true })
      .returning('id');
    const [observationId] = await db(SignalObservation.tableName)
      .insert({ source_id: Number(sourceId.id ?? sourceId), title: 'T', content_hash: 'h1', company_id: company.id })
      .returning('id');
    await expect(
      db(SignalAlert.tableName).insert({
        observation_id: Number(observationId.id ?? observationId),
        threshold: 0.75,
        fired_at: new Date().toISOString(),
        status: 'bogus',
      })
    ).rejects.toThrow();
  });
});
