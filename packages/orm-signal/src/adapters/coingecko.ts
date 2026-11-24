import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

interface CoinMarket {
  readonly id?: string;
  readonly name?: string;
  readonly symbol?: string;
  readonly current_price?: number;
  readonly price_change_percentage_24h?: number;
  readonly market_cap?: number;
  readonly total_volume?: number;
}

export class CoinGeckoAdapter implements SignalAdapter {
  readonly kind = 'coingecko';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const vsCurrency = typeof ctx.config.vsCurrency === 'string' ? ctx.config.vsCurrency : 'usd';
    const perPage = typeof ctx.config.perPage === 'number' ? Math.min(250, ctx.config.perPage) : 25;
    const minAbsChangePct = typeof ctx.config.minAbsChangePct === 'number' ? ctx.config.minAbsChangePct : 0;
    const fetchImpl = ctx.fetchImpl ?? fetch;

    const url = new URL('https://api.coingecko.com/api/v3/coins/markets');
    url.searchParams.set('vs_currency', vsCurrency);
    url.searchParams.set('order', 'market_cap_desc');
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', '1');
    url.searchParams.set('price_change_percentage', '24h');

    let markets: readonly CoinMarket[];
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!response.ok) return [];
      const body = (await response.json()) as unknown;
      markets = Array.isArray(body) ? (body as CoinMarket[]) : [];
    } catch {
      return [];
    }

    const drafts: SignalObservationDraft[] = [];
    for (const market of markets) {
      if (typeof market?.id !== 'string' || typeof market?.name !== 'string') continue;
      const changePct = typeof market.price_change_percentage_24h === 'number' ? market.price_change_percentage_24h : 0;
      if (Math.abs(changePct) < minAbsChangePct) continue;
      const direction = changePct >= 0 ? 'up' : 'down';
      drafts.push({
        title: `${market.name} (${market.symbol?.toUpperCase() ?? market.id}) ${direction} ${Math.abs(changePct).toFixed(2)}% in 24h`,
        summary:
          typeof market.current_price === 'number'
            ? `Price ${market.current_price} ${vsCurrency.toUpperCase()}; 24h change ${changePct.toFixed(2)}%`
            : undefined,
        url: `https://www.coingecko.com/en/coins/${market.id}`,
        publishedAt: ctx.now,
        tags: ['coingecko', direction],
        sourceRef: market.id,
        raw: market,
      });
    }
    return drafts;
  }
}
