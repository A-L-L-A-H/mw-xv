import { Context } from '@moonwitness/orm';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromContentRoyalty(
  ctx: Context,
  result: {
    platform: string;
    contentId: string;
    estimatedRoyaltyMinor: number;
    currency: string;
    publishedAt: Date;
    externalRef?: string;
  },
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', result.platform)
    .andWhere('kind', 'content_royalty')
    .first();

  if (!stream) return;

  await ctx.query(IncomeEntry).insert({
    streamId: stream.id,
    occurredAt: result.publishedAt,
    amountMinor: result.estimatedRoyaltyMinor,
    currency: result.currency,
    kind: 'revenue',
    sourceModel: `content.${result.platform}`,
    sourceId: result.contentId,
    externalRef: result.externalRef ?? null,
    netMinor: result.estimatedRoyaltyMinor,
  });
}