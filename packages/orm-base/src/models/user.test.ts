import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest, User, Partner, Company } from '../index.js';
const migrationModulePath = '../migrations/001_identity_subject.js';
const migrationUp = (async (database: Knex) => {
  const module = (await import(migrationModulePath)) as { up: (db: Knex) => Promise<void> };
  await module.up(database);
}) satisfies (db: Knex) => Promise<void>;

describe('base.user identity_subject mapping (I41)', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await installAddons(db, [manifest]);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('defines nullable unique identity_subject column and preserves integer ID', async () => {
    expect(await db.schema.hasColumn('users', 'identity_subject')).toBe(true);

    const superadmin = await User.query().findOne({ login: 'superadmin' }).throwIfNotFound();
    expect(typeof superadmin.id).toBe('number');
    expect(superadmin.identity_subject).toBeNull();
  });

  it('allows multiple users with null identity_subject', async () => {
    const users = await User.query().whereNull('identity_subject');
    expect(users.length).toBeGreaterThanOrEqual(2);
  });

  it('allows setting an opaque identity_subject and resolves user by subject', async () => {
    const opaqueSub = 'opaque-sub-uuid-12345678';
    const superadmin = await User.query().findOne({ login: 'superadmin' }).throwIfNotFound();

    await User.query().findById(superadmin.id).patch({ identity_subject: opaqueSub });
    const found = await User.query().findOne({ identity_subject: opaqueSub });
    expect(found).toBeDefined();
    expect(found?.id).toBe(superadmin.id);
    expect(found?.login).toBe('superadmin');
  });

  it('rejects duplicate non-null identity_subject', async () => {
    const opaqueSub = 'duplicate-sub-test';
    const superadmin = await User.query().findOne({ login: 'superadmin' }).throwIfNotFound();
    const system = await User.query().findOne({ login: 'system' }).throwIfNotFound();

    await User.query().findById(superadmin.id).patch({ identity_subject: opaqueSub });

    await expect(
      User.query().findById(system.id).patch({ identity_subject: opaqueSub })
    ).rejects.toThrow();
  });

  it('migration is repeatable and idempotent', async () => {
    await migrationUp(db);
    await migrationUp(db);
    expect(await db.schema.hasColumn('users', 'identity_subject')).toBe(true);
  });
});
