import type { Context } from '../context.js';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromDonation(
  ctx: Context,
  payload: {
    platform: string;
    donorId: string;
    amount_minor: number;
    currency: string;
    occurred_at: Date;
    external_ref?: string;
  }
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', payload.platform)
    .andWhere('kind', 'donation')
    .first();

  if (!stream) return;

  await ctx.query(IncomeEntry).insert({
    stream_id: stream.id,
    occurred_at: payload.occurred_at.toISOString(),
    amount_minor: payload.amount_minor,
    currency: payload.currency,
    kind: 'revenue',
    source_model: `donation.${payload.platform}`,
    source_id: payload.donorId,
    external_ref: payload.external_ref ?? null,
    net_minor: payload.amount_minor,
  });
}
