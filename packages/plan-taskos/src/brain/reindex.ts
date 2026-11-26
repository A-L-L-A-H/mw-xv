/**
 * T13 — Deterministic Git-to-SQLite reindexer.
 *
 * Rebuilds nodes, edges, fts_index, and proof_ledger from repo plans inside
 * a single transaction while preserving live unexpired leases. Never mutates
 * any Git-tracked file.
 */

import type { BrainStorageDriver } from "./storage.js";
import { initializeBrainSchema, BRAIN_SCHEMA_VERSION } from "./schema.js";
import { discoverPlans } from "../core/loader.js";
import { redactSensitiveText, sha256Hex } from "../core/redaction.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const GRAPH_RELATIONS = [
  "depends_on",
  "parent_of",
  "owns_file",
  "reads_file",
  "governed_by",
  "decided_by",
  "documents",
  "proved_by",
  "failed_on",
  "fixed_by",
  "projected_to",
] as const;

type GraphRelation = (typeof GRAPH_RELATIONS)[number];

interface EdgeRow {
  src_urn: string;
  rel: GraphRelation;
  dst_urn: string;
  metadata_json: string;
}

interface NodeRow {
  urn: string;
  kind: string;
  code: string;
  title: string;
  plan_id: string;
  wave_id: string;
  status: string;
  delivery_stage: string;
  owner_files: string;
  metadata_json: string;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null) ?? "{}";
  } catch {
    return "{}";
  }
}

function loadInvariantRuleIds(content: string): string[] {
  const ids: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^###\s+(INV-[A-Za-z0-9-]+)/.exec(line.trim());
    if (match) {
      ids.push(match[1]);
    }
  }
  return ids;
}

interface EpisodeLine {
  episode_id?: string;
  kind?: string;
  summary?: string;
  failure_pattern?: string;
  owner_files?: string[];
  task_urn?: string;
  plan_id?: string;
  importance_bps?: number;
  status?: string;
}

function parseEpisodes(content: string): EpisodeLine[] {
  const episodes: EpisodeLine[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as EpisodeLine;
      episodes.push(parsed);
    } catch {
      // skip malformed line
    }
  }
  return episodes;
}

function loadProofLedgers(content: string): Array<{ envelope: Record<string, unknown> }> {
  const proofs: Array<{ envelope: Record<string, unknown> }> = [];
  let current: Record<string, unknown> | null = null;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        current = JSON.parse(trimmed) as Record<string, unknown>;
        proofs.push({ envelope: current });
      } catch {
        current = null;
      }
    }
  }
  return proofs;
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export interface ReindexResult {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly ftsCount: number;
  readonly proofCount: number;
  readonly episodeCount: number;
  readonly durationMs: number;
}

/**
 * Rebuild the cognitive brain tables from repo plans. Deterministic: the same
 * repo state always produces identical nodes/edges/fts counts.
 */
