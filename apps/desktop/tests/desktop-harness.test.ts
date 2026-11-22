import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DESKTOP_ADDONS,
  DesktopUpstreamSyncClient,
  LocalSidecarController,
  buildArtifactDigest,
  createDesktopHarnessBridge,
  executeProjectTaskInSandbox,
  parseDesktopCliArgs,
  startDesktopSidecarDaemon,
  type DesktopActionAuthContext,
  type DesktopBridgeHostSurface,
  type DesktopCapabilityBridge,
  type DesktopCapabilityGrant,
  type HumanApprovalToken,
  type LocalMcpServerConfig,
  type PcwSyncEnvelope,
  type UpstreamPcwSyncTransport,
} from '../src/index.js';
import { Company } from '@moonwitness/orm-base';
import { ProviderProfile } from '@moonwitness/orm-ai';

const tempDirs: string[] = [];
const activeBridges: DesktopCapabilityBridge[] = [];
const activeSidecars: LocalSidecarController[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initTempGitRepo(): string {
  const repoDir = makeTempDir('mw-desktop-repo-');
  mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  mkdirSync(path.join(repoDir, 'secrets'), { recursive: true });

  writeFileSync(path.join(repoDir, 'src', 'app.ts'), 'export const appVersion = 1;\n', 'utf8');
  writeFileSync(path.join(repoDir, 'docs', 'readme.md'), '# Notes\n', 'utf8');
  writeFileSync(path.join(repoDir, '.env'), 'MW_AI_SECRET=super-secret-value-12345\n', 'utf8');
  writeFileSync(path.join(repoDir, 'secrets', 'token.key'), 'PRIVATE-KEY-DO-NOT-READ\n', 'utf8');

  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@moonwitness.local'], {
    cwd: repoDir,
    stdio: 'pipe',
  });
  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: repoDir, stdio: 'pipe' });

  return repoDir;
}

function makeGrant(overrides: Partial<DesktopCapabilityGrant> = {}): DesktopCapabilityGrant {
  return {
    grantId: overrides.grantId ?? `grant-${randomUUID()}`,
    companyId: overrides.companyId ?? 1,
    agentId: overrides.agentId ?? 10,
    workContractId: overrides.workContractId ?? 42,
    capability: overrides.capability ?? 'desktop.worktree@v1',
    policyVersion: overrides.policyVersion ?? 1,
    allowedRiskTier: overrides.allowedRiskTier ?? 'R2',
    allowedClassification: overrides.allowedClassification ?? 'local_only',
    maxCallsPerRun: overrides.maxCallsPerRun ?? 10,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString(),
    revokedAt: overrides.revokedAt ?? null,
    status: overrides.status ?? 'active',
    allowedPaths: overrides.allowedPaths,
  };
}

function makeAuth(overrides: Partial<DesktopActionAuthContext> = {}): DesktopActionAuthContext {
  const grant = overrides.grant ?? makeGrant();
  return {
    companyId: overrides.companyId ?? grant.companyId,
    agentId: overrides.agentId ?? grant.agentId,
    workContractId: overrides.workContractId ?? grant.workContractId ?? 42,
    expectedPolicyVersion: overrides.expectedPolicyVersion ?? grant.policyVersion,
    dataClassification: overrides.dataClassification ?? 'local_only',
    grant,
    humanApproval: overrides.humanApproval,
  };
}

function makeApproval(overrides: Partial<HumanApprovalToken> = {}): HumanApprovalToken {
  return {
    tokenId: overrides.tokenId ?? `approval-${randomUUID()}`,
    approvedByUserId: overrides.approvedByUserId ?? 99,
    action: overrides.action ?? 'git.push_remote',
    runId: overrides.runId ?? 'run-1',
    issuedAt: overrides.issuedAt ?? new Date().toISOString(),
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 600_000).toISOString(),
    singleUse: overrides.singleUse ?? true,
  };
}

