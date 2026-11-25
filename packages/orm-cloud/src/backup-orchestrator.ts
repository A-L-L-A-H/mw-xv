import { createHash, randomUUID } from 'node:crypto';
import { assertNonEmpty } from '@moonwitness/types';
import {
  buildChunkManifest,
  encryptArtifactEnvelope,
  verifyChunkManifest,
  type ChunkManifest,
  type EncryptedEnvelope,
} from '@moonwitness/orm-storage';

export type BackupRetentionClass = 'hourly' | 'daily' | 'weekly';
export type BackupSchedule = 'hourly' | 'daily' | 'weekly';
export type BackupVerificationStatus = 'verified' | 'integrity_mismatch';

export interface BackupVaultBinding {
  readonly tenantId: string;
  readonly keyId: string;
  readonly masterKey: Uint8Array;
  readonly artifactIdPrefix?: string;
  readonly chunkSizeBytes?: number;
}

export interface BackupRetentionPolicy {
  readonly hourlyCount: number;
  readonly dailyCount: number;
  readonly weeklyCount: number;
  readonly weeklyAnchorDay?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export interface BackupRetentionDecision {
  readonly artifactId: string;
  readonly retained: boolean;
  readonly reason: 'newest' | 'kept' | 'superseded' | 'expired' | 'outside_policy';
  readonly retentionClass: BackupRetentionClass;
}

export interface BackupRetentionPlan {
  readonly retainedArtifactIds: readonly string[];
  readonly prunedArtifactIds: readonly string[];
  readonly decisions: readonly BackupRetentionDecision[];
  readonly policySha256: string;
}

export interface BackupIntegrityReport {
  readonly status: BackupVerificationStatus;
  readonly verified: boolean;
  readonly manifestDigestSha256: string;
  readonly verifiedChunks: number;
  readonly totalBytes: number;
  readonly errors: readonly string[];
}

export interface BackupRecord {
  readonly artifactId: string;
  readonly tenantId: string;
  readonly databaseName: string;
  readonly schedule: BackupSchedule;
  readonly createdAt: string;
  readonly plaintextBytes: number;
  readonly plaintextSha256: string;
  readonly manifest: ChunkManifest;
  readonly envelope: EncryptedEnvelope;
}

export interface BackupPlanEntry {
  readonly artifactId: string;
  readonly schedule: BackupSchedule;
  readonly createdAt: string;
}

export interface BackupExecutionResult {
  readonly record: BackupRecord;
  readonly integrity: BackupIntegrityReport;
  readonly retention: BackupRetentionPlan;
  readonly orchestrationSha256: string;
}

export interface BackupArtifactStore {
  put(
    artifactId: string,
    data: { readonly envelope: EncryptedEnvelope; readonly manifest: ChunkManifest }
  ): Promise<void> | void;
  get(
    artifactId: string
  ): Promise<
    { readonly envelope: EncryptedEnvelope; readonly manifest: ChunkManifest } | undefined
  >;
  list(): Promise<readonly BackupPlanEntry[]> | readonly BackupPlanEntry[];
  delete(artifactId: string): Promise<void> | void;
}

export interface BackupPostgresDumpGateway {
  dump(options: {
    readonly databaseName: string;
    readonly env: Readonly<Record<string, string>>;
  }): Promise<Buffer> | Buffer;
}

const DEFAULT_RETENTION_POLICY: BackupRetentionPolicy = Object.freeze({
  hourlyCount: 24,
  dailyCount: 30,
  weeklyCount: 8,
  weeklyAnchorDay: 0,
});

const BACKUP_ARTIFACT_CONTENT_TYPE = 'application/vnd.moonwitness.postgres-backup.v1';
const HEX_256 = /^[a-f0-9]{64}$/u;
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function assertRetentionPolicy(policy: BackupRetentionPolicy): void {
  for (const value of [policy.hourlyCount, policy.dailyCount, policy.weeklyCount]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('Retention counts must be positive safe integers');
    }
  }
  if (
    policy.weeklyAnchorDay !== undefined &&
    (!Number.isInteger(policy.weeklyAnchorDay) ||
      policy.weeklyAnchorDay < 0 ||
      policy.weeklyAnchorDay > 6)
  ) {
    throw new Error('weeklyAnchorDay must be an integer between 0 and 6');
  }
}

