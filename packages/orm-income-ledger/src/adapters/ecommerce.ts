import { Context } from '@moonwitness/orm';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromMarketplaceOrder(
  ctx: Context,
  order: {
    id: string;
    revenueMinor: number;
    feeMinor: number;
    currency: string;
    occurredAt: Date;
    externalRef?: string;
  },
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', 'marketplace')
    .andWhere('kind', 'marketplace')
    .first();

  if (!stream) return;

  const netMinor = order.revenueMinor - order.feeMinor;

  await ctx.query(IncomeEntry).insert({
    streamId: stream.id,
    occurredAt: order.occurredAt,
    amountMinor: order.revenueMinor,
    currency: order.currency,
    kind: 'revenue',
    sourceModel: 'ecom.marketplace_order',
    sourceId: order.id,
    externalRef: order.externalRef ?? null,
    netMinor,
  });
}