import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Registry } from '@moonwitness/orm';
import {
  ConcurrencyConflictError,
  NotFoundError,
  ValidationError,
  type Domain,
  type DomainLeaf,
  type JsonObject,
} from '@moonwitness/types';
import { redactSensitiveText } from './risk-gate.js';
import type {
  DataClassification,
  EnqueuePcwEnvelopeInput,
  LocalSidecarState,
  PcwArtifactDigest,
  PcwArtifactKind,
  PcwOutboxModelName,
  PcwSyncBatchResult,
  PcwSyncEnvelope,
  PcwSyncStatus,
  RiskAuditRecord,
  UpstreamPcwSyncTransport,
} from './types.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_REGEX = /^[a-f0-9]{64}$/u;
const SCHEMA_VERSION = 1;

const ALLOWED_DOMAIN_FIELDS: ReadonlySet<string> = new Set([
  'envelope_id',
  'company_id',
  'work_contract_id',
  'agent_run_id',
  'agent_id',
  'correlation_id',
  'model_name',
  'run_status',
  'sync_status',
]);

interface OutboxRow {
  envelope_id: string;
  company_id: number;
  work_contract_id: number;
  agent_run_id: string;
  agent_id: number;
  correlation_id: string;
  model_name: PcwOutboxModelName;
  fencing_token: number;
  run_status: PcwSyncEnvelope['runStatus'];
  artifacts_json: string;
  envelope_sha256: string;
  sync_status: PcwSyncStatus;
  attempts: number;
  created_at: string;
  synced_at: string | null;
  upstream_record_id: number | null;
  last_error: string | null;
}

interface CountRow {
  total: number;
}

interface MetaRow {
  value: string;
}

interface RunFencingRow {
  fencing_token: number;
}

export function buildArtifactDigest(input: {
  readonly storageKey?: string;
  readonly artifactKind: PcwArtifactKind;
  readonly content: string | Uint8Array;
  readonly mimeType?: string;
  readonly dataClassification: DataClassification;
  readonly sourceSha?: string;
  readonly relativePath?: string;
}): PcwArtifactDigest {
  const buf =
    typeof input.content === 'string'
      ? Buffer.from(input.content, 'utf8')
      : Buffer.from(input.content);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  return {
    storageKey: input.storageKey ?? randomUUID(),
    artifactKind: input.artifactKind,
    sha256,
    sizeBytes: buf.byteLength,
    mimeType: input.mimeType ?? 'application/json',
    dataClassification: input.dataClassification,
    ...(input.sourceSha !== undefined ? { sourceSha: input.sourceSha } : {}),
    ...(input.relativePath !== undefined ? { relativePath: input.relativePath } : {}),
  };
}

