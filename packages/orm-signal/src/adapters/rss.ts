import { XMLParser } from './xml-parser.js';
import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

interface FeedEntry {
  title?: unknown;
  link?: unknown;
  summary?: unknown;
  description?: unknown;
  published?: unknown;
  updated?: unknown;
  pubDate?: unknown;
  id?: unknown;
  guid?: unknown;
  category?: unknown;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '_text' in value) {
    const text = (value as { _text?: unknown })._text;
    if (typeof text === 'string') return text;
  }
  return undefined;
}

function firstLink(link: unknown): string | undefined {
  if (typeof link === 'string') return link;
  if (Array.isArray(link)) return textOf(link[0]);
  if (link && typeof link === 'object') {
    const href = (link as { href?: unknown }).href ?? (link as { _href?: unknown })._href;
    if (typeof href === 'string') return href;
    if (Array.isArray(link)) return textOf(link[0]);
  }
  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  const text = textOf(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function categoriesOf(category: unknown): string[] {
  if (!category) return [];
  const entries = Array.isArray(category) ? category : [category];
  const out: string[] = [];
  for (const entry of entries) {
    const text = textOf(entry);
    if (text) out.push(text);
  }
  return out;
}

export class RssAdapter implements SignalAdapter {
  readonly kind = 'rss';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const feedUrls = Array.isArray(ctx.config.feeds) ? ctx.config.feeds : [];
    const maxItems =
      typeof ctx.config.maxItemsPerFeed === 'number' ? ctx.config.maxItemsPerFeed : 50;
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const drafts: SignalObservationDraft[] = [];

    for (const feedUrl of feedUrls) {
      if (typeof feedUrl !== 'string' || feedUrl.length === 0) continue;
      const response = await fetchImpl(feedUrl, {
        headers: {
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const doc = XMLParser.parse(xml);
      const channel =
        doc.rss && typeof doc.rss === 'object'
          ? (doc.rss as { channel?: unknown }).channel
          : undefined;
      const channelEntries: unknown[] =
        channel &&
        typeof channel === 'object' &&
        Array.isArray((channel as { item?: unknown }).item)
          ? (channel as { item: unknown[] }).item
          : [];
      const atomRoot =
        doc.feed && typeof doc.feed === 'object'
          ? (doc.feed as { entry?: unknown }).entry
          : undefined;
      const atomEntries: unknown[] = Array.isArray(atomRoot)
        ? atomRoot
        : atomRoot
          ? [atomRoot]
          : [];
      const entries: FeedEntry[] = [...channelEntries, ...atomEntries].slice(
        0,
        maxItems
      ) as FeedEntry[];

      for (const entry of entries) {
        const title = textOf(entry.title);
        if (!title) continue;
        drafts.push({
          title,
          summary: textOf(entry.summary) ?? textOf(entry.description),
          url: firstLink(entry.link),
          publishedAt:
            parseDate(entry.published) ?? parseDate(entry.updated) ?? parseDate(entry.pubDate),
          tags: categoriesOf(entry.category),
          sourceRef: textOf(entry.id) ?? textOf(entry.guid),
          raw: entry,
        });
      }
    }
    return drafts;
  }
}
