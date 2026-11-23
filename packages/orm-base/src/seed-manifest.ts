import type { Knex } from 'knex';

export interface SeedContext {
  db: Knex;
  companyId?: number;
  ownerId?: number;
}

export interface SeedResult {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface AddonSeedManifest {
  seedVersion: string;
  dependencies: string[];
  seed: (ctx: SeedContext) => Promise<SeedResult>;
}
