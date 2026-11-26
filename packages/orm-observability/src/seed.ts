import type { SeedContext, SeedResult } from '@moonwitness/orm-base';

export async function seedObservability(_ctx: SeedContext): Promise<SeedResult> {
  return { inserted: 0, updated: 0, skipped: 0 };
}
