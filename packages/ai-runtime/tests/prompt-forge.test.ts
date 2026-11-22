import { describe, expect, it } from 'vitest';
import { compileExecutionPacket, createRedactor, type RepoSnapshot } from '../src/index.js';

function makeSnapshot(): RepoSnapshot {
  return {
    schemaVersion: 1,
    rootLabel: 'fixture-repo',
    capturedAt: '2026-11-22T00:00:00.000Z',
    gitRevision: {
      headCommit: 'abcdef1234567890',
      branch: 'dev',
      dirty: false,
      capturedAt: '2026-11-22T00:00:00.000Z',
    },
    scannedFileCount: 3,
    manifests: [
      {
        path: 'packages/ai-runtime/package.json',
        kind: 'package.json',
        sha256: 'a'.repeat(64),
        sizeBytes: 512,
        truncated: false,
        name: '@moonwitness/ai-runtime',
        version: '1.0.0-rc.1',
      },
    ],
    scripts: [
      {
        manifestPath: 'packages/ai-runtime/package.json',
        manifestSha256: 'a'.repeat(64),
        name: 'test',
        command: 'vitest run',
      },
    ],
    docs: [
      {
        path: 'docs/architecture/rock-soul-flow-reuse-map.md',
        sha256: 'b'.repeat(64),
        sizeBytes: 1024,
        title: 'ROCKSOUL FLOW Capability Audit',
        headings: ['ROCKSOUL FLOW Capability Audit'],
        truncated: false,
      },
    ],
    entryPoints: [
      {
        path: 'packages/ai-runtime/src/index.ts',
        sha256: 'c'.repeat(64),
        sizeBytes: 256,
      },
    ],
    observations: [],
    inferences: [],
    incomplete: false,
    omittedReasons: [],
    contentSha256: 'd'.repeat(64),
    snapshotSha256: 'e'.repeat(64),
  };
}

describe('compileExecutionPacket (M13.04)', () => {
  it('compiles a deterministic redacted execution packet from locked contract + RepoSnapshot', () => {
    const redactor = createRedactor(['sk-live-secret-987654']);
    const snapshot = makeSnapshot();

    const baseInput = {
      repoSnapshot: snapshot,
      redactor,
      allowedCapabilities: ['repo.read@v1', 'worktree.write@v1'],
      verificationCommands: ['pnpm --filter @moonwitness/ai-runtime test'],
      approvedSkills: [
        {
          code: 'sop.bounded_edit',
          version: 1,
          title: 'Bounded Scope Editing',
          sopBody: 'Edit only allowed files. Token sk-live-secret-987654 must be scrubbed.',
        },
      ],
      policyLimits: {
        maxSteps: 12,
        maxWallClockSeconds: 300,
        maxTokensPerRun: 50_000,
        maxCostMicrosPerRun: 250_000,
      },
      contract: {
        id: 42,
        code: 'wc_m13_04',
        companyId: 1,
        title: 'Compile Prompt Forge Packet',
        objective: 'Implement bounded packet compiler without leaking sk-live-secret-987654.',
        scopePaths: ['packages/ai-runtime/src', 'packages/ai-runtime/tests'],
        protectedPaths: ['.env', '.git', 'apps/api'],
        nonGoals: ['Do not create a second prompt DB'],
        expectedDeliverables: ['Deterministic Markdown packet'],
        constraints: ['Authorization: Bearer sk-live-secret-987654 must be redacted'],
        riskTier: 'R1' as const,
        dataClassification: 'local_only' as const,
        criteriaLockedAt: '2026-11-22T01:00:00.000Z',
        criteria: [
          {
            code: 'prompt_forge_tests',
            title: 'Pass unit tests',
            verificationMethod: 'automated_test' as const,
            requiredEvidenceType: 'evidence_bundle',
            mandatory: true,
          },
        ],
      },
    };

    const p1 = compileExecutionPacket({ ...baseInput, compiledAt: '2026-11-22T02:00:00.000Z' });
    const p2 = compileExecutionPacket({ ...baseInput, compiledAt: '2026-11-22T03:00:00.000Z' });

    expect(p1.contentSha256).toBe(p2.contentSha256);
    expect(p1.packetSha256).not.toBe(p2.packetSha256);
    expect(p1.targetBranch).toBe('dev');
    expect(p1.repoSnapshotSha256).toBe(snapshot.contentSha256);
    expect(p1.markdown).toContain('# Execution Packet: wc_m13_04');
    expect(p1.markdown).toContain('packages/ai-runtime/src');
    expect(p1.markdown).toContain('Never mark work `accepted` locally');
    expect(JSON.stringify(p1)).not.toContain('sk-live-secret-987654');
  });

  it('fails closed on empty/unlocked criteria, traversal/.env scope, boundary conflict, or R4 commands', () => {
    const snapshot = makeSnapshot();
    const validContract = {
      id: 1,
      code: 'wc_fail',
      companyId: 1,
      title: 'Test',
      objective: 'Test',
      scopePaths: ['packages/ai-runtime/src'],
      riskTier: 'R0' as const,
      dataClassification: 'local_only' as const,
      criteriaLockedAt: '2026-11-22T01:00:00.000Z',
      criteria: [
        {
          code: 'c1',
          title: 'C1',
          verificationMethod: 'automated_test' as const,
          requiredEvidenceType: 'evidence_bundle',
          mandatory: true,
        },
      ],
    };

    expect(() =>
      compileExecutionPacket({
        repoSnapshot: snapshot,
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['pnpm test'],
        contract: { ...validContract, criteria: [] },
      })
    ).toThrow(/AcceptanceCriterion/iu);

    expect(() =>
      compileExecutionPacket({
        repoSnapshot: snapshot,
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['pnpm test'],
        contract: { ...validContract, criteriaLockedAt: undefined },
      })
    ).toThrow(/locked/iu);

    expect(() =>
      compileExecutionPacket({
        repoSnapshot: snapshot,
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['pnpm test'],
        contract: { ...validContract, scopePaths: ['../outside', '.env'] },
      })
    ).toThrow(/relative|secret/iu);

    expect(() =>
      compileExecutionPacket({
        repoSnapshot: snapshot,
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['pnpm test'],
        contract: { ...validContract, scopePaths: ['.env.local'] },
      })
    ).toThrow(/secret|protected/iu);

    expect(() =>
      compileExecutionPacket({
        repoSnapshot: snapshot,
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['pnpm test'],
        contract: {
          ...validContract,
          scopePaths: ['apps/api/src'],
          protectedPaths: ['apps/api'],
        },
      })
    ).toThrow(/conflicts with protected boundary/iu);

    expect(() =>
      compileExecutionPacket({
        repoSnapshot: snapshot,
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: [],
        contract: validContract,
      })
    ).toThrow(/verification command/iu);

    expect(() =>
      compileExecutionPacket({
        repoSnapshot: snapshot,
        allowedCapabilities: ['repo.read@v1'],
        verificationCommands: ['rm -rf /'],
        contract: validContract,
      })
    ).toThrow(/R4 destructive/iu);
  });
});
