import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigrationPostgresKnexConfig } from '../src/config/knexfile.js';
import { coordinateApiMigration, readSchemaState } from '../src/database/schema-state.js';

const connectionString = process.env.POSTGRES_TEST_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe('PostgreSQL schema migration coordination', () => {
  let adminDb: Knex;
  let firstDb: Knex;
  let secondDb: Knex;
  const schema = `mw_schema_state_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    if (!connectionString) throw new Error('POSTGRES_TEST_URL is required');
    adminDb = knex({ client: 'pg', connection: connectionString, pool: { min: 0, max: 2 } });
    await adminDb.raw('create schema ??', [schema]);
    const limits = {
      poolMin: 0,
      poolMax: 1,
      acquireTimeoutMs: 5_000,
      statementTimeoutMs: 30_000,
      migrationStatementTimeoutMs: 300_000,
    };
    firstDb = knex(
      createMigrationPostgresKnexConfig(connectionString, limits, { searchPath: [schema] })
    );
    secondDb = knex(
      createMigrationPostgresKnexConfig(connectionString, limits, { searchPath: [schema] })
    );
  }, 30_000);

  afterAll(async () => {
    await firstDb?.destroy();
    await secondDb?.destroy();
    if (adminDb) {
      await adminDb.raw('drop schema if exists ?? cascade', [schema]);
      await adminDb.destroy();
    }
  });

  it('uses the isolated migration schema', async () => {
    const result = await firstDb.raw('SELECT current_schema() AS schema');
    expect(result.rows[0]?.schema).toBe(schema);
  });

  it('serializes concurrent coordinators and applies the migration once', async () => {
    const desired = { version: 1, digest: 'abc123abc123abcd', addons: [] };
    let migrations = 0;
    const migrate = async () => {
      migrations += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
    };

    const [first, second] = await Promise.all([
      coordinateApiMigration(firstDb, { desired, migrate }),
      coordinateApiMigration(secondDb, { desired, migrate }),
    ]);

    expect(migrations).toBe(1);
    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied');
    expect(await readSchemaState(firstDb)).toMatchObject({
      status: 'applied',
      applied_version: 1,
      applied_digest: 'abc123abc123abcd',
    });
  }, 30_000);
});
