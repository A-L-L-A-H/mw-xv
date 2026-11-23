import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

const DEFAULT_LISTING = 'hot';
const DEFAULT_LIMIT = 25;

interface RedditListingChild {
  readonly data?: {
    readonly title?: unknown;
    readonly selftext?: unknown;
    readonly permalink?: unknown;
    readonly url?: unknown;
    readonly created_utc?: unknown;
    readonly score?: unknown;
    readonly num_comments?: unknown;
    readonly subreddit?: unknown;
    readonly link_flair_text?: unknown;
    readonly id?: unknown;
  };
}

export class RedditAdapter implements SignalAdapter {
  readonly kind = 'reddit';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const subreddits = Array.isArray(ctx.config.subreddits) ? ctx.config.subreddits.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];
    const listing = typeof ctx.config.listing === 'string' ? ctx.config.listing : DEFAULT_LISTING;
    const limit = typeof ctx.config.limit === 'number' ? ctx.config.limit : DEFAULT_LIMIT;
    const fetchImpl = ctx.fetchImpl ?? fetch;

    const drafts: SignalObservationDraft[] = [];
    for (const subreddit of subreddits) {
      const endpoint = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${listing}.json?limit=${limit}`;
      let children: readonly RedditListingChild[];
      try {
        const response = await fetchImpl(endpoint, {
          headers: { accept: 'application/json', 'user-agent': 'MoonWitness-SignalBot/1.0' },
        });
        if (!response.ok) continue;
        const body = (await response.json()) as { data?: { children?: RedditListingChild[] } };
        children = Array.isArray(body?.data?.children) ? body.data.children : [];
      } catch {
        continue;
      }

      for (const child of children) {
        const post = child?.data;
        if (!post || typeof post.title !== 'string') continue;
        const permalink = typeof post.permalink === 'string' ? `https://www.reddit.com${post.permalink}` : undefined;
        const score = typeof post.score === 'number' ? post.score : 0;
        drafts.push({
          title: post.title,
          summary: typeof post.selftext === 'string' && post.selftext.length > 0 ? post.selftext.slice(0, 500) : undefined,
          url: permalink ?? (typeof post.url === 'string' ? post.url : undefined),
          publishedAt: typeof post.created_utc === 'number' ? new Date(post.created_utc * 1000) : undefined,
          tags: ['reddit', subreddit, typeof post.link_flair_text === 'string' ? post.link_flair_text : ''].filter((t) => t.length > 0),
          sourceRef: typeof post.id === 'string' ? post.id : undefined,
          raw: { ...post, score, commentCount: post.num_comments },
        });
      }
    }
    return drafts;
  }
}
