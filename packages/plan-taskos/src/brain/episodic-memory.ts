/**
 * T16 — Episodic Memory, Non-REM Sleep Consolidation & Protected-Gate Invariant Synthesizer.
 *
 * Redacted episodic memory operations:
 *   - `recordEpisode`: scrubs `summary` via `redactSensitiveText`,
 *     computes `provenance_sha256`, writes to SQLite `episodic_memory` +
 *     graph edge (`failed_on`/`fixed_by`/`learned_from`) AND appends a
 *     deterministic line to `.plan/memory/episodes.jsonl` (Git-portable).
 *   - `recallPitfallsForPaths`: ranks `status = 'active'` episodes by path
 *     overlap + `importance_bps` + recency, bumping `access_count` and
 *     `last_accessed_at`.
 *   - `runNonRemSleepConsolidation`: reversible decay of stale low-salience
 *     episodes + clustering of recurring `failure_pattern` episodes into
 *     `SemanticCandidate[]` and `InvariantRuleProposal[]`. Fail-closed
 *     constitutional guard rejects protected-gate weakening proposals and
 *     forbids `automatedPromotionAllowed: true`.
 *
 * The `episodes.jsonl` file is the source of truth for cross-DB-portability:
 * deleting `.plan/.brain/taskos.sqlite` and re-running `reindexBrainFromRepo`
 * restores episodes from `.plan/memory/episodes.jsonl`.
 */

import type { BrainStorageDriver } from "./storage.js";
import { redactSensitiveText, sha256Hex } from "../core/redaction.js";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Protected gates that must never be weakened by automated proposals.
// ---------------------------------------------------------------------------

export const PROTECTED_GATES = [
  "R0",
  "R1",
  "R2",
  "R3",
  "R4",
  "check-desktop-non-overlap",
  "check-api-addon-boundary",
  "check-board-shared-ui",
  "ai-drift-watchdog",
] as const;

const WEAKENING_PATTERNS = /\b(weaken|disable|bypass|skip|remove)\b/i;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface EpisodeInput {
  readonly summary: string;
  readonly kind?: "failure" | "fix" | "learned" | "pitfall";
  readonly failure_pattern?: string;
  readonly owner_files?: readonly string[];
  readonly task_urn?: string;
  readonly plan_id?: string;
  readonly importance_bps?: number;
  readonly status?: "active" | "decayed";
  readonly reversible?: boolean;
}

export interface RecordEpisodeResult {
  readonly episode_id: string;
  readonly provenance_sha256: string;
  readonly summary_redacted: string;
  readonly redacted: boolean;
}

interface EpisodeRowRaw {
  readonly episode_id: string;
  readonly kind: string;
  readonly summary_redacted: string;
  readonly failure_pattern: string;
  readonly owner_files: string;
  readonly task_urn: string;
  readonly plan_id: string;
  readonly importance_bps: number;
  readonly access_count: number;
  readonly last_accessed_at: string | null;
  readonly status: string;
  readonly reversible: number;
  readonly provenance_sha256: string;
  readonly recorded_at: string;
}

export interface PitfallMatch {
  readonly episode_id: string;
  readonly kind: string;
  readonly summary: string;
  readonly failure_pattern: string;
  readonly owner_files: string[];
  readonly score: number;
  readonly path_overlap_count: number;
}

export interface SemanticCandidate {
  readonly candidate_id: string;
  readonly topic: string;
  readonly matched_paths: string[];
  readonly occurrence_count: number;
  readonly representative_summary: string;
  readonly cluster_episodes: string[];
}

export interface InvariantRuleProposal {
  readonly proposal_id: string;
  readonly rule_id: string;
  readonly rule_text: string;
  readonly source_episodes: string[];
  readonly automated_promotion_allowed: boolean;
  readonly automated_self_accept: boolean;
  readonly rejected: boolean;
  readonly rejection_reason?: string;
}

