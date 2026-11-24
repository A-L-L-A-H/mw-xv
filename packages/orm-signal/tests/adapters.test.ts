import { describe, expect, it } from 'vitest';
import {
  CoinGeckoAdapter,
  CustomAdapter,
  GithubTrendingAdapter,
  GoogleTrendsAdapter,
  HackerNewsAdapter,
  RedditAdapter,
  RssAdapter,
  WebDiffAdapter,
  XMLParser,
  YoutubeTrendingAdapter,
  adapterForKind,
  hashObservationContent,
  signalAdapters,
} from '../src/index.js';
import type { SignalAdapterContext } from '../src/index.js';

function makeCtx(overrides: Partial<SignalAdapterContext> = {}): SignalAdapterContext {
  return {
    db: {} as SignalAdapterContext['db'],
    companyId: 1,
    now: new Date('2026-01-01T00:00:00Z'),
    config: {},
    fetchImpl: async () => {
      throw new Error('network disabled in test');
    },
    ...overrides,
  };
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item><title>First &amp; Item</title><link>https://example.com/1</link><description>Hello world</description><pubDate>Mon, 01 Dec 2025 10:00:00 GMT</pubDate><category>tech</category><category>news</category><guid>guid-1</guid></item>
<item><title>Second Item</title><link>https://example.com/2</link><pubDate>Tue, 02 Dec 2025 11:00:00 GMT</pubDate></item>
</channel></rss>`;

const SAMPLE_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom Entry</title><link href="https://example.com/atom-1"/><summary>Atom summary</summary><id>atom-1</id><updated>2025-12-03T00:00:00Z</updated></entry>
</feed>`;

describe('XMLParser', () => {
  it('parses RSS and Atom documents into JS objects', () => {
    const rss = XMLParser.parse(SAMPLE_RSS);
    const channel = (rss.rss as { channel: { item: unknown } }).channel;
    expect(Array.isArray(channel.item)).toBe(true);
    expect((channel.item as unknown[]).length).toBe(2);

    const atom = XMLParser.parse(SAMPLE_ATOM);
    const entry = (atom.feed as { entry: { title: { _text: string } } }).entry;
    expect(entry.title._text).toBe('Atom Entry');
  });

  it('preserves XML syntax variants, malformed less-than text, and attribute entities', () => {
    const xml = `<?xml version="1.0"?><!-- <ignored> &amp; --><ns:root xmlns:ns="urn:test" note="1 > 0 &amp; 2 < 3" label='it&apos;s > fine'><ns:message><</ns:message><ns:raw><![CDATA[<raw> &amp; ]]></ns:raw><ns:item id="&lt;id&gt;" count=2/><ns:item id="second"></ns:item><?work done?></ns:root>`;

    expect(XMLParser.parse(xml)).toEqual({
      root: {
        'xmlns:ns': 'urn:test',
        note: '1 > 0 & 2 < 3',
        label: "it's > fine",
        message: { _text: '<' },
        raw: { _text: '<raw> &amp; ' },
        item: [{ _name: 'item', id: '<id>', count: '2' }, { id: 'second' }],
      },
    });
  });

  it('handles adversarial attribute fragments and quotes without backtracking', () => {
    const attributes = 'data-name="value" '.repeat(10_000);
    const singleQuotedAttributes = "data-name='value' ".repeat(10_000);
    const openQuotes = 'data-name="'.repeat(10_000);
    const valid = XMLParser.parse(`<root ${attributes}/>`);
    expect(valid).toEqual({ root: { _name: 'root', 'data-name': 'value' } });

    for (const xml of [
      `<root ${attributes}!`,
      `<root ${singleQuotedAttributes}!`,
      `<root ${openQuotes}`,
      `<root data="${'<'.repeat(20_000)}`,
    ]) {
      expect(XMLParser.parse(xml)).toEqual({});
    }
  });
});

describe('RssAdapter', () => {
  it('extracts observations from RSS and Atom payloads', async () => {
    const responses = [SAMPLE_RSS, SAMPLE_ATOM];
    const adapter = new RssAdapter();
    const drafts = await adapter.fetch(
      makeCtx({
        config: { feeds: ['https://example.com/rss', 'https://example.com/atom'] },
        fetchImpl: async () => new Response(responses.shift()!, { status: 200 }),
      })
    );
    expect(drafts.length).toBe(3);
    expect(drafts[0].title).toBe('First & Item');
    expect(drafts[0].tags).toEqual(['tech', 'news']);
    expect(drafts[0].sourceRef).toBe('guid-1');
    expect(drafts[0].publishedAt?.toISOString()).toBe('2025-12-01T10:00:00.000Z');
    expect(drafts[2].url).toBe('https://example.com/atom-1');
  });

  it('drops entries without titles and tolerates failed feeds', async () => {
    const adapter = new RssAdapter();
    let call = 0;
    const drafts = await adapter.fetch(
      makeCtx({
        config: { feeds: ['https://example.com/bad', 'https://example.com/good'] },
        fetchImpl: async () => {
          call += 1;
          if (call === 1) return new Response('nope', { status: 500 });
          return new Response('<rss><channel><item><description>no title</description></item></channel></rss>', { status: 200 });
        },
      })
    );
    expect(drafts).toEqual([]);
  });
});

describe('hashObservationContent', () => {
  it('is stable for identical drafts and differs on content change', () => {
    const draft = { title: 'T', url: 'https://e.com', summary: 'S' };
    expect(hashObservationContent(draft)).toBe(hashObservationContent({ ...draft }));
    expect(hashObservationContent(draft)).not.toBe(hashObservationContent({ ...draft, title: 'T2' }));
    expect(hashObservationContent(draft)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('adapter registry', () => {
  it('covers every signal source kind', () => {
    for (const kind of Object.keys(signalAdapters)) {
      expect(adapterForKind(kind as keyof typeof signalAdapters).kind).toBe(kind);
    }
    expect(() => adapterForKind('nonexistent' as keyof typeof signalAdapters)).toThrow(/No signal adapter/);
  });
});

describe('GoogleTrendsAdapter', () => {
  it('parses trending searches from the RSS payload', async () => {
    const xml = `<rss><channel><item><title>quantum computing</title><ht:approx_traffic>50K+</ht:approx_traffic><pubDate>Mon, 01 Dec 2025 00:00:00 GMT</pubDate></item></channel></rss>`;
    const drafts = await new GoogleTrendsAdapter().fetch(
      makeCtx({ fetchImpl: async () => new Response(xml, { status: 200 }) })
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0].title).toBe('quantum computing');
    expect(drafts[0].sourceRef).toBe('quantum computing');
                         });
});

describe('GithubTrendingAdapter', () => {
  it('extracts trending repositories from HTML', async () => {
    const html = `<h2 class="Box-row"><a href="/user/repo-one" class="repo-name">repo-one</a><p class="col-9">A great repo</p><span itemprop="programmingLanguage">TypeScript</span><a href="/user/repo-one/stargazers">1,234</a>500 stars today</h2>`;
    const drafts = await new GithubTrendingAdapter().fetch(
      makeCtx({ fetchImpl: async () => new Response(html, { status: 200 }) })
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0].title).toBe('user/repo-one');
    expect(drafts[0].url).toBe('https://github.com/user/repo-one');
  });

  it('decodes supported entities exactly once while stripping tags and normalizing whitespace', async () => {
    const html = `<a href="/user/repo-one" class="repo-name">repo-one</a><p class="col-9">  Tom &amp; Jerry &lt;3 &gt; &quot;quoted&quot; &#39;single&#39; &amp;lt;tag&amp;gt; &amp;amp; <b>tools</b>\n today </p>`;
    const drafts = await new GithubTrendingAdapter().fetch(
      makeCtx({ fetchImpl: async () => new Response(html, { status: 200 }) })
    );
    expect(drafts[0].summary).toBe(
      'Tom & Jerry <3 > "quoted" \'single\' &lt;tag&gt; &amp; tools today'
    );
  });
});

describe('HackerNewsAdapter', () => {
  it('fetches top stories and their items', async () => {
    const calls: string[] = [];
    const adapter = new HackerNewsAdapter();
    const drafts = await adapter.fetch(
      makeCtx({
        config: { topItems: 2, minScore: 5 },
        fetchImpl: async (input: string | URL) => {
          const url = String(input);
          calls.push(url);
          if (url.endsWith('topstories.json')) return new Response('[1,2,3]', { status: 200 });
          if (url.endsWith('1.json')) return new Response('{"id":1,"title":"Story One","url":"https://e.com/1","score":100,"time":1735689600}', { status: 200 });
          return new Response('{"id":2,"title":"Low Score","score":1}', { status: 200 });
        },
      })
    );
    expect(calls.some((c) => c.endsWith('3.json'))).toBe(false);
    expect(drafts.length).toBe(1);
    expect(drafts[0].title).toBe('Story One');
    expect(drafts[0].sourceRef).toBe('1');
  });
});

describe('RedditAdapter', () => {
  it('extracts posts from public JSON listings', async () => {
    const body = JSON.stringify({
      data: { children: [{ data: { title: 'Post A', permalink: '/r/tech/comments/abc/post_a/', score: 42, created_utc: 1735689600, id: 'abc' } }] },
    });
    const drafts = await new RedditAdapter().fetch(
      makeCtx({
        config: { subreddits: ['technology'], listing: 'hot', limit: 5 },
        fetchImpl: async () => new Response(body, { status: 200 }),
      })
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0].title).toBe('Post A');
    expect(drafts[0].url).toBe('https://www.reddit.com/r/tech/comments/abc/post_a/');
    expect(drafts[0].tags).toContain('technology');
  });
});

describe('YoutubeTrendingAdapter', () => {
  it('returns nothing without an API key and parses videos with one', async () => {
    const noKey = await new YoutubeTrendingAdapter().fetch(makeCtx({}));
    expect(noKey).toEqual([]);

    const body = JSON.stringify({
      items: [{ id: 'vid1', snippet: { title: 'Cool Video', publishedAt: '2025-12-01T00:00:00Z', channelTitle: 'Chan' } }],
    });
    const drafts = await new YoutubeTrendingAdapter().fetch(
      makeCtx({ config: { apiKey: 'k' }, fetchImpl: async () => new Response(body, { status: 200 }) })
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0].url).toBe('https://www.youtube.com/watch?v=vid1');
  });
});

describe('CoinGeckoAdapter', () => {
  it('maps market rows into observations and filters by change', async () => {
    const body = JSON.stringify([
      { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', current_price: 100000, price_change_percentage_24h: 5.5 },
      { id: 'stable', name: 'Stable', symbol: 'st', current_price: 1, price_change_percentage_24h: 0.01 },
    ]);
    const drafts = await new CoinGeckoAdapter().fetch(
      makeCtx({ config: { minAbsChangePct: 1 }, fetchImpl: async () => new Response(body, { status: 200 }) })
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0].title).toContain('Bitcoin');
    expect(drafts[0].tags).toContain('up');
  });
});

describe('WebDiffAdapter', () => {
  it('reports first snapshot and change, skips unchanged pages', async () => {
    const adapter = new WebDiffAdapter();
    const first = await adapter.fetch(
      makeCtx({ config: { urls: ['https://e.com/page'], previousStates: {} }, fetchImpl: async () => new Response('<html>one</html>', { status: 200 }) })
    );
    expect(first.length).toBe(1);
    expect(first[0].raw).toMatchObject({ previousHash: null });

    const unchanged = await adapter.fetch(
      makeCtx({ config: { urls: ['https://e.com/page'], previousStates: { 'https://e.com/page': first[0].sourceRef! } }, fetchImpl: async () => new Response('<html>one</html>', { status: 200 }) })
    );
    expect(unchanged).toEqual([]);

    const changed = await adapter.fetch(
      makeCtx({ config: { urls: ['https://e.com/page'], previousStates: { 'https://e.com/page': first[0].sourceRef! } }, fetchImpl: async () => new Response('<html>two</html>', { status: 200 }) })
    );
    expect(changed.length).toBe(1);
    expect(changed[0].title).toContain('Content changed');
  });
});

describe('CustomAdapter', () => {
  it('maps pending entries into drafts and skips invalid ones', async () => {
    const drafts = await new CustomAdapter().fetch(
      makeCtx({
        config: {
          pendingEntries: [
            { title: 'Manual Signal', url: 'https://e.com/x', tags: ['ops'] },
            { title: '' },
            'not-an-object',
          ],
        },
      })
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0].title).toBe('Manual Signal');
    expect(drafts[0].sourceRef).toMatch(/^[0-9a-f]{32}$/);
  });
});
