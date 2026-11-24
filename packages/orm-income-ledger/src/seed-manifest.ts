import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { Context } from '@moonwitness/orm';
import { IncomeStream } from './models.js';

async function seedIncomeLedger(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const companyId = ctx.companyId ?? 1;

  const streams = [
    { kind: 'saas', platform: 'subscription', goalMonthlyMinor: 5_000_00 },
    { kind: 'marketplace', platform: 'marketplace', goalMonthlyMinor: 3_000_00 },
    { kind: 'ads', platform: 'adsense', goalMonthlyMinor: 500_00 },
    { kind: 'ads', platform: 'admob', goalMonthlyMinor: 200_00 },
    { kind: 'affiliate', platform: 'partnerstack', goalMonthlyMinor: 1_000_00 },
    { kind: 'content_royalty', platform: 'youtube', goalMonthlyMinor: 800_00 },
    { kind: 'donation', platform: 'kofi', goalMonthlyMinor: 300_00 },
    { kind: 'other', platform: null, goalMonthlyMinor: 0 },
  ];

  for (const stream of streams) {
    const existing = await db('income_stream').where({ kind: stream.kind, platform: stream.platform }).first();

    if (existing) {
      await db('income_stream').where({ id: existing.id }).update({
        status: 'idea',
        goalMonthlyMinor: stream.goalMonthlyMinor,
        currency: 'USD',
        tags: {},
        companyId,
        updatedAt: new Date(),
      });
      updated++;
    } else {
      await db('income_stream').insert({
        kind: stream.kind,
        platform: stream.platform,
        status: 'idea',
        goalMonthlyMinor: stream.goalMonthlyMinor,
        currency: 'USD',
        tags: {},
        companyId,
        createdAt: new Date(),
        updatedAt: new Date(),
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