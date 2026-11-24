import type { Context } from './context.js';
import { IncomeStream } from './models.js';

export async function seedIncomeStreams(ctx: Context, companyId = 1): Promise<void> {
  const rows = [
    { kind: 'saas', platform: 'subscription', goal_monthly_minor: 5_000_00 },
    { kind: 'marketplace', platform: 'marketplace', goal_monthly_minor: 3_000_00 },
    { kind: 'ads', platform: 'adsense', goal_monthly_minor: 500_00 },
    { kind: 'ads', platform: 'admob', goal_monthly_minor: 200_00 },
    { kind: 'affiliate', platform: 'partnerstack', goal_monthly_minor: 1_000_00 },
    { kind: 'content_royalty', platform: 'youtube', goal_monthly_minor: 800_00 },
    { kind: 'donation', platform: 'kofi', goal_monthly_minor: 300_00 },
    { kind: 'other', platform: null, goal_monthly_minor: 0 },
  ] as const;

  for (const row of rows) {
    await ctx.query(IncomeStream).insert({
      kind: row.kind,
      platform: row.platform,
      status: 'idea',
      goal_monthly_minor: row.goal_monthly_minor,
      currency: 'USD',
      tags: {},
      company_id: companyId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}
