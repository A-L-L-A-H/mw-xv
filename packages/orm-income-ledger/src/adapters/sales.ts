import type { Context } from '../context.js';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromSale(
  ctx: Context,
  saleOrder: {
    id: string;
    totalMinor: number;
    currency: string;
    platformFeeMinor: number;
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

  const net_minor = saleOrder.totalMinor - saleOrder.platformFeeMinor;

  await ctx.query(IncomeEntry).insert({
    stream_id: stream.id,
    occurred_at: saleOrder.occurred_at.toISOString(),
    amount_minor: saleOrder.totalMinor,
    currency: saleOrder.currency,
    kind: 'revenue',
    source_model: 'ecom.marketplace_order',
    source_id: saleOrder.id,
    external_ref: saleOrder.external_ref ?? null,
    net_minor,
  });
}
