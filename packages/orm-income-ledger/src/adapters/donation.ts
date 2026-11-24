import { Context } from '@moonwitness/orm';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromDonation(
  ctx: Context,
  payload: {
    platform: string;
    donorId: string;
    amountMinor: number;
    currency: string;
    occurredAt: Date;
    externalRef?: string;
  },
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', payload.platform)
    .andWhere('kind', 'donation')
    .first();

  if (!stream) return;

  await ctx.query(IncomeEntry).insert({
    streamId: stream.id,
    occurredAt: payload.occurredAt,
    amountMinor: payload.amountMinor,
    currency: payload.currency,
    kind: 'revenue',
    sourceModel: `donation.${payload.platform}`,
    sourceId: payload.donorId,
    externalRef: payload.externalRef ?? null,
    netMinor: payload.amountMinor,
  });
}