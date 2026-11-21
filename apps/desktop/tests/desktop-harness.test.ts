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
  LocalSidecarController,
  buildArtifactDigest,
  createDesktopHarnessBridge,
  type DesktopActionAuthContext,
  type DesktopBridgeHostSurface,
  type DesktopCapabilityBridge,
  type DesktopCapabilityGrant,
  type HumanApprovalToken,
  type LocalMcpServerConfig,
  type PcwSyncEnvelope,
  type UpstreamPcwSyncTransport,
} from '../src/index.js';

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
});