export interface ConsolidationResult {
  readonly decayed: Array<{ episode_id: string; summary: string }>;
  readonly candidates: SemanticCandidate[];
  readonly proposals: InvariantRuleProposal[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function episodeKey(urnOrPath: string): string {
  return `urn:mw:episode:${sha256Hex(urnOrPath)}`;
}

function episodeFilePath(repoRoot: string): string {
  return join(repoRoot, ".plan", "memory", "episodes.jsonl");
}

function parseOwnerFiles(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function asEpisodeRows(result: unknown): EpisodeRowRaw[] {
  return Array.isArray(result) ? (result as EpisodeRowRaw[]) : [];
}

/** RRF constant for combining lexical/path overlap and recency. */
const RRF_K = 60;

// ---------------------------------------------------------------------------
// recordEpisode
// ---------------------------------------------------------------------------

/**
 * Record an episodic memory entry. The summary is redacted via
 * `redactSensitiveText` before storage so secrets never enter the brain DB or
 * the Git-portable `episodes.jsonl`. A `provenance_sha256` is computed over
 * the redacted payload for tamper-evidence.
 *
 * Writes both to SQLite `episodic_memory` (inside the store) and appends one
 * deterministic JSON line to `.plan/memory/episodes.jsonl` so episodes survive
 * DB deletion.
 */
export async function recordEpisode(
  store: BrainStorageDriver,
  repoRoot: string,
  input: EpisodeInput
): Promise<RecordEpisodeResult> {
  const redacted = redactSensitiveText(input.summary, input.owner_files ?? []);
  const summaryRedacted = redacted.text;
  const provenanceSha = sha256Hex(
    JSON.stringify({
      summary: summaryRedacted,
      kind: input.kind ?? "failure",
      owner_files: input.owner_files ?? [],
      task_urn: input.task_urn ?? "",
      plan_id: input.plan_id ?? "",
    })
  );
  const episodeId = episodeKey(`${provenanceSha}|${input.task_urn ?? ""}`);

  const row: EpisodeRowRaw = {
    episode_id: episodeId,
    kind: input.kind ?? "failure",
    summary_redacted: summaryRedacted,
    failure_pattern: input.failure_pattern ?? "",
    owner_files: JSON.stringify(input.owner_files ?? []),
    task_urn: input.task_urn ?? "",
    plan_id: input.plan_id ?? "",
    importance_bps: input.importance_bps ?? 5000,
    access_count: 0,
    last_accessed_at: null,
    status: input.status ?? "active",
    reversible: input.reversible ?? 1 ? 1 : 0,
    provenance_sha256: provenanceSha,
    recorded_at: new Date().toISOString(),
  };

  store.transactionImmediate((tx) => {
    tx.run(
      `INSERT OR REPLACE INTO episodic_memory
       (episode_id, kind, summary_redacted, failure_pattern, owner_files, task_urn,
        plan_id, importance_bps, access_count, last_accessed_at, status, reversible,
        provenance_sha256, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      row.episode_id,
      row.kind,
      row.summary_redacted,
      row.failure_pattern,
      row.owner_files,
      row.task_urn,
      row.plan_id,
      row.importance_bps,
      row.access_count,
      row.last_accessed_at,
      row.status,
      row.reversible,
      row.provenance_sha256,
      row.recorded_at
    );

    // Graph edge linking the episode to its task (and to each owned file).
    if (row.task_urn) {
      tx.run(
        `INSERT OR REPLACE INTO edges (src_urn, rel, dst_urn, metadata_json)
         VALUES (?, ?, ?, ?);`,
        row.episode_id,
        row.kind === "fix" ? "fixed_by" : row.kind === "learned" ? "learned_from" : "failed_on",
        row.task_urn,
        "{}"
      );
    }
    for (const file of input.owner_files ?? []) {
      tx.run(
        `INSERT OR REPLACE INTO edges (src_urn, rel, dst_urn, metadata_json)
         VALUES (?, ?, ?, ?);`,
        row.episode_id,
        "failed_on",
        `file:${file}`,
        "{}"
      );
    }
  });

  // Git-portable append to episodes.jsonl (deterministic, order-stable).
  const jsonlLine = JSON.stringify({
    episode_id: row.episode_id,
    kind: row.kind,
    summary: row.summary_redacted,
    failure_pattern: row.failure_pattern,
    owner_files: input.owner_files ?? [],
    task_urn: row.task_urn,
    plan_id: row.plan_id,
    importance_bps: row.importance_bps,
    status: row.status,
    reversible: row.reversible === 1,
    provenance_sha256: row.provenance_sha256,
    recorded_at: row.recorded_at,
  });
  await appendJsonlLine(episodeFilePath(repoRoot), jsonlLine);

  return {
    episode_id: row.episode_id,
    provenance_sha256: row.provenance_sha256,
    summary_redacted: row.summary_redacted,
    redacted: redacted.redacted,
  };
}

async function appendJsonlLine(filePath: string, line: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(filePath, ".."), { recursive: true });
  const { appendFile } = await import("node:fs/promises");
  await appendFile(filePath, line + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// recallPitfallsForPaths
// ---------------------------------------------------------------------------

/**
 * Rank active pitfall episodes by overlap with the given owner files,
 * weighted by `importance_bps` and recency. Bumps `access_count` and
 * `last_accessed_at` on every recalled episode.
 *
 * Returns up to `limit` (default 3) matches ordered by composite score desc.
 */
export function recallPitfallsForPaths(
  store: BrainStorageDriver,
  ownerFiles: readonly string[],
  limit = 3
): PitfallMatch[] {
  const files = new Set(ownerFiles.map((f) => f.toLowerCase()));
  const now = new Date().toISOString();

  const rows = asEpisodeRows(
    store.all(
      `SELECT episode_id, kind, summary_redacted, failure_pattern, owner_files,
              task_urn, plan_id, importance_bps, access_count, last_accessed_at,
              status, reversible, provenance_sha256, recorded_at
       FROM episodic_memory
       WHERE status = 'active';`
    )
  );

  const scored: PitfallMatch[] = [];
  for (const row of rows) {
    const epFiles = parseOwnerFiles(row.owner_files);
    const overlap = epFiles.filter((f) => files.has(f.toLowerCase())).length;
    if (overlap === 0) continue;

    // Recency bonus: more recent recorded_at ranks higher.
    let recency = 0;
    if (row.recorded_at) {
      const recordedMs = new Date(row.recorded_at).getTime();
      const nowMs = new Date(now).getTime();
      const daysOld = Math.max(0, (nowMs - recordedMs) / 86_400_000);
      recency = 1 / (1 + daysOld);
    }

    // Composite: path overlap (dominant), importance_bps, recency (RRF-style).
    const score = overlap * 100 + (row.importance_bps / 100) + recency * 10;

    scored.push({
      episode_id: row.episode_id,
      kind: row.kind,
      summary: row.summary_redacted,
      failure_pattern: row.failure_pattern,
      owner_files: epFiles,
      score,
      path_overlap_count: overlap,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  // Bump access_count and last_accessed_at on every recalled episode.
  store.transactionImmediate((tx) => {
    for (const match of top) {
      tx.run(
        `UPDATE episodic_memory
         SET access_count = access_count + 1, last_accessed_at = ?
         WHERE episode_id = ?;`,
        now,
        match.episode_id
      );
    }
  });

  return top;
}

// ---------------------------------------------------------------------------
// runNonRemSleepConsolidation
// ---------------------------------------------------------------------------

export interface ConsolidationOptions {
  readonly decayOlderThanDays?: number;
  readonly minSalienceBps?: number;
  readonly clusterMinOccurrences?: number;
}

const DEFAULT_DECAY_DAYS = 90;
const DEFAULT_MIN_SALIENCE = 1000;
const DEFAULT_CLUSTER_MIN = 2;

/**
 * Non-REM sleep consolidation pass over the episodic store:
 *
 * 1. Reversible decay: stale low-salience episodes (older than
 *    `decayOlderThanDays` AND below `minSalienceBps`) are flipped to
 *    `status = 'decayed'` with `reversible = 1` (revivable later).
 * 2. Clustering: recurring `failure_pattern` episodes with >=
 *    `clusterMinOccurrences` occurrences on matching topic/paths are grouped
 *    into `SemanticCandidate[]` and `InvariantRuleProposal[]`.
 * 3. Constitutional Guard (fail-closed): `automatedPromotionAllowed` and
 *    `automatedSelfAccept` are hard-`false`; any candidate whose rule text
 *    or topic contains a weakening pattern (`weaken|disable|bypass|skip|remove`)
 *    targeting a protected gate is rejected.
 *
 * Does NOT auto-edit `.agents/rules/learned-invariants.md`.
 */
export function runNonRemSleepConsolidation(
  store: BrainStorageDriver,
  options: ConsolidationOptions = {}
): ConsolidationResult {
  const decayDays = options.decayOlderThanDays ?? DEFAULT_DECAY_DAYS;
  const minSalience = options.minSalienceBps ?? DEFAULT_MIN_SALIENCE;
  const clusterMin = options.clusterMinOccurrences ?? DEFAULT_CLUSTER_MIN;
  const cutoff = new Date(Date.now() - decayDays * 86_400_000).toISOString();

  const rows = asEpisodeRows(
    store.all(
      `SELECT episode_id, kind, summary_redacted, failure_pattern, owner_files,
              task_urn, plan_id, importance_bps, access_count, last_accessed_at,
              status, reversible, provenance_sha256, recorded_at
       FROM episodic_memory;`
    )
  );

  // --- 1. Reversible decay -----------------------------------------------
  const decayed: ConsolidationResult["decayed"] = [];
  for (const row of rows) {
    if (row.status !== "active") continue;
    const recordedMs = row.recorded_at ? new Date(row.recorded_at).getTime() : 0;
    const isStale = recordedMs > 0 && new Date(recordedMs) < new Date(cutoff);
    const isLowSalience = (row.importance_bps ?? 0) < minSalience;
    if (isStale && isLowSalience) {
      decayed.push({ episode_id: row.episode_id, summary: row.summary_redacted });
    }
  }

  store.transactionImmediate((tx) => {
    for (const ep of decayed) {
      tx.run(
        `UPDATE episodic_memory
         SET status = 'decayed', reversible = 1
         WHERE episode_id = ? AND status = 'active';`,
        ep.episode_id
      );
    }
  });

  // --- 2. Clustering -----------------------------------------------------
  // Cluster active (non-decayed) failure episodes by normalized failure_pattern
  // and overlapping owner files.
  const activeRows = rows.filter((r) => r.status === "active" && r.kind === "failure");
  const clusters = new Map<string, EpisodeRowRaw[]>();
  for (const row of activeRows) {
    const topic = (row.failure_pattern || row.kind || "general").toLowerCase().trim();
    const key = topic || "general";
    const existing = clusters.get(key) ?? [];
    existing.push(row);
    clusters.set(key, existing);
  }

  const candidates: SemanticCandidate[] = [];
  const proposals: InvariantRuleProposal[] = [];

  for (const [topic, clusterRows] of clusters) {
    if (clusterRows.length < clusterMin) continue;

    // Union of owner files across the cluster.
    const matchedPaths = new Set<string>();
    const episodeIds: string[] = [];
    let maxImportance = 0;
    let representative = clusterRows[0];
    for (const row of clusterRows) {
      episodeIds.push(row.episode_id);
      for (const f of parseOwnerFiles(row.owner_files)) matchedPaths.add(f);
      if ((row.importance_bps ?? 0) > maxImportance) {
        maxImportance = row.importance_bps ?? 0;
        representative = row;
      }
    }

    candidates.push({
      candidate_id: `candidate:${sha256Hex(topic + "|" + [...matchedPaths].sort().join(","))}`,
      topic,
      matched_paths: [...matchedPaths].sort(),
      occurrence_count: clusterRows.length,
      representative_summary: representative.summary_redacted,
      cluster_episodes: episodeIds,
    });

    // --- 3. Constitutional Guard (fail-closed) ---------------------------
    const ruleId = `INV-auto-${sha256Hex(topic).slice(0, 8)}`;
    const ruleText = `Auto-proposed rule for recurring failure pattern '${topic}' (${clusterRows.length} occurrences).`;
    const hasWeakening = WEAKENING_PATTERNS.test(ruleText) || WEAKENING_PATTERNS.test(topic);
    const targetsProtectedGate = PROTECTED_GATES.some((gate) =>
      ruleText.toLowerCase().includes(gate.toLowerCase())
    );

    let rejected = false;
    let rejectionReason: string | undefined;
    if (hasWeakening && targetsProtectedGate) {
      rejected = true;
      rejectionReason = `proposal weakens protected gate(s): ${PROTECTED_GATES.join(", ")}`;
    }
    // Hard constitutional rule: never allow automated promotion or self-accept.
    proposals.push({
      proposal_id: `proposal:${sha256Hex(ruleId + "|" + Date.now().toString())}`,
      rule_id: ruleId,
      rule_text: ruleText,
      source_episodes: episodeIds,
      automated_promotion_allowed: false,
      automated_self_accept: false,
      rejected,
      rejection_reason: rejectionReason,
    });
  }

  return { decayed, candidates, proposals };
}
