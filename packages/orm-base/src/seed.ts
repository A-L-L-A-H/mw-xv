export const seedVersion = '1.0.0';
export const dependencies = ['orm-base'];

import type { Knex } from 'knex';

export async function seed(_ctx: { db: Knex }) {
  // Base seed reference data if needed
  return { inserted: 0, updated: 0, skipped: 0 };
}

export const manifest = {
  seedVersion,
  dependencies,
  seed,
};