export async function reindexBrainFromRepo(
  store: BrainStorageDriver,
  repoRoot: string
): Promise<ReindexResult> {
  const startedAt = process.hrtime.bigint();

  initializeBrainSchema(store);

  const bundles = await discoverPlans(repoRoot);

  const nodes: NodeRow[] = [];
  const edges: EdgeRow[] = [];
  const ftsRows: Array<{ urn: string; kind: string; plan_id: string; title: string; body: string }> = [];
  const proofRows: Array<{
    envelope_sha256: string;
    task_urn: string;
    task_code: string;
    plan_id: string;
    wave_id: string;
    verify_exit_code: number;
    parent_proof_hashes: string;
    merkle_root: string;
    evidence_json: string;
  }> = [];
  const episodeRows: Array<{
    episode_id: string;
    kind: string;
    summary_redacted: string;
    failure_pattern: string;
    owner_files: string;
    task_urn: string;
    plan_id: string;
    importance_bps: number;
    provenance_sha256: string;
    status: string;
  }> = [];

  for (const bundle of bundles) {
    const planId = bundle.manifest.plan_id;
    nodes.push({
      urn: `urn:mw:plan:${planId}`,
      kind: "plan",
      code: planId,
      title: bundle.manifest.title,
      plan_id: planId,
      wave_id: "",
      status: "active",
      delivery_stage: "na",
      owner_files: "[]",
      metadata_json: safeJson({ format: bundle.format }),
    });

    // plan --documents--> ADR
    if (bundle.manifest.adr_file) {
      edges.push({
        src_urn: `urn:mw:plan:${planId}`,
        rel: "documents",
        dst_urn: `urn:mw:doc:${planId}/${bundle.manifest.adr_file}`,
        metadata_json: "{}",
      });
    }

    for (const doc of bundle.documents) {
      edges.push({
        src_urn: `urn:mw:plan:${planId}`,
        rel: "documents",
        dst_urn: doc.urn,
        metadata_json: "{}",
      });
    }

    for (const wave of bundle.waves) {
      for (const task of wave.tasks) {
        const ownerFiles = Array.isArray(task.governance.owner_files)
          ? [...task.governance.owner_files]
          : [];
        const ownerGlobs = Array.isArray(task.governance.owner_globs)
          ? [...task.governance.owner_globs]
          : [];

        nodes.push({
          urn: task.urn,
          kind: task.kind,
          code: task.code,
          title: task.title,
          plan_id: planId,
          wave_id: wave.wave_id,
          status: task.lifecycle.status,
          delivery_stage: task.lifecycle.delivery_stage,
          owner_files: safeJson(ownerFiles),
          metadata_json: safeJson({
            attempts: task.lifecycle.attempts,
            owner_globs: ownerGlobs,
          }),
        });

        // plan --parent_of--> wave/task
        edges.push({
          src_urn: `urn:mw:plan:${planId}`,
          rel: "parent_of",
          dst_urn: task.urn,
          metadata_json: safeJson({ wave_id: wave.wave_id }),
        });

        // task --depends_on--> predecessor codes
        for (const dep of task.graph.depends_on ?? []) {
          const depUrn = `urn:mw:work:${bundle.manifest.repo.org}/${bundle.manifest.repo.name}:${planId}:*/${dep}`;
          edges.push({
            src_urn: task.urn,
            rel: "depends_on",
            dst_urn: depUrn,
            metadata_json: "{}",
          });
        }

        // task --owns_file--> each owner file
        for (const file of ownerFiles) {
          edges.push({
            src_urn: task.urn,
            rel: "owns_file",
            dst_urn: `file:${file}`,
            metadata_json: "{}",
          });
        }
        for (const glob of ownerGlobs) {
          edges.push({
            src_urn: task.urn,
            rel: "reads_file",
            dst_urn: `glob:${glob}`,
            metadata_json: "{}",
          });
        }

        // invariants -> governed_by
        for (const inv of task.governance.invariants ?? []) {
          edges.push({
            src_urn: task.urn,
            rel: "governed_by",
            dst_urn: `urn:mw:inv:${inv.id}`,
            metadata_json: safeJson({ rule: inv.rule }),
          });
        }

        // knowledge doc urns -> documents
        for (const docUrn of task.knowledge.doc_urns ?? []) {
          edges.push({
            src_urn: task.urn,
            rel: "documents",
            dst_urn: docUrn,
            metadata_json: "{}",
          });
        }

        const specBody = (task.verification.acceptance_criteria ?? []).join("\n");
        ftsRows.push({
          urn: task.urn,
          kind: task.kind,
          plan_id: planId,
          title: `${task.code} — ${task.title}`,
          body: [
            task.title,
            specBody,
            ownerFiles.join(" "),
            ownerGlobs.join(" "),
          ]
            .filter(Boolean)
            .join("\n"),
        });
      }
    }
  }

  // Learned invariants become invariant nodes + decided_by edges to plans.
  const invariantsPath = join(repoRoot, ".agents", "rules", "learned-invariants.md");
  const invariantsContent = await readTextIfExists(invariantsPath);
  const invariantIds = loadInvariantRuleIds(invariantsContent);
  for (const invId of invariantIds) {
    nodes.push({
      urn: `urn:mw:inv:${invId}`,
      kind: "invariant",
      code: invId,
      title: invId,
      plan_id: "",
      wave_id: "",
      status: "active",
      delivery_stage: "na",
      owner_files: "[]",
      metadata_json: "{}",
    });
  }

  // Episodic memory from .plan/memory/episodes.jsonl (Git-portable memory).
  const episodesPath = join(repoRoot, ".plan", "memory", "episodes.jsonl");
  const episodesContent = await readTextIfExists(episodesPath);
  const episodes = parseEpisodes(episodesContent);
  for (const ep of episodes) {
    const summaryRedacted = redactSensitiveText(ep.summary ?? "").text;
    const ownerFiles = Array.isArray(ep.owner_files) ? ep.owner_files : [];
    const episodeId = ep.episode_id ?? sha256Hex(`${summaryRedacted}|${ep.task_urn ?? ""}`);
    episodeRows.push({
      episode_id: episodeId,
      kind: ep.kind ?? "failure",
      summary_redacted: summaryRedacted,
      failure_pattern: ep.failure_pattern ?? "",
      owner_files: safeJson(ownerFiles),
      task_urn: ep.task_urn ?? "",
      plan_id: ep.plan_id ?? "",
      importance_bps: ep.importance_bps ?? 5000,
      provenance_sha256: sha256Hex(safeJson(ep)),
      status: ep.status ?? "active",
    });
    if (ep.task_urn) {
      edges.push({
        src_urn: episodeId,
        rel: ep.kind === "fix" ? "fixed_by" : "failed_on",
        dst_urn: ep.task_urn,
        metadata_json: "{}",
      });
    }
    for (const file of ownerFiles) {
      edges.push({
        src_urn: episodeId,
        rel: "failed_on",
        dst_urn: `file:${file}`,
        metadata_json: "{}",
      });
    }
  }

  // Evidence proofs from .plan/*/evidence/*.proof.json (best-effort scan).
  const evidenceIndex = await readTextIfExists(join(repoRoot, ".plan", "evidence-index.json"));
  if (evidenceIndex) {
    for (const { envelope } of loadProofLedgers(evidenceIndex)) {
      const envelopeSha = (envelope.envelope_sha256 as string) ?? sha256Hex(safeJson(envelope));
      proofRows.push({
        envelope_sha256: envelopeSha,
        task_urn: (envelope.task_urn as string) ?? "",
        task_code: (envelope.task_code as string) ?? "",
        plan_id: (envelope.plan_id as string) ?? "",
        wave_id: (envelope.wave_id as string) ?? "",
        verify_exit_code: (envelope.verify_exit_code as number) ?? 0,
        parent_proof_hashes: safeJson(envelope.parent_proof_hashes ?? []),
        merkle_root: (envelope.merkle_root as string) ?? "",
        evidence_json: safeJson(envelope),
      });
      if (envelope.task_urn) {
        edges.push({
          src_urn: envelope.task_urn as string,
          rel: "proved_by",
          dst_urn: `proof:${envelopeSha}`,
          metadata_json: "{}",
        });
      }
    }
  }

  const nodeCount = nodes.length + invariantIds.length;
  const edgeCount = edges.length;
  const episodeCount = episodeRows.length;

  store.transactionImmediate((tx) => {
    // Preserve live unexpired leases.
    tx.exec("CREATE TEMP TABLE IF NOT EXISTS _live_leases AS SELECT * FROM leases WHERE released = 0 AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now');");

    tx.exec("DELETE FROM fts_index;");
    tx.exec("DELETE FROM edges;");
    tx.exec("DELETE FROM nodes;");
    tx.exec("DELETE FROM proof_ledger;");
    tx.exec("DELETE FROM episodic_memory;");

    for (const node of nodes) {
      tx.run(
        `INSERT OR REPLACE INTO nodes (urn, kind, code, title, plan_id, wave_id, status, delivery_stage, owner_files, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        node.urn, node.kind, node.code, node.title, node.plan_id, node.wave_id,
        node.status, node.delivery_stage, node.owner_files, node.metadata_json
      );
    }
    for (const invId of invariantIds) {
      tx.run(
        `INSERT OR REPLACE INTO nodes (urn, kind, code, title, plan_id, wave_id, status, delivery_stage, owner_files, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        `urn:mw:inv:${invId}`, "invariant", invId, invId, "", "", "active", "na", "[]", "{}"
      );
    }

    for (const edge of edges) {
      tx.run(
        `INSERT OR IGNORE INTO edges (src_urn, rel, dst_urn, metadata_json) VALUES (?, ?, ?, ?);`,
        edge.src_urn, edge.rel, edge.dst_urn, edge.metadata_json
      );
    }

    for (const row of ftsRows) {
      tx.run(
        `INSERT INTO fts_index (urn, kind, plan_id, title, body) VALUES (?, ?, ?, ?, ?);`,
        row.urn, row.kind, row.plan_id, row.title, row.body
      );
    }

    for (const proof of proofRows) {
      tx.run(
        `INSERT OR REPLACE INTO proof_ledger (envelope_sha256, task_urn, task_code, plan_id, wave_id, verify_exit_code, parent_proof_hashes, merkle_root, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        proof.envelope_sha256, proof.task_urn, proof.task_code, proof.plan_id, proof.wave_id,
        proof.verify_exit_code, proof.parent_proof_hashes, proof.merkle_root, proof.evidence_json
      );
    }

    for (const ep of episodeRows) {
      tx.run(
        `INSERT OR REPLACE INTO episodic_memory (episode_id, kind, summary_redacted, failure_pattern, owner_files, task_urn, plan_id, importance_bps, provenance_sha256, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        ep.episode_id, ep.kind, ep.summary_redacted, ep.failure_pattern, ep.owner_files,
        ep.task_urn, ep.plan_id, ep.importance_bps, ep.provenance_sha256, ep.status
      );
    }

    // Restore live leases from temp snapshot.
    tx.exec("DELETE FROM leases WHERE released = 0;");
    tx.exec("INSERT OR IGNORE INTO leases SELECT * FROM _live_leases;");
    tx.exec("DROP TABLE IF EXISTS _live_leases;");

    const meta: Array<[string, string]> = [
      ["schema_version", BRAIN_SCHEMA_VERSION],
      ["last_reindexed_at", new Date().toISOString()],
      ["plan_count", String(bundles.length)],
      ["node_count", String(nodeCount)],
      ["edge_count", String(edgeCount)],
    ];
    for (const [key, value] of meta) {
      tx.run(
        `INSERT INTO brain_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
        key, value
      );
    }
  });

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return { nodeCount, edgeCount, ftsCount: ftsRows.length, proofCount: proofRows.length, episodeCount, durationMs };
}

export { GRAPH_RELATIONS };
