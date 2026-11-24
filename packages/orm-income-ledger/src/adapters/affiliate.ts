import type { Context } from '../context.js';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromAffiliateWebhook(
  ctx: Context,
  payload: {
    platform: string;
    conversionId: string;
    amount_minor: number;
    currency: string;
    occurred_at: Date;
    external_ref?: string;
  }
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', payload.platform)
    .andWhere('kind', 'affiliate')
    .first();

  if (!stream) return;

  await ctx.query(IncomeEntry).insert({
    stream_id: stream.id,
    occurred_at: payload.occurred_at.toISOString(),
    amount_minor: payload.amount_minor,
    currency: payload.currency,
    kind: 'revenue',
    source_model: `affiliate.${payload.platform}`,
    source_id: payload.conversionId,
    external_ref: payload.external_ref ?? null,
    net_minor: payload.amount_minor,
  });
}