export function computeEnvelopeSha256(payload: {
  readonly envelopeId: string;
  readonly companyId: number;
  readonly workContractId: number;
  readonly agentRunId: string;
  readonly agentId: number;
  readonly correlationId: string;
  readonly modelName: PcwOutboxModelName;
  readonly fencingToken: number;
  readonly runStatus: PcwSyncEnvelope['runStatus'];
  readonly artifacts: readonly PcwArtifactDigest[];
}): string {
  const canonical = JSON.stringify({
    envelopeId: payload.envelopeId,
    companyId: payload.companyId,
    workContractId: payload.workContractId,
    agentRunId: payload.agentRunId,
    agentId: payload.agentId,
    correlationId: payload.correlationId,
    modelName: payload.modelName,
    fencingToken: payload.fencingToken,
    runStatus: payload.runStatus,
    artifacts: payload.artifacts.map((artifact) => ({
      storageKey: artifact.storageKey,
      artifactKind: artifact.artifactKind,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      mimeType: artifact.mimeType,
      dataClassification: artifact.dataClassification,
      sourceSha: artifact.sourceSha ?? null,
      relativePath: artifact.relativePath ?? null,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function validatePositiveInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError(`${label} must be a positive safe integer`);
  }
}

function validateArtifacts(artifacts: readonly PcwArtifactDigest[]): void {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new ValidationError('PCW envelope must include at least one SHA-256 artifact digest');
  }
  const seenKeys = new Set<string>();
  for (const artifact of artifacts) {
    if (!UUID_REGEX.test(artifact.storageKey)) {
      throw new ValidationError(`Invalid artifact storageKey UUID: '${artifact.storageKey}'`);
    }
    if (seenKeys.has(artifact.storageKey)) {
      throw new ValidationError(
        `Duplicate artifact storageKey in envelope: '${artifact.storageKey}'`
      );
    }
    seenKeys.add(artifact.storageKey);
    if (!SHA256_REGEX.test(artifact.sha256)) {
      throw new ValidationError(`Invalid artifact SHA-256 digest: '${artifact.sha256}'`);
    }
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) {
      throw new ValidationError(`Invalid artifact sizeBytes for '${artifact.storageKey}'`);
    }
    if (!artifact.mimeType.trim()) {
      throw new ValidationError(`Artifact '${artifact.storageKey}' must specify mimeType`);
    }
  }
}

export interface LocalSidecarControllerOptions {
  readonly sqlitePath: string;
  readonly offlineMode?: boolean;
  readonly knownSecrets?: readonly string[];
}

export class LocalSidecarController {
  readonly sqlitePath: string;
  private readonly db: DatabaseSync;
  private readonly knownSecrets: readonly string[];
  private offlineMode: boolean;
  private closed = false;

  constructor(options: LocalSidecarControllerOptions) {
    this.sqlitePath = options.sqlitePath;
    this.offlineMode = options.offlineMode ?? false;
    this.knownSecrets = options.knownSecrets ?? [];

    if (this.sqlitePath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(this.sqlitePath)), { recursive: true });
    }

    this.db = new DatabaseSync(this.sqlitePath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    if (this.sqlitePath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS desktop_sidecar_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS desktop_local_runs (
        agent_run_id TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL,
        work_contract_id INTEGER NOT NULL,
        agent_id INTEGER NOT NULL,
        correlation_id TEXT NOT NULL,
        run_status TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        worktree_lease_id TEXT,
        checkpoint_json TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS desktop_pcw_outbox (
        envelope_id TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL,
        work_contract_id INTEGER NOT NULL,
        agent_run_id TEXT NOT NULL,
        agent_id INTEGER NOT NULL,
        correlation_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        run_status TEXT NOT NULL,
        artifacts_json TEXT NOT NULL,
        envelope_sha256 TEXT NOT NULL,
        sync_status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        synced_at TEXT,
        upstream_record_id INTEGER,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_desktop_pcw_outbox_sync
        ON desktop_pcw_outbox (sync_status, created_at);

      CREATE TABLE IF NOT EXISTS desktop_pcw_artifacts (
        envelope_id TEXT NOT NULL REFERENCES desktop_pcw_outbox(envelope_id) ON DELETE CASCADE,
        storage_key TEXT NOT NULL,
        artifact_kind TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        data_classification TEXT NOT NULL,
        source_sha TEXT,
        relative_path TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (envelope_id, storage_key)
      );

      CREATE TABLE IF NOT EXISTS desktop_risk_audit (
        audit_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        action TEXT NOT NULL,
        requested_tier TEXT NOT NULL,
        resolved_tier TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        reason_code TEXT NOT NULL,
        reason TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        agent_id INTEGER NOT NULL,
        grant_id TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    this.setMetaIfMissing('schema_version', String(SCHEMA_VERSION), now);
    this.setMetaIfMissing('offline_mode', this.offlineMode ? 'true' : 'false', now);
  }

  getState(): LocalSidecarState {
    if (this.closed) {
      return {
        status: 'stopped',
        sqlitePath: this.sqlitePath,
        schemaVersion: SCHEMA_VERSION,
        offlineMode: this.offlineMode,
        registeredOrmModels: Registry.getNames(),
        pendingOutboxCount: 0,
        syncedOutboxCount: 0,
        failedOutboxCount: 0,
        conflictOutboxCount: 0,
        activeRunCount: 0,
        lastSyncAt: null,
        lastSyncError: null,
      };
    }

    const countByStatus = (status: PcwSyncStatus): number => {
      const row = this.db
        .prepare('SELECT COUNT(*) AS total FROM desktop_pcw_outbox WHERE sync_status = ?')
        .get(status) as unknown as CountRow | undefined;
      return row?.total ?? 0;
    };

    const activeRunRow = this.db
      .prepare(
        "SELECT COUNT(*) AS total FROM desktop_local_runs WHERE run_status IN ('pending', 'running')"
      )
      .get() as unknown as CountRow | undefined;

    const failedCount = countByStatus('failed');
    const conflictCount = countByStatus('conflict');

    const status: LocalSidecarState['status'] = this.offlineMode
      ? 'offline'
      : failedCount > 0 || conflictCount > 0
        ? 'degraded'
        : 'ready';

    return {
      status,
      sqlitePath: this.sqlitePath,
      schemaVersion: SCHEMA_VERSION,
      offlineMode: this.offlineMode,
      registeredOrmModels: Registry.getNames(),
      pendingOutboxCount: countByStatus('pending'),
      syncedOutboxCount: countByStatus('synced'),
      failedOutboxCount: failedCount,
      conflictOutboxCount: conflictCount,
      activeRunCount: activeRunRow?.total ?? 0,
      lastSyncAt: this.getMeta('last_sync_at'),
      lastSyncError: this.getMeta('last_sync_error'),
    };
  }

  setOfflineMode(offline: boolean): LocalSidecarState {
    this.assertOpen();
    this.offlineMode = offline;
    this.setMeta('offline_mode', offline ? 'true' : 'false', new Date().toISOString());
    return this.getState();
  }

  enqueuePcwEnvelope(input: EnqueuePcwEnvelopeInput): PcwSyncEnvelope {
    this.assertOpen();
    validatePositiveInt(input.companyId, 'companyId');
    validatePositiveInt(input.workContractId, 'workContractId');
    validatePositiveInt(input.agentId, 'agentId');
    if (!input.agentRunId.trim() || !input.correlationId.trim()) {
      throw new ValidationError('agentRunId and correlationId are required');
    }
    if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken < 0) {
      throw new ValidationError('fencingToken must be a non-negative integer');
    }
    validateArtifacts(input.artifacts);

    const envelopeId = input.envelopeId ?? randomUUID();
    const modelName: PcwOutboxModelName = input.modelName ?? 'ai.agent_run';
    const envelopeSha256 = computeEnvelopeSha256({
      envelopeId,
      companyId: input.companyId,
      workContractId: input.workContractId,
      agentRunId: input.agentRunId,
      agentId: input.agentId,
      correlationId: input.correlationId,
      modelName,
      fencingToken: input.fencingToken,
      runStatus: input.runStatus,
      artifacts: input.artifacts,
    });

    const existing = this.db
      .prepare('SELECT * FROM desktop_pcw_outbox WHERE envelope_id = ?')
      .get(envelopeId) as unknown as OutboxRow | undefined;

    if (existing) {
      if (existing.envelope_sha256 !== envelopeSha256) {
        throw new ConcurrencyConflictError(
          `PCW envelope '${envelopeId}' already exists with a different SHA-256 digest`
        );
      }
      return this.rowToEnvelope(existing);
    }

    const currentRun = this.db
      .prepare('SELECT fencing_token FROM desktop_local_runs WHERE agent_run_id = ?')
      .get(input.agentRunId) as unknown as RunFencingRow | undefined;

    if (currentRun && input.fencingToken < currentRun.fencing_token) {
      throw new ConcurrencyConflictError(
        `Stale fencing token ${input.fencingToken} for run '${input.agentRunId}' (current: ${currentRun.fencing_token})`
      );
    }

    const now = new Date().toISOString();
    const artifactsJson = JSON.stringify(input.artifacts);
    const checkpointJson = input.checkpoint ? JSON.stringify(input.checkpoint) : null;

    this.runInTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO desktop_local_runs (
            agent_run_id, company_id, work_contract_id, agent_id, correlation_id,
            run_status, fencing_token, worktree_lease_id, checkpoint_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(agent_run_id) DO UPDATE SET
            run_status = excluded.run_status,
            fencing_token = excluded.fencing_token,
            worktree_lease_id = COALESCE(excluded.worktree_lease_id, desktop_local_runs.worktree_lease_id),
            checkpoint_json = COALESCE(excluded.checkpoint_json, desktop_local_runs.checkpoint_json),
            updated_at = excluded.updated_at`
        )
        .run(
          input.agentRunId,
          input.companyId,
          input.workContractId,
          input.agentId,
          input.correlationId,
          input.runStatus,
          input.fencingToken,
          input.worktreeLeaseId ?? null,
          checkpointJson,
          now
        );

      this.db
        .prepare(
          `INSERT INTO desktop_pcw_outbox (
            envelope_id, company_id, work_contract_id, agent_run_id, agent_id,
            correlation_id, model_name, fencing_token, run_status, artifacts_json,
            envelope_sha256, sync_status, attempts, created_at, synced_at, upstream_record_id, last_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL)`
        )
        .run(
          envelopeId,
          input.companyId,
          input.workContractId,
          input.agentRunId,
          input.agentId,
          input.correlationId,
          modelName,
          input.fencingToken,
          input.runStatus,
          artifactsJson,
          envelopeSha256,
          now
        );

      const insertArtifact = this.db.prepare(
        `INSERT INTO desktop_pcw_artifacts (
          storage_key, envelope_id, artifact_kind, sha256, size_bytes, mime_type,
          data_classification, source_sha, relative_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const artifact of input.artifacts) {
        insertArtifact.run(
          artifact.storageKey,
          envelopeId,
          artifact.artifactKind,
          artifact.sha256,
          artifact.sizeBytes,
          artifact.mimeType,
          artifact.dataClassification,
          artifact.sourceSha ?? null,
          artifact.relativePath ?? null,
          now
        );
      }
    });

    return this.getEnvelope(envelopeId);
  }

  getEnvelope(envelopeId: string): PcwSyncEnvelope {
    this.assertOpen();
    const row = this.db
      .prepare('SELECT * FROM desktop_pcw_outbox WHERE envelope_id = ?')
      .get(envelopeId) as unknown as OutboxRow | undefined;
    if (!row) {
      throw new NotFoundError(`PCW envelope '${envelopeId}' not found`);
    }
    return this.rowToEnvelope(row);
  }

  listEnvelopes(domain: Domain = []): readonly PcwSyncEnvelope[] {
    this.assertOpen();
    const { sqlWhere, params } = compileSimpleDomain(domain);
    const sql = `SELECT * FROM desktop_pcw_outbox${sqlWhere} ORDER BY created_at ASC, rowid ASC`;
    const rows = this.db.prepare(sql).all(...params) as unknown as OutboxRow[];
    return rows.map((row) => this.rowToEnvelope(row));
  }

  verifyEnvelopeIntegrity(envelopeId: string): boolean {
    const envelope = this.getEnvelope(envelopeId);
    const expected = computeEnvelopeSha256({
      envelopeId: envelope.envelopeId,
      companyId: envelope.companyId,
      workContractId: envelope.workContractId,
      agentRunId: envelope.agentRunId,
      agentId: envelope.agentId,
      correlationId: envelope.correlationId,
      modelName: envelope.modelName,
      fencingToken: envelope.fencingToken,
      runStatus: envelope.runStatus,
      artifacts: envelope.artifacts,
    });
    return expected === envelope.envelopeSha256;
  }

  async syncPending(transport: UpstreamPcwSyncTransport): Promise<PcwSyncBatchResult> {
    this.assertOpen();
    if (this.offlineMode) {
      return {
        attempted: 0,
        synced: 0,
        failed: 0,
        conflicts: 0,
        skippedOffline: true,
        results: [],
      };
    }

    const pendingRows = this.db
      .prepare(
        "SELECT * FROM desktop_pcw_outbox WHERE sync_status IN ('pending', 'failed') ORDER BY created_at ASC, rowid ASC"
      )
      .all() as unknown as OutboxRow[];

    let synced = 0;
    let failed = 0;
    let conflicts = 0;
    const results: Array<{
      readonly envelopeId: string;
      readonly outcome: 'synced' | 'conflict' | 'retryable_error';
      readonly upstreamRecordId: number | null;
      readonly error: string | null;
    }> = [];

    for (const row of pendingRows) {
      const envelope = this.rowToEnvelope(row);
      const integrityValid = this.verifyEnvelopeIntegrity(envelope.envelopeId);
      if (!integrityValid) {
        const message = 'Local PCW envelope SHA-256 integrity check failed';
        this.db
          .prepare(
            "UPDATE desktop_pcw_outbox SET sync_status = 'conflict', attempts = attempts + 1, last_error = ? WHERE envelope_id = ?"
          )
          .run(message, envelope.envelopeId);
        conflicts += 1;
        this.setMeta('last_sync_error', message, new Date().toISOString());
        results.push({
          envelopeId: envelope.envelopeId,
          outcome: 'conflict',
          upstreamRecordId: null,
          error: message,
        });
        continue;
      }

      this.db
        .prepare("UPDATE desktop_pcw_outbox SET sync_status = 'processing' WHERE envelope_id = ?")
        .run(envelope.envelopeId);

      try {
        const outcome = await transport.pushEnvelope(envelope);
        const now = new Date().toISOString();

        if (outcome.outcome === 'synced') {
          this.db
            .prepare(
              `UPDATE desktop_pcw_outbox
               SET sync_status = 'synced', attempts = attempts + 1, synced_at = ?,
                   upstream_record_id = ?, last_error = NULL
               WHERE envelope_id = ?`
            )
            .run(now, outcome.upstreamRecordId ?? null, envelope.envelopeId);
          this.setMeta('last_sync_at', now, now);
          synced += 1;
          results.push({
            envelopeId: envelope.envelopeId,
            outcome: 'synced',
            upstreamRecordId: outcome.upstreamRecordId ?? null,
            error: null,
          });
        } else if (outcome.outcome === 'conflict') {
          const message = redactSensitiveText(
            outcome.message ?? 'Upstream fencing or idempotency conflict',
            this.knownSecrets
          ).text;
          this.db
            .prepare(
              `UPDATE desktop_pcw_outbox
               SET sync_status = 'conflict', attempts = attempts + 1, last_error = ?
               WHERE envelope_id = ?`
            )
            .run(message, envelope.envelopeId);
          this.setMeta('last_sync_error', message, now);
          conflicts += 1;
          results.push({
            envelopeId: envelope.envelopeId,
            outcome: 'conflict',
            upstreamRecordId: null,
            error: message,
          });
        } else {
          const message = redactSensitiveText(
            outcome.message ?? 'Upstream sync failed with retryable error',
            this.knownSecrets
          ).text;
          this.db
            .prepare(
              `UPDATE desktop_pcw_outbox
               SET sync_status = 'failed', attempts = attempts + 1, last_error = ?
               WHERE envelope_id = ?`
            )
            .run(message, envelope.envelopeId);
          this.setMeta('last_sync_error', message, now);
          failed += 1;
          results.push({
            envelopeId: envelope.envelopeId,
            outcome: 'retryable_error',
            upstreamRecordId: null,
            error: message,
          });
        }
      } catch (error) {
        const now = new Date().toISOString();
        const rawMessage = error instanceof Error ? error.message : String(error);
        const message = redactSensitiveText(rawMessage, this.knownSecrets).text;
        this.db
          .prepare(
            `UPDATE desktop_pcw_outbox
             SET sync_status = 'failed', attempts = attempts + 1, last_error = ?
             WHERE envelope_id = ?`
          )
          .run(message, envelope.envelopeId);
        this.setMeta('last_sync_error', message, now);
        failed += 1;
        results.push({
          envelopeId: envelope.envelopeId,
          outcome: 'retryable_error',
          upstreamRecordId: null,
          error: message,
        });
      }
    }

    return {
      attempted: pendingRows.length,
      synced,
      failed,
      conflicts,
      skippedOffline: false,
      results,
    };
  }

  recordRiskAudit(entry: RiskAuditRecord): void {
    this.assertOpen();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO desktop_risk_audit (
          audit_id, run_id, action, requested_tier, resolved_tier, allowed,
          reason_code, reason, company_id, agent_id, grant_id, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.auditId,
        entry.runId,
        entry.action,
        entry.requestedTier,
        entry.resolvedTier,
        entry.allowed ? 1 : 0,
        entry.reasonCode,
        redactSensitiveText(entry.reason, this.knownSecrets).text,
        entry.companyId,
        entry.agentId,
        entry.grantId,
        entry.timestamp
      );
  }

  getCheckpoint(agentRunId: string): JsonObject | null {
    this.assertOpen();
    const row = this.db
      .prepare('SELECT checkpoint_json FROM desktop_local_runs WHERE agent_run_id = ?')
      .get(agentRunId) as unknown as { checkpoint_json: string | null } | undefined;
    if (!row?.checkpoint_json) return null;
    return JSON.parse(row.checkpoint_json) as JsonObject;
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ValidationError('LocalSidecarController has been closed');
    }
  }

  private runInTransaction(work: () => void): void {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      work();
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  private getMeta(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM desktop_sidecar_meta WHERE key = ?')
      .get(key) as unknown as MetaRow | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO desktop_sidecar_meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, updatedAt);
  }

  private setMetaIfMissing(key: string, value: string, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO desktop_sidecar_meta (key, value, updated_at) VALUES (?, ?, ?)`
      )
      .run(key, value, updatedAt);
  }

  private rowToEnvelope(row: OutboxRow): PcwSyncEnvelope {
    return {
      envelopeId: row.envelope_id,
      companyId: row.company_id,
      workContractId: row.work_contract_id,
      agentRunId: row.agent_run_id,
      agentId: row.agent_id,
      correlationId: row.correlation_id,
      modelName: row.model_name,
      fencingToken: row.fencing_token,
      runStatus: row.run_status,
      artifacts: JSON.parse(row.artifacts_json) as PcwArtifactDigest[],
      envelopeSha256: row.envelope_sha256,
      syncStatus: row.sync_status,
      attempts: row.attempts,
      createdAt: row.created_at,
      syncedAt: row.synced_at,
      upstreamRecordId: row.upstream_record_id,
      lastError: row.last_error,
    };
  }
}

function compileSimpleDomain(domain: Domain): {
  readonly sqlWhere: string;
  readonly params: Array<string | number>;
} {
  if (!domain.length) {
    return { sqlWhere: '', params: [] };
  }
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  for (const item of domain) {
    if (!Array.isArray(item)) {
      throw new ValidationError(
        'Complex logical operators are not supported on local sidecar query'
      );
    }
    const leaf = item as DomainLeaf;
    const field = leaf[0];
    if (!ALLOWED_DOMAIN_FIELDS.has(field)) {
      throw new ValidationError(`Unsupported sidecar outbox query field: '${field}'`);
    }
    const operator = leaf.length === 2 ? '=' : leaf[1];
    const value = leaf.length === 2 ? leaf[1] : leaf[2];
    if (operator !== '=' && operator !== '!=') {
      throw new ValidationError(`Unsupported sidecar outbox operator: '${operator}'`);
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new ValidationError(
        `Sidecar outbox query value for '${field}' must be string or number`
      );
    }
    clauses.push(`${field} ${operator} ?`);
    params.push(value);
  }

  return {
    sqlWhere: ` WHERE ${clauses.join(' AND ')}`,
    params,
  };
}
