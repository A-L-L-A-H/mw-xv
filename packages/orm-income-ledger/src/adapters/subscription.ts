import { Context } from '@moonwitness/orm';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function upsertMrrFromSubscription(
  ctx: Context,
  subscription: {
    id: string;
    mrrMinor: number;
    currency: string;
    status: string;
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', 'subscription')
    .andWhere('kind', 'saas')
    .first();

  if (!stream) return;

  await ctx.query(IncomeEntry).insert({
    streamId: stream.id,
    occurredAt: subscription.periodStart,
    amountMinor: subscription.mrrMinor,
    currency: subscription.currency,
    kind: 'revenue',
    sourceModel: 'subscription.subscription',
    sourceId: subscription.id,
    externalRef: null,
    netMinor: subscription.mrrMinor,
  });
}