function assertBackupTimestamp(timestamp: string): Date {
  const parsed = new Date(timestamp);
  if (
    !ISO_8601_UTC.test(timestamp) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== timestamp
  ) {
    throw new Error(`Backup createdAt must be a canonical ISO-8601 UTC timestamp: ${timestamp}`);
  }
  return parsed;
}

function startOfUtcDay(timestamp: string): number {
  const parsed = assertBackupTimestamp(timestamp);
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed.getTime();
}

function weeklyBucketStartMs(timestamp: string, anchorDay: number): number {
  const dayStart = startOfUtcDay(timestamp);
  const weekday = new Date(dayStart).getUTCDay();
  const daysSinceAnchor = (weekday - anchorDay + 7) % 7;
  return dayStart - daysSinceAnchor * 86_400_000;
}

function canonicalPolicySha256(policy: BackupRetentionPolicy): string {
  const canonical = JSON.stringify({
    hourlyCount: policy.hourlyCount,
    dailyCount: policy.dailyCount,
    weeklyCount: policy.weeklyCount,
    weeklyAnchorDay: policy.weeklyAnchorDay ?? DEFAULT_RETENTION_POLICY.weeklyAnchorDay,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function compareByNewestThenId(a: BackupPlanEntry, b: BackupPlanEntry): number {
  const timeDelta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (timeDelta !== 0) return timeDelta;
  return a.artifactId.localeCompare(b.artifactId);
}

function canonicalEnvelopeDigest(envelope: EncryptedEnvelope): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        alg: envelope.alg,
        version: envelope.version,
        keyId: envelope.keyId,
        tenantId: envelope.tenantId,
        artifactId: envelope.artifactId ?? null,
        ivBase64: envelope.ivBase64,
        authTagBase64: envelope.authTagBase64,
        ciphertextBase64: envelope.ciphertextBase64,
        encryptedDekBase64: envelope.encryptedDekBase64 ?? null,
        dekIvBase64: envelope.dekIvBase64 ?? null,
        dekAuthTagBase64: envelope.dekAuthTagBase64 ?? null,
      })
    )
    .digest('hex');
}

function canonicalCanonicalDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function planRetentionRotation(
  entries: readonly BackupPlanEntry[],
  policy: BackupRetentionPolicy = DEFAULT_RETENTION_POLICY
): BackupRetentionPlan {
  assertRetentionPolicy(policy);

  const normalized = entries.map((entry) => {
    assertNonEmpty(entry.artifactId, 'artifactId');
    assertBackupTimestamp(entry.createdAt);
    return { artifactId: entry.artifactId, schedule: entry.schedule, createdAt: entry.createdAt };
  });

  const seen = new Set<string>();
  for (const entry of normalized) {
    if (seen.has(entry.artifactId)) {
      throw new Error(`Duplicate backup artifactId in retention input: ${entry.artifactId}`);
    }
    seen.add(entry.artifactId);
  }

  const sorted = [...normalized].sort(compareByNewestThenId);
  const reasonById = new Map<string, BackupRetentionDecision['reason']>();
  const claim = (
    schedule: BackupSchedule,
    bucketOf: (entry: BackupPlanEntry) => string,
    keepCount: number,
    reason: BackupRetentionDecision['reason']
  ): void => {
    const buckets = new Set<string>();
    let kept = 0;
    for (const entry of sorted) {
      if (entry.schedule !== schedule || kept >= keepCount) continue;
      const bucket = bucketOf(entry);
      if (buckets.has(bucket)) continue;
      buckets.add(bucket);
      reasonById.set(entry.artifactId, reason);
      kept += 1;
    }
  };

  const anchorDay: number = policy.weeklyAnchorDay ?? 0;
  claim('hourly', (entry) => entry.createdAt.slice(0, 13), policy.hourlyCount, 'kept');
  claim('daily', (entry) => startOfUtcDay(entry.createdAt).toString(), policy.dailyCount, 'kept');
  claim(
    'weekly',
    (entry) => weeklyBucketStartMs(entry.createdAt, anchorDay).toString(),
    policy.weeklyCount,
    'kept'
  );

  const referenceMs = sorted.length > 0 ? Date.parse(sorted[0]!.createdAt) : 0;
  const decisions = sorted.map((entry, index): BackupRetentionDecision => {
    const retainedReason = reasonById.get(entry.artifactId);
    let reason: BackupRetentionDecision['reason'];
    if (retainedReason === 'kept') {
      reason = index === 0 ? 'newest' : 'kept';
    } else {
      const ageHours = (referenceMs - Date.parse(entry.createdAt)) / 3_600_000;
      reason = ageHours > 168 ? 'expired' : 'superseded';
    }
    return {
      artifactId: entry.artifactId,
      retained: retainedReason !== undefined,
      reason,
      retentionClass:
        entry.schedule === 'hourly' ? 'hourly' : entry.schedule === 'daily' ? 'daily' : 'weekly',
    };
  });

  return {
    retainedArtifactIds: decisions
      .filter((decision) => decision.retained)
      .map((decision) => decision.artifactId),
    prunedArtifactIds: decisions
      .filter((decision) => !decision.retained)
      .map((decision) => decision.artifactId)
      .sort((a, b) => a.localeCompare(b)),
    decisions,
    policySha256: canonicalPolicySha256(policy),
  };
}

export async function verifyBackupIntegrity(
  manifest: ChunkManifest,
  resolveChunk: (
    sha256: string
  ) => Buffer | Uint8Array | undefined | Promise<Buffer | Uint8Array | undefined>
): Promise<BackupIntegrityReport> {
  const verification = await verifyChunkManifest(manifest, resolveChunk);
  const canonicalManifest = JSON.stringify({
    version: manifest.version,
    tenantId: manifest.tenantId,
    contentType: manifest.contentType ?? null,
    chunkSize: manifest.chunkSize,
    totalBytes: manifest.totalBytes,
    rootSha256: manifest.rootSha256,
    chunks: manifest.chunks.map((chunk) => ({
      index: chunk.index,
      sha256: chunk.sha256,
      sizeBytes: chunk.sizeBytes,
    })),
  });

  return {
    status: verification.valid ? 'verified' : 'integrity_mismatch',
    verified: verification.valid,
    manifestDigestSha256: canonicalCanonicalDigest(canonicalManifest),
    verifiedChunks: verification.verifiedChunks,
    totalBytes: verification.totalBytes,
    errors: verification.errors,
  };
}

export interface OrchestrateEncryptedBackupInput {
  readonly databaseName: string;
  readonly schedule: BackupSchedule;
  readonly createdAt?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly vault: BackupVaultBinding;
  readonly store: BackupArtifactStore;
  readonly dumpGateway: BackupPostgresDumpGateway;
  readonly policy?: BackupRetentionPolicy;
}

