import { describe, expect, it, vi } from 'vitest';

import { CapabilityGateway, type ToolEffectAcknowledgement } from '../src/capability-gateway.js';
import { InMemoryCapabilityGrantStore } from '../src/index.js';
import { buildEphemeralSandboxManifest } from '../src/sandbox-runner.js';
import type { WorkspaceSandboxClient } from '../src/workspace-contract.js';
import {
  WORKSPACE_TOOL_MATRIX,
  buildWorkspaceEvidence,
  isWorkspaceToolAllowed,
  registerWorkspaceTools,
} from '../src/workspace-tools.js';

const manifest = buildEphemeralSandboxManifest({
  runId: 'run-1',
  imageRef: `registry.example.com/mw/sandbox@sha256:${'b'.repeat(64)}`,
  command: ['/bin/sh', '-c', 'exec sleep 2147483647'],
  cpuCores: 1,
  memoryMb: 512,
  timeoutMs: 10_000,
});

function fakeClient(
  opts: { readonly exitCode?: number; readonly outsideScope?: boolean } = {}
): WorkspaceSandboxClient {
  const base = {
    createWorkspace: async () => {
      throw new Error('unused');
    },
    snapshotWorkspace: async () => {
      throw new Error('unused');
    },
    executeCheck: async () => ({
      runId: 'run-1',
      check: 'node-test' as const,
      exitCode: opts.exitCode ?? 0,
      durationMs: 1,
      timedOut: false,
      cancelled: false,
      truncated: false,
      stdout: 'ok',
      stderr: '',
      stdoutBytes: 2,
      stderrBytes: 0,
      totalOutputBytes: 2,
    }),
    listWorkspace: async () => ({
      runId: 'run-1',
      paths: ['src/app.ts'],
      truncated: false as const,
    }),
    readWorkspaceFile: async () => ({
      runId: 'run-1',
      path: 'src/app.ts',
      content: 'x',
      sizeBytes: 1,
      truncated: false,
    }),
    applyWorkspacePatch: async () => ({ runId: 'run-1', files: ['src/app.ts'] }),
    diffWorkspace: async () => ({
      runId: 'run-1',
      headCommit: 'a'.repeat(40),
      clean: false,
      scopeClean: true as const,
      files: [{ path: opts.outsideScope ? 'secrets/key' : 'src/app.ts', status: 'M' }],
      unifiedDiff: 'diff --git a/src/app.ts b/src/app.ts\n+1\n',
      diffSha256: 'c'.repeat(64),
      sizeBytes: 40,
      truncated: false as const,
    }),
    commitLocal: async () => ({
      runId: 'run-1',
      commitSha: 'd'.repeat(40),
      branch: 'local-work',
      files: [],
      message: 'm',
      pushed: false as const,
    }),
    rollbackWorkspace: async () => {
      throw new Error('unused');
    },
    cancelWorkspace: async () => {
      throw new Error('unused');
    },
    destroyWorkspace: async () => {
      throw new Error('unused');
    },
    getWorkspace: async () => {
      throw new Error('unused');
    },
    reconcileWorkspaces: async () => ({
      removedWorkspaceIds: [],
      removedContainerIds: [],
      retainedWorkspaceIds: [],
    }),
  };
  return base;
}

