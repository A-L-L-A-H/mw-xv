import knex, { type Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeMigrationBackoffMs,
  coordinateApiMigration,
  ensureSchemaStateTable,
  readSchemaState,
  runApiSchemaMigration,
  waitForSchemaReady,
} from '../src/database/schema-state.js';

describe('schema migration backoff', () => {
  it('uses exponential backoff capped at sixty seconds', () => {
    expect([1, 2, 3, 4, 5, 6].map(computeMigrationBackoffMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000,
    ]);
  });
});

describe('API migration coordinator', () => {
  let db: Knex;

  afterEach(async () => {
    if (db) await db.destroy();
  });

  it('retries a failed migration and records the applied state', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const sleeps: number[] = [];
    const statuses: string[] = [];
    let attempts = 0;

    const state = await coordinateApiMigration(db, {
      desired: { version: 1, digest: 'abc123abc123abcd', addons: [] },
      ownerId: 'api-test',
      onStateChange: (state) => {
        statuses.push(state.status);
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      migrate: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('migration failed');
      },
    });

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([5_000]);
    expect(statuses).toEqual(['running', 'retrying', 'running', 'applied']);
    expect(state).toMatchObject({
      status: 'applied',
      desired_version: 1,
      desired_digest: 'abc123abc123abcd',
      applied_version: 1,
      applied_digest: 'abc123abc123abcd',
      attempt_count: 2,
      last_error_code: 'MIGRATION_FAILED',
    });
    expect(await readSchemaState(db)).toMatchObject({ status: 'applied', attempt_count: 2 });
  });

  it('redacts credentials and database URLs from migration errors', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    let attempts = 0;

    await coordinateApiMigration(db, {
      desired: { version: 1, digest: 'abc123abc123abcd', addons: [] },
      ownerId: 'api-test',
      sleep: async () => {},
      migrate: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('connect postgresql://postgres:secret@db/app JWT_SECRET=hidden');
        }
      },
    });

    const state = await readSchemaState(db);
    expect(state?.last_error_message).toContain('[redacted-url]');
    expect(state?.last_error_message).toContain('JWT_SECRET=[redacted]');
    expect(state?.last_error_message).not.toContain('secret');
    expect(state?.last_error_message).not.toContain('hidden');
  });

  it('waits until the applied schema matches the worker expectation', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('_orm_schema_state', (table) => {
      table.string('id').primary();
      table.string('status').notNullable();
      table.integer('desired_version').notNullable();
      table.string('desired_digest').notNullable();
      table.integer('applied_version').nullable();
      table.string('applied_digest').nullable();
      table.string('owner_id').nullable();
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.string('heartbeat_at').nullable();
      table.string('started_at').nullable();
      table.string('completed_at').nullable();
      table.string('last_error_code').nullable();
      table.text('last_error_message').nullable();
      table.string('last_attempt_at').nullable();
      table.string('updated_at').notNullable();
    });
    await db('_orm_schema_state').insert({
      id: 'global',
      status: 'running',
      desired_version: 1,
      desired_digest: 'abc123abc123abcd',
      applied_version: null,
      applied_digest: null,
      owner_id: 'api-test',
      attempt_count: 1,
      heartbeat_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      last_error_code: null,
      last_error_message: null,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    let waits = 0;
    const state = await waitForSchemaReady(db, {
      desired: { version: 1, digest: 'abc123abc123abcd', addons: [] },
      sleep: async () => {
        waits += 1;
        await db('_orm_schema_state').where({ id: 'global' }).update({
          status: 'applied',
          applied_version: 1,
          applied_digest: 'abc123abc123abcd',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      },
    });

    expect(waits).toBe(1);
    expect(state.status).toBe('applied');
  });

  it('marks the API ready only after the migration callback completes', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const readiness = { ready: false, status: 'running' as const };
    let migrated = false;

    await runApiSchemaMigration(db, {
      desired: { version: 1, digest: 'abc123abc123abcd', addons: [] },
      readiness,
      migrate: async () => {
        migrated = true;
      },
    });

    expect(migrated).toBe(true);
    expect(readiness).toEqual({
      ready: true,
      status: 'applied',
      version: 1,
      digest: 'abc123abc123abcd',
    });
  });

  it('stops after the configured attempt limit', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    let attempts = 0;

    await expect(
      coordinateApiMigration(db, {
        desired: { version: 1, digest: 'abc123abc123abcd', addons: [] },
        maxAttempts: 2,
        sleep: async () => {
          if (attempts >= 3) throw new Error('attempt limit was not enforced');
        },
        migrate: async () => {
          attempts += 1;
          throw new Error('persistent migration failure');
        },
      })
    ).rejects.toThrow('persistent migration failure');

    expect(attempts).toBe(2);
  });

  it('retries transient state table initialization failures', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    let ensureCalls = 0;

    await coordinateApiMigration(db, {
      desired: { version: 1, digest: 'abc123abc123abcd', addons: [] },
      ensureStateTable: async () => {
        ensureCalls += 1;
        if (ensureCalls === 1) throw new Error('database temporarily unavailable');
        await ensureSchemaStateTable(db);
      },
      sleep: async () => {},
      migrate: async () => {},
    });

    expect(ensureCalls).toBe(2);
    expect((await readSchemaState(db))?.status).toBe('applied');
  });

  it('revalidates schema state after acquiring the migration lock', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    let migrations = 0;

    const state = await coordinateApiMigration(db, {
      desired: { version: 1, digest: 'abc123abc123abcd', addons: [] },
      tryAcquireLock: async () => {
        const timestamp = new Date().toISOString();
        await db('_orm_schema_state').insert({
          id: 'global',
          status: 'applied',
          desired_version: 1,
          desired_digest: 'abc123abc123abcd',
          applied_version: 1,
          applied_digest: 'abc123abc123abcd',
          owner_id: 'other-api',
          attempt_count: 1,
          heartbeat_at: timestamp,
          started_at: timestamp,
          completed_at: timestamp,
          last_error_code: null,
          last_error_message: null,
          last_attempt_at: timestamp,
          updated_at: timestamp,
        });
        return true;
      },
      migrate: async () => {
        migrations += 1;
      },
    });

    expect(migrations).toBe(0);
    expect(state.status).toBe('applied');
  });

  it('releases the lock and retries when persisting the running state fails', async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    let runningWrites = 0;
    let releaseCalls = 0;
    let migrations = 0;

    await coordinateApiMigration(db, {
      desired: { version: 1, digest: 'abc123abc123abcd', addons: [] },
      writeState: async (database, state) => {
        if (state.status === 'running') {
          runningWrites += 1;
          if (runningWrites === 1) throw new Error('state write failed');
        }
        await database('_orm_schema_state').insert(state).onConflict('id').merge(state);
      },
      tryAcquireLock: async () => true,
      releaseLock: async () => {
        releaseCalls += 1;
      },
      sleep: async () => {},
      migrate: async () => {
        migrations += 1;
      },
    });

    expect(migrations).toBe(1);
    expect(runningWrites).toBe(2);
    expect(releaseCalls).toBe(2);
  });
});
