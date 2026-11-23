import { createHash, randomBytes } from 'node:crypto';
import {
  buildChunkManifest,
  decryptArtifactEnvelope,
  type ChunkManifest,
  type EncryptedEnvelope,
} from '@moonwitness/orm-storage';
import { describe, expect, it } from 'vitest';
import {
  orchestrateEncryptedBackup,
  planRetentionRotation,
  verifyBackupIntegrity,
  type BackupArtifactStore,
  type BackupPlanEntry,
  type BackupPostgresDumpGateway,
  type BackupRetentionPolicy,
} from '../src/backup-orchestrator.js';

class MutableBackupArtifactStore implements BackupArtifactStore {
  readonly artifacts = new Map<
    string,
    { readonly envelope: EncryptedEnvelope; readonly manifest: ChunkManifest }
  >();
  readonly entries: BackupPlanEntry[] = [];
  readonly deleted: string[] = [];

  async put(
    artifactId: string,
    artifact: { readonly envelope: EncryptedEnvelope; readonly manifest: ChunkManifest }
  ): Promise<void> {
    this.artifacts.set(artifactId, artifact);
  }

  async get(
    artifactId: string
  ): Promise<
    { readonly envelope: EncryptedEnvelope; readonly manifest: ChunkManifest } | undefined
  > {
    return this.artifacts.get(artifactId);
  }

  async list(): Promise<readonly BackupPlanEntry[]> {
    return this.entries.map((entry) => ({ ...entry }));
  }

  async delete(artifactId: string): Promise<void> {
    this.artifacts.delete(artifactId);
    const index = this.entries.findIndex((entry) => entry.artifactId === artifactId);
    if (index >= 0) this.entries.splice(index, 1);
    this.deleted.push(artifactId);
  }
}

function createDumpGateway(
  payloads: readonly Buffer[],
  expectedEnv?: Readonly<Record<string, string>>
): BackupPostgresDumpGateway {
  let callCount = 0;
  return {
    dump: async ({ databaseName, env }) => {
      expect(databaseName).toBe('moonwitness_production');
      if (expectedEnv) {
        for (const [key, value] of Object.entries(expectedEnv)) {
          expect(env[key]).toBe(value);
        }
      }
      const payload = payloads[Math.min(callCount, payloads.length - 1)]!;
      callCount += 1;
      return Buffer.from(payload);
    },
  };
}

function planEntry(
  artifactId: string,
  schedule: BackupPlanEntry['schedule'],
  createdAt: string
): BackupPlanEntry {
  return { artifactId, schedule, createdAt };
}

const testVault = {
  tenantId: 'tenant-moonwitness-prod',
  keyId: 'kek-backup-2026-q4',
  masterKey: randomBytes(32),
};

