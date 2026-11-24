import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

const DEFAULT_FIREBASE_API = 'https://hacker-news.firebaseio.com/v0';

interface HackerNewsItem {
  readonly id?: number;
  readonly title?: string;
  readonly url?: string;
  readonly text?: string;
  readonly score?: number;
  readonly by?: string;
  readonly time?: number;
  readonly descendants?: number;
  readonly type?: string;
}

export class HackerNewsAdapter implements SignalAdapter {
  readonly kind = 'hackernews';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const firebaseApi =
      typeof ctx.config.firebaseApi === 'string' && ctx.config.firebaseApi.length > 0
        ? ctx.config.firebaseApi
        : DEFAULT_FIREBASE_API;
    const topItems = typeof ctx.config.topItems === 'number' ? ctx.config.topItems : 30;
    const minScore = typeof ctx.config.minScore === 'number' ? ctx.config.minScore : 0;
    const fetchImpl = ctx.fetchImpl ?? fetch;

    const listResponse = await fetchImpl(`${firebaseApi}/topstories.json`);
    if (!listResponse.ok) return [];
    const ids = (await listResponse.json()) as unknown;
    if (!Array.isArray(ids)) return [];

    const drafts: SignalObservationDraft[] = [];
    for (const id of ids.slice(0, topItems)) {
      if (typeof id !== 'number') continue;
      let item: HackerNewsItem;
      try {
        const itemResponse = await fetchImpl(`${firebaseApi}/item/${id}.json`);
        if (!itemResponse.ok) continue;
        item = (await itemResponse.json()) as HackerNewsItem;
      } catch {
        continue;
      }
      if (!item || typeof item.title !== 'string') continue;
      if (typeof item.score === 'number' && item.score < minScore) continue;
      drafts.push({
        title: item.title,
        summary: typeof item.text === 'string' ? stripHtml(item.text) : undefined,
        url: item.url ?? `https://news.ycombinator.com/item?id=${id}`,
        publishedAt: typeof item.time === 'number' ? new Date(item.time * 1000) : undefined,
        tags: ['hackernews'],
        sourceRef: String(id),
        raw: { ...item, commentCount: item.descendants },
      });
    }
    return drafts;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
