import type { Context } from '../context.js';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function upsertMrrFromSubscription(
  ctx: Context,
  subscription: {
    id: string;
    mrr_minor: number;
    currency: string;
    status: string;
    periodStart: Date;
    periodEnd: Date;
  }
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', 'subscription')
    .andWhere('kind', 'saas')
    .first();

  if (!stream) return;

  await ctx.query(IncomeEntry).insert({
    stream_id: stream.id,
    occurred_at: subscription.periodStart.toISOString(),
    amount_minor: subscription.mrr_minor,
    currency: subscription.currency,
    kind: 'revenue',
    source_model: 'subscription.subscription',
    source_id: subscription.id,
    external_ref: null,
    net_minor: subscription.mrr_minor,
  });
}
