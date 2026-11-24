import { Context } from '@moonwitness/orm';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromAffiliateWebhook(
  ctx: Context,
  payload: {
    platform: string;
    conversionId: string;
    amountMinor: number;
    currency: string;
    occurredAt: Date;
    externalRef?: string;
  },
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', payload.platform)
    .andWhere('kind', 'affiliate')
    .first();

  if (!stream) return;

  await ctx.query(IncomeEntry).insert({
    streamId: stream.id,
    occurredAt: payload.occurredAt,
    amountMinor: payload.amountMinor,
    currency: payload.currency,
    kind: 'revenue',
    sourceModel: `affiliate.${payload.platform}`,
    sourceId: payload.conversionId,
    externalRef: payload.externalRef ?? null,
    netMinor: payload.amountMinor,
  });
}