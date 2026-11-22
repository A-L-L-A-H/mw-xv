import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import knexConfig, { createMigrationPostgresKnexConfig } from '../config/knexfile.js';
import { config } from '../config/env.js';

export function createDatabase(): Knex {
  const environment =
    config.env === 'test' || config.env === 'production' ? config.env : 'development';
  const db = knex(knexConfig[environment] ?? knexConfig.development);
  Model.knex(db);
  return db;
}

export function createMigrationDatabase(): Knex {
  return knex(createMigrationPostgresKnexConfig(config.db.connection, config.db));
}

export async function testConnection(db: Knex): Promise<boolean> {
  try {
    await db.raw('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
