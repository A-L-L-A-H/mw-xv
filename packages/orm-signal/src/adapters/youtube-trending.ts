import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

interface YouTubeVideoItem {
  readonly id?: string;
  readonly snippet?: {
    readonly title?: string;
    readonly description?: string;
    readonly publishedAt?: string;
    readonly channelTitle?: string;
    readonly tags?: string[];
  };
}

export class YoutubeTrendingAdapter implements SignalAdapter {
  readonly kind = 'youtube_trending';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const apiKey = ctx.config.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return [];
    }
    const regionCode = typeof ctx.config.regionCode === 'string' ? ctx.config.regionCode : 'US';
    const chart = typeof ctx.config.chart === 'string' ? ctx.config.chart : 'mostPopular';
    const maxResults =
      typeof ctx.config.maxResults === 'number' ? Math.min(50, ctx.config.maxResults) : 25;
    const fetchImpl = ctx.fetchImpl ?? fetch;

    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,statistics');
    url.searchParams.set('chart', chart);
    url.searchParams.set('regionCode', regionCode);
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('key', apiKey);

    let items: readonly YouTubeVideoItem[];
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!response.ok) return [];
      const body = (await response.json()) as { items?: YouTubeVideoItem[] };
      items = Array.isArray(body?.items) ? body.items : [];
    } catch {
      return [];
    }

    return items
      .filter((item) => typeof item?.id === 'string' && typeof item?.snippet?.title === 'string')
      .map((item) => ({
        title: item.snippet!.title!,
        summary: item.snippet!.description || undefined,
        url: `https://www.youtube.com/watch?v=${item.id}`,
        publishedAt: item.snippet!.publishedAt ? new Date(item.snippet!.publishedAt) : undefined,
        tags: ['youtube', item.snippet!.channelTitle ?? ''].filter((tag) => tag.length > 0),
        sourceRef: item.id,
        raw: item,
      }));
  }
}
