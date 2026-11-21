import type { Knex } from 'knex';
import { createDatabase } from '../database/knex.js';
import { installApiAddons } from '../addons/registry.js';

const MIGRATION_ADVISORY_LOCK_ID = 77490122;

export async function runPreDeployMigrations(
  db: Knex,
  superadminPassword: string | undefined
): Promise<void> {
  const isPostgres = db.client?.config?.client === 'pg';
  if (isPostgres) {
    await db.raw('SELECT pg_advisory_lock(?)', [MIGRATION_ADVISORY_LOCK_ID]);
  }
  try {
    await installApiAddons(db, superadminPassword, undefined, { skipBootMigrations: false });
  } finally {
    if (isPostgres) {
      await db.raw('SELECT pg_advisory_unlock(?)', [MIGRATION_ADVISORY_LOCK_ID]).catch(() => {});
    }
  }
}

async function main(): Promise<void> {
  const db = createDatabase();
  try {
    await runPreDeployMigrations(db, process.env.SUPERADMIN_PASSWORD);
    process.stdout.write('Pre-deploy database migrations completed safely.\n');
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Pre-deploy migration failed: ${message}\n`);
    process.exitCode = 1;
  });
}
