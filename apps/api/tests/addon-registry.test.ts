import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { defineAddon, defineModel, fields, Registry } from '@moonwitness/orm';
import { registerJobHandler } from '@moonwitness/jobs';
import { API_ADDONS, bootstrapApiWorker } from '../src/addons/registry.js';

const Widget = defineModel('test.worker-widget', {
  table: 'test_worker_widgets',
  fields: { name: fields.string({ required: true }) },
});

const addon = {
  name: 'test-worker',
  manifest: defineAddon({
    name: 'test-worker',
    version: '1.0.0',
    models: [Widget],
  }),
};

describe('API worker bootstrap', () => {
  let db: ReturnType<typeof knex>;

  afterEach(async () => {
    await db.destroy();
  });

  it('registers metadata without writing database schema', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await bootstrapApiWorker(db, {
      addons: [addon],
      waitForSchema: async () => {},
    });

    expect(Registry.get('test.worker-widget')).toBe(Widget);
    expect(await db.schema.hasTable('_orm_addons')).toBe(false);
    expect(await db.schema.hasTable('test_worker_widgets')).toBe(false);
  });

  it('registers AI agent-run job handlers on the worker path', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await bootstrapApiWorker(db, {
      addons: API_ADDONS,
      waitForSchema: async () => {},
    });

    for (const name of ['ai.agent_run.execute', 'ai.agent_run.inspect']) {
      expect(() =>
        registerJobHandler({
          name,
          version: 1,
          parse: (payload: unknown) => payload,
          run: async () => ({ ok: true }),
        })
      ).toThrow(/already registered/iu);
    }
  });
});
