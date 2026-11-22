import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { jobsManifest } from '@moonwitness/jobs';
import {
  Environment,
  Registry,
  ServiceContainer,
  createServiceToken,
  installAddons,
  registerAddons,
  type Addon,
} from '@moonwitness/orm';
import { manifest as aiManifest } from '@moonwitness/orm-ai';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as knowledgeManifest } from '@moonwitness/orm-knowledge';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { LocalFileAttachmentStorage, manifest as storageManifest } from '@moonwitness/orm-storage';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  AccessDeniedError,
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
  OrphanAttachmentGcOptions,
  OrphanAttachmentGcResult,
  PcwArtifactDigest,
  PcwArtifactKind,
  PcwOutboxModelName,
  PcwSyncBatchResult,
  PcwSyncEnvelope,
  PcwSyncStatus,
  RiskAuditRecord,
  SingleWriterLockMetadata,
  SqliteRecordSchema,
  UpstreamPcwSyncTransport,
} from './types.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_REGEX = /^[a-f0-9]{64}$/u;
const SCHEMA_VERSION = 1;

export const DESKTOP_ADDONS: readonly Addon[] = Object.freeze([
  baseManifest,
  organizationManifest,
  jobsManifest,
  notificationManifest,
  workflowManifest,
  storageManifest,
  knowledgeManifest,
  aiManifest,
]);

/**
 * Dual-dialect SQLite / Postgres column normalization helpers (DSK-2.8).
 * Ensures ISO-8601 UTC timestamps, 0/1 booleans, and JSON payloads normalize
 * identically between local `better-sqlite3` and upstream PostgreSQL.
 */