afterEach(() => {
  while (activeBridges.length > 0) {
    activeBridges.pop()?.dispose();
  }
  while (activeSidecars.length > 0) {
    activeSidecars.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('MoonWitness Desktop Harness', () => {
  it('isolates git worktrees per run with lock fencing, diff inspection, and local commits', async () => {
    const repoRoot = initTempGitRepo();
    const surface: DesktopBridgeHostSurface = {};
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        localAiEndpoint: 'http://127.0.0.1:11434',
        allowedPathPrefixes: ['src', 'tests'],
      },
      { surface }
    );
    activeBridges.push(bridge);

    expect(surface.__MW_DESKTOP__).toBe(bridge);
    const leaseAlpha = await bridge.worktree.acquire({ runId: 'alpha-1' });
    const leaseBeta = await bridge.worktree.acquire({ runId: 'beta-1' });

    expect(leaseAlpha.worktreePath).toContain(path.join('.mw-worktrees', 'run-alpha-1'));
    expect(leaseBeta.worktreePath).toContain(path.join('.mw-worktrees', 'run-beta-1'));
    expect(leaseBeta.fencingToken).toBeGreaterThan(leaseAlpha.fencingToken);

    await expect(bridge.worktree.acquire({ runId: 'alpha-1' })).rejects.toThrow(/already active/iu);

    const auth = makeAuth();
    await bridge.worktree.writeFile(
      'alpha-1',
      'src/app.ts',
      'export const appVersion = 2;\n',
      auth
    );

    const alphaFile = await bridge.worktree.readFile('alpha-1', 'src/app.ts');
    const betaFile = await bridge.worktree.readFile('beta-1', 'src/app.ts');
    expect(alphaFile.content).toBe('export const appVersion = 2;\n');
    expect(betaFile.content).toBe('export const appVersion = 1;\n');
    expect(readFileSync(path.join(repoRoot, 'src', 'app.ts'), 'utf8')).toBe(
      'export const appVersion = 1;\n'
    );

    const diff = await bridge.worktree.diff('alpha-1');
    expect(diff.clean).toBe(false);
    expect(diff.files).toEqual([{ path: 'src/app.ts', status: ' M', additions: 1, deletions: 1 }]);
    expect(diff.patch).toContain('+export const appVersion = 2;');
    expect(diff.patchSha256).toMatch(/^[a-f0-9]{64}$/u);

    const commitResult = await bridge.worktree.commit('alpha-1', 'feat: bump version to 2', auth);
    expect(commitResult.commitSha).toMatch(/^[a-f0-9]{40}$/u);
    expect(commitResult.stagedFiles).toEqual(['src/app.ts']);

    const diffAfterCommit = await bridge.worktree.diff('alpha-1');
    expect(diffAfterCommit.clean).toBe(true);

    const released = await bridge.worktree.release('alpha-1');
    expect(released.status).toBe('released');
    expect(existsSync(leaseAlpha.worktreePath)).toBe(false);
    await bridge.worktree.release('beta-1');
  });

  it('blocks path traversal, external paths, allowlist escapes, .env secrets, and symlink escapes', async () => {
    const repoRoot = initTempGitRepo();
    const externalDir = makeTempDir('mw-desktop-external-');
    writeFileSync(path.join(externalDir, 'host-secret.txt'), 'TOP_SECRET', 'utf8');

    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        allowedPathPrefixes: ['src'],
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    const lease = await bridge.worktree.acquire({ runId: 'sec-1' });
    const auth = makeAuth();

    await expect(bridge.worktree.readFile('sec-1', '../outside.txt')).rejects.toThrow(
      /traversal/iu
    );
    await expect(bridge.worktree.readFile('sec-1', 'src/../../etc/passwd')).rejects.toThrow(
      /traversal/iu
    );
    await expect(bridge.worktree.readFile('sec-1', '/etc/passwd')).rejects.toThrow(
      /absolute|external/iu
    );
    await expect(bridge.worktree.readFile('sec-1', 'C:\\Windows\\win.ini')).rejects.toThrow(
      /absolute|external/iu
    );
    await expect(bridge.worktree.readFile('sec-1', '.env')).rejects.toThrow(/secret|sensitive/iu);
    await expect(bridge.worktree.writeFile('sec-1', '.env.local', 'KEY=1', auth)).rejects.toThrow(
      /prohibited|secret|sensitive/iu
    );
    await expect(bridge.worktree.readFile('sec-1', '.git/HEAD')).rejects.toThrow(
      /secret|sensitive/iu
    );
    await expect(bridge.worktree.readFile('sec-1', 'secrets/token.key')).rejects.toThrow(
      /secret|sensitive/iu
    );
    await expect(bridge.worktree.readFile('sec-1', 'docs/readme.md')).rejects.toThrow(
      /allowlist/iu
    );

    const linkPath = path.join(lease.worktreePath, 'src', 'linked-external');
    symlinkSync(externalDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(
      bridge.worktree.readFile('sec-1', 'src/linked-external/host-secret.txt')
    ).rejects.toThrow(/symbolic link|escapes/iu);
    await expect(
      bridge.worktree.writeFile('sec-1', 'src/linked-external/pwn.txt', 'x', auth)
    ).rejects.toThrow(/symbolic link|escapes/iu);

    await bridge.worktree.release('sec-1');
  });

  it('enforces bounded PTY execution, environment sanitization, output caps, and timeouts', async () => {
    const repoRoot = initTempGitRepo();
    process.env.MW_AI_TEST_LEAK_GUARD = 'sensitive-host-secret-999';
    try {
      const bridge = createDesktopHarnessBridge(
        {
          repoRoot,
          sqlitePath: ':memory:',
          boardOrigin: 'http://127.0.0.1:5173',
          apiBaseUrl: 'http://127.0.0.1:3000',
          knownSecrets: ['sensitive-host-secret-999'],
        },
        { autoAttach: false }
      );
      activeBridges.push(bridge);

      await bridge.worktree.acquire({ runId: 'pty-1' });
      const auth = makeAuth({ grant: makeGrant({ maxCallsPerRun: 10 }) });

      const cleanResult = await bridge.pty.execute(
        {
          runId: 'pty-1',
          command: 'node',
          args: ['-e', 'console.log(process.env.MW_AI_TEST_LEAK_GUARD ?? "FILTERED")'],
        },
        auth
      );
      expect(cleanResult.exitCode).toBe(0);
      expect(cleanResult.stdout.trim()).toBe('FILTERED');
      expect(cleanResult.stdoutSha256).toMatch(/^[a-f0-9]{64}$/u);

      const truncatedResult = await bridge.pty.execute(
        {
          runId: 'pty-1',
          command: 'node',
          args: ['-e', 'process.stdout.write("A".repeat(4096))'],
          maxOutputBytes: 512,
        },
        auth
      );
      expect(truncatedResult.truncated).toBe(true);
      expect(Buffer.byteLength(truncatedResult.stdout, 'utf8')).toBeLessThanOrEqual(512);

      const timeoutResult = await bridge.pty.execute(
        {
          runId: 'pty-1',
          command: 'node',
          args: ['-e', 'setTimeout(() => {}, 5000)'],
          timeoutMs: 150,
        },
        auth
      );
      expect(timeoutResult.timedOut).toBe(true);

      await expect(
        bridge.pty.execute(
          {
            runId: 'pty-1',
            command: 'bash',
            args: ['-c', 'echo hi'],
          },
          auth
        )
      ).rejects.toThrow(/allowlist/iu);

      await expect(
        bridge.pty.execute(
          {
            runId: 'pty-1',
            command: 'node',
            args: ['-e', "require('fs').readFileSync('.env')"],
          },
          auth
        )
      ).rejects.toThrow(/prohibited tier R4/iu);

      await bridge.worktree.release('pty-1');
    } finally {
      delete process.env.MW_AI_TEST_LEAK_GUARD;
    }
  });

  it('enforces R0-R4 risk-tier gating, grant lifecycle, quotas, data classification, and single-use R3 approval', () => {
    const repoRoot = initTempGitRepo();
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    const r0Grant = makeGrant({ allowedRiskTier: 'R0', maxCallsPerRun: 2 });
    expect(
      bridge.risk.evaluate({
        runId: 'risk-1',
        action: 'repo.read',
        companyId: 1,
        agentId: 10,
        workContractId: 42,
        expectedPolicyVersion: 1,
        dataClassification: 'local_only',
        grant: r0Grant,
      }).allowed
    ).toBe(true);

    const r1Blocked = bridge.risk.evaluate({
      runId: 'risk-1',
      action: 'worktree.write',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'local_only',
      grant: r0Grant,
    });
    expect(r1Blocked.allowed).toBe(false);
    expect(r1Blocked.reasonCode).toBe('RISK_TIER_EXCEEDED');

    // Second R0 call succeeds and exhausts maxCallsPerRun=2.
    expect(
      bridge.risk.evaluate({
        runId: 'risk-1',
        action: 'git.diff',
        companyId: 1,
        agentId: 10,
        workContractId: 42,
        expectedPolicyVersion: 1,
        dataClassification: 'local_only',
        grant: r0Grant,
      }).remainingQuota
    ).toBe(0);

    const quotaExceeded = bridge.risk.evaluate({
      runId: 'risk-1',
      action: 'repo.search',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'local_only',
      grant: r0Grant,
    });
    expect(quotaExceeded.allowed).toBe(false);
    expect(quotaExceeded.reasonCode).toBe('RUN_QUOTA_EXCEEDED');

    // R3 requires HumanApprovalToken + cloud_eligible when targeting cloud egress.
    const r3Grant = makeGrant({
      allowedRiskTier: 'R3',
      allowedClassification: 'cloud_eligible',
      maxCallsPerRun: 5,
    });
    const missingApproval = bridge.risk.evaluate({
      runId: 'risk-r3',
      action: 'git.push_remote',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'cloud_eligible',
      grant: r3Grant,
    });
    expect(missingApproval.allowed).toBe(false);
    expect(missingApproval.reasonCode).toBe('HUMAN_APPROVAL_REQUIRED');

    const token = makeApproval({ runId: 'risk-r3', action: 'git.push_remote', singleUse: true });
    const localOnlyBlocked = bridge.risk.evaluate({
      runId: 'risk-r3',
      action: 'cloud.provider_call',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'local_only',
      grant: r3Grant,
      humanApproval: makeApproval({ runId: 'risk-r3', action: 'cloud.provider_call' }),
    });
    expect(localOnlyBlocked.allowed).toBe(false);
    expect(localOnlyBlocked.reasonCode).toBe('DATA_CLASSIFICATION_VIOLATION');

    const r3Allowed = bridge.risk.evaluate({
      runId: 'risk-r3',
      action: 'git.push_remote',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'cloud_eligible',
      grant: r3Grant,
      humanApproval: token,
    });
    expect(r3Allowed.allowed).toBe(true);
    expect(r3Allowed.requiresHumanApproval).toBe(true);

    // Replay of single-use approval token is rejected.
    const replay = bridge.risk.evaluate({
      runId: 'risk-r3',
      action: 'git.push_remote',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'cloud_eligible',
      grant: r3Grant,
      humanApproval: token,
    });
    expect(replay.allowed).toBe(false);
    expect(replay.reasonCode).toBe('HUMAN_APPROVAL_REPLAYED');

    // R4 is unconditionally prohibited even with an R4 grant and approval token.
    const r4Grant = makeGrant({ allowedRiskTier: 'R4', allowedClassification: 'restricted' });
    const r4Denied = bridge.risk.evaluate({
      runId: 'risk-r4',
      action: 'secret.read',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'restricted',
      grant: r4Grant,
      humanApproval: makeApproval({ runId: 'risk-r4', action: 'secret.read' }),
    });
    expect(r4Denied.allowed).toBe(false);
    expect(r4Denied.reasonCode).toBe('RISK_R4_PROHIBITED');
    expect(bridge.risk.getAuditLog(20).length).toBeGreaterThanOrEqual(7);
  });

  it('queues PCW artifact digests offline in SQLite and reconciles upstream sync when reconnected', async () => {
    const dbDir = makeTempDir('mw-desktop-sidecar-');
    const sqlitePath = path.join(dbDir, 'local.db');

    const sidecar1 = new LocalSidecarController({ sqlitePath, offlineMode: true });
    activeSidecars.push(sidecar1);

    const reportArtifact = buildArtifactDigest({
      artifactKind: 'report',
      content: JSON.stringify({ summary: 'All desktop checks green' }),
      dataClassification: 'local_only',
      relativePath: 'src/app.ts',
    });
    const evidenceArtifact = buildArtifactDigest({
      artifactKind: 'evidence_bundle',
      content: 'vitest passed 6/6',
      mimeType: 'text/plain',
      dataClassification: 'local_only',
    });

    const env1 = sidecar1.enqueuePcwEnvelope({
      envelopeId: 'env-sync-1',
      companyId: 1,
      workContractId: 42,
      agentRunId: 'run-pcw-1',
      agentId: 10,
      correlationId: 'corr-1',
      modelName: 'ai.agent_run',
      fencingToken: 1,
      runStatus: 'completed',
      artifacts: [reportArtifact, evidenceArtifact],
      checkpoint: { step: 3, verified: true },
    });

    // Idempotent duplicate enqueue returns the same envelope.
    const env1Duplicate = sidecar1.enqueuePcwEnvelope({
      envelopeId: 'env-sync-1',
      companyId: 1,
      workContractId: 42,
      agentRunId: 'run-pcw-1',
      agentId: 10,
      correlationId: 'corr-1',
      modelName: 'ai.agent_run',
      fencingToken: 1,
      runStatus: 'completed',
      artifacts: [reportArtifact, evidenceArtifact],
    });
    expect(env1Duplicate.envelopeSha256).toBe(env1.envelopeSha256);

    // Stale fencing token for the same run is rejected.
    expect(() =>
      sidecar1.enqueuePcwEnvelope({
        envelopeId: 'env-sync-stale',
        companyId: 1,
        workContractId: 42,
        agentRunId: 'run-pcw-1',
        agentId: 10,
        correlationId: 'corr-1',
        fencingToken: 0,
        runStatus: 'running',
        artifacts: [reportArtifact],
      })
    ).toThrow(/Stale fencing token/iu);

    const env2 = sidecar1.enqueuePcwEnvelope({
      envelopeId: 'env-sync-2',
      companyId: 1,
      workContractId: 42,
      agentRunId: 'run-pcw-2',
      agentId: 10,
      correlationId: 'corr-2',
      modelName: 'ai.artifact_manifest',
      fencingToken: 1,
      runStatus: 'completed',
      artifacts: [evidenceArtifact],
    });

    const offlineSync = await sidecar1.syncPending({
      pushEnvelope: async () => ({ outcome: 'synced', upstreamRecordId: 999 }),
    });
    expect(offlineSync.skippedOffline).toBe(true);
    expect(offlineSync.attempted).toBe(0);
    expect(sidecar1.getState().pendingOutboxCount).toBe(2);

    // Simulate process restart by closing and reopening the SQLite sidecar file.
    sidecar1.close();
    const sidecar2 = new LocalSidecarController({ sqlitePath, offlineMode: false });
    activeSidecars.push(sidecar2);

    expect(sidecar2.getState().pendingOutboxCount).toBe(2);
    expect(sidecar2.getCheckpoint('run-pcw-1')).toEqual({ step: 3, verified: true });
    expect(sidecar2.verifyEnvelopeIntegrity(env1.envelopeId)).toBe(true);

    let failOnce = true;
    const transport: UpstreamPcwSyncTransport = {
      async pushEnvelope(envelope: PcwSyncEnvelope) {
        if (envelope.envelopeId === env1.envelopeId) {
          return { outcome: 'synced', upstreamRecordId: 5001 };
        }
        if (envelope.envelopeId === env2.envelopeId && failOnce) {
          failOnce = false;
          return { outcome: 'retryable_error', message: 'Temporary 503 upstream' };
        }
        return { outcome: 'synced', upstreamRecordId: 5002 };
      },
    };

    const batch1 = await sidecar2.syncPending(transport);
    expect(batch1.attempted).toBe(2);
    expect(batch1.synced).toBe(1);
    expect(batch1.failed).toBe(1);

    const failedList = sidecar2.listEnvelopes([['sync_status', '=', 'failed']]);
    expect(failedList.map((e) => e.envelopeId)).toEqual([env2.envelopeId]);

    // Second pass reconciles the previously failed envelope.
    const batch2 = await sidecar2.syncPending(transport);
    expect(batch2.attempted).toBe(1);
    expect(batch2.synced).toBe(1);
    expect(sidecar2.getState().syncedOutboxCount).toBe(2);
    expect(sidecar2.getEnvelope(env2.envelopeId).upstreamRecordId).toBe(5002);

    // Tampered local SQLite row is caught before upstream sync.
    sidecar2.enqueuePcwEnvelope({
      envelopeId: 'env-tampered',
      companyId: 1,
      workContractId: 42,
      agentRunId: 'run-pcw-3',
      agentId: 10,
      correlationId: 'corr-3',
      fencingToken: 1,
      runStatus: 'completed',
      artifacts: [reportArtifact],
    });
    sidecar2.close();

    const rawDb = new DatabaseSync(sqlitePath);
    rawDb
      .prepare("UPDATE desktop_pcw_outbox SET run_status = 'failed' WHERE envelope_id = ?")
      .run('env-tampered');
    rawDb.close();

    const sidecar3 = new LocalSidecarController({ sqlitePath, offlineMode: false });
    activeSidecars.push(sidecar3);
    expect(sidecar3.verifyEnvelopeIntegrity('env-tampered')).toBe(false);
    const tamperedBatch = await sidecar3.syncPending(transport);
    expect(tamperedBatch.conflicts).toBe(1);
    expect(sidecar3.getEnvelope('env-tampered').syncStatus).toBe('conflict');
  });

  it('validates local MCP host capability grants, quotas, stdio RPC, loopback safety, and output redaction', async () => {
    const repoRoot = initTempGitRepo();
    const knownToken = 'mw-secret-token-abcdef123456';
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        knownSecrets: [knownToken],
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    // Non-loopback HTTP MCP server must be rejected.
    const remoteConfig: LocalMcpServerConfig = {
      serverId: 'remote-bad',
      name: 'Remote Bad MCP',
      transport: 'loopback_http',
      endpointUrl: 'https://evil.example.com/mcp',
      requiredCapability: 'mcp.search@v1',
      maxRiskTier: 'R0',
      allowedDataClassifications: ['local_only'],
      maxCallsPerRun: 5,
      enabled: true,
    };
    expect(() => bridge.mcp.registerServer(remoteConfig)).toThrow(/loopback/iu);

    // Register local in-process handler server.
    bridge.mcp.registerServer({
      serverId: 'local-knowledge',
      name: 'Local Knowledge MCP',
      transport: 'loopback_http',
      endpointUrl: 'http://127.0.0.1:4310/mcp',
      requiredCapability: 'mcp.knowledge@v1',
      maxRiskTier: 'R0',
      allowedDataClassifications: ['local_only', 'restricted'],
      maxCallsPerRun: 2,
      enabled: true,
    });
    bridge.mcp.registerHandler('local-knowledge', async (toolName, args) => ({
      tool: toolName,
      query: args.query ?? null,
      debugHeader: 'Bearer super-secret-jwt-token-99999',
      apiKey: 'sk-proj-1234567890abcdef',
      leakedToken: knownToken,
    }));

    const mcpGrant = makeGrant({
      capability: 'mcp.knowledge@v1',
      allowedRiskTier: 'R1',
      allowedClassification: 'local_only',
      maxCallsPerRun: 5,
    });
    const auth = makeAuth({ grant: mcpGrant, dataClassification: 'local_only' });

    const res1 = await bridge.mcp.invoke({
      runId: 'mcp-run-1',
      serverId: 'local-knowledge',
      toolName: 'search_notes',
      arguments: { query: 'local-first' },
      auth,
    });
    expect(res1.redacted).toBe(true);
    expect(res1.callCountForRun).toBe(1);
    expect(res1.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(res1.output).toEqual({
      tool: 'search_notes',
      query: 'local-first',
      debugHeader: 'Bearer [REDACTED]',
      apiKey: '[REDACTED]',
      leakedToken: '[REDACTED_SECRET]',
    });

    // Second call succeeds; third call exceeds server maxCallsPerRun=2.
    await bridge.mcp.invoke({
      runId: 'mcp-run-1',
      serverId: 'local-knowledge',
      toolName: 'search_notes',
      arguments: { query: 'second' },
      auth,
    });
    await expect(
      bridge.mcp.invoke({
        runId: 'mcp-run-1',
        serverId: 'local-knowledge',
        toolName: 'search_notes',
        arguments: { query: 'third' },
        auth,
      })
    ).rejects.toThrow(/quota exceeded/iu);

    // Wrong capability grant is rejected.
    await expect(
      bridge.mcp.invoke({
        runId: 'mcp-run-2',
        serverId: 'local-knowledge',
        toolName: 'search_notes',
        arguments: { query: 'x' },
        auth: makeAuth({ grant: makeGrant({ capability: 'mcp.other@v1' }) }),
      })
    ).rejects.toThrow(/does not match server requirement/iu);

    // Real stdio JSON-RPC invocation via Node subprocess.
    bridge.mcp.registerServer({
      serverId: 'local-stdio-echo',
      name: 'Local Stdio Echo MCP',
      transport: 'stdio',
      command: 'node',
      args: [
        '-e',
        'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const req=JSON.parse(d.trim());process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:req.id,result:{ok:true,name:req.params.name,secret:"password=topsecret123"}})+"\\n")});',
      ],
      requiredCapability: 'mcp.stdio@v1',
      maxRiskTier: 'R0',
      allowedDataClassifications: ['local_only'],
      maxCallsPerRun: 3,
      enabled: true,
    });

    const stdioResult = await bridge.mcp.invoke({
      runId: 'mcp-run-3',
      serverId: 'local-stdio-echo',
      toolName: 'ping',
      arguments: { ping: 1 },
      auth: makeAuth({ grant: makeGrant({ capability: 'mcp.stdio@v1' }) }),
    });
    expect(stdioResult.redacted).toBe(true);
    expect(stdioResult.output).toEqual({
      ok: true,
      name: 'ping',
      secret: '[REDACTED]',
    });
  });

  it('rejects non-loopback board origins and validates Tauri v2 apps/board hosting config', async () => {
    const repoRoot = initTempGitRepo();

    expect(() =>
      createDesktopHarnessBridge({
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'https://remote.example.com',
        apiBaseUrl: 'http://127.0.0.1:3000',
      })
    ).toThrow(/loopback/iu);

    expect(() =>
      createDesktopHarnessBridge({
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        localAiEndpoint: 'https://api.openai.com/v1',
      })
    ).toThrow(/loopback/iu);

    const tauriConfigPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../tauri.conf.json'
    );
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8')) as {
      productName: string;
      version: string;
      build: { devUrl: string; frontendDist: string };
      app: {
        withGlobalTauri: boolean;
        windows: Array<{ url: string }>;
        security: {
          freezePrototype: boolean;
          csp: { 'frame-ancestors': string[]; 'object-src': string[]; 'connect-src': string[] };
        };
      };
    };

    expect(tauriConfig.version).toBe('1.0.0-rc.1');
    expect(tauriConfig.build.devUrl).toBe('http://127.0.0.1:5173/board');
    expect(tauriConfig.build.frontendDist).toContain('board');
    expect(tauriConfig.app.withGlobalTauri).toBe(false);
    expect(tauriConfig.app.windows[0]?.url).toBe('/board');
    expect(tauriConfig.app.security.freezePrototype).toBe(true);
    expect(tauriConfig.app.security.csp['frame-ancestors']).toEqual(["'none'"]);
    expect(tauriConfig.app.security.csp['object-src']).toEqual(["'none'"]);
    expect(tauriConfig.app.security.csp['connect-src']).toContain('http://127.0.0.1:3000');

    const surface: DesktopBridgeHostSurface = {};
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
      },
      { surface }
    );
    const status = await bridge.getStatus();
    expect(status.hostSurface).toBe('apps/board');
    expect(status.protocolVersion).toBe('1.0');
    bridge.dispose();
    expect(surface.__MW_DESKTOP__).toBeUndefined();
  });

  it('invokes a real loopback HTTP JSON-RPC MCP server and blocks commit of secret untracked files', async () => {
    const repoRoot = initTempGitRepo();
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          id: string | number | null;
          params?: { name?: string };
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              called: body.params?.name ?? null,
              endpointAuth: 'https://user:pass@127.0.0.1:9000/internal',
            },
          })
        );
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind ephemeral loopback port');
      }

      const bridge = createDesktopHarnessBridge(
        {
          repoRoot,
          sqlitePath: ':memory:',
          boardOrigin: 'http://127.0.0.1:5173',
          apiBaseUrl: 'http://127.0.0.1:3000',
          allowedPathPrefixes: ['src'],
        },
        { autoAttach: false }
      );
      activeBridges.push(bridge);

      bridge.mcp.registerServer({
        serverId: 'loopback-rpc',
        name: 'Loopback HTTP RPC',
        transport: 'loopback_http',
        endpointUrl: `http://127.0.0.1:${address.port}/rpc`,
        requiredCapability: 'mcp.loopback@v1',
        maxRiskTier: 'R0',
        allowedDataClassifications: ['local_only'],
        maxCallsPerRun: 3,
        enabled: true,
      });

      const rpcResult = await bridge.mcp.invoke({
        runId: 'mcp-loopback-1',
        serverId: 'loopback-rpc',
        toolName: 'check_health',
        arguments: { verbose: true },
        auth: makeAuth({ grant: makeGrant({ capability: 'mcp.loopback@v1' }) }),
      });
      expect(rpcResult.redacted).toBe(true);
      expect(rpcResult.output).toEqual({
        called: 'check_health',
        endpointAuth: 'https://[REDACTED]:[REDACTED]@127.0.0.1:9000/internal',
      });

      const lease = await bridge.worktree.acquire({ runId: 'secret-commit-guard' });
      writeFileSync(path.join(lease.worktreePath, '.env.local'), 'LEAK=1\n', 'utf8');
      await expect(
        bridge.worktree.commit('secret-commit-guard', 'should block secret', makeAuth())
      ).rejects.toThrow(/sensitive or secret/iu);

      rmSync(path.join(lease.worktreePath, '.env.local'), { force: true });
      await expect(bridge.worktree.acquire({ runId: '../bad-run' })).rejects.toThrow(
        /Invalid runId/iu
      );
      await bridge.worktree.release('secret-commit-guard');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects expired/revoked/mismatched grants, handles upstream conflict sync, and enforces MCP timeouts', async () => {
    const repoRoot = initTempGitRepo();
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    const expiredGrant = makeGrant({ expiresAt: new Date(Date.now() - 10_000).toISOString() });
    expect(
      bridge.risk.evaluate({
        runId: 'grant-checks',
        action: 'repo.read',
        companyId: 1,
        agentId: 10,
        workContractId: 42,
        expectedPolicyVersion: 1,
        dataClassification: 'local_only',
        grant: expiredGrant,
      }).reasonCode
    ).toBe('GRANT_EXPIRED');

    const revokedGrant = makeGrant({ status: 'revoked', revokedAt: new Date().toISOString() });
    expect(
      bridge.risk.evaluate({
        runId: 'grant-checks',
        action: 'repo.read',
        companyId: 1,
        agentId: 10,
        workContractId: 42,
        expectedPolicyVersion: 1,
        dataClassification: 'local_only',
        grant: revokedGrant,
      }).reasonCode
    ).toBe('GRANT_INACTIVE');

    const wrongPolicyGrant = makeGrant({ policyVersion: 2 });
    expect(
      bridge.risk.evaluate({
        runId: 'grant-checks',
        action: 'repo.read',
        companyId: 1,
        agentId: 10,
        workContractId: 42,
        expectedPolicyVersion: 1,
        dataClassification: 'local_only',
        grant: wrongPolicyGrant,
      }).reasonCode
    ).toBe('POLICY_VERSION_MISMATCH');

    const artifact = buildArtifactDigest({
      artifactKind: 'tool_output',
      content: 'conflict-check',
      dataClassification: 'local_only',
    });
    const conflictEnv = bridge.sidecar.enqueuePcwEnvelope({
      envelopeId: 'env-conflict-1',
      companyId: 1,
      workContractId: 42,
      agentRunId: 'run-conflict',
      agentId: 10,
      correlationId: 'corr-conflict',
      modelName: 'base.outbox_event',
      fencingToken: 1,
      runStatus: 'completed',
      artifacts: [artifact],
    });
    const syncRes = await bridge.sidecar.syncPending({
      pushEnvelope: async () => ({ outcome: 'conflict', message: 'Stale upstream fencing token' }),
    });
    expect(syncRes.conflicts).toBe(1);
    expect(bridge.sidecar.listEnvelopes([['sync_status', '=', 'conflict']])[0]?.envelopeId).toBe(
      conflictEnv.envelopeId
    );

    bridge.mcp.registerServer({
      serverId: 'slow-mcp',
      name: 'Slow MCP',
      transport: 'loopback_http',
      endpointUrl: 'http://127.0.0.1:4399/mcp',
      requiredCapability: 'mcp.slow@v1',
      maxRiskTier: 'R0',
      allowedDataClassifications: ['local_only'],
      maxCallsPerRun: 2,
      timeoutMs: 120,
      enabled: true,
    });
    bridge.mcp.registerHandler(
      'slow-mcp',
      async () =>
        await new Promise((resolve) => {
          setTimeout(() => resolve({ late: true }), 1000);
        })
    );
    await expect(
      bridge.mcp.invoke({
        runId: 'mcp-timeout-1',
        serverId: 'slow-mcp',
        toolName: 'hang',
        arguments: {},
        auth: makeAuth({ grant: makeGrant({ capability: 'mcp.slow@v1' }) }),
      })
    ).rejects.toThrow(/timed out/iu);

    bridge.mcp.registerServer({
      serverId: 'disabled-mcp',
      name: 'Disabled MCP',
      transport: 'loopback_http',
      endpointUrl: 'http://127.0.0.1:4398/mcp',
      requiredCapability: 'mcp.off@v1',
      maxRiskTier: 'R0',
      allowedDataClassifications: ['local_only'],
      maxCallsPerRun: 1,
      enabled: false,
    });
    await expect(
      bridge.mcp.invoke({
        runId: 'mcp-disabled-1',
        serverId: 'disabled-mcp',
        toolName: 'ping',
        arguments: {},
        auth: makeAuth({ grant: makeGrant({ capability: 'mcp.off@v1' }) }),
      })
    ).rejects.toThrow(/disabled/iu);
  });

  it('initializes better-sqlite3 local.db via MW_DESKTOP_HOME with DESKTOP_ADDONS, single-writer lockfile, and company isolation', async () => {
    const desktopHome = makeTempDir('mw-desktop-home-');
    const previousHome = process.env.MW_DESKTOP_HOME;
    process.env.MW_DESKTOP_HOME = desktopHome;

    try {
      const sidecar = new LocalSidecarController();
      activeSidecars.push(sidecar);

      const expectedDbPath = path.join(desktopHome, 'local.db');
      expect(sidecar.sqlitePath).toBe(expectedDbPath);
      expect(existsSync(`${expectedDbPath}.lock`)).toBe(true);

      // Concurrent writer on the same local.db is blocked by the OS single-writer lockfile.
      expect(() => new LocalSidecarController({ sqlitePath: expectedDbPath })).toThrow(
        /Single-writer SQLite lock/iu
      );

      const installed = await sidecar.initializeOrmAddons();
      expect(installed).toEqual(DESKTOP_ADDONS.map((addon) => addon.name));
      expect(sidecar.getState().registeredOrmModels).toEqual(
        expect.arrayContaining(['base.company', 'base.job', 'ai.agent', 'ai.work_contract'])
      );

      // Verify company-scoped ORM addon data isolation and outbox partition scoping.
      const companyA = await Company.query().insertAndFetch({ name: 'Desktop Company A' });
      const companyB = await Company.query().insertAndFetch({ name: 'Desktop Company B' });

      await ProviderProfile.query().insert({
        company_id: companyA.id,
        code: 'ollama-company-a',
        name: 'Company A Local Ollama',
        kind: 'ollama',
        endpoint_url: 'http://127.0.0.1:11434',
        secret_ref: 'MW_AI_OLLAMA_LOCAL',
        data_classification: 'local_only',
        enabled: true,
      });
      await ProviderProfile.query().insert({
        company_id: companyB.id,
        code: 'ollama-company-b',
        name: 'Company B Local Ollama',
        kind: 'ollama',
        endpoint_url: 'http://127.0.0.1:11434',
        secret_ref: 'MW_AI_OLLAMA_LOCAL',
        data_classification: 'local_only',
        enabled: true,
      });

      const digestA = buildArtifactDigest({
        artifactKind: 'report',
        content: 'company-a-report',
        dataClassification: 'local_only',
      });
      const digestB = buildArtifactDigest({
        artifactKind: 'report',
        content: 'company-b-report',
        dataClassification: 'local_only',
      });

      sidecar.setActiveCompany(companyA.id);
      sidecar.enqueuePcwEnvelope({
        envelopeId: 'env-comp-a',
        companyId: companyA.id,
        workContractId: 101,
        agentRunId: 'run-comp-a',
        agentId: 1,
        correlationId: 'corr-a',
        fencingToken: 1,
        runStatus: 'completed',
        artifacts: [digestA],
      });

      // Cross-company enqueue while scoped to Company A is rejected.
      expect(() =>
        sidecar.enqueuePcwEnvelope({
          envelopeId: 'env-comp-b-blocked',
          companyId: companyB.id,
          workContractId: 102,
          agentRunId: 'run-comp-b',
          agentId: 2,
          correlationId: 'corr-b',
          fencingToken: 1,
          runStatus: 'completed',
          artifacts: [digestB],
        })
      ).toThrow(/active sidecar session is scoped/iu);

      const recordsA = await sidecar.queryCompanyAddonRecords('ai.provider_profile');
      expect(recordsA.map((r) => r.code)).toEqual(['ollama-company-a']);
      await expect(
        sidecar.queryCompanyAddonRecords('ai.provider_profile', [], { companyId: companyB.id })
      ).rejects.toThrow(/Cross-company/iu);

      // Switch session to Company B: Company A rows and envelopes are isolated.
      sidecar.setActiveCompany(companyB.id);
      sidecar.enqueuePcwEnvelope({
        envelopeId: 'env-comp-b',
        companyId: companyB.id,
        workContractId: 102,
        agentRunId: 'run-comp-b',
        agentId: 2,
        correlationId: 'corr-b',
        fencingToken: 1,
        runStatus: 'completed',
        artifacts: [digestB],
      });

      const recordsB = await sidecar.queryCompanyAddonRecords('ai.provider_profile');
      expect(recordsB.map((r) => r.code)).toEqual(['ollama-company-b']);
      expect(sidecar.listEnvelopes().map((e) => e.envelopeId)).toEqual(['env-comp-b']);
      expect(() => sidecar.getEnvelope('env-comp-a')).toThrow(/another company partition/iu);

      const envScoped = sidecar.createScopedEnvironment();
      expect(envScoped.context.companyId).toBe(companyB.id);

      await sidecar.closeAsync();
      expect(existsSync(`${expectedDbPath}.lock`)).toBe(false);

      // Stale lockfile from a dead PID is reclaimed automatically.
      writeFileSync(
        `${expectedDbPath}.lock`,
        JSON.stringify({
          pid: 999999,
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          startTimeMs: Date.now() - 60_000,
          host: 'stale-host',
          sqlitePath: expectedDbPath,
          lockPath: `${expectedDbPath}.lock`,
        }),
        'utf8'
      );
      const reclaimed = new LocalSidecarController({
        sqlitePath: expectedDbPath,
        lockOptions: { isPidAlive: () => false },
      });
      activeSidecars.push(reclaimed);
      expect(reclaimed.getLockMetadata()?.pid).toBe(process.pid);
      reclaimed.close();
    } finally {
      if (previousHome === undefined) {
        delete process.env.MW_DESKTOP_HOME;
      } else {
        process.env.MW_DESKTOP_HOME = previousHome;
      }
    }
  });

  it('enforces frozen IPC bridge membrane, sender origin allowlist, MW_AI_* keychain, and cryptographic R3 nonces', async () => {
    const repoRoot = initTempGitRepo();
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        requireSignedApprovals: true,
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.isFrozen(bridge.worktree)).toBe(true);
    expect(Object.isFrozen(bridge.sidecar)).toBe(true);

    expect(bridge.verifySenderOrigin('http://127.0.0.1:5173', 'main')).toBe(true);
    expect(bridge.verifySenderOrigin('tauri://localhost', 'main')).toBe(true);
    expect(() => bridge.verifySenderOrigin('https://attacker.example.com', 'main')).toThrow(
      /untrusted sender origin/iu
    );
    expect(() => bridge.verifySenderOrigin('http://127.0.0.1:5173', 'child-webview')).toThrow(
      /non-main window label/iu
    );

    expect(() => bridge.keychain.registerSecretRef('OPENAI_API_KEY', 'sk-invalid-ref')).toThrow(
      /only MW_AI_\*/iu
    );
    bridge.keychain.registerSecretRef('MW_AI_C1_LOCAL_SECRET', 'top-secret-keychain-987654');
    expect(bridge.keychain.hasSecretRef('MW_AI_C1_LOCAL_SECRET')).toBe(true);
    expect(bridge.keychain.listSecretRefs()).toEqual(['MW_AI_C1_LOCAL_SECRET']);

    const r3Grant = makeGrant({
      allowedRiskTier: 'R3',
      allowedClassification: 'cloud_eligible',
      maxCallsPerRun: 5,
    });

    // Unsigned / forged R3 token is rejected when requireSignedApprovals is active.
    const forgedToken = makeApproval({
      runId: 'run-signed-r3',
      action: 'git.push_remote',
      nonce: 'forged-nonce',
      signature: 'deadbeef',
    });
    const forgedDecision = bridge.risk.evaluate({
      runId: 'run-signed-r3',
      action: 'git.push_remote',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'cloud_eligible',
      grant: r3Grant,
      humanApproval: forgedToken,
    });
    expect(forgedDecision.allowed).toBe(false);
    expect(forgedDecision.reasonCode).toBe('HUMAN_APPROVAL_FORGED');

    // Native host-issued cryptographic token succeeds once and rejects replay.
    const issuedToken = bridge.issueNativeApprovalToken({
      approvedByUserId: 7,
      action: 'git.push_remote',
      runId: 'run-signed-r3',
    });
    const validDecision = bridge.risk.evaluate({
      runId: 'run-signed-r3',
      action: 'git.push_remote',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'cloud_eligible',
      grant: r3Grant,
      humanApproval: issuedToken,
    });
    expect(validDecision.allowed).toBe(true);

    const replayDecision = bridge.risk.evaluate({
      runId: 'run-signed-r3',
      action: 'git.push_remote',
      companyId: 1,
      agentId: 10,
      workContractId: 42,
      expectedPolicyVersion: 1,
      dataClassification: 'cloud_eligible',
      grant: r3Grant,
      humanApproval: issuedToken,
    });
    expect(replayDecision.allowed).toBe(false);
    expect(replayDecision.reasonCode).toBe('HUMAN_APPROVAL_REPLAYED');
  });

  it('reconciles upstream HTTP sync with exponential backoff retry, 409 quarantine, and CLI sidecar health daemon', async () => {
    const repoRoot = initTempGitRepo();
    const homeDir = makeTempDir('mw-desktop-cli-home-');
    let pcwAttempts = 0;

    const apiServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const url = req.url ?? '/';
        const bodyText = Buffer.concat(chunks).toString('utf8');
        res.setHeader('content-type', 'application/json');

        if (req.method === 'POST' && url === '/api/ai/desktop/lease') {
          const body = JSON.parse(bodyText) as { hostId: string };
          res.writeHead(200);
          res.end(
            JSON.stringify({
              granted: true,
              leaseOwner: `desktop:${body.hostId}`,
              fencingToken: 4,
              leaseUntil: new Date(Date.now() + 60_000).toISOString(),
            })
          );
          return;
        }

        if (req.method === 'GET' && url.startsWith('/api/ai/desktop/pull')) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              companyId: 1,
              nextCursor: 'cursor-2',
              workContracts: [{ id: 42, code: 'wc-1' }],
              capabilityGrants: [],
              executionPolicies: [],
            })
          );
          return;
        }

        if (req.method === 'POST' && url === '/api/ai/desktop/artifacts/upload') {
          const body = JSON.parse(bodyText) as { artifact: { storageKey: string; sha256: string } };
          res.writeHead(200);
          res.end(
            JSON.stringify({
              storageKey: body.artifact.storageKey,
              sha256: body.artifact.sha256,
              verified: true,
            })
          );
          return;
        }

        if (req.method === 'POST' && url === '/api/ai/desktop/pcw-sync') {
          const env = JSON.parse(bodyText) as PcwSyncEnvelope;
          if (env.envelopeId === 'env-409') {
            res.writeHead(409);
            res.end(JSON.stringify({ message: 'SHA-256 or fencing conflict on server' }));
            return;
          }
          pcwAttempts += 1;
          if (pcwAttempts === 1) {
            res.writeHead(503);
            res.end('Temporary upstream outage');
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({ outcome: 'synced', upstreamRecordId: 8801 }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
      });
    });

    await new Promise<void>((resolve) => {
      apiServer.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = apiServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind mock upstream API server');
      }
      const apiBaseUrl = `http://127.0.0.1:${address.port}`;

      const syncClient = new DesktopUpstreamSyncClient({
        apiBaseUrl,
        authToken: () => 'desktop-session-jwt',
        maxRetries: 2,
        baseDelayMs: 5,
        maxDelayMs: 20,
      });

      const leaseResp = await syncClient.claimWorkContractLease({
        companyId: 1,
        workContractId: 42,
        hostId: 'workstation-1',
      });
      expect(leaseResp.granted).toBe(true);
      expect(leaseResp.fencingToken).toBe(4);

      const pullResp = await syncClient.pullCompanySnapshot({ companyId: 1 });
      expect(pullResp.nextCursor).toBe('cursor-2');
      expect(pullResp.workContracts).toHaveLength(1);

      const payloadBytes = Buffer.from('verified-evidence-payload', 'utf8');
      const artifact = buildArtifactDigest({
        artifactKind: 'evidence_bundle',
        content: payloadBytes,
        dataClassification: 'local_only',
      });
      const uploadResp = await syncClient.uploadArtifact({
        companyId: 1,
        workContractId: 42,
        artifact,
        contentBase64: payloadBytes.toString('base64'),
      });
      expect(uploadResp.verified).toBe(true);

      const cliOpts = parseDesktopCliArgs([
        '--repo-root',
        repoRoot,
        '--desktop-home',
        homeDir,
        '--api-url',
        apiBaseUrl,
        '--skip-addons',
      ]);
      const daemon = await startDesktopSidecarDaemon(cliOpts);
      try {
        const healthRes = await fetch(daemon.healthUrl);
        expect(healthRes.status).toBe(200);
        const healthJson = (await healthRes.json()) as { ok: boolean; hostSurface: string };
        expect(healthJson.ok).toBe(true);
        expect(healthJson.hostSurface).toBe('apps/board');

        daemon.bridge.sidecar.enqueuePcwEnvelope({
          envelopeId: 'env-retry-ok',
          companyId: 1,
          workContractId: 42,
          agentRunId: 'run-http-1',
          agentId: 10,
          correlationId: 'corr-http-1',
          fencingToken: 4,
          runStatus: 'completed',
          artifacts: [artifact],
        });
        daemon.bridge.sidecar.enqueuePcwEnvelope({
          envelopeId: 'env-409',
          companyId: 1,
          workContractId: 42,
          agentRunId: 'run-http-2',
          agentId: 10,
          correlationId: 'corr-http-2',
          fencingToken: 4,
          runStatus: 'completed',
          artifacts: [artifact],
        });

        const batch = await daemon.bridge.sidecar.syncPending(syncClient);
        expect(batch.attempted).toBe(2);
        expect(batch.synced).toBe(1);
        expect(batch.conflicts).toBe(1);
        expect(pcwAttempts).toBe(2);
        expect(syncClient.getQuarantinedEnvelopes().map((q) => q.envelopeId)).toEqual(['env-409']);
        expect(syncClient.clearQuarantine('env-409')).toBe(true);
      } finally {
        await daemon.stop();
      }
    } finally {
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    }
  });

  it('produces an R0 revision-pinned RepoSnapshot with manifests, scripts, docs, dirty tracking, and .env omission (M13.02)', async () => {
    const repoRoot = initTempGitRepo();
    writeFileSync(
      path.join(repoRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'fixture-radar-app',
          version: '1.2.3',
          scripts: {
            build: 'tsc',
            test: 'vitest run',
          },
        },
        null,
        2
      ),
      'utf8'
    );
    execFileSync('git', ['add', 'package.json'], { cwd: repoRoot, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add package.json'], { cwd: repoRoot, stdio: 'pipe' });

    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        knownSecrets: ['super-secret-value-12345'],
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    const lease = await bridge.worktree.acquire({ runId: 'radar-1' });
    const r0Auth = makeAuth({
      grant: makeGrant({
        allowedRiskTier: 'R0',
        maxCallsPerRun: 10,
      }),
    });

    const cleanSnapshot = await bridge.worktree.repoSnapshot('radar-1', r0Auth, {
      rootLabel: 'fixture-radar',
    });

    expect(cleanSnapshot.schemaVersion).toBe(1);
    expect(cleanSnapshot.rootLabel).toBe('fixture-radar');
    expect(cleanSnapshot.gitRevision?.headCommit).toBe(lease.headCommit);
    expect(cleanSnapshot.gitRevision?.branch).toBe(lease.branchName);
    expect(cleanSnapshot.gitRevision?.dirty).toBe(false);
    expect(cleanSnapshot.incomplete).toBe(false);
    expect(cleanSnapshot.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(cleanSnapshot.contentSha256).toMatch(/^[a-f0-9]{64}$/u);

    expect(cleanSnapshot.manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'package.json',
          kind: 'package.json',
          name: 'fixture-radar-app',
          version: '1.2.3',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      ])
    );
    expect(cleanSnapshot.scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ manifestPath: 'package.json', name: 'build', command: 'tsc' }),
        expect.objectContaining({
          manifestPath: 'package.json',
          name: 'test',
          command: 'vitest run',
        }),
      ])
    );
    expect(cleanSnapshot.docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'docs/readme.md',
          title: 'Notes',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      ])
    );

    const serialized = JSON.stringify(cleanSnapshot);
    expect(serialized).not.toContain('.env');
    expect(serialized).not.toContain('super-secret-value-12345');
    expect(serialized).not.toContain('PRIVATE-KEY-DO-NOT-READ');

    // Mutate worktree and confirm dirty flag flips to true.
    const r1Auth = makeAuth({ grant: makeGrant({ allowedRiskTier: 'R1', maxCallsPerRun: 10 }) });
    await bridge.worktree.writeFile(
      'radar-1',
      'src/app.ts',
      'export const appVersion = 9;\n',
      r1Auth
    );
    const dirtySnapshot = await bridge.worktree.repoSnapshot('radar-1', r0Auth);
    expect(dirtySnapshot.gitRevision?.dirty).toBe(true);

    // maxFiles cap marks snapshot incomplete with explicit omittedReasons.
    const cappedSnapshot = await bridge.worktree.repoSnapshot('radar-1', r0Auth, { maxFiles: 1 });
    expect(cappedSnapshot.incomplete).toBe(true);
    expect(cappedSnapshot.omittedReasons.length).toBeGreaterThan(0);

    await bridge.worktree.release('radar-1');
  });

  it('fails closed on revoked grant, disallowed path, or R4 secret root in repoSnapshot (M13.02)', async () => {
    const repoRoot = initTempGitRepo();
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        allowedPathPrefixes: ['src'],
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    await bridge.worktree.acquire({ runId: 'radar-sec-1' });

    const revokedAuth = makeAuth({
      grant: makeGrant({
        allowedRiskTier: 'R0',
        status: 'revoked',
        revokedAt: new Date().toISOString(),
      }),
    });
    await expect(bridge.worktree.repoSnapshot('radar-sec-1', revokedAuth)).rejects.toThrow(
      /revoked|denied|grant/iu
    );

    const r0Auth = makeAuth({
      grant: makeGrant({
        allowedRiskTier: 'R0',
        maxCallsPerRun: 10,
      }),
    });
    await expect(
      bridge.worktree.repoSnapshot('radar-sec-1', r0Auth, { targetPath: 'docs' })
    ).rejects.toThrow(/allowlist|outside/iu);

    await expect(
      bridge.worktree.repoSnapshot('radar-sec-1', r0Auth, { targetPath: '.env' })
    ).rejects.toThrow(/prohibited|secret|sensitive|R4/iu);

    await expect(
      bridge.worktree.repoSnapshot('radar-sec-1', r0Auth, { targetPath: 'secrets/token.key' })
    ).rejects.toThrow(/prohibited|secret|sensitive|R4/iu);

    const disjointGrantAuth = makeAuth({
      grant: makeGrant({
        allowedRiskTier: 'R0',
        allowedPaths: ['docs'],
        maxCallsPerRun: 10,
      }),
    });
    await expect(bridge.worktree.repoSnapshot('radar-sec-1', disjointGrantAuth)).rejects.toThrow(
      /overlapping|allowed/iu
    );

    await bridge.worktree.release('radar-sec-1');
  });

  it('compiles a deterministic R0 ExecutionPacket from worktree lease and rejects out-of-lease/unsafe scope (M13.04)', async () => {
    const repoRoot = initTempGitRepo();
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        allowedPathPrefixes: ['src'],
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    const lease = await bridge.worktree.acquire({ runId: 'forge-1', allowedPaths: ['src'] });
    const r0Auth = makeAuth({
      grant: makeGrant({
        allowedRiskTier: 'R0',
        allowedPaths: ['src'],
        maxCallsPerRun: 10,
      }),
    });

    const packet = await bridge.worktree.compileExecutionPacket('forge-1', r0Auth, {
      allowedCapabilities: ['repo.read@v1'],
      verificationCommands: ['pnpm --filter @moonwitness/desktop test'],
      contract: {
        id: 77,
        code: 'wc_forge_1',
        companyId: 1,
        title: 'Inspect Desktop Module',
        objective: 'Compile revision-pinned packet for src inspection.',
        scopePaths: ['src'],
        protectedPaths: ['.env', '.git', 'apps/api'],
        riskTier: 'R0',
        dataClassification: 'local_only',
        criteriaLockedAt: '2026-11-22T01:00:00.000Z',
        criteria: [
          {
            code: 'c_inspect',
            title: 'Verify src module',
            verificationMethod: 'source_inspection',
            requiredEvidenceType: 'evidence_bundle',
            mandatory: true,
          },
        ],
      },
    });

    expect(packet.contractCode).toBe('wc_forge_1');
    expect(packet.repoRevision?.headCommit).toBe(lease.headCommit);
    expect(packet.targetBranch).toBe(lease.branchName);
    expect(packet.allowedScopePaths).toEqual(['src']);
    expect(packet.markdown).toContain('# Execution Packet: wc_forge_1');
    expect(packet.contentSha256).toMatch(/^[a-f0-9]{64}$/u);

    // Out-of-lease scope path is rejected.
    await expect(
      bridge.worktree.compileExecutionPacket('forge-1', r0Auth, {
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['pnpm test'],
        contract: {
          id: 78,
          code: 'wc_forge_escape',
          companyId: 1,
          title: 'Out of lease',
          objective: 'Attempt out-of-lease edit',
          scopePaths: ['docs'],
          riskTier: 'R0',
          dataClassification: 'local_only',
          criteriaLockedAt: '2026-11-22T01:00:00.000Z',
          criteria: [
            {
              code: 'c1',
              title: 'c1',
              verificationMethod: 'automated_test',
              requiredEvidenceType: 'evidence_bundle',
              mandatory: true,
            },
          ],
        },
      })
    ).rejects.toThrow(/outside worktree lease/iu);

    // Sensitive .env scope path fails closed.
    await expect(
      bridge.worktree.compileExecutionPacket('forge-1', r0Auth, {
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['pnpm test'],
        contract: {
          id: 79,
          code: 'wc_forge_secret',
          companyId: 1,
          title: 'Secret read',
          objective: 'Read env',
          scopePaths: ['.env'],
          riskTier: 'R0',
          dataClassification: 'local_only',
          criteriaLockedAt: '2026-11-22T01:00:00.000Z',
          criteria: [
            {
              code: 'c1',
              title: 'c1',
              verificationMethod: 'automated_test',
              requiredEvidenceType: 'evidence_bundle',
              mandatory: true,
            },
          ],
        },
      })
    ).rejects.toThrow(/Sensitive or unsafe/iu);

    // Cross-company mismatch fails closed.
    await expect(
      bridge.worktree.compileExecutionPacket('forge-1', r0Auth, {
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['pnpm test'],
        contract: {
          id: 80,
          code: 'wc_forge_tenant',
          companyId: 2,
          title: 'Wrong tenant',
          objective: 'Wrong tenant',
          scopePaths: ['src'],
          riskTier: 'R0',
          dataClassification: 'local_only',
          criteriaLockedAt: '2026-11-22T01:00:00.000Z',
          criteria: [
            {
              code: 'c1',
              title: 'c1',
              verificationMethod: 'automated_test',
              requiredEvidenceType: 'evidence_bundle',
              mandatory: true,
            },
          ],
        },
      })
    ).rejects.toThrow(/Cross-company/iu);

    await bridge.worktree.release('forge-1');
  });

  it('reports scopeClean and outOfScopeFiles on inspectDiff for in-scope vs drifted edits (M13.05)', async () => {
    const repoRoot = initTempGitRepo();
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
        allowedPathPrefixes: ['src'],
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    const lease = await bridge.worktree.acquire({ runId: 'scope-1', allowedPaths: ['src'] });
    const r1Auth = makeAuth({
      grant: makeGrant({
        allowedRiskTier: 'R1',
        allowedPaths: ['src'],
        maxCallsPerRun: 10,
      }),
    });

    await bridge.worktree.writeFile(
      'scope-1',
      'src/app.ts',
      'export const appVersion = 42;\n',
      r1Auth
    );

    const inScopeDiff = await bridge.worktree.diff('scope-1');
    expect(inScopeDiff.clean).toBe(false);
    expect(inScopeDiff.scopeClean).toBe(true);
    expect(inScopeDiff.outOfScopeFiles).toEqual([]);

    // Simulate out-of-scope drift directly in the worktree outside allowedPaths.
    writeFileSync(path.join(lease.worktreePath, 'docs', 'drift.md'), '# Drift\n', 'utf8');

    const driftedDiff = await bridge.worktree.diff('scope-1');
    expect(driftedDiff.clean).toBe(false);
    expect(driftedDiff.scopeClean).toBe(false);
    expect(driftedDiff.outOfScopeFiles).toContain('docs/drift.md');

    await bridge.worktree.release('scope-1');
  });

  it('detects advisory-only capability overlap via R0 bridge and rejects unauthorized/cross-company requests (M13.06)', async () => {
    const repoRoot = initTempGitRepo();
    writeFileSync(
      path.join(repoRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'fixture-overlap-app',
          version: '1.0.0',
          scripts: { test: 'vitest run' },
        },
        null,
        2
      ),
      'utf8'
    );
    execFileSync('git', ['add', 'package.json'], { cwd: repoRoot, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add package.json for overlap'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    const lease = await bridge.worktree.acquire({ runId: 'overlap-1' });
    const r0Auth = makeAuth({
      companyId: 1,
      grant: makeGrant({
        companyId: 1,
        allowedRiskTier: 'R0',
        maxCallsPerRun: 20,
      }),
    });

    const report = await bridge.worktree.detectOverlap('overlap-1', r0Auth, {
      requirements: [
        {
          id: 'req-existing-app',
          title: 'Application entry point',
          description: 'Provide src/app.ts application version export',
          keywords: ['appVersion'],
          targetPaths: ['src/app.ts'],
        },
        {
          id: 'req-missing-billing',
          title: 'Quantum ledger billing engine',
          description: 'Unimplemented billing ledger module',
          keywords: ['quantumLedgerBilling'],
          targetPaths: ['packages/quantum-billing'],
        },
      ],
      existingTasks: [
        {
          id: 'task-101',
          code: 'TSK-101',
          title: 'Update src/app.ts application entry point',
          status: 'in_progress',
          scopePaths: ['src/app.ts'],
        },
      ],
    });

    expect(report.advisoryOnly).toBe(true);
    expect(report.automatedMutationsAllowed).toBe(false);
    expect(report.companyId).toBe(1);
    expect(report.gitRevision?.headCommit).toBe(lease.headCommit);
    expect(report.findings).toHaveLength(2);

    const existingFinding = report.findings.find((f) => f.requirementId === 'req-existing-app');
    expect(existingFinding?.status).toBe('overlapping');
    expect(existingFinding?.duplicateTaskIds).toContain('task-101');
    expect(existingFinding?.advisoryOnly).toBe(true);

    const missingFinding = report.findings.find((f) => f.requirementId === 'req-missing-billing');
    expect(missingFinding?.status).toBe('missing');

    // Cross-company auth/grant mismatch is rejected.
    const crossCompanyAuth = makeAuth({
      companyId: 2,
      grant: makeGrant({ companyId: 1, allowedRiskTier: 'R0', maxCallsPerRun: 10 }),
    });
    await expect(
      bridge.worktree.detectOverlap('overlap-1', crossCompanyAuth, { requirements: [] })
    ).rejects.toThrow(/company|cross-company|denied/iu);

    // Revoked grant is rejected.
    const revokedAuth = makeAuth({
      grant: makeGrant({
        allowedRiskTier: 'R0',
        status: 'revoked',
        revokedAt: new Date().toISOString(),
      }),
    });
    await expect(
      bridge.worktree.detectOverlap('overlap-1', revokedAuth, { requirements: [] })
    ).rejects.toThrow(/revoked|denied|grant/iu);

    // R4 secret targetPath is rejected.
    await expect(
      bridge.worktree.detectOverlap('overlap-1', r0Auth, {
        requirements: [],
        snapshotOptions: { targetPath: '.env' },
      })
    ).rejects.toThrow(/prohibited|secret|sensitive|R4/iu);

    await bridge.worktree.release('overlap-1');
  });

  it('unifies the autonomous engineering execution loop (todo-sync, work-contract dispatch, and sandbox verification)', async () => {
    const repoRoot = initTempGitRepo();
    const bridge = createDesktopHarnessBridge(
      {
        repoRoot,
        sqlitePath: ':memory:',
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:3000',
      },
      { autoAttach: false }
    );
    activeBridges.push(bridge);

    let syncedTasksCount = 0;
    let contractDispatched = false;
    let stageSynced = false;

    const mockApiServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const url = req.url ?? '/';
        const bodyText = Buffer.concat(chunks).toString('utf8');
        res.setHeader('content-type', 'application/json');

        if (req.method === 'POST' && url.includes('/todo-sync')) {
          const body = JSON.parse(bodyText) as { tasks: unknown[] };
          syncedTasksCount = body.tasks?.length ?? 0;
          res.writeHead(200);
          res.end(
            JSON.stringify({
              success: true,
              data: { imported: 1, updated: 0, snapshots: body.tasks },
            })
          );
          return;
        }

        if (req.method === 'POST' && url.includes('/work-contract') && !url.includes('/sync-stage')) {
          contractDispatched = true;
          res.writeHead(201);
          res.end(
            JSON.stringify({
              success: true,
              created: true,
              data: {
                id: 55,
                code: 'wc_task_123',
                status: 'running',
              },
            })
          );
          return;
        }

        if (req.method === 'POST' && url.includes('/work-contract/sync-stage')) {
          stageSynced = true;
          res.writeHead(200);
          res.end(
            JSON.stringify({
              success: true,
              data: {
                advanced: true,
                task: { status: 'done' },
                work_contract: { status: 'accepted' },
              },
            })
          );
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
      });
    });

    await new Promise<void>((resolve) => mockApiServer.listen(0, '127.0.0.1', () => resolve()));

    try {
      const addr = mockApiServer.address();
      if (!addr || typeof addr === 'string') throw new Error('Cannot bind mock API');

      const syncClient = new DesktopUpstreamSyncClient({
        apiBaseUrl: `http://127.0.0.1:${addr.port}`,
        authToken: 'test-token',
      });

      const syncResult = await syncClient.syncTodoTasksToProject(1, [
        {
          code: 'TASK-001',
          title: 'Implement autonomous loop',
          priority: 'high',
          status: 'in_progress',
        },
      ]);
      expect(syncResult.imported).toBe(1);
      expect(syncedTasksCount).toBe(1);

      const auth = makeAuth({
        grant: makeGrant({
          capability: 'desktop.worktree@v1',
          allowedRiskTier: 'R2',
          allowedPaths: ['src'],
        }),
      });

      const outcome = await executeProjectTaskInSandbox(bridge, syncClient, 123, auth, {
        command: 'git',
        commandArgs: ['status', '--short'],
        commitMessage: 'feat(loop): verified autonomous task execution',
      });

      expect(contractDispatched).toBe(true);
      expect(stageSynced).toBe(true);
      expect(outcome.workContractId).toBe(55);
      expect(outcome.workContractCode).toBe('wc_task_123');
      expect(outcome.exitCode).toBe(0);
      expect(outcome.advanced).toBe(true);
      expect(outcome.taskStatus).toBe('done');
    } finally {
      await new Promise<void>((resolve) => mockApiServer.close(() => resolve()));
    }
  });
});
