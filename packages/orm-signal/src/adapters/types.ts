import { createHash } from 'node:crypto';
import type { Knex } from 'knex';

export interface SignalAdapterContext {
  readonly db: Knex;
  readonly companyId: number;
  readonly now: Date;
  readonly config: Record<string, unknown>;
  readonly fetchImpl?: typeof fetch;
}

export interface SignalObservationDraft {
  readonly title: string;
  readonly summary?: string;
  readonly url?: string;
  readonly raw?: unknown;
  readonly publishedAt?: Date;
  readonly tags?: readonly string[];
  readonly sourceRef?: string;
}

export interface SignalAdapter {
  readonly kind: string;
  fetch(ctx: SignalAdapterContext): Promise<SignalObservationDraft[]>;
}

export function hashObservationContent(draft: SignalObservationDraft): string {
  const hash = createHash('sha256');
  hash.update(draft.title);
  if (draft.url) hash.update('\n');
  hash.update(draft.url ?? '');
  if (draft.summary) hash.update('\n');
  hash.update(draft.summary ?? '');
  return hash.digest('hex');
}

export function toRawJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
