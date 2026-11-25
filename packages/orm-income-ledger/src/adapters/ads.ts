import type { Context } from '../context.js';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromAds(
  ctx: Context,
  platform: string,
  fetcher: {
    fetchRevenue(
      periodStart: Date,
      periodEnd: Date
    ): Promise<{ revenue_minor: number; currency: string; external_ref?: string }>;
  },
  periodStart: Date,
  periodEnd: Date
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', platform)
    .andWhere('kind', 'ads')
    .first();

  if (!stream) return;

  const { revenue_minor, currency, external_ref } = await fetcher.fetchRevenue(
    periodStart,
    periodEnd
  );

  await ctx.query(IncomeEntry).insert({
    stream_id: stream.id,
    occurred_at: periodEnd.toISOString(),
    amount_minor: revenue_minor,
    currency,
    kind: 'revenue',
    source_model: `ads.${platform}`,
    source_id: `${platform}-${periodStart.toISOString().slice(0, 7)}`,
    external_ref: external_ref ?? null,
    net_minor: revenue_minor,
  });
}
