import knex, { type Knex } from 'knex';
import { BaseModel, installAddons, registerAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { whatsappManifest } from '@moonwitness/orm-whatsapp';
import type { WhatsappServiceConfig } from './config.js';

export function createDatabase(
  config: Pick<WhatsappServiceConfig, 'databaseUrl' | 'sqlitePath'>
): Knex {
  const isPostgres =
    typeof config.databaseUrl === 'string' &&
    (config.databaseUrl.startsWith('postgres://') ||
      config.databaseUrl.startsWith('postgresql://'));

  const db = isPostgres
    ? knex({
        client: 'pg',
        connection: {
          connectionString: config.databaseUrl!,
        },
        pool: {
          min: 0,
          max: 10,
        },
      })
    : knex({
        client: 'better-sqlite3',
        connection: {
          filename: config.sqlitePath || ':memory:',
        },
        useNullAsDefault: true,
      });

  BaseModel.knex(db);
  return db;
}

function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) {
      return (a[index] ?? 0) - (b[index] ?? 0);
    }
  }
  return 0;
}

async function isAlreadyInstalledOnDatabase(db: Knex): Promise<boolean> {
  const hasAddonsTable = await db.schema.hasTable('_orm_addons');
  if (!hasAddonsTable) return false;
  const hasAccountsTable = await db.schema.hasTable('whatsapp_accounts');
  if (!hasAccountsTable) return false;

  const installedRows = (await db('_orm_addons')
    .whereIn('name', [baseManifest.name, whatsappManifest.name])
    .select('name', 'version', 'status')) as Array<{
    name: string;
    version: string;
    status?: string;
  }>;

  const byName = new Map(installedRows.map((row) => [row.name, row]));
  const installedBase = byName.get(baseManifest.name);
  const installedWhatsapp = byName.get(whatsappManifest.name);

  if (!installedBase || !installedWhatsapp) return false;
  if (installedBase.status !== 'installed' || installedWhatsapp.status !== 'installed')
    return false;

  // Never run DDL/seed against an existing moonwitness_db when both addons are already at
  // the current or newer version; register in-memory bindings without touching existing tables.
  return (
    compareSemver(installedBase.version, baseManifest.version) >= 0 &&
    compareSemver(installedWhatsapp.version, whatsappManifest.version) >= 0
  );
}

export async function bootstrapWhatsappOrm(
  db: Knex,
  options: { installSchema?: boolean } = {}
): Promise<void> {
  BaseModel.knex(db);
  const shouldSkipDdl =
    options.installSchema === false ||
    process.env.SKIP_BOOT_MIGRATIONS === 'true' ||
    (await isAlreadyInstalledOnDatabase(db));

  if (shouldSkipDdl) {
    await registerAddons(db, [baseManifest, whatsappManifest]);
    return;
  }

  await installAddons(db, [baseManifest, whatsappManifest]);
}

export async function testDatabaseConnection(db: Knex): Promise<boolean> {
  try {
    await db.raw('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
