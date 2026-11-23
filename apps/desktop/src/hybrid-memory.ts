import { isLoopbackEndpointUrl, redactSensitiveText } from './risk-gate.js';

export type HybridMemorySourceKind = 'document' | 'task' | 'run_note';

export interface HybridMemoryRecord {
  readonly id: string;
  readonly companyId: number;
  readonly kind: HybridMemorySourceKind;
  readonly title: string;
  readonly body: string;
  readonly tags?: readonly string[];
  readonly updatedAt?: string;
}

export interface HybridMemorySearchInput {
  readonly companyId: number;
  readonly query: string;
  readonly records: readonly HybridMemoryRecord[];
  readonly limit?: number;
  readonly ollamaEndpoint?: string;
  readonly embeddingModel?: string;
  readonly timeoutMs?: number;
  readonly knownSecrets?: readonly string[];
  readonly fetchFn?: typeof fetch;
}

export interface HybridMemoryHit {
  readonly id: string;
  readonly companyId: number;
  readonly kind: HybridMemorySourceKind;
  readonly title: string;
  readonly snippet: string;
  readonly lexicalScore: number;
  readonly semanticScore: number | null;
  readonly score: number;
  readonly redacted: boolean;
  readonly updatedAt?: string;
}

export interface HybridMemorySearchResult {
  readonly companyId: number;
  readonly query: string;
  readonly mode: 'hybrid' | 'lexical_only';
  readonly fallbackReason?: string;
  readonly totalScanned: number;
  readonly skippedCrossCompany: number;
  readonly hits: readonly HybridMemoryHit[];
}

interface SanitizedDocument {
  readonly record: HybridMemoryRecord;
  readonly title: string;
  readonly body: string;
  readonly snippet: string;
  readonly redacted: boolean;
  readonly tokens: readonly string[];
  readonly termFreq: ReadonlyMap<string, number>;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
const DEFAULT_EMBEDDING_TIMEOUT_MS = 800;
const MAX_EMBEDDING_CANDIDATES = 24;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/gu);
  return matches ?? [];
}

function buildSnippet(body: string, maxLength = 240): string {
  const normalized = body.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function computeBm25Scores(
  queryTokens: readonly string[],
  docs: readonly SanitizedDocument[]
): number[] {
  if (docs.length === 0 || queryTokens.length === 0) {
    return docs.map(() => 0);
  }

  const uniqueQueryTokens = Array.from(new Set(queryTokens));
  const docCount = docs.length;
  const totalLen = docs.reduce((sum, doc) => sum + doc.tokens.length, 0);
  const avgDocLen = totalLen > 0 ? totalLen / docCount : 1;

  const docFreq = new Map<string, number>();
  for (const token of uniqueQueryTokens) {
    let df = 0;
    for (const doc of docs) {
      if ((doc.termFreq.get(token) ?? 0) > 0) {
        df += 1;
      }
    }
    docFreq.set(token, df);
  }

  return docs.map((doc) => {
    const docLen = doc.tokens.length;
    if (docLen === 0) return 0;
    let score = 0;
    for (const token of uniqueQueryTokens) {
      const tf = doc.termFreq.get(token) ?? 0;
      if (tf === 0) continue;
      const df = docFreq.get(token) ?? 0;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + (BM25_B * docLen) / avgDocLen);
      score += idf * (numerator / denominator);
    }
    return roundScore(score);
  });
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0 || !Number.isFinite(denom)) return 0;
  return dot / denom;
}

function parseEmbeddingVector(payload: unknown): number[] | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const raw = record.embedding;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const vector: number[] = [];
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      return null;
    }
    vector.push(item);
  }
  return vector;
}