export async function orchestrateEncryptedBackup(
  input: OrchestrateEncryptedBackupInput
): Promise<BackupExecutionResult> {
  assertNonEmpty(input.databaseName, 'databaseName');
  assertNonEmpty(input.vault.tenantId, 'vault.tenantId');
  assertNonEmpty(input.vault.keyId, 'vault.keyId');
  if (input.vault.masterKey.byteLength !== 32) {
    throw new Error('vault.masterKey must be exactly 32 bytes (256 bits)');
  }
  if (input.vault.chunkSizeBytes !== undefined) {
    if (!Number.isSafeInteger(input.vault.chunkSizeBytes) || input.vault.chunkSizeBytes < 1) {
      throw new Error('vault.chunkSizeBytes must be a positive safe integer');
    }
  }

  const policy = input.policy ?? DEFAULT_RETENTION_POLICY;
  const createdAt = input.createdAt ?? new Date().toISOString();
  assertBackupTimestamp(createdAt);
  const artifactId = `${input.vault.artifactIdPrefix ?? 'pg-backup'}-${createdAt.replace(/[-:.TZ]/gu, '')}-${randomUUID()}`;
  const env = input.env ?? {};
  for (const [key, value] of Object.entries(env)) {
    assertNonEmpty(key, 'backup environment variable name');
    if (typeof value !== 'string') {
      throw new Error(`Backup environment variable ${key} must be a string`);
    }
  }

  const dump = await input.dumpGateway.dump({ databaseName: input.databaseName, env });
  const plaintext = Buffer.from(dump);
  if (plaintext.byteLength === 0) {
    throw new Error('PostgreSQL dump gateway returned an empty backup');
  }
  const plaintextSha256 = createHash('sha256').update(plaintext).digest('hex');

  const { manifest, chunkStore } = buildChunkManifest(plaintext, {
    tenantId: input.vault.tenantId,
    ...(input.vault.chunkSizeBytes !== undefined ? { chunkSize: input.vault.chunkSizeBytes } : {}),
    contentType: BACKUP_ARTIFACT_CONTENT_TYPE,
  });

  const envelope = encryptArtifactEnvelope(plaintext, {
    keyId: input.vault.keyId,
    tenantId: input.vault.tenantId,
    artifactId,
    masterKey: input.vault.masterKey,
  });

  if (!HEX_256.test(plaintextSha256) || !HEX_256.test(manifest.rootSha256)) {
    throw new Error('Backup SHA-256 digests failed canonical validation');
  }
  if (envelope.version !== 1 || envelope.alg !== 'aes-256-gcm') {
    throw new Error('Backup envelope does not conform to orm-storage AES-256-GCM vault spec');
  }
  if (
    envelope.tenantId !== input.vault.tenantId ||
    envelope.keyId !== input.vault.keyId ||
    envelope.artifactId !== artifactId ||
    envelope.encryptedDekBase64 === undefined ||
    envelope.dekIvBase64 === undefined ||
    envelope.dekAuthTagBase64 === undefined
  ) {
    throw new Error('Backup envelope metadata is not bound to the configured orm-storage vault');
  }
  const envelopeSha256 = canonicalEnvelopeDigest(envelope);

  await input.store.put(artifactId, { envelope, manifest });

  const integrity = await verifyBackupIntegrity(manifest, (sha256) => chunkStore.get(sha256));
  if (!integrity.verified) {
    throw new Error(`Backup integrity verification failed: ${integrity.errors.join('; ')}`);
  }

  const entries = await input.store.list();
  const entriesWithCurrent = entries.some((entry) => entry.artifactId === artifactId)
    ? entries
    : [...entries, { artifactId, schedule: input.schedule, createdAt }];
  const retention = planRetentionRotation(entriesWithCurrent, policy);
  for (const prunedArtifactId of retention.prunedArtifactIds) {
    await input.store.delete(prunedArtifactId);
  }

  const record: BackupRecord = {
    artifactId,
    tenantId: input.vault.tenantId,
    databaseName: input.databaseName,
    schedule: input.schedule,
    createdAt,
    plaintextBytes: plaintext.byteLength,
    plaintextSha256,
    manifest,
    envelope,
  };

  const orchestrationSha256 = createHash('sha256')
    .update(
      JSON.stringify({
        manifestDigestSha256: integrity.manifestDigestSha256,
        envelopeSha256,
        plaintextSha256,
        retentionPolicySha256: retention.policySha256,
        artifactId,
      })
    )
    .digest('hex');

  return { record, integrity, retention, orchestrationSha256 };
}
