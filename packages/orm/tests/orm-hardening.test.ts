import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Environment,
  Registry,
  defineAddon,
  defineModel,
  fields,
  installAddons,
  createServiceToken,
  ServiceContainer,
} from '../src/index.js';

describe('ORM hardening and performance invariants', () => {
  const connections: ReturnType<typeof knex>[] = [];

  afterEach(async () => {
    while (connections.length) {
      await connections.pop()!.destroy();
    }
    Registry.clear();
  });

  function createMemoryDb() {
    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    connections.push(db);
    return db;
  }

  it('caches bound model subclasses per Environment instance without regenerating classes', async () => {
    const db = createMemoryDb();
    const Note = defineModel('hardening.note', {
      table: 'hardening_notes',
      fields: { title: fields.string({ required: true }) },
    });
    const addon = defineAddon({ name: 'hardening_env', version: '1.0.0', models: [Note] });
    await installAddons(db, [addon]);

    const env = new Environment({ userId: 7 });
    const first = env.get('hardening.note');
    const second = env.get('hardening.note');
    expect(first).toBe(second);

    const otherEnv = new Environment({ userId: 8 });
    expect(otherEnv.get('hardening.note')).not.toBe(first);
  });

  it('enforces search_read field whitelist even when hiddenFields is empty', async () => {
    const db = createMemoryDb();
    const Item = defineModel('hardening.item', {
      table: 'hardening_items',
      fields: {
        name: fields.string({ required: true, index: true }),
      },
    });
    const addon = defineAddon({ name: 'hardening_fields', version: '1.0.0', models: [Item] });
    await installAddons(db, [addon]);
    await Item.create({ name: 'Alpha' });

    const valid = await Item.search_read([], { fields: ['name'] });
    expect(valid).toEqual([{ id: 1, name: 'Alpha' }]);

    await expect(Item.search_read([], { fields: ['nonexistent_col'] })).rejects.toThrow(
      /Invalid or private field selection/u
    );
    await expect(
      Item.search_read([], { fields: ['name; DROP TABLE hardening_items'] })
    ).rejects.toThrow(/Invalid or private field selection/u);
  });

  it('creates custom field indexes and composite multi-tenant (company_id, active, id) index', async () => {
    const db = createMemoryDb();
    const Org = defineModel('hardening.org', {
      table: 'hardening_orgs',
      fields: { name: fields.string({ required: true }) },
    });
    const Ticket = defineModel('hardening.ticket', {
      table: 'hardening_tickets',
      fields: {
        company: fields.belongsTo(Org, { required: true }),
        code: fields.string({ required: true, index: true }),
      },
    });
    const addon = defineAddon({
      name: 'hardening_indexes',
      version: '1.0.0',
      models: [Org, Ticket],
    });
    await installAddons(db, [addon]);

    const indexList = (await db.raw("PRAGMA index_list('hardening_tickets')")) as {
      name: string;
    }[];
    const indexColumns: string[][] = [];
    for (const idx of indexList) {
      const info = (await db.raw(`PRAGMA index_info('${idx.name}')`)) as { name: string }[];
      indexColumns.push(info.map((col) => col.name));
    }

    expect(indexColumns).toContainEqual(['company_id', 'active', 'id']);
    expect(indexColumns).toContainEqual(['code']);
  });

  it('executes multi-step addon upgrades in ascending semver order when jumping versions', async () => {
    const db = createMemoryDb();
    const RecordModel = defineModel('hardening.versioned', {
      table: 'hardening_versioned',
      fields: { label: fields.string({ required: true }) },
    });
    const v1 = defineAddon({
      name: 'hardening_chain',
      version: '1.0.0',
      models: [RecordModel],
    });
    await installAddons(db, [v1]);

    const executed: string[] = [];
    const v12 = defineAddon({
      name: 'hardening_chain',
      version: '1.2.0',
      models: [RecordModel],
      upgrade: {
        '1.1.0': async () => {
          executed.push('1.1.0->1.2.0');
        },
        '1.0.0': async () => {
          executed.push('1.0.0->1.1.0');
        },
        '0.9.0': async () => {
          executed.push('0.9.0-should-skip');
        },
      },
    });
    await installAddons(db, [v12]);

    expect(executed).toEqual(['1.0.0->1.1.0', '1.1.0->1.2.0']);
  });

  it('resolves registered cross-addon services through Environment and fails closed for missing services', async () => {
    const storageService = createServiceToken<{ put(): string }>('orm.service.storage');
    const loggerService = createServiceToken<{ info(message: string): void }>('orm.service.logger');

    const services = new Environment().services;
    services.register(storageService, { put: () => 'stored' });
    services.register(loggerService, { info: () => undefined });

    const env = new Environment({}, undefined, services);
    const childEnv = env.withUser(7);

    expect(env.services.get(storageService).put()).toBe('stored');
    expect(env.services.has(loggerService)).toBe(true);
    expect(childEnv.services).toBe(env.services);
    expect(() => env.services.get(createServiceToken('orm.service.missing'))).toThrowError(
      "Service 'orm.service.missing' is not registered."
    );
  });

  it('disposes registered services in reverse registration order', async () => {
    const services = new ServiceContainer();
    const firstToken = createServiceToken<{ close(): void }>('orm.service.first');
    const secondToken = createServiceToken<{ close(): Promise<void> }>('orm.service.second');
    const disposed: string[] = [];
    services.register(firstToken, { close: () => undefined }, () => {
      disposed.push('first');
    });
    services.register(secondToken, { close: async () => undefined }, async () => {
      disposed.push('second');
    });
    await services.disposeAll();
    expect(disposed).toEqual(['second', 'first']);
  });
});
