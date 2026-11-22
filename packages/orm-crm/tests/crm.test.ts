import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { Lead, LeadStage, LeadTagLink, Opportunity, manifest } from '../src/index.js';

describe('@moonwitness/orm-crm addon', () => {
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

  it('installs complete CRM pipeline stages, demo leads, opportunities, tags, and views idempotently', async () => {
    await installAddons(db, [manifest, baseManifest]);
    await installAddons(db, [baseManifest, manifest]);

    expect(manifest.depends).toEqual(['base']);
    expect(await db(LeadStage.tableName).count({ count: '*' }).first()).toMatchObject({ count: 6 });
    expect(await db(Lead.tableName).count({ count: '*' }).first()).toMatchObject({ count: 6 });
    expect(await db(Opportunity.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 4,
    });
    expect(await db(LeadTagLink.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 2,
    });

    for (const model of manifest.models) {
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }
  });
});
