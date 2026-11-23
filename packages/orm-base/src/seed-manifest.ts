export interface SeedContext {
  db: any;
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
