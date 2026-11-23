import { createHash } from 'node:crypto';
import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

export class CustomAdapter implements SignalAdapter {
  readonly kind = 'custom';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const entries = Array.isArray(ctx.config.pendingEntries) ? ctx.config.pendingEntries : [];
    const drafts: SignalObservationDraft[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.title !== 'string' || record.title.length === 0) continue;
      drafts.push({
        title: record.title,
        summary: typeof record.summary === 'string' ? record.summary : undefined,
        url: typeof record.url === 'string' ? record.url : undefined,
        publishedAt: typeof record.publishedAt === 'string' ? parseDateOrNow(record.publishedAt, ctx.now) : ctx.now,
        tags: Array.isArray(record.tags) ? record.tags.filter((t): t is string => typeof t === 'string') : undefined,
        sourceRef: typeof record.sourceRef === 'string' ? record.sourceRef : contentFingerprint(record),
        raw: record,
      });
    }
    return drafts;
  }
}

function parseDateOrNow(value: string, fallback: Date): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function contentFingerprint(record: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 32);
}
