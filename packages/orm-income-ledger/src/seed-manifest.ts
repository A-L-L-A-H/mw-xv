import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';

async function seedIncomeLedger(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db;
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  const companyId = ctx.companyId ?? 1;

  const streams = [
    { kind: 'saas', platform: 'subscription', goal_monthly_minor: 5_000_00 },
    { kind: 'marketplace', platform: 'marketplace', goal_monthly_minor: 3_000_00 },
    { kind: 'ads', platform: 'adsense', goal_monthly_minor: 500_00 },
    { kind: 'ads', platform: 'admob', goal_monthly_minor: 200_00 },
    { kind: 'affiliate', platform: 'partnerstack', goal_monthly_minor: 1_000_00 },
    { kind: 'content_royalty', platform: 'youtube', goal_monthly_minor: 800_00 },
    { kind: 'donation', platform: 'kofi', goal_monthly_minor: 300_00 },
    { kind: 'other', platform: null, goal_monthly_minor: 0 },
  ];

  for (const stream of streams) {
    const existing = await db('income_stream').where({ kind: stream.kind, platform: stream.platform }).first();

    if (existing) {
      await db('income_stream').where({ id: existing.id }).update({
        status: 'idea',
        goal_monthly_minor: stream.goal_monthly_minor,
        currency: 'USD',
        tags: JSON.stringify({}),
        company_id: companyId,
        updated_at: new Date().toISOString(),
      });
      updated++;
    } else {
      await db('income_stream').insert({
        kind: stream.kind,
        platform: stream.platform,
        status: 'idea',
        goal_monthly_minor: stream.goal_monthly_minor,
        currency: 'USD',
        tags: JSON.stringify({}),
        company_id: companyId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

export const incomeLedgerSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: seedIncomeLedger,
};