import { Context } from '@moonwitness/orm';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromAds(
  ctx: Context,
  platform: string,
  fetcher: { fetchRevenue(periodStart: Date, periodEnd: Date): Promise<{ revenueMinor: number; currency: string; externalRef?: string }> },
  periodStart: Date,
  periodEnd: Date,
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', platform)
    .andWhere('kind', 'ads')
    .first();

  if (!stream) return;

  const { revenueMinor, currency, externalRef } = await fetcher.fetchRevenue(periodStart, periodEnd);

  await ctx.query(IncomeEntry).insert({
    streamId: stream.id,
    occurredAt: periodEnd,
    amountMinor: revenueMinor,
    currency,
    kind: 'revenue',
    sourceModel: `ads.${platform}`,
    sourceId: `${platform}-${periodStart.toISOString().slice(0, 7)}`,
    externalRef: externalRef ?? null,
    netMinor: revenueMinor,
  });
}