export function toIsoUtcTimestamp(value: string | number | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ValidationError('Invalid Date value for ISO-8601 UTC timestamp');
    }
    return value.toISOString();
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError(`Invalid numeric timestamp: ${value}`);
    }
    return parsed.toISOString();
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Normalize SQLite CURRENT_TIMESTAMP format ("YYYY-MM-DD HH:MM:SS") to UTC ISO-8601.
  const normalizedInput = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const parsed = new Date(normalizedInput);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Invalid timestamp string: '${value}'`);
  }
  return parsed.toISOString();
}

export function toSqliteBoolean(value: boolean | number | null | undefined): 0 | 1 | null {
  if (value === null || value === undefined) return null;
  return value === true || value === 1 ? 1 : 0;
}

export function fromSqliteBoolean(value: boolean | number | string | null | undefined): boolean {
  if (value === true || value === 1 || value === '1' || value === 'true') {
    return true;
  }
  return false;
}

export function serializeSqliteJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

export function deserializeSqliteJson<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }
  return value as T;
}

export function normalizeSqliteRecord<T extends Record<string, unknown>>(
  row: Readonly<Record<string, unknown>>,
  schema: SqliteRecordSchema
): T {
  const normalized: Record<string, unknown> = { ...row };
  for (const [column, kind] of Object.entries(schema)) {
    if (!Object.hasOwn(row, column)) continue;
    const raw = row[column];
    if (raw === null || raw === undefined) {
      normalized[column] = null;
      continue;
    }
    switch (kind) {
      case 'boolean':
        normalized[column] = fromSqliteBoolean(raw as boolean | number | string);
        break;
      case 'timestamp':
        normalized[column] = toIsoUtcTimestamp(raw as string | number | Date);
        break;
      case 'json':
        normalized[column] = deserializeSqliteJson(raw);
        break;
      case 'integer':
        normalized[column] = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
        break;
      case 'text':
        normalized[column] = String(raw);
        break;
    }
  }
  return normalized as T;
}

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

export function resolveDesktopHomeDir(overrideHomeDir?: string): string {
  const raw = overrideHomeDir ?? process.env.MW_DESKTOP_HOME;
  if (raw && raw.trim()) {
    return path.resolve(raw.trim());
  }
  return path.join(os.homedir(), '.moonwitness');
}

export function resolveDesktopDatabasePath(sqlitePath?: string, overrideHomeDir?: string): string {
  if (!sqlitePath || sqlitePath === '~/.moonwitness/local.db') {
    return path.join(resolveDesktopHomeDir(overrideHomeDir), 'local.db');
  }
  if (sqlitePath === ':memory:') {
    return ':memory:';
  }
  if (sqlitePath.startsWith('~/') || sqlitePath.startsWith('~\\')) {
    return path.join(os.homedir(), sqlitePath.slice(2));
  }
  return path.resolve(sqlitePath);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code === 'EPERM';
  }
}

export function acquireSingleWriterLock(
  sqlitePath: string,
  options?: {
    readonly pid?: number;
    readonly isPidAlive?: (pid: number) => boolean;
    readonly staleLockAgeMs?: number;
  }
): SingleWriterLockMetadata {
  const lockPath = `${sqlitePath}.lock`;
  mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
  const currentPid = options?.pid ?? process.pid;
  const checkAlive = options?.isPidAlive ?? isProcessAlive;
  const staleAgeMs = options?.staleLockAgeMs ?? 86_400_000;
  const nowMs = Date.now();
  const metadata: SingleWriterLockMetadata = {
    pid: currentPid,
    startedAt: new Date(nowMs).toISOString(),
    startTimeMs: nowMs,
    host: os.hostname(),
    sqlitePath,
    lockPath,
  };

  const tryCreate = (): boolean => {
    try {
      writeFileSync(lockPath, JSON.stringify(metadata, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
      });
      return true;
    } catch {
      return false;
    }
  };

  if (tryCreate()) {
    return metadata;
  }

  let existing: SingleWriterLockMetadata | null;
  try {
    existing = JSON.parse(readFileSync(lockPath, 'utf8')) as SingleWriterLockMetadata;
  } catch {
    existing = null;
  }

  if (existing && Number.isSafeInteger(existing.pid) && existing.pid > 0) {
    const alive = checkAlive(existing.pid);
    const expired =
      typeof existing.startTimeMs === 'number' &&
      Number.isFinite(existing.startTimeMs) &&
      nowMs - existing.startTimeMs > staleAgeMs;
    if (alive && !expired) {
      throw new ConcurrencyConflictError(
        `Single-writer SQLite lock '${lockPath}' is already held by active PID ${existing.pid}`
      );
    }
  }

  rmSync(lockPath, { force: true });
  if (!tryCreate()) {
    throw new ConcurrencyConflictError(`Failed to acquire single-writer SQLite lock '${lockPath}'`);
  }
  return metadata;
}

export function releaseSingleWriterLock(lock: SingleWriterLockMetadata | null): void {
  if (!lock || !existsSync(lock.lockPath)) return;
  try {
    const current = JSON.parse(readFileSync(lock.lockPath, 'utf8')) as SingleWriterLockMetadata;
    if (current.pid === lock.pid && current.startTimeMs === lock.startTimeMs) {
      rmSync(lock.lockPath, { force: true });
    }
  } catch {
    rmSync(lock.lockPath, { force: true });
  }
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

export interface DesktopDatabaseBackupResult {
  readonly backupId: string;
  readonly backupPath: string;
  readonly manifestPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly schemaVersion: number;
  readonly installedAddons: readonly string[];
  readonly createdAt: string;
  readonly compatibleWithAddonUpgrade: true;
}

export function resolveDesktopBackupsDir(desktopHomeDir?: string): string {
  return path.join(resolveDesktopHomeDir(desktopHomeDir), 'backups');
}

export interface LocalSidecarControllerOptions {
  readonly sqlitePath?: string;
  readonly desktopHomeDir?: string;
  readonly offlineMode?: boolean;
  readonly activeCompanyId?: number | null;
  readonly knownSecrets?: readonly string[];
  readonly lockOptions?: {
    readonly pid?: number;
    readonly isPidAlive?: (pid: number) => boolean;
    readonly staleLockAgeMs?: number;
  };
}

export class LocalSidecarController {
  readonly sqlitePath: string;
  readonly desktopHomeDir: string;
  readonly storageDir: string;
  readonly attachmentStorage: LocalFileAttachmentStorage;
  private readonly db: DatabaseSync;
  private readonly knownSecrets: readonly string[];
  private lockMetadata: SingleWriterLockMetadata | null = null;
  private ormKnex: Knex | null = null;
  private installedAddonNames: readonly string[] = [];
  private activeCompanyId: number | null;
  private offlineMode: boolean;
  private closed = false;

  constructor(options: LocalSidecarControllerOptions = {}) {
    this.desktopHomeDir = resolveDesktopHomeDir(options.desktopHomeDir);
    this.sqlitePath = resolveDesktopDatabasePath(options.sqlitePath, options.desktopHomeDir);
    this.storageDir = path.join(this.desktopHomeDir, 'storage');
    this.attachmentStorage = new LocalFileAttachmentStorage(this.storageDir);
    this.offlineMode = options.offlineMode ?? false;
    this.activeCompanyId = options.activeCompanyId ?? null;
    this.knownSecrets = options.knownSecrets ?? [];

    if (this.activeCompanyId !== null) {
      validatePositiveInt(this.activeCompanyId, 'activeCompanyId');
    }

    if (this.sqlitePath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(this.sqlitePath)), { recursive: true });
      this.lockMetadata = acquireSingleWriterLock(this.sqlitePath, options.lockOptions);
    }

    try {
      this.db = new DatabaseSync(this.sqlitePath);
      this.initializeSchema();
    } catch (error) {
      releaseSingleWriterLock(this.lockMetadata);
      this.lockMetadata = null;
      throw error;
    }
  }

  private initializeSchema(): void {
    if (this.sqlitePath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
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

      CREATE INDEX IF NOT EXISTS idx_desktop_pcw_outbox_company
        ON desktop_pcw_outbox (company_id, sync_status, created_at);

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

  /**
   * Initialize canonical MoonWitness workspace addons (`DESKTOP_ADDONS`) inside this SQLite sidecar
   * via `better-sqlite3` + `knex` + `@moonwitness/orm` `installAddons`/`registerAddons` (DSK-2.5, DSK-2.7).
   */
  async initializeOrmAddons(addons: readonly Addon[] = DESKTOP_ADDONS): Promise<readonly string[]> {
    this.assertOpen();
    if (!this.ormKnex) {
      const isFileDb = this.sqlitePath !== ':memory:';
      this.ormKnex = knex({
        client: 'better-sqlite3',
        connection: { filename: this.sqlitePath },
        useNullAsDefault: true,
        pool: {
          afterCreate(
            connection: { pragma(sql: string): unknown },
            done: (error: Error | null, connection: unknown) => void
          ) {
            if (isFileDb) {
              connection.pragma('journal_mode = WAL');
              connection.pragma('synchronous = NORMAL');
            }
            connection.pragma('foreign_keys = ON');
            connection.pragma('busy_timeout = 5000');
            done(null, connection);
          },
        },
      });
    }

    Model.knex(this.ormKnex);
    await installAddons(this.ormKnex, addons);
    await registerAddons(this.ormKnex, addons);
    this.installedAddonNames = addons.map((addon) => addon.name);
    this.setMeta(
      'installed_addons',
      JSON.stringify(this.installedAddonNames),
      new Date().toISOString()
    );
    return this.installedAddonNames;
  }

  getOrmKnex(): Knex | null {
    return this.ormKnex;
  }

  createScopedEnvironment(companyId?: number, userId?: number): Environment {
    this.assertOpen();
    const effectiveCompanyId = companyId ?? this.activeCompanyId;
    if (effectiveCompanyId === null || effectiveCompanyId === undefined) {
      throw new AccessDeniedError('Company scope is required to create a sidecar ORM Environment');
    }
    validatePositiveInt(effectiveCompanyId, 'companyId');
    if (this.activeCompanyId !== null && effectiveCompanyId !== this.activeCompanyId) {
      throw new AccessDeniedError(
        `Cross-company sidecar environment rejected: requested company ${effectiveCompanyId} != active session company ${this.activeCompanyId}`
      );
    }
    const services = new ServiceContainer();
    const attachmentStorageToken = createServiceToken('attachmentStorage');
    services.register(attachmentStorageToken, this.attachmentStorage);
    return new Environment(
      {
        companyId: effectiveCompanyId,
        ...(userId !== undefined ? { userId } : {}),
      },
      undefined,
      services
    );
  }

  async queryCompanyAddonRecords(
    modelName: string,
    domain: Domain = [],
    options?: { readonly companyId?: number; readonly fields?: readonly string[] }
  ): Promise<readonly Record<string, unknown>[]> {
    this.assertOpen();
    if (!this.ormKnex) {
      throw new ValidationError(
        'ORM addons have not been initialized; call initializeOrmAddons() first'
      );
    }
    const effectiveCompanyId = this.resolveScopedCompanyId(options?.companyId, true);
    const ModelClass = Registry.get(modelName);
    const hasCompanyField =
      ModelClass.fields !== undefined && Object.hasOwn(ModelClass.fields, 'company');
    const scopedDomain: Domain = hasCompanyField
      ? [['company_id', '=', effectiveCompanyId], ...domain]
      : domain;
    return await ModelClass.search_read(scopedDomain, {
      ...(options?.fields ? { fields: [...options.fields] } : {}),
      context: { companyId: effectiveCompanyId },
    });
  }

  setActiveCompany(companyId: number | null): LocalSidecarState {
    this.assertOpen();
    if (companyId !== null) {
      validatePositiveInt(companyId, 'companyId');
    }
    this.activeCompanyId = companyId;
    this.setMeta(
      'active_company_id',
      companyId === null ? '' : String(companyId),
      new Date().toISOString()
    );
    return this.getState();
  }

  getActiveCompany(): number | null {
    return this.activeCompanyId;
  }

  getLockMetadata(): SingleWriterLockMetadata | null {
    return this.lockMetadata;
  }

  getState(): LocalSidecarState {
    if (this.closed) {
      return {
        status: 'stopped',
        sqlitePath: this.sqlitePath,
        schemaVersion: SCHEMA_VERSION,
        offlineMode: this.offlineMode,
        activeCompanyId: this.activeCompanyId,
        installedAddons: this.installedAddonNames,
        lockPath: this.lockMetadata?.lockPath ?? null,
        storageDir: this.storageDir,
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
      if (this.activeCompanyId !== null) {
        const row = this.db
          .prepare(
            'SELECT COUNT(*) AS total FROM desktop_pcw_outbox WHERE sync_status = ? AND company_id = ?'
          )
          .get(status, this.activeCompanyId) as unknown as CountRow | undefined;
        return row?.total ?? 0;
      }
      const row = this.db
        .prepare('SELECT COUNT(*) AS total FROM desktop_pcw_outbox WHERE sync_status = ?')
        .get(status) as unknown as CountRow | undefined;
      return row?.total ?? 0;
    };

    const activeRunRow =
      this.activeCompanyId !== null
        ? (this.db
            .prepare(
              "SELECT COUNT(*) AS total FROM desktop_local_runs WHERE run_status IN ('pending', 'running') AND company_id = ?"
            )
            .get(this.activeCompanyId) as unknown as CountRow | undefined)
        : (this.db
            .prepare(
              "SELECT COUNT(*) AS total FROM desktop_local_runs WHERE run_status IN ('pending', 'running')"
            )
            .get() as unknown as CountRow | undefined);

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
      activeCompanyId: this.activeCompanyId,
      installedAddons: this.installedAddonNames,
      lockPath: this.lockMetadata?.lockPath ?? null,
      storageDir: this.storageDir,
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
    if (this.activeCompanyId !== null && input.companyId !== this.activeCompanyId) {
      throw new AccessDeniedError(
        `Cannot enqueue PCW envelope for company ${input.companyId} while active sidecar session is scoped to company ${this.activeCompanyId}`
      );
    }
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

    const now = toIsoUtcTimestamp(new Date())!;
    const artifactsJson = serializeSqliteJson(input.artifacts)!;
    const checkpointJson = serializeSqliteJson(input.checkpoint ?? null);

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
    if (this.activeCompanyId !== null && row.company_id !== this.activeCompanyId) {
      throw new AccessDeniedError(
        `PCW envelope '${envelopeId}' belongs to another company partition`
      );
    }
    return this.rowToEnvelope(row);
  }

  listEnvelopes(
    domain: Domain = [],
    options?: { readonly companyId?: number }
  ): readonly PcwSyncEnvelope[] {
    this.assertOpen();
    const scopedCompanyId = this.resolveScopedCompanyId(options?.companyId, false);
    const effectiveDomain: Domain =
      scopedCompanyId !== null ? [['company_id', '=', scopedCompanyId], ...domain] : domain;
    const { sqlWhere, params } = compileSimpleDomain(effectiveDomain);
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

    const pendingRows =
      this.activeCompanyId !== null
        ? (this.db
            .prepare(
              "SELECT * FROM desktop_pcw_outbox WHERE sync_status IN ('pending', 'failed') AND company_id = ? ORDER BY created_at ASC, rowid ASC"
            )
            .all(this.activeCompanyId) as unknown as OutboxRow[])
        : (this.db
            .prepare(
              "SELECT * FROM desktop_pcw_outbox WHERE sync_status IN ('pending', 'failed') ORDER BY created_at ASC, rowid ASC"
            )
            .all() as unknown as OutboxRow[]);

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
    const sanitizedReason = redactSensitiveText(entry.reason, this.knownSecrets).text;
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
        toSqliteBoolean(entry.allowed) ?? 0,
        entry.reasonCode,
        sanitizedReason,
        entry.companyId,
        entry.agentId,
        entry.grantId,
        toIsoUtcTimestamp(entry.timestamp) ?? new Date().toISOString()
      );

    // Mirror into ORM base_audit_log when ORM addons are initialized (DSK-6.8 / DSK-8.8).
    try {
      const hasBaseAudit = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'base_audit_log'")
        .get() as { name?: string } | undefined;
      if (hasBaseAudit?.name === 'base_audit_log') {
        this.db
          .prepare(
            `INSERT INTO base_audit_log (
              model, res_id, action, user_id, changes_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            'desktop.risk_audit',
            entry.agentId,
            entry.allowed ? `allow:${entry.action}` : `deny:${entry.action}`,
            entry.agentId,
            JSON.stringify({
              auditId: entry.auditId,
              runId: entry.runId,
              requestedTier: entry.requestedTier,
              resolvedTier: entry.resolvedTier,
              reasonCode: entry.reasonCode,
              reason: sanitizedReason,
              companyId: entry.companyId,
              grantId: entry.grantId,
            }),
            entry.timestamp
          );
      }
    } catch {
      // base_audit_log schema may vary across addon versions; desktop_risk_audit is authoritative.
    }
  }

  listRiskAudits(limit = 200): readonly RiskAuditRecord[] {
    this.assertOpen();
    const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT audit_id, run_id, action, requested_tier, resolved_tier, allowed,
                reason_code, reason, company_id, agent_id, grant_id, timestamp
         FROM desktop_risk_audit
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(boundedLimit) as unknown as Array<{
      audit_id: string;
      run_id: string;
      action: RiskAuditRecord['action'];
      requested_tier: RiskAuditRecord['requestedTier'];
      resolved_tier: RiskAuditRecord['resolvedTier'];
      allowed: number;
      reason_code: string;
      reason: string;
      company_id: number;
      agent_id: number;
      grant_id: string;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      auditId: row.audit_id,
      runId: row.run_id,
      action: row.action,
      requestedTier: row.requested_tier,
      resolvedTier: row.resolved_tier,
      allowed: fromSqliteBoolean(row.allowed),
      reasonCode: row.reason_code,
      reason: row.reason,
      companyId: row.company_id,
      agentId: row.agent_id,
      grantId: row.grant_id,
      timestamp: toIsoUtcTimestamp(row.timestamp) ?? row.timestamp,
    }));
  }

  backupDatabase(options?: {
    readonly backupDir?: string;
    readonly label?: string;
  }): DesktopDatabaseBackupResult {
    this.assertOpen();
    const backupsDir = options?.backupDir ?? resolveDesktopBackupsDir(this.desktopHomeDir);
    mkdirSync(backupsDir, { recursive: true });

    const createdAt = new Date().toISOString();
    const safeLabel = (options?.label ?? 'manual').replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 32);
    const stamp = createdAt.replace(/[:.]/gu, '-');
    const backupId = `${stamp}-${safeLabel}-${randomUUID().slice(0, 8)}`;
    const backupPath = path.join(backupsDir, `local-${backupId}.sqlite`);
    const manifestPath = path.join(backupsDir, `local-${backupId}.manifest.json`);

    // Consistent snapshot via SQLite VACUUM INTO (works for both file-backed and :memory: DBs).
    const escapedPath = backupPath.replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escapedPath}'`);

    const content = readFileSync(backupPath);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const sizeBytes = statSync(backupPath).size;
    const schemaVersion = Number.parseInt(this.getMeta('schema_version') ?? '1', 10) || 1;

    const result: DesktopDatabaseBackupResult = {
      backupId,
      backupPath,
      manifestPath,
      sha256,
      sizeBytes,
      schemaVersion,
      installedAddons: [...this.installedAddonNames],
      createdAt,
      compatibleWithAddonUpgrade: true,
    };

    writeFileSync(manifestPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }

  getCheckpoint(agentRunId: string): JsonObject | null {
    this.assertOpen();
    const row = this.db
      .prepare('SELECT company_id, checkpoint_json FROM desktop_local_runs WHERE agent_run_id = ?')
      .get(agentRunId) as unknown as
      { company_id: number; checkpoint_json: string | null } | undefined;
    if (!row) return null;
    if (this.activeCompanyId !== null && row.company_id !== this.activeCompanyId) {
      throw new AccessDeniedError(`Run '${agentRunId}' belongs to another company partition`);
    }
    if (!row.checkpoint_json) return null;
    return deserializeSqliteJson<JsonObject>(row.checkpoint_json);
  }

  /**
   * Prune orphaned or post-sync expired local attachment blobs under `~/.moonwitness/storage/` (DSK-3.12).
   * Never deletes blobs referenced by pending/processing/failed/conflict envelopes, nor synced envelopes
   * whose `synced_at` timestamp is still within `retentionMs`.
   */
  pruneOrphanAttachmentStorage(options?: OrphanAttachmentGcOptions): OrphanAttachmentGcResult {
    this.assertOpen();
    const retentionMs = options?.retentionMs ?? 7 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(retentionMs) || retentionMs < 0) {
      throw new ValidationError('retentionMs must be a non-negative finite number');
    }
    const nowMs = (options?.now ?? new Date()).getTime();
    const dryRun = options?.dryRun ?? false;

    if (!existsSync(this.storageDir)) {
      return {
        scannedFiles: 0,
        retainedFiles: 0,
        deletedFiles: [],
        freedBytes: 0,
        dryRun,
      };
    }

    const artifactRows = this.db
      .prepare(
        `SELECT a.storage_key, o.sync_status, o.synced_at
         FROM desktop_pcw_artifacts a
         INNER JOIN desktop_pcw_outbox o ON o.envelope_id = a.envelope_id`
      )
      .all() as unknown as Array<{
      storage_key: string;
      sync_status: PcwSyncStatus;
      synced_at: string | null;
    }>;

    const retainedKeys = new Set<string>();
    const expiredSyncedKeys = new Set<string>();
    for (const row of artifactRows) {
      if (row.sync_status !== 'synced') {
        retainedKeys.add(row.storage_key);
        continue;
      }
      const syncedIso = toIsoUtcTimestamp(row.synced_at);
      const syncedMs = syncedIso ? Date.parse(syncedIso) : Number.NaN;
      if (Number.isNaN(syncedMs) || nowMs - syncedMs < retentionMs) {
        retainedKeys.add(row.storage_key);
      } else {
        expiredSyncedKeys.add(row.storage_key);
      }
    }

    const filesToScan: string[] = [];
    const walkDir = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          filesToScan.push(fullPath);
        }
      }
    };
    walkDir(this.storageDir);

    let retainedFiles = 0;
    let freedBytes = 0;
    const deletedFiles: string[] = [];

    for (const fullPath of filesToScan) {
      const relPath = path.relative(this.storageDir, fullPath).replaceAll('\\', '/');
      const baseName = path.basename(fullPath);
      const baseNoExt = path.parse(fullPath).name;

      if (retainedKeys.has(baseName) || retainedKeys.has(baseNoExt) || retainedKeys.has(relPath)) {
        retainedFiles += 1;
        continue;
      }

      const stat = statSync(fullPath);
      const isExpiredSynced =
        expiredSyncedKeys.has(baseName) ||
        expiredSyncedKeys.has(baseNoExt) ||
        expiredSyncedKeys.has(relPath);

      if (!isExpiredSynced && nowMs - stat.mtimeMs < retentionMs) {
        retainedFiles += 1;
        continue;
      }

      deletedFiles.push(relPath);
      freedBytes += stat.size;
      if (!dryRun) {
        rmSync(fullPath, { force: true });
      }
    }

    return {
      scannedFiles: filesToScan.length,
      retainedFiles,
      deletedFiles,
      freedBytes,
      dryRun,
    };
  }

  async closeAsync(): Promise<void> {
    if (this.ormKnex) {
      const knexInstance = this.ormKnex;
      this.ormKnex = null;
      await knexInstance.destroy();
    }
    this.close();
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      if (this.ormKnex) {
        const knexInstance = this.ormKnex;
        this.ormKnex = null;
        void knexInstance.destroy();
      }
      this.db.close();
      releaseSingleWriterLock(this.lockMetadata);
      this.lockMetadata = null;
    }
  }

  private resolveScopedCompanyId(
    requestedCompanyId: number | undefined,
    requireScope: true
  ): number;
  private resolveScopedCompanyId(
    requestedCompanyId: number | undefined,
    requireScope: false
  ): number | null;
  private resolveScopedCompanyId(
    requestedCompanyId: number | undefined,
    requireScope: boolean
  ): number | null {
    if (requestedCompanyId !== undefined) {
      validatePositiveInt(requestedCompanyId, 'companyId');
      if (this.activeCompanyId !== null && requestedCompanyId !== this.activeCompanyId) {
        throw new AccessDeniedError(
          `Cross-company sidecar query rejected: requested company ${requestedCompanyId} != active session company ${this.activeCompanyId}`
        );
      }
      return requestedCompanyId;
    }
    if (this.activeCompanyId !== null) {
      return this.activeCompanyId;
    }
    if (requireScope) {
      throw new AccessDeniedError('Company scope is required for local sidecar query');
    }
    return null;
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
      artifacts: deserializeSqliteJson<PcwArtifactDigest[]>(row.artifacts_json) ?? [],
      envelopeSha256: row.envelope_sha256,
      syncStatus: row.sync_status,
      attempts: row.attempts,
      createdAt: toIsoUtcTimestamp(row.created_at) ?? row.created_at,
      syncedAt: toIsoUtcTimestamp(row.synced_at),
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
