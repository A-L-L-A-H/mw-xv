import { XMLParser } from './xml-parser.js';
import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

const DEFAULT_RSS_URL = 'https://trends.google.com/trending/rss?geo=US';

interface TrendsEntry {
  title?: unknown;
  description?: unknown;
  pubDate?: unknown;
  'ht:approx_traffic'?: unknown;
  'ht:news_item'?: unknown;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '_text' in value) {
    const text = (value as { _text?: unknown })._text;
    if (typeof text === 'string') return text;
  }
  return undefined;
}

export class GoogleTrendsAdapter implements SignalAdapter {
  readonly kind = 'google_trends';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const rssUrl = typeof ctx.config.rssUrl === 'string' && ctx.config.rssUrl.length > 0 ? ctx.config.rssUrl : DEFAULT_RSS_URL;
    const maxItems = typeof ctx.config.maxItems === 'number' ? ctx.config.maxItems : 20;
    const fetchImpl = ctx.fetchImpl ?? fetch;

    const response = await fetchImpl(rssUrl, { headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!response.ok) return [];
    const xml = await response.text();
    const doc = XMLParser.parse(xml);
    const channel = doc.rss && typeof doc.rss === 'object' ? (doc.rss as { channel?: unknown }).channel : undefined;
    const rawItems = channel && typeof channel === 'object' ? (channel as { item?: unknown }).item : undefined;
    const entries: TrendsEntry[] = Array.isArray(rawItems) ? (rawItems as TrendsEntry[]) : rawItems ? [rawItems as TrendsEntry] : [];

    const drafts: SignalObservationDraft[] = [];
    for (const entry of entries.slice(0, maxItems)) {
      const title = textOf(entry.title);
      if (!title) continue;
      const approxTraffic = textOf(entry['ht:approx_traffic']);
      drafts.push({
        title,
        summary: textOf(entry.description),
        publishedAt: parsePubDate(entry.pubDate),
        tags: ['google-trends'],
        sourceRef: title,
        raw: { entry, approxTraffic },
      });
    }
    return drafts;
  }
}

function parsePubDate(value: unknown): Date | undefined {
  const text = textOf(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
