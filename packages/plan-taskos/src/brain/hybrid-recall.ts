/**
 * T15 — Hybrid BM25 + optional loopback Ollama embedding recall.
 *
 * Retrieves from the reindexed brain's FTS5 `fts_index` (porter unicode61)
 * with operator sanitization so paths/punctuation never throw syntax errors,
 * then optionally fuses lexical candidates with Ollama embeddings (strictly
 * loopback — SSRF fail-closed) via weighted Reciprocal Rank Fusion.
 *
 * Every returned snippet passes through `redactSensitiveText` so secrets never
 * leak in recall output.
 */

import type { BrainStorageDriver } from "./storage.js";
import { redactSensitiveText } from "../core/redaction.js";

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface HybridRecallResult {
  readonly mode: "lexical_only" | "hybrid";
  readonly fallbackReason?: string;
  readonly limit: number;
  readonly results: Array<{
    readonly urn: string;
    readonly kind: string;
    readonly plan_id: string;
    readonly title: string;
    readonly snippet: string; // redacted
    readonly score: number;
    readonly matchType: "lexical" | "semantic" | "fused";
  }>;
}

export interface HybridRecallInput {
  readonly query: string;
  readonly kinds?: readonly string[];
  readonly limit?: number;
  readonly ollamaEndpoint?: string;
  readonly embeddingModel?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// FTS5 query sanitization
// ---------------------------------------------------------------------------

// FTS5 special operators that would throw syntax errors if a raw path like
// `packages/plan-taskos/src/brain/storage.ts` or a quoted phrase were passed
// verbatim into a MATCH expression.
const FTS5_SPECIAL = /["()[\]*^:!~]/g;

/**
 * Sanitize a free-text query into an FTS5-safe MATCH expression.
 *
 * Strategy: strip every FTS5 special operator character (so paths containing
 * `.`, `/`, `-` and punctuation never parse as operators), collapse whitespace,
 * split into terms, and join with ` AND `. An empty/sanitized-away query falls
 * back to matching every row (lexical scan over all candidates), so callers
 * still get deterministic results instead of a syntax error.
 */
export function sanitizeFts5Query(query: string): string {
  const cleaned = query.replace(FTS5_SPECIAL, " ");
  const terms = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0) return "";
  return terms.map((t) => `"${t}"`).join(" AND ");
}

// ---------------------------------------------------------------------------
// Loopback guard (SSRF fail-closed)
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_LIMIT = 10;
const LEXICAL_CANDIDATE_LIMIT = 24; // top-24 lexical candidates for embedding re-rank

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

function toFloat32Array(buffer: ArrayBuffer | SharedArrayBuffer): Float32Array {
  return new Float32Array(buffer);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

async function fetchOllamaEmbedding(
  ollamaEndpoint: string,
  model: string,
  query: string,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<Float32Array | null> {
  if (!isLoopbackUrl(ollamaEndpoint)) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = ollamaEndpoint.replace(/\/+$/, "");
    const response = await fetchFn(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: query }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) return null;
    return Float32Array.from(data.embedding);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Snippet extraction
// ---------------------------------------------------------------------------

function buildSnippet(title: string, body: string | undefined): string {
  const parts = [title, body || ""].filter(Boolean).join("\n");
  return parts.slice(0, 240);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hybrid BM25 (+ optional Ollama semantic) recall over the brain index.
 *
 * - Always runs an FTS5 `bm25(fts_index)` lexical query with sanitized
 *   operators (paths/punctuation never throw).
 * - When `ollamaEndpoint` is strictly loopback and reachable, fetches the
 *   query embedding (AbortController, default 800ms timeout), scores the
 *   top-24 lexical candidates by cosine similarity against cached `embeddings`
 *   blobs, and fuses lexical + semantic ranks via weighted RRF (`mode: 'hybrid'`).
 * - When Ollama is absent/offline/times out or the endpoint is non-loopback,
 *   falls back with zero error to `mode: 'lexical_only'` + `fallbackReason`.
 * - Every returned snippet is redacted via `redactSensitiveText`.
 */
export async function hybridRecall(
  store: BrainStorageDriver,
  input: HybridRecallInput
): Promise<HybridRecallResult> {
  const {
    query,
    kinds,
    limit = DEFAULT_LIMIT,
    ollamaEndpoint,
    embeddingModel = "nomic-embed-text",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchFn = globalThis.fetch,
  } = input;

  const matchExpr = sanitizeFts5Query(query);
  const kindFilter = kinds && kinds.length > 0 ? `AND n.kind IN (${kinds.map(() => "?").join(", ")})` : "";

  // --- Lexical (BM25) pass -----------------------------------------------
  const lexicalSql = matchExpr
    ? `
      SELECT n.urn, n.kind, n.plan_id, n.title, b.body,
             bm25(fts_index) AS rank
      FROM fts_index b
      JOIN nodes n ON n.urn = b.urn
      WHERE fts_index MATCH ? ${kindFilter}
      ORDER BY rank
      LIMIT ?;
    `
    : `
      SELECT n.urn, n.kind, n.plan_id, n.title, b.body,
             0 AS rank
      FROM nodes n
      LEFT JOIN fts_index b ON b.urn = n.urn
      WHERE 1=1 ${kindFilter}
      LIMIT ?;
    `;

  // NOTE: kindFilter placeholders are spliced into the SQL string above, so
  // params carry matchExpr, then each kind value, then limit.
  const lexicalParams: unknown[] = matchExpr
    ? [matchExpr, ...(kinds ?? []), limit]
    : [...(kinds ?? []), limit];

  const lexicalRows = (await store.all(
    lexicalSql,
    ...lexicalParams
  )) as Array<{
    urn: string;
    kind: string;
    plan_id: string;
    title: string;
    body?: string;
    rank: number;
  }>;

  const lexicalCandidates = lexicalRows.slice(0, LEXICAL_CANDIDATE_LIMIT);

  // --- Optional semantic (Ollama) pass -----------------------------------
  let embedding: Float32Array | null = null;
  let semanticAvailable = false;
  let fallbackReason: string | undefined;

  if (ollamaEndpoint) {
    if (!isLoopbackUrl(ollamaEndpoint)) {
      fallbackReason = `non-loopback ollama endpoint rejected (SSRF guard): ${ollamaEndpoint}`;
    } else {
      embedding = await fetchOllamaEmbedding(
        ollamaEndpoint,
        embeddingModel,
        query,
        timeoutMs,
        fetchFn
      );
      if (embedding) {
        semanticAvailable = true;
      } else {
        fallbackReason = "ollama endpoint unreachable or returned no embedding";
      }
    }
  }

  const mode: HybridRecallResult["mode"] = semanticAvailable ? "hybrid" : "lexical_only";

  // --- Semantic re-rank of lexical candidates ----------------------------
  const semanticScores = new Map<string, number>();
  if (semanticAvailable && embedding && lexicalCandidates.length > 0) {
    const urns = lexicalCandidates.map((c) => c.urn);
    const embeddingRows = (await store.all(
      `SELECT urn, vector FROM embeddings WHERE urn IN (${urns.map(() => "?").join(", ")});`,
      ...urns
    )) as Array<{ urn: string; vector: unknown }>;

    const vectorByUrn = new Map<string, Float32Array>();
    for (const row of embeddingRows) {
      const buf =
        row.vector instanceof ArrayBuffer || row.vector instanceof SharedArrayBuffer
          ? row.vector
          : row.vector instanceof Uint8Array
          ? row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength)
          : null;
      if (buf) vectorByUrn.set(row.urn, toFloat32Array(buf));
    }

    for (const cand of lexicalCandidates) {
      const stored = vectorByUrn.get(cand.urn);
      if (stored && stored.length === embedding.length) {
        semanticScores.set(cand.urn, cosineSimilarity(embedding, stored));
      }
    }
  }

  // --- Fuse via weighted Reciprocal Rank Fusion --------------------------
  const k = 60; // RRF constant
  const lexicalWeight = 0.6;
  const semanticWeight = 0.4;

  // Lexical rank: position in bm25 order (1-based).
  const lexicalRank = new Map<string, number>();
  for (let i = 0; i < lexicalCandidates.length; i++) {
    lexicalRank.set(lexicalCandidates[i].urn, i + 1);
  }

  // Semantic rank: position by descending cosine similarity (1-based), only
  // for candidates that have an embedding.
  const semanticCandidates = [...lexicalCandidates].filter((c) => semanticScores.has(c.urn));
  semanticCandidates.sort((a, b) => (semanticScores.get(b.urn) ?? 0) - (semanticScores.get(a.urn) ?? 0));
  const semanticRank = new Map<string, number>();
  for (let i = 0; i < semanticCandidates.length; i++) {
    semanticRank.set(semanticCandidates[i].urn, i + 1);
  }

  const fused = new Map<string, { score: number; matchType: "lexical" | "semantic" | "fused" }>();
  for (const cand of lexicalCandidates) {
    const lr = lexicalRank.get(cand.urn) ?? 0;
    const sr = semanticRank.get(cand.urn);
    let score: number;
    let matchType: "lexical" | "semantic" | "fused";
    if (semanticAvailable && sr !== undefined) {
      score = lexicalWeight * (1 / (k + lr)) + semanticWeight * (1 / (k + sr));
      matchType = "fused";
    } else {
      score = lexicalWeight * (1 / (k + lr));
      matchType = "lexical";
    }
    fused.set(cand.urn, { score, matchType });
  }

  const ranked = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit);

  const results = ranked.map(([urn, info]) => {
    const cand = lexicalCandidates.find((c) => c.urn === urn);
    const snippet = redactSensitiveText(buildSnippet(cand?.title ?? "", cand?.body)).text;
    return {
      urn,
      kind: cand?.kind ?? "",
      plan_id: cand?.plan_id ?? "",
      title: cand?.title ?? "",
      snippet,
      score: info.score,
      matchType: info.matchType,
    };
  });

  return {
    mode,
    fallbackReason: mode === "lexical_only" ? fallbackReason : undefined,
    limit,
    results,
  };
}
