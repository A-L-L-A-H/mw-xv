import { createHash } from 'node:crypto';
import type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';

interface WatchedPageState {
  readonly [url: string]: string;
}

export class WebDiffAdapter implements SignalAdapter {
  readonly kind = 'web_diff';

  async fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]> {
    const urls = Array.isArray(ctx.config.urls)
      ? ctx.config.urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [];
    const algorithm =
      typeof ctx.config.hashAlgorithm === 'string' && ctx.config.hashAlgorithm.length > 0
        ? ctx.config.hashAlgorithm
        : 'sha256';
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const previousStates = readPreviousStates(ctx.config.previousStates);

    const drafts: SignalObservationDraft[] = [];
    for (const url of urls) {
      let body: string;
      try {
        const response = await fetchImpl(url, { headers: { accept: 'text/html, */*' } });
        if (!response.ok) continue;
        body = await response.text();
      } catch {
        continue;
      }
      const currentHash = createHash(algorithm).update(body).digest('hex');
      const previousHash = previousStates[url];
      if (previousHash === currentHash) continue;

      drafts.push({
        title: `Content changed: ${url}`,
        summary: previousHash
          ? `Watched page content changed (previous hash ${previousHash.slice(0, 12)}, new hash ${currentHash.slice(0, 12)})`
          : `First snapshot of watched page recorded (hash ${currentHash.slice(0, 12)})`,
        url,
        publishedAt: ctx.now,
        tags: ['web-diff'],
        sourceRef: currentHash,
        raw: { url, hash: currentHash, previousHash: previousHash ?? null },
      });
    }
    return drafts;
  }
}

function readPreviousStates(value: unknown): WatchedPageState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const states: Record<string, string> = {};
  for (const [url, hash] of Object.entries(value as Record<string, unknown>)) {
    if (typeof hash === 'string' && hash.length > 0) states[url] = hash;
  }
  return states;
}
