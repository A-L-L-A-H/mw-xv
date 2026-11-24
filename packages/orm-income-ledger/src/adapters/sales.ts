import { Context } from '@moonwitness/orm';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromSale(
  ctx: Context,
  saleOrder: {
    id: string;
    totalMinor: number;
    currency: string;
    platformFeeMinor: number;
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

  const netMinor = saleOrder.totalMinor - saleOrder.platformFeeMinor;

  await ctx.query(IncomeEntry).insert({
    streamId: stream.id,
    occurredAt: saleOrder.occurredAt,
    amountMinor: saleOrder.totalMinor,
    currency: saleOrder.currency,
    kind: 'revenue',
    sourceModel: 'ecom.marketplace_order',
    sourceId: saleOrder.id,
    externalRef: saleOrder.externalRef ?? null,
    netMinor,
  });
}