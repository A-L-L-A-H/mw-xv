import type { Context } from '../context.js';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromMarketplaceOrder(
  ctx: Context,
  order: {
    id: string;
    revenue_minor: number;
    feeMinor: number;
    currency: string;
    occurred_at: Date;
    external_ref?: string;
  }
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', 'marketplace')
    .andWhere('kind', 'marketplace')
    .first();

  if (!stream) return;

  const net_minor = order.revenue_minor - order.feeMinor;

  await ctx.query(IncomeEntry).insert({
    stream_id: stream.id,
    occurred_at: order.occurred_at.toISOString(),
    amount_minor: order.revenue_minor,
    currency: order.currency,
    kind: 'revenue',
    source_model: 'ecom.marketplace_order',
    source_id: order.id,
    external_ref: order.external_ref ?? null,
    net_minor,
  });
}
