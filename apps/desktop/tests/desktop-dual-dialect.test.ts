import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Registry } from '@moonwitness/orm';
import {
  DEFAULT_MAX_BUFFERED_EVENTS,
  DesktopEventStreamHub,
  createDesktopHarnessBridge,
} from '../src/bridge.js';
import {
  DESKTOP_ADDONS,
  LocalSidecarController,
  buildArtifactDigest,
  deserializeSqliteJson,
  fromSqliteBoolean,
  normalizeSqliteRecord,
  serializeSqliteJson,
  toIsoUtcTimestamp,
  toSqliteBoolean,
} from '../src/local-sidecar.js';
import type {
  DesktopActionAuthContext,
  DesktopBridgeHostSurface,
  DesktopCapabilityGrant,
  DesktopStreamEvent,
  UpstreamPcwSyncTransport,
} from '../src/types.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initTempGitRepo(): string {
  const repoRoot = createTempDir('mw-desktop-dual-repo-');
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'harness@moonwitness.local'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'MoonWitness Harness'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  writeFileSync(path.join(repoRoot, 'README.md'), '# MoonWitness Dual-Dialect Fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: initial fixture'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  return repoRoot;
}

function makeAuthContext(
  overrides: Partial<DesktopActionAuthContext> = {}
): DesktopActionAuthContext {
  const grant: DesktopCapabilityGrant = {
    grantId: 'grant-dual-dialect-1',
    companyId: 101,
    agentId: 7,
    workContractId: 42,
    capability: 'desktop.harness@v1',
    policyVersion: 1,
    allowedRiskTier: 'R2',
    allowedClassification: 'local_only',
    maxCallsPerRun: 50,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'active',
  };
  return {
    companyId: 101,
    agentId: 7,
    workContractId: 42,
    expectedPolicyVersion: 1,
    dataClassification: 'local_only',
    grant,
    ...overrides,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('DSK-2.8 & DSK-2.12: Dual-dialect SQLite / Postgres conformance', () => {
  it('normalizes SQLite and Postgres column representations identically', () => {
    expect(toIsoUtcTimestamp('2026-11-21 23:45:00')).toBe('2026-11-21T23:45:00.000Z');
    expect(toIsoUtcTimestamp('2026-11-21T23:45:00Z')).toBe('2026-11-21T23:45:00.000Z');
    expect(toIsoUtcTimestamp(null)).toBeNull();

    expect(toSqliteBoolean(true)).toBe(1);
    expect(toSqliteBoolean(false)).toBe(0);
    expect(toSqliteBoolean(null)).toBeNull();
    expect(fromSqliteBoolean(1)).toBe(true);
    expect(fromSqliteBoolean(0)).toBe(false);
    expect(fromSqliteBoolean(true)).toBe(true);

    const payload = { provider: 'MockProvider', tokens: 128 };
    const serialized = serializeSqliteJson(payload);
    expect(serialized).toBe(JSON.stringify(payload));
    expect(deserializeSqliteJson(serialized)).toEqual(payload);
    expect(deserializeSqliteJson(payload)).toEqual(payload);

    const schema = {
      active: 'boolean',
      created_at: 'timestamp',
      metadata_json: 'json',
      company_id: 'integer',
      name: 'text',
    } as const;

    const sqliteNormalized = normalizeSqliteRecord(
      {
        active: 1,
        created_at: '2026-11-21 12:00:00',
        metadata_json: '{"mode":"local"}',
        company_id: '101',
        name: 'agent-alpha',
      },
      schema
    );

    const postgresNormalized = normalizeSqliteRecord(
      {
        active: true,
        created_at: new Date('2026-11-21T12:00:00.000Z'),
        metadata_json: { mode: 'local' },
        company_id: 101,
        name: 'agent-alpha',
      },
      schema
    );

    expect(sqliteNormalized).toEqual(postgresNormalized);
  });

  it('installs DESKTOP_ADDONS (@moonwitness/orm-ai, @moonwitness/jobs, etc.) against better-sqlite3 local.db', async () => {
    const homeDir = createTempDir('mw-desktop-orm-');
    const sqlitePath = path.join(homeDir, 'local.db');
    const sidecar = new LocalSidecarController({
      desktopHomeDir: homeDir,
      sqlitePath,
      activeCompanyId: 101,
    });

    try {
      const installed = await sidecar.initializeOrmAddons(DESKTOP_ADDONS);
      expect(installed).toEqual(DESKTOP_ADDONS.map((addon) => addon.name));
      expect(installed).toHaveLength(8);
      expect(installed).toContain('ai');
      expect(installed).toContain('jobs');

      const knexInstance = sidecar.getOrmKnex();
      expect(knexInstance).not.toBeNull();
      const tables = await knexInstance!('sqlite_master').select('name').where({ type: 'table' });
      const tableNames = new Set(tables.map((row: { name: string }) => row.name));

      // Verify core @moonwitness/orm-ai and @moonwitness/jobs tables exist in local.db
      const agentRunTable = Registry.get('ai.agent_run').tableName;
      const workContractTable = Registry.get('ai.work_contract').tableName;
      expect(tableNames.has(agentRunTable)).toBe(true);
      expect(tableNames.has(workContractTable)).toBe(true);
      expect([...tableNames].some((name) => name.includes('job'))).toBe(true);
    } finally {
      await sidecar.closeAsync();
    }
  });
});

describe('DSK-3.12: Local attachment storage orphan GC pruning', () => {
  it('retains pending and within-retention synced blobs while pruning expired synced and orphan blobs', async () => {
    const homeDir = createTempDir('mw-desktop-gc-');
    const sqlitePath = path.join(homeDir, 'local.db');
    const sidecar = new LocalSidecarController({
      desktopHomeDir: homeDir,
      sqlitePath,
      activeCompanyId: 101,
    });

    try {
      mkdirSync(sidecar.storageDir, { recursive: true });

      const pendingDigest = buildArtifactDigest({
        artifactKind: 'report',
        content: 'pending-report-payload',
        dataClassification: 'local_only',
      });
      const recentSyncedDigest = buildArtifactDigest({
        artifactKind: 'transcript',
        content: 'recent-synced-payload',
        dataClassification: 'local_only',
      });
      const expiredSyncedDigest = buildArtifactDigest({
        artifactKind: 'tool_output',
        content: 'expired-synced-payload',
        dataClassification: 'local_only',
      });

      const pendingPath = path.join(sidecar.storageDir, pendingDigest.storageKey);
      const recentSyncedPath = path.join(sidecar.storageDir, recentSyncedDigest.storageKey);
      const expiredSyncedPath = path.join(sidecar.storageDir, expiredSyncedDigest.storageKey);
      const orphanPath = path.join(sidecar.storageDir, 'orphan-blob-unreferenced.bin');

      writeFileSync(pendingPath, 'pending-report-payload', 'utf8');
      writeFileSync(recentSyncedPath, 'recent-synced-payload', 'utf8');
      writeFileSync(expiredSyncedPath, 'expired-synced-payload', 'utf8');
      writeFileSync(orphanPath, 'unreferenced-orphan-bytes', 'utf8');

      const oldDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      utimesSync(orphanPath, oldDate, oldDate);

      sidecar.enqueuePcwEnvelope({
        companyId: 101,
        workContractId: 10,
        agentRunId: 'run-gc-pending',
        agentId: 7,
        correlationId: 'corr-gc-1',
        fencingToken: 1,
        runStatus: 'completed',
        artifacts: [pendingDigest],
      });

      const recentEnv = sidecar.enqueuePcwEnvelope({
        companyId: 101,
        workContractId: 11,
        agentRunId: 'run-gc-recent',
        agentId: 7,
        correlationId: 'corr-gc-2',
        fencingToken: 1,
        runStatus: 'completed',
        artifacts: [recentSyncedDigest],
      });

      const expiredEnv = sidecar.enqueuePcwEnvelope({
        companyId: 101,
        workContractId: 12,
        agentRunId: 'run-gc-expired',
        agentId: 7,
        correlationId: 'corr-gc-3',
        fencingToken: 1,
        runStatus: 'completed',
        artifacts: [expiredSyncedDigest],
      });

      const transport: UpstreamPcwSyncTransport = {
        async pushEnvelope(envelope) {
          if (
            envelope.envelopeId === recentEnv.envelopeId ||
            envelope.envelopeId === expiredEnv.envelopeId
          ) {
            return { outcome: 'synced', upstreamRecordId: 9001 };
          }
          return { outcome: 'retryable_error', message: 'keep pending' };
        },
      };

      await sidecar.syncPending(transport);

      // Dry-run with retentionMs = 0 should flag both synced blobs + orphan, but retain pending
      const dryRunResult = sidecar.pruneOrphanAttachmentStorage({
        retentionMs: 0,
        dryRun: true,
      });
      expect(dryRunResult.dryRun).toBe(true);
      expect(dryRunResult.scannedFiles).toBe(4);
      expect(dryRunResult.retainedFiles).toBe(1);
      expect(dryRunResult.deletedFiles).toHaveLength(3);
      expect(existsSync(orphanPath)).toBe(true);

      // Actual GC with 7-day retention: recentSynced and pending retained; orphan deleted
      const liveResult = sidecar.pruneOrphanAttachmentStorage({
        retentionMs: 7 * 24 * 60 * 60 * 1000,
        dryRun: false,
      });
      expect(liveResult.dryRun).toBe(false);
      expect(liveResult.deletedFiles).toContain('orphan-blob-unreferenced.bin');
      expect(liveResult.freedBytes).toBeGreaterThan(0);
      expect(existsSync(orphanPath)).toBe(false);
      expect(existsSync(pendingPath)).toBe(true);
      expect(existsSync(recentSyncedPath)).toBe(true);

      // Future clock (+10 days) prunes expired synced blobs too, while pending remains untouched
      const futureNow = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const futureResult = sidecar.pruneOrphanAttachmentStorage({
        retentionMs: 7 * 24 * 60 * 60 * 1000,
        now: futureNow,
        dryRun: false,
      });
      expect(futureResult.deletedFiles).toContain(expiredSyncedDigest.storageKey);
      expect(futureResult.deletedFiles).toContain(recentSyncedDigest.storageKey);
      expect(existsSync(pendingPath)).toBe(true);
      expect(existsSync(expiredSyncedPath)).toBe(false);
    } finally {
      await sidecar.closeAsync();
    }
  });
});

describe('DSK-4.7: Streaming event backpressure & unsubscribe cleanup', () => {
  it('enforces maxBufferedEvents backpressure and cleans up closed drawer listeners without leaks', () => {
    const hub = new DesktopEventStreamHub();
    const received: DesktopStreamEvent[] = [];

    expect(DEFAULT_MAX_BUFFERED_EVENTS).toBe(256);

    const sub = hub.subscribe((event) => received.push(event), {
      runId: 'run-stream-1',
      kinds: ['harness.step'],
      maxBufferedEvents: 5,
    });
    expect(hub.getActiveListenerCount()).toBe(1);

    // Emit 20 events in a synchronous burst -> 15 dropped, 5 buffered
    for (let i = 0; i < 20; i += 1) {
      hub.emit({
        kind: 'harness.step',
        runId: 'run-stream-1',
        payload: { step: i },
      });
    }

    expect(sub.getDroppedCount()).toBe(15);
    expect(sub.getBufferedCount()).toBe(5);

    const flushed = sub.flush();
    expect(flushed).toHaveLength(5);
    expect(received.map((ev) => ev.payload.step)).toEqual([15, 16, 17, 18, 19]);

    // Unsubscribe (drawer closed) -> zero active listeners and no further deliveries
    sub.unsubscribe();
    expect(hub.getActiveListenerCount()).toBe(0);

    hub.emit({
      kind: 'harness.step',
      runId: 'run-stream-1',
      payload: { step: 20 },
    });
    expect(sub.flush()).toHaveLength(0);
    expect(received).toHaveLength(5);
  });
});

describe('DSK-10.6, DSK-10.8 & DSK-10.13: Native ABI parity & end-to-end window.__MW_DESKTOP__ harness contract', () => {
  it('verifies Tauri v2 config and Node sidecar CLI command parity', () => {
    const tauriConfPath = path.resolve(process.cwd(), 'tauri.conf.json');
    const pkgJsonPath = path.resolve(process.cwd(), 'package.json');
    expect(existsSync(tauriConfPath)).toBe(true);
    expect(existsSync(pkgJsonPath)).toBe(true);

    const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8')) as {
      productName?: string;
      identifier?: string;
    };
    expect(tauriConf.productName).toBeTruthy();
    expect(tauriConf.identifier).toBeTruthy();

    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkgJson.bin?.['moonwitness-desktop']).toBe('./dist/cli.js');
    expect(pkgJson.dependencies?.['better-sqlite3']).toBeTruthy();
  });

  it('executes end-to-end MockProvider harness flow on window.__MW_DESKTOP__ (worktree diff, bounded PTY, offline sync banner)', async () => {
    const repoRoot = initTempGitRepo();
    const homeDir = createTempDir('mw-desktop-e2e-');
    const surface: DesktopBridgeHostSurface = {};

    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        desktopHomeDir: homeDir,
        sqlitePath: path.join(homeDir, 'local.db'),
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        activeCompanyId: 101,
        allowedCommands: ['node'],
      },
      { surface }
    );

    try {
      expect(surface.__MW_DESKTOP__).toBe(bridge);
      const auth = makeAuthContext();

      // 1. Worktree acquire, write, and diff inspection
      const lease = await bridge.worktree.acquire({ runId: 'run-e2e-1' });
      expect(lease.status).toBe('active');

      await bridge.worktree.writeFile(
        'run-e2e-1',
        'notes.txt',
        'MockProvider generated artifact\n',
        auth
      );
      const diff = await bridge.worktree.diff('run-e2e-1');
      expect(diff.clean).toBe(false);
      expect(diff.patchSha256).toMatch(/^[a-f0-9]{64}$/u);

      // 2. Bounded PTY execution + streaming event delivery
      const ptyEvents: DesktopStreamEvent[] = [];
      const ptySub = bridge.events.subscribe((ev) => ptyEvents.push(ev), {
        runId: 'run-e2e-1',
        kinds: ['pty.output', 'pty.exit'],
      });

      const ptyResult = await bridge.pty.execute(
        {
          runId: 'run-e2e-1',
          command: 'node',
          args: ['-e', 'process.stdout.write("mock-provider-ok")'],
        },
        auth
      );
      expect(ptyResult.exitCode).toBe(0);
      expect(ptyResult.stdout).toContain('mock-provider-ok');

      ptySub.flush();
      expect(ptyEvents.some((ev) => ev.kind === 'pty.output')).toBe(true);
      expect(ptyEvents.some((ev) => ev.kind === 'pty.exit')).toBe(true);
      ptySub.unsubscribe();
      expect(bridge.events.getActiveListenerCount()).toBe(0);

      // 3. Offline sync banner & upstream PCW flush
      const offlineState = bridge.sidecar.setOfflineMode(true);
      expect(offlineState.status).toBe('offline');
      expect(offlineState.offlineMode).toBe(true);

      const digest = buildArtifactDigest({
        artifactKind: 'evidence_bundle',
        content: diff.patch || 'diff-placeholder',
        dataClassification: 'local_only',
      });
      bridge.sidecar.enqueuePcwEnvelope({
        companyId: 101,
        workContractId: 42,
        agentRunId: 'run-e2e-1',
        agentId: 7,
        correlationId: 'corr-e2e-1',
        fencingToken: lease.fencingToken,
        runStatus: 'completed',
        artifacts: [digest],
      });

      const offlineSnapshot = await bridge.getStatus();
      expect(offlineSnapshot.sidecar.status).toBe('offline');
      expect(offlineSnapshot.sidecar.pendingOutboxCount).toBe(1);

      bridge.sidecar.setOfflineMode(false);
      const syncResult = await bridge.sidecar.syncPending({
        async pushEnvelope() {
          return { outcome: 'synced', upstreamRecordId: 505 };
        },
      });
      expect(syncResult.synced).toBe(1);
      expect(bridge.sidecar.getState().syncedOutboxCount).toBe(1);

      await bridge.worktree.release('run-e2e-1');
    } finally {
      bridge.dispose();
      expect(surface.__MW_DESKTOP__).toBeUndefined();
    }
  });
});