describe('typed workspace tools', () => {
  it('exposes an explicit R0-R3 matrix with publication disabled and R4 absent', () => {
    expect(WORKSPACE_TOOL_MATRIX.some((t) => t.tier === 'R4')).toBe(false);
    expect(WORKSPACE_TOOL_MATRIX.find((t) => t.name === 'workspace.request_publish')?.enabled).toBe(
      false
    );
    expect(isWorkspaceToolAllowed('workspace.apply_patch')).toBe(true);
    expect(isWorkspaceToolAllowed('workspace.request_publish')).toBe(false);
    expect(isWorkspaceToolAllowed('shell.exec')).toBe(false);
  });

  it('registers only enabled tools on the capability gateway', () => {
    const gateway = new CapabilityGateway();
    const names = registerWorkspaceTools({
      gateway,
      client: fakeClient(),
      allowedPaths: ['src'],
    });
    expect(names).toContain('workspace.apply_patch');
    expect(names).not.toContain('workspace.request_publish');
    expect(gateway.listRegisteredTools().every((t) => t.riskTier !== 'R4')).toBe(true);
  });

  it('produces deterministic evidence and fails on a failing check', async () => {
    const passing = await buildWorkspaceEvidence({
      client: fakeClient(),
      manifest,
      runId: 'run-1',
      check: 'node-test',
    });
    const again = await buildWorkspaceEvidence({
      client: fakeClient(),
      manifest,
      runId: 'run-1',
      check: 'node-test',
    });
    expect(passing).toEqual(again);
    expect(passing.passed).toBe(true);
    expect(passing.automatedPromotionAllowed).toBe(false);
    const failing = await buildWorkspaceEvidence({
      client: fakeClient({ exitCode: 1 }),
      manifest,
      runId: 'run-1',
      check: 'node-test',
    });
    expect(failing.passed).toBe(false);
  });

  it('uses durable effect acknowledgement, audit sink and quota store', async () => {
    const acknowledgements = new Map<string, ToolEffectAcknowledgement>();
    const auditEntries: unknown[] = [];
    const gateway = new CapabilityGateway({
      effectStore: {
        find: (key) => acknowledgements.get(key) ?? null,
        acknowledge: (record) => {
          acknowledgements.set(record.key, record);
        },
      },
      auditSink: {
        record: (entry) => {
          auditEntries.push(entry);
        },
      },
      quotaStore: {
        getRunUsage: () => 0,
        incrementRunUsage: () => 1,
      },
    });
    gateway.denyTool('workspace.shell');
    gateway.registerTool({
      name: 'workspace.shell',
      riskTier: 'R4',
      capability: 'workspace.shell@v1',
      inputSchema: { type: 'object' },
      execute: () => ({ denied: false }),
    });
    const context = {
      actorType: 'agent' as const,
      actorId: 1,
      companyId: 1,
      runId: 'run-1',
      correlationId: 'corr-1',
      policyVersion: 1,
    };
    const denied = await gateway.invoke('workspace.shell', {}, context);
    if (denied.allowed) throw new Error('Expected R4 tool denial');
    expect(denied.denial.reasonCode).toBe('R4_ALWAYS_DENIED');
    expect(auditEntries.length).toBe(1);
  });

  it('rejects inline fabricated context in strict mode', async () => {
    const gateway = new CapabilityGateway({ allowInlineInvocation: false });
    await expect(
      gateway.invoke({ toolName: 'workspace.list', companyId: 1, args: {} })
    ).rejects.toThrow(/Inline capability invocation is disabled/u);
  });

  it('normalizes repeated slashes in grant allowedPaths and requested paths in linear time', async () => {
    const nowMs = Date.parse('2026-11-25T00:00:00.000Z');
    const grantStore = new InMemoryCapabilityGrantStore({ now: () => nowMs });
    grantStore.setPolicyVersion(1, 1);
    grantStore.upsertGrant({
      grantId: 'grant-slash-scope',
      companyId: 1,
      agentId: 1,
      capability: 'workspace.read@v1',
      scope: { allowedPaths: [`src${'/'.repeat(20_000)}`] },
      policyVersion: 1,
      maxCallsPerRun: 10,
      issuedBy: 1,
      issuedAt: '2026-11-24T00:00:00.000Z',
      expiresAt: '2026-11-26T00:00:00.000Z',
      status: 'active',
    });

    const gateway = new CapabilityGateway({ grantStore, clock: { now: () => nowMs } });
    gateway.registerTool({
      name: 'workspace.read',
      riskTier: 'R0',
      sideEffect: 'read_only',
      capability: 'workspace.read@v1',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: (args) => ({ path: args.path }),
    });

    const context = {
      actorType: 'agent' as const,
      actorId: 1,
      companyId: 1,
      runId: 'run-slash-scope',
      correlationId: 'corr-slash-scope',
      policyVersion: 1,
    };

    const allowed = await gateway.invoke(
      'workspace.read',
      { path: `${'/'.repeat(20_000)}src/app.ts` },
      context
    );
    expect(allowed.allowed).toBe(true);

    const deniedOutside = await gateway.invoke(
      'workspace.read',
      { path: `${'/'.repeat(20_000)}secrets/key` },
      context
    );
    expect(deniedOutside.allowed).toBe(false);
    if (!deniedOutside.allowed) expect(deniedOutside.denial.reasonCode).toBe('SCOPE_PATH_DENIED');

    const deniedTraversal = await gateway.invoke(
      'workspace.read',
      { path: `${'\\'.repeat(20_000)}src/../secrets/key` },
      context
    );
    expect(deniedTraversal.allowed).toBe(false);
    if (!deniedTraversal.allowed)
      expect(deniedTraversal.denial.reasonCode).toBe('SCOPE_PATH_DENIED');
  });
});
