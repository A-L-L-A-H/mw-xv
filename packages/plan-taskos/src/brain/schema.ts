/**
 * T13 — 7-table cognitive brain schema (idempotent DDL).
 *
 * Tables: nodes, edges, fts_index (FTS5 porter unicode61), embeddings,
 * episodic_memory, proof_ledger, leases + brain_meta + edge indexes.
 */

export const BRAIN_SCHEMA_VERSION = "1.0.0";

const NODES_DDL = `
CREATE TABLE IF NOT EXISTS nodes (
  urn TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  wave_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  delivery_stage TEXT NOT NULL DEFAULT 'local',
  owner_files TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

const EDGES_DDL = `
CREATE TABLE IF NOT EXISTS edges (
  src_urn TEXT NOT NULL,
  rel TEXT NOT NULL,
  dst_urn TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (src_urn, rel, dst_urn)
);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges (dst_urn);
CREATE INDEX IF NOT EXISTS idx_edges_rel ON edges (rel);
`;

const FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
  urn UNINDEXED,
  kind UNINDEXED,
  plan_id UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61'
);
`;

const EMBEDDINGS_DDL = `
CREATE TABLE IF NOT EXISTS embeddings (
  urn TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

const EPISODIC_MEMORY_DDL = `
CREATE TABLE IF NOT EXISTS episodic_memory (
  episode_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'failure',
  summary_redacted TEXT NOT NULL,
  failure_pattern TEXT NOT NULL DEFAULT '',
  owner_files TEXT NOT NULL DEFAULT '[]',
  task_urn TEXT NOT NULL DEFAULT '',
  plan_id TEXT NOT NULL DEFAULT '',
  importance_bps INTEGER NOT NULL DEFAULT 5000,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  reversible INTEGER NOT NULL DEFAULT 1,
  provenance_sha256 TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_episodic_status ON episodic_memory (status);
`;

const PROOF_LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS proof_ledger (
  envelope_sha256 TEXT PRIMARY KEY,
  task_urn TEXT NOT NULL,
  task_code TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  wave_id TEXT NOT NULL DEFAULT '',
  verify_exit_code INTEGER NOT NULL,
  parent_proof_hashes TEXT NOT NULL DEFAULT '[]',
  merkle_root TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_proof_task ON proof_ledger (task_urn);
`;

const LEASES_DDL = `
CREATE TABLE IF NOT EXISTS leases (
  lease_id TEXT PRIMARY KEY,
  task_urn TEXT NOT NULL,
  agent_runtime TEXT NOT NULL,
  session_id TEXT NOT NULL,
  model_tier TEXT NOT NULL DEFAULT 'flash',
  acquired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  renewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  released INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_leases_task ON leases (task_urn);
CREATE INDEX IF NOT EXISTS idx_leases_session ON leases (session_id);
CREATE INDEX IF NOT EXISTS idx_leases_agent ON leases (agent_runtime);
`;

const BRAIN_META_DDL = `
CREATE TABLE IF NOT EXISTS brain_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

const NODE_INDEXES_DDL = `
CREATE INDEX IF NOT EXISTS idx_nodes_plan ON nodes (plan_id);
CREATE INDEX IF NOT EXISTS idx_nodes_code ON nodes (code);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes (kind);
`;

export const BRAIN_SCHEMA_DDL: readonly string[] = [
  NODES_DDL,
  EDGES_DDL,
  FTS_DDL,
  EMBEDDINGS_DDL,
  EPISODIC_MEMORY_DDL,
  PROOF_LEDGER_DDL,
  LEASES_DDL,
  BRAIN_META_DDL,
  NODE_INDEXES_DDL,
];

/** Apply the full idempotent schema to a brain store. */
export function initializeBrainSchema(store: { exec: (sql: string) => void }): void {
  for (const ddl of BRAIN_SCHEMA_DDL) {
    store.exec(ddl);
  }
  store.exec(
    `INSERT INTO brain_meta (key, value) VALUES ('schema_version', '${BRAIN_SCHEMA_VERSION}')
     ON CONFLICT(key) DO NOTHING;`
  );
}

export function getBrainMeta(store: { get?: unknown; exec: (sql: string) => void }, key: string): string | undefined {
  const getter = store as unknown as {
    get: (sql: string, ...params: unknown[]) => { value?: string } | undefined;
  };
  if (typeof getter.get !== "function") return undefined;
  const row = getter.get("SELECT value FROM brain_meta WHERE key = ?;", key);
  return row?.value;
}

export function setBrainMeta(
  store: { run: (sql: string, ...params: unknown[]) => unknown },
  key: string,
  value: string
): void {
  store.run(
    "INSERT INTO brain_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
    key,
    value
  );
}
