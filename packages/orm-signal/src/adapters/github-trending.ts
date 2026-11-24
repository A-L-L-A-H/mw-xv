import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

const GITHUB_TRENDING_URL = 'https://github.com/trending';

interface ParsedRepo {
  readonly owner: string;
  readonly repo: string;
  readonly description: string;
  readonly language: string;
  readonly stars: string;
  readonly starsToday: string;
}

const REPO_ANCHOR_RE = /<a[^>]*class="[^"]*repo-name[^"]*"[^>]*href="\/([^"/]+)\/([^"/?#]+)"|<a[^>]*href="\/([^"/]+)\/([^"/?#]+)"[^>]*class="[^"]*repo-name[^"]*"/g;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTrendingHtml(html: string): ParsedRepo[] {
  const repos: ParsedRepo[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(REPO_ANCHOR_RE)) {
    const owner = match[1] ?? match[3];
    const repo = match[2] ?? match[4];
    const key = `${owner}/${repo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const blockStart = match.index ?? 0;
    const block = html.slice(blockStart, blockStart + 3000);
    const paragraphs = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const languageItem = block.match(/itemprop="programmingLanguage">([^<]+)</);
    const stars = block.match(/<a[^>]+href="\/[^"]+\/stargazers"[^>]*>\s*([\d,]+)\s*<\/a>/);
    const starsToday = block.match(/([\d,]+)\s+stars today/);
    repos.push({
      owner,
      repo,
      description: paragraphs ? stripTags(paragraphs[1]) : '',
      language: languageItem ? languageItem[1].trim() : '',
      stars: stars ? stars[1] : '',
      starsToday: starsToday ? starsToday[1] : '',
    });
  }
  return repos;
}

export class GithubTrendingAdapter implements SignalAdapter {
  readonly kind = 'github_trending';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const language = typeof ctx.config.language === 'string' && ctx.config.language !== 'any' ? `/${ctx.config.language}` : '';
    const since = typeof ctx.config.since === 'string' ? ctx.config.since : 'daily';
    const maxItems = typeof ctx.config.maxItems === 'number' ? ctx.config.maxItems : 25;
    const fetchImpl = ctx.fetchImpl ?? fetch;

    const response = await fetchImpl(`${GITHUB_TRENDING_URL}${language}?since=${encodeURIComponent(since)}`, {
      headers: { accept: 'text/html', 'user-agent': 'MoonWitness-SignalBot/1.0' },
    });
    if (!response.ok) return [];
    const html = await response.text();
    return parseTrendingHtml(html).slice(0, maxItems).map((repo) => ({
      title: `${repo.owner}/${repo.repo}`,
      summary: repo.description || undefined,
      url: `https://github.com/${repo.owner}/${repo.repo}`,
      publishedAt: ctx.now,
      tags: [repo.language, 'github-trending'].filter((tag) => tag.length > 0),
      sourceRef: `${repo.owner}/${repo.repo}`,
      raw: repo,
    }));
  }
}
