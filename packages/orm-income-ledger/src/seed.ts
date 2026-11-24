import { Context } from '@moonwitness/orm';
import { IncomeStream } from './models.js';

export async function seedIncomeStreams(ctx: Context): Promise<void> {
  const rows = [
    { kind: 'saas', platform: 'subscription', goalMonthlyMinor: 5_000_00 },
    { kind: 'marketplace', platform: 'marketplace', goalMonthlyMinor: 3_000_00 },
    { kind: 'ads', platform: 'adsense', goalMonthlyMinor: 500_00 },
    { kind: 'ads', platform: 'admob', goalMonthlyMinor: 200_00 },
    { kind: 'affiliate', platform: 'partnerstack', goalMonthlyMinor: 1_000_00 },
    { kind: 'content_royalty', platform: 'youtube', goalMonthlyMinor: 800_00 },
    { kind: 'donation', platform: 'kofi', goalMonthlyMinor: 300_00 },
    { kind: 'other', platform: null, goalMonthlyMinor: 0 },
  ];

  for (const row of rows) {
    await ctx.query(IncomeStream).insert({
      kind: row.kind,
      platform: row.platform,
      status: 'idea',
      goalMonthlyMinor: row.goalMonthlyMinor,
      currency: 'USD',
      tags: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}