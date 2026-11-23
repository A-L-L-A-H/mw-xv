import { redactSensitiveText } from './risk-gate.js';

export type LocalRagDocumentKind = 'task' | 'doc' | 'log';

export interface LocalRagDocument {
  readonly id: string;
  readonly kind: LocalRagDocumentKind;
  readonly title: string;
  readonly body: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LocalRagSearchHit {
  readonly id: string;
  readonly kind: LocalRagDocumentKind;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LocalRagSearchOptions {
  readonly limit?: number;
  readonly kinds?: readonly LocalRagDocumentKind[];
  readonly k1?: number;
  readonly b?: number;
}

export interface LocalRagSearchResult {
  readonly query: string;
  readonly totalIndexed: number;
  readonly totalMatched: number;
  readonly hits: readonly LocalRagSearchHit[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function buildRedactedSnippet(text: string, matchedTerms: readonly string[], maxLen = 180): string {
  const safe = redactSensitiveText(text).text.replace(/\s+/g, ' ').trim();
  if (safe.length <= maxLen) {
    return safe;
  }
  const lower = safe.toLowerCase();
  let bestIdx = 0;
  for (const term of matchedTerms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx >= 0) {
      bestIdx = Math.max(0, idx - 40);
      break;
    }
  }
  const slice = safe.slice(bestIdx, bestIdx + maxLen).trim();
  return `${bestIdx > 0 ? '...' : ''}${slice}${bestIdx + maxLen < safe.length ? '...' : ''}`;
}

/**
 * Pure offline BM25 + token-prefix hybrid search engine over local Kanban tasks,
 * knowledge docs, and DesktopLogHub entries. Zero network calls; all returned
 * titles and snippets pass through secret redaction.
 */
export function searchLocalRagDocuments(
  documents: readonly LocalRagDocument[],
  query: string,
  options: LocalRagSearchOptions = {}
): LocalRagSearchResult {
  const trimmedQuery = query.trim();
  const allowedKinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  const filteredDocs = allowedKinds
    ? documents.filter((doc) => allowedKinds.has(doc.kind))
    : documents;

  const queryTerms = Array.from(new Set(tokenize(trimmedQuery)));
  if (queryTerms.length === 0 || filteredDocs.length === 0) {
    return {
      query: redactSensitiveText(trimmedQuery).text,
      totalIndexed: filteredDocs.length,
      totalMatched: 0,
      hits: [],
    };
  }

  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;
  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(Math.floor(options.limit), 100)
      : 20;

  interface IndexedDoc {
    readonly doc: LocalRagDocument;
    readonly titleTokens: readonly string[];
    readonly bodyTokens: readonly string[];
    readonly termFreq: Map<string, number>;
    readonly docLen: number;
  }

  const indexed: IndexedDoc[] = [];
  const docFreq = new Map<string, number>();
  let totalDocLen = 0;

  for (const doc of filteredDocs) {
    const safeTitle = redactSensitiveText(doc.title).text;
    const safeBody = redactSensitiveText(doc.body).text;
    const titleTokens = tokenize(safeTitle);
    const bodyTokens = tokenize(safeBody);
    const termFreq = new Map<string, number>();

    // Title tokens carry 2x weight for relevance
    for (const token of titleTokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 2);
    }
    for (const token of bodyTokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    const docLen = Math.max(1, titleTokens.length * 2 + bodyTokens.length);
    totalDocLen += docLen;
    for (const uniqueTerm of termFreq.keys()) {
      docFreq.set(uniqueTerm, (docFreq.get(uniqueTerm) ?? 0) + 1);
    }

    indexed.push({
      doc: {
        ...doc,
        title: safeTitle,
        body: safeBody,
      },
      titleTokens,
      bodyTokens,
      termFreq,
      docLen,
    });
  }

  const N = indexed.length;
  const avgDocLen = totalDocLen / N;
  const scored: LocalRagSearchHit[] = [];

  for (const item of indexed) {
    let score = 0;
    const matchedTerms = new Set<string>();

    for (const qTerm of queryTerms) {
      const exactTf = item.termFreq.get(qTerm) ?? 0;
      if (exactTf > 0) {
        const df = docFreq.get(qTerm) ?? 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const bm25 =
          idf * ((exactTf * (k1 + 1)) / (exactTf + k1 * (1 - b + b * (item.docLen / avgDocLen))));
        score += bm25;
        matchedTerms.add(qTerm);
        continue;
      }

      // Token-prefix match fallback (e.g., "sync" matches "sync-engine")
      let prefixMatches = 0;
      for (const docToken of item.termFreq.keys()) {
        if (docToken.startsWith(qTerm)) {
          prefixMatches += item.termFreq.get(docToken) ?? 1;
        }
      }
      if (prefixMatches > 0) {
        score += 0.45 * Math.log(1 + prefixMatches);
        matchedTerms.add(qTerm);
      }
    }

    if (score > 0 && matchedTerms.size > 0) {
      const matchedList = Array.from(matchedTerms).sort();
      scored.push({
        id: item.doc.id,
        kind: item.doc.kind,
        title: item.doc.title,
        snippet: buildRedactedSnippet(item.doc.body || item.doc.title, matchedList),
        score: Number(score.toFixed(6)),
        matchedTerms: matchedList,
        ...(item.doc.metadata !== undefined ? { metadata: item.doc.metadata } : {}),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    query: redactSensitiveText(trimmedQuery).text,
    totalIndexed: filteredDocs.length,
    totalMatched: scored.length,
    hits: scored.slice(0, limit),
  };
}
