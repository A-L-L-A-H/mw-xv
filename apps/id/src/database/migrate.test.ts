import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import {
  createIdentityMigrationRunner,
  IDENTITY_MIGRATION_TABLE,
  IDENTITY_SCHEMA,
} from './migrate.js';

function fakeDatabase() {
  const raw = vi.fn(async () => undefined);
  const latest = vi.fn(async () => []);
  const list = vi.fn(async () => [{ name: '001_identity_schema.js' }]);
  const database = { raw } as unknown as Knex;
  return { database, raw, latest, list, migrator: { latest, list } as unknown as Knex.Migrator };
}

describe('Identity migration runner', () => {
  it('uses an Identity-only table and schema', async () => {
    const { database, migrator } = fakeDatabase();
    const runner = createIdentityMigrationRunner(database, migrator);
    await runner.apply();
    expect(migrator.latest).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: IDENTITY_MIGRATION_TABLE,
        schemaName: IDENTITY_SCHEMA,
      })
    );
  });

  it('is ordered and repeatable through Knex migrations', async () => {
    const { database, migrator } = fakeDatabase();
    const runner = createIdentityMigrationRunner(database, migrator);
    await runner.apply();
    await runner.apply();
    expect(migrator.latest).toHaveBeenCalledTimes(2);
    expect(await runner.status()).toEqual(['001_identity_schema.js']);
  });

  it('refuses unsafe rollback', async () => {
    const { database, migrator } = fakeDatabase();
    const runner = createIdentityMigrationRunner(database, migrator);
    await expect(runner.rollback()).rejects.toThrow('rollback is intentionally disabled');
  });
});