describe('planRetentionRotation', () => {
  it('keeps newest per hourly, daily, and weekly buckets and prunes deterministic superseded backups', () => {
    const entries: BackupPlanEntry[] = [
      planEntry('backup-hourly-2026-11-23t10', 'hourly', '2026-11-23T10:05:00.000Z'),
      planEntry('backup-hourly-2026-11-23t09', 'hourly', '2026-11-23T09:05:00.000Z'),
      planEntry('backup-hourly-2026-11-23t09-late', 'hourly', '2026-11-23T09:45:00.000Z'),
      planEntry('backup-daily-2026-11-23', 'daily', '2026-11-23T02:00:00.000Z'),
      planEntry('backup-daily-2026-11-22', 'daily', '2026-11-22T02:00:00.000Z'),
      planEntry('backup-daily-2026-11-22-late', 'daily', '2026-11-22T18:00:00.000Z'),
      planEntry('backup-weekly-2026-11-22', 'weekly', '2026-11-22T03:00:00.000Z'),
      planEntry('backup-weekly-2026-11-15', 'weekly', '2026-11-15T03:00:00.000Z'),
      planEntry('backup-weekly-2026-11-20', 'weekly', '2026-11-20T03:00:00.000Z'),
    ];
    const policy: BackupRetentionPolicy = {
      hourlyCount: 2,
      dailyCount: 2,
      weeklyCount: 2,
      weeklyAnchorDay: 0,
    };

    const plan = planRetentionRotation(entries, policy);

    expect(plan.retainedArtifactIds).toEqual([
      'backup-hourly-2026-11-23t10',
      'backup-hourly-2026-11-23t09-late',
      'backup-daily-2026-11-23',
      'backup-daily-2026-11-22-late',
      'backup-weekly-2026-11-22',
      'backup-weekly-2026-11-20',
    ]);
    expect(plan.prunedArtifactIds).toEqual([
      'backup-daily-2026-11-22',
      'backup-hourly-2026-11-23t09',
      'backup-weekly-2026-11-15',
    ]);
    expect(plan.decisions[0]).toEqual({
      artifactId: 'backup-hourly-2026-11-23t10',
      retained: true,
      reason: 'newest',
      retentionClass: 'hourly',
    });
    expect(
      plan.decisions.find((decision) => decision.artifactId === 'backup-hourly-2026-11-23t09')
        ?.reason
    ).toBe('superseded');
    expect(plan.policySha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('is deterministic for equivalent counts and rejects invalid policy or input', () => {
    const entries: BackupPlanEntry[] = [
      planEntry('backup-valid-01', 'hourly', '2026-11-23T10:00:00.000Z'),
      planEntry('backup-valid-02', 'daily', '2026-11-23T00:00:00.000Z'),
    ];
    const policy: BackupRetentionPolicy = { hourlyCount: 1, dailyCount: 1, weeklyCount: 1 };
    const plan = planRetentionRotation(entries, policy);
    const equivalentPlan = planRetentionRotation(entries, {
      hourlyCount: 1,
      dailyCount: 1,
      weeklyCount: 1,
      weeklyAnchorDay: 0,
    });
    expect(plan).toEqual(equivalentPlan);

    expect(() =>
      planRetentionRotation(entries, { hourlyCount: 0, dailyCount: 1, weeklyCount: 1 })
    ).toThrow('Retention counts must be positive safe integers');
    expect(() =>
      planRetentionRotation(entries, {
        hourlyCount: 1,
        dailyCount: 1,
        weeklyCount: 1,
        weeklyAnchorDay: 7 as 0,
      })
    ).toThrow('weeklyAnchorDay must be an integer between 0 and 6');
    expect(() =>
      planRetentionRotation(
        [
          planEntry('backup-valid-01', 'hourly', '2026-11-23T10:00:00.000Z'),
          planEntry('backup-valid-01', 'daily', '2026-11-22T10:00:00.000Z'),
        ],
        policy
      )
    ).toThrow('Duplicate backup artifactId in retention input');
    expect(() =>
      planRetentionRotation(
        [planEntry('backup-invalid-time', 'hourly', '2026-11-23T10:00:00Z')],
        policy
      )
    ).toThrow('canonical ISO-8601 UTC timestamp');
  });
});

describe('verifyBackupIntegrity', () => {
  it('returns a verified SHA-256 manifest report for intact chunks', async () => {
    const plaintext = Buffer.from('postgres-backup-verification-payload-2026-11-23', 'utf8');
    const { manifest, chunkStore } = buildChunkManifest(plaintext, {
      tenantId: 'tenant-moonwitness-prod',
      chunkSize: 32,
      contentType: 'application/vnd.moonwitness.postgres-backup.v1',
    });

    const report = await verifyBackupIntegrity(manifest, (sha256) => chunkStore.get(sha256));

    expect(report.status).toBe('verified');
    expect(report.verified).toBe(true);
    expect(report.verifiedChunks).toBe(manifest.chunks.length);
    expect(report.totalBytes).toBe(plaintext.byteLength);
    expect(report.manifestDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.errors).toEqual([]);
  });

  it('reports integrity mismatch for corrupted and missing SHA-256 chunks', async () => {
    const plaintext = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
    const first = plaintext.subarray(0, 16);
    const second = plaintext.subarray(16);
    const firstSha = createHash('sha256').update(first).digest('hex');
    const secondSha = createHash('sha256').update(second).digest('hex');
    const rootSha = createHash('sha256')
      .update(`0:${firstSha}:16\n`)
      .update(`1:${secondSha}:16\n`)
      .digest('hex');
    const manifest: ChunkManifest = {
      version: 1,
      tenantId: 'tenant-moonwitness-prod',
      chunkSize: 16,
      totalBytes: plaintext.byteLength,
      rootSha256: rootSha,
      chunks: [
        { index: 0, sha256: firstSha, sizeBytes: 16 },
        { index: 1, sha256: secondSha, sizeBytes: 16 },
      ],
    };

    const corrupted = await verifyBackupIntegrity(manifest, (sha256) =>
      sha256 === firstSha ? Buffer.from('XXXXXXXXXXXXXXXX', 'utf8') : second
    );
    expect(corrupted.status).toBe('integrity_mismatch');
    expect(corrupted.verified).toBe(false);
    expect(corrupted.errors.some((error) => error.includes('digest mismatch'))).toBe(true);

    const missing = await verifyBackupIntegrity(manifest, (sha256) =>
      sha256 === firstSha ? undefined : second
    );
    expect(missing.status).toBe('integrity_mismatch');
    expect(missing.errors.some((error) => error.includes('Missing chunk'))).toBe(true);
  });
});

describe('orchestrateEncryptedBackup', () => {
  it('dumps, encrypts, verifies, stores, rotates, and prunes production backups end to end', async () => {
    const plaintext = Buffer.from(
      '-- MoonWitness production PostgreSQL dump\nCREATE TABLE tenant_ledger (id uuid primary key, amount numeric);\nCOMMIT;\n',
      'utf8'
    );
    const store = new MutableBackupArtifactStore();
    store.entries.push(
      planEntry('backup-hourly-2026-11-23t09', 'hourly', '2026-11-23T09:00:00.000Z'),
      planEntry('backup-daily-2026-11-22', 'daily', '2026-11-22T02:00:00.000Z')
    );
    const policy: BackupRetentionPolicy = {
      hourlyCount: 1,
      dailyCount: 1,
      weeklyCount: 1,
      weeklyAnchorDay: 0,
    };

    const result = await orchestrateEncryptedBackup({
      databaseName: 'moonwitness_production',
      schedule: 'hourly',
      createdAt: '2026-11-23T10:15:00.000Z',
      env: {
        PGHOST: 'db.internal.moonwitness.local',
        PGDATABASE: 'moonwitness_production',
      },
      vault: { ...testVault, artifactIdPrefix: 'pg-prod-backup', chunkSizeBytes: 32 },
      store,
      dumpGateway: createDumpGateway([plaintext], {
        PGHOST: 'db.internal.moonwitness.local',
        PGDATABASE: 'moonwitness_production',
      }),
      policy,
    });

    expect(result.record.artifactId).toMatch(/^pg-prod-backup-20261123101500000-[0-9a-f-]{36}$/u);
    expect(result.record.tenantId).toBe('tenant-moonwitness-prod');
    expect(result.record.databaseName).toBe('moonwitness_production');
    expect(result.record.schedule).toBe('hourly');
    expect(result.record.plaintextSha256).toBe(
      createHash('sha256').update(plaintext).digest('hex')
    );
    expect(result.record.manifest.chunks.length).toBeGreaterThan(1);
    expect(result.integrity.status).toBe('verified');
    expect(result.integrity.totalBytes).toBe(plaintext.byteLength);
    expect(result.retention.retainedArtifactIds).toEqual([
      result.record.artifactId,
      'backup-daily-2026-11-22',
    ]);
    expect(result.retention.prunedArtifactIds).toEqual(['backup-hourly-2026-11-23t09']);
    expect(store.deleted).toEqual(['backup-hourly-2026-11-23t09']);
    expect(store.entries).toEqual([
      planEntry('backup-daily-2026-11-22', 'daily', '2026-11-22T02:00:00.000Z'),
    ]);
    expect(result.orchestrationSha256).toMatch(/^[a-f0-9]{64}$/u);

    const stored = await store.get(result.record.artifactId);
    expect(stored?.manifest).toEqual(result.record.manifest);
    const decrypted = decryptArtifactEnvelope(result.record.envelope, {
      expectedTenantId: testVault.tenantId,
      expectedArtifactId: result.record.artifactId,
      masterKey: testVault.masterKey,
    });
    expect(decrypted.equals(plaintext)).toBe(true);
    expect(result.record.envelope.alg).toBe('aes-256-gcm');
    expect(result.record.envelope.version).toBe(1);
    expect(result.record.envelope.keyId).toBe(testVault.keyId);
    expect(result.record.envelope.encryptedDekBase64).toBeDefined();
  });

  it('uses chained storage listing for retention when a stored artifact is already registered', async () => {
    const plaintext = Buffer.from('incremental-production-backup-payload', 'utf8');
    const store = new MutableBackupArtifactStore();
    let putCount = 0;
    const originalPut = store.put.bind(store);
    store.put = async (artifactId, artifact) => {
      putCount += 1;
      store.entries.push(planEntry(artifactId, 'daily', '2026-11-23T04:00:00.000Z'));
      await originalPut(artifactId, artifact);
    };

    const result = await orchestrateEncryptedBackup({
      databaseName: 'moonwitness_production',
      schedule: 'daily',
      createdAt: '2026-11-23T04:00:00.000Z',
      vault: testVault,
      store,
      dumpGateway: createDumpGateway([plaintext]),
      policy: { hourlyCount: 1, dailyCount: 1, weeklyCount: 1 },
    });

    expect(putCount).toBe(1);
    expect(result.record.artifactId).toMatch(/^pg-backup-20261123040000000-[0-9a-f-]{36}$/u);
    expect(result.retention.retainedArtifactIds).toEqual([result.record.artifactId]);
    expect(result.retention.prunedArtifactIds).toEqual([]);
  });

  it('rejects empty dumps, invalid vault keys, and invalid timestamps before storing artifacts', async () => {
    const store = new MutableBackupArtifactStore();
    const baseInput = {
      databaseName: 'moonwitness_production',
      schedule: 'hourly' as const,
      createdAt: '2026-11-23T10:15:00.000Z',
      vault: testVault,
      store,
      dumpGateway: createDumpGateway([Buffer.alloc(0)]),
    };

    await expect(orchestrateEncryptedBackup(baseInput)).rejects.toThrow('empty backup');
    await expect(
      orchestrateEncryptedBackup({
        ...baseInput,
        dumpGateway: createDumpGateway([Buffer.from('non-empty')]),
        vault: { ...testVault, masterKey: randomBytes(16) },
      })
    ).rejects.toThrow('vault.masterKey must be exactly 32 bytes');
    await expect(
      orchestrateEncryptedBackup({
        ...baseInput,
        createdAt: '2026-11-23T10:15:00Z',
        dumpGateway: createDumpGateway([Buffer.from('non-empty')]),
      })
    ).rejects.toThrow('canonical ISO-8601 UTC timestamp');
    expect(store.artifacts.size).toBe(0);
  });
});
