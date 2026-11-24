import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import knexFactory, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { observabilityAddon } from './manifest.js';
import { SqlTelemetryStore } from './sql-store.js';
import type { TelemetryStoreOptions } from './types.js';

export interface SqliteTelemetryStoreOptions extends TelemetryStoreOptions {
  filename: string;
}

export async function createSqliteTelemetryStore(
  options: SqliteTelemetryStoreOptions
): Promise<SqlTelemetryStore> {
  const { filename, ...storeOptions } = options;
  if (filename !== ':memory:') await mkdir(dirname(resolve(filename)), { recursive: true });

  const db: Knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  try {
    await installAddons(db, [observabilityAddon]);
    return new SqlTelemetryStore(db, storeOptions);
  } catch (error) {
    await db.destroy();
    throw error;
  }
}
