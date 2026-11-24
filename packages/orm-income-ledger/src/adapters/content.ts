import type { Context } from '../context.js';
import { IncomeEntry, IncomeStream } from '../models.js';

export async function createEntryFromContentRoyalty(
  ctx: Context,
  result: {
    platform: string;
    contentId: string;
    estimatedRoyaltyMinor: number;
    currency: string;
    publishedAt: Date;
    external_ref?: string;
  }
): Promise<void> {
  const stream = await ctx
    .query(IncomeStream)
    .where('platform', result.platform)
    .andWhere('kind', 'content_royalty')
    .first();

  if (!stream) return;

  await ctx.query(IncomeEntry).insert({
    stream_id: stream.id,
    occurred_at: result.publishedAt.toISOString(),
    amount_minor: result.estimatedRoyaltyMinor,
    currency: result.currency,
    kind: 'revenue',
    source_model: `content.${result.platform}`,
    source_id: result.contentId,
    external_ref: result.external_ref ?? null,
    net_minor: result.estimatedRoyaltyMinor,
  });
}