async function fetchOllamaEmbedding(
  endpointBase: string,
  model: string,
  prompt: string,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<number[]> {
  const normalizedBase = endpointBase.replace(/\/+$/u, '');
  const response = await fetchFn(`${normalizedBase}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`OLLAMA_HTTP_${response.status}`);
  }
  const parsed: unknown = await response.json();
  const vector = parseEmbeddingVector(parsed);
  if (!vector) {
    throw new Error('OLLAMA_INVALID_EMBEDDING');
  }
  return vector;
}

export async function searchHybridLocalMemory(
  input: HybridMemorySearchInput
): Promise<HybridMemorySearchResult> {
  if (!Number.isInteger(input.companyId) || input.companyId <= 0) {
    throw new Error('companyId must be a positive integer');
  }

  const knownSecrets = input.knownSecrets ?? [];
  const safeQuery = redactSensitiveText(input.query, knownSecrets).text.trim();
  const limit =
    typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit > 0
      ? input.limit
      : DEFAULT_LIMIT;

  let skippedCrossCompany = 0;
  const companyDocs: SanitizedDocument[] = [];

  for (const record of input.records) {
    if (record.companyId !== input.companyId) {
      skippedCrossCompany += 1;
      continue;
    }
    const titleRedaction = redactSensitiveText(record.title, knownSecrets);
    const bodyRedaction = redactSensitiveText(record.body, knownSecrets);
    const safeTags = (record.tags ?? []).map((tag) => redactSensitiveText(tag, knownSecrets).text);
    const titleTokens = tokenize(titleRedaction.text);
    const bodyTokens = tokenize(bodyRedaction.text);
    const tagTokens = safeTags.flatMap((tag) => tokenize(tag));
    const tokens = [...titleTokens, ...titleTokens, ...tagTokens, ...bodyTokens];
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    companyDocs.push({
      record,
      title: titleRedaction.text,
      body: bodyRedaction.text,
      snippet: buildSnippet(bodyRedaction.text),
      redacted: titleRedaction.redacted || bodyRedaction.redacted,
      tokens,
      termFreq,
    });
  }

  const queryTokens = tokenize(safeQuery);
  const lexicalScores = computeBm25Scores(queryTokens, companyDocs);

  const scoredIndices = companyDocs
    .map((doc, idx) => ({
      doc,
      idx,
      lexicalScore: lexicalScores[idx] ?? 0,
    }))
    .sort((a, b) => {
      if (b.lexicalScore !== a.lexicalScore) return b.lexicalScore - a.lexicalScore;
      return a.doc.record.id.localeCompare(b.doc.record.id);
    });

  const endpoint = input.ollamaEndpoint?.trim();
  let mode: 'hybrid' | 'lexical_only' = 'lexical_only';
  let fallbackReason: string | undefined;
  const semanticById = new Map<string, number>();

  if (endpoint && endpoint.length > 0 && safeQuery.length > 0 && scoredIndices.length > 0) {
    if (!isLoopbackEndpointUrl(endpoint)) {
      fallbackReason = 'NON_LOOPBACK_ENDPOINT_BLOCKED';
    } else {
      const fetchFn = input.fetchFn ?? globalThis.fetch;
      const model = input.embeddingModel?.trim() || DEFAULT_EMBEDDING_MODEL;
      const timeoutMs =
        typeof input.timeoutMs === 'number' &&
        Number.isFinite(input.timeoutMs) &&
        input.timeoutMs > 0
          ? Math.min(input.timeoutMs, DEFAULT_EMBEDDING_TIMEOUT_MS)
          : DEFAULT_EMBEDDING_TIMEOUT_MS;

      try {
        const queryVector = await fetchOllamaEmbedding(
          endpoint,
          model,
          safeQuery,
          timeoutMs,
          fetchFn
        );
        const candidates = scoredIndices.slice(0, MAX_EMBEDDING_CANDIDATES);
        for (const candidate of candidates) {
          const docText = `${candidate.doc.title}\n${candidate.doc.body}`.slice(0, 2000);
          const docVector = await fetchOllamaEmbedding(
            endpoint,
            model,
            docText,
            timeoutMs,
            fetchFn
          );
          const sim = cosineSimilarity(queryVector, docVector);
          semanticById.set(candidate.doc.record.id, roundScore(sim));
        }
        mode = 'hybrid';
      } catch (err) {
        fallbackReason = err instanceof Error ? err.message : 'OLLAMA_UNAVAILABLE';
      }
    }
  }

  const maxLexical = scoredIndices.reduce(
    (max, entry) => (entry.lexicalScore > max ? entry.lexicalScore : max),
    0
  );

  const rankedHits: HybridMemoryHit[] = scoredIndices
    .map(({ doc, lexicalScore }) => {
      const semanticScore = semanticById.has(doc.record.id)
        ? (semanticById.get(doc.record.id) ?? 0)
        : null;

      let combinedScore = lexicalScore;
      if (mode === 'hybrid' && semanticScore !== null) {
        const normalizedLexical = maxLexical > 0 ? lexicalScore / maxLexical : 0;
        const normalizedSemantic = Math.max(0, (semanticScore + 1) / 2);
        combinedScore = roundScore(0.55 * normalizedLexical + 0.45 * normalizedSemantic);
      }

      return {
        id: doc.record.id,
        companyId: doc.record.companyId,
        kind: doc.record.kind,
        title: doc.title,
        snippet: doc.snippet,
        lexicalScore,
        semanticScore,
        score: combinedScore,
        redacted: doc.redacted,
        ...(doc.record.updatedAt !== undefined ? { updatedAt: doc.record.updatedAt } : {}),
      };
    })
    .filter((hit) => hit.score > 0 || (mode === 'hybrid' && hit.semanticScore !== null))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);

  return {
    companyId: input.companyId,
    query: safeQuery,
    mode,
    ...(fallbackReason !== undefined ? { fallbackReason } : {}),
    totalScanned: companyDocs.length,
    skippedCrossCompany,
    hits: rankedHits,
  };
}
