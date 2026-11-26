import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';

export const IDENTITY_MIGRATION_TABLE = 'identity_migrations';
export const IDENTITY_SCHEMA = 'identity';

export type MigrationDirection = 'up' | 'down';

export interface IdentityMigrationPort {
  readonly raw: (sql: string) => Promise<unknown>;
}

export interface IdentityMigrationRunner {
  readonly database: Knex;
  readonly apply: () => Promise<void>;
  readonly status: () => Promise<readonly string[]>;
  readonly rollback: () => Promise<never>;
}

const migrationDirectory = path.dirname(fileURLToPath(import.meta.url));

export function identityMigrationConfig(database: Knex): Knex.MigratorConfig {
  return {
    tableName: IDENTITY_MIGRATION_TABLE,
    schemaName: IDENTITY_SCHEMA,
    directory: path.join(migrationDirectory, 'migrations'),
    extension: 'js',
    loadExtensions: ['.js'],
    disableMigrationsListValidation: false,
  } as Knex.MigratorConfig;
}

export function createIdentityMigrationRunner(
  database: Knex,
  migrator: Pick<Knex.Migrator, 'latest' | 'list'> = database.migrate
): IdentityMigrationRunner {
  const config = identityMigrationConfig(database);
  return {
    database,
    apply: async () => {
      await database.raw(`CREATE SCHEMA IF NOT EXISTS ${IDENTITY_SCHEMA}`);
      await migrator.latest(config);
    },
    status: async () => {
      const migrations = await migrator.list(config);
      return migrations.map((migration: { name: string }) => migration.name);
    },
    rollback: async () => {
      throw new Error('Identity schema rollback is intentionally disabled');
    },
  };
}
