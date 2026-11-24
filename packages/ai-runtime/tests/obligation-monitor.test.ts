import { describe, expect, it } from 'vitest';
import {
  evaluateObligationDrift,
  type ObligationRecord,
  type WorldStateSnapshot,
} from '../src/obligation-monitor.js';
import { createRedactor } from '../src/redaction.js';

describe('evaluateObligationDrift', () => {
  const baseSnapshot: WorldStateSnapshot = {
    companyId: 42,
    observedAt: '2026-11-23T02:00:00Z',
    repoGitSha: 'abc123def456',
    trackedFilesSha256: {
      'packages/ai-runtime/src/index.ts': 'hash-index-1',
      'packages/ai-runtime/src/redaction.ts': 'hash-redaction-1',
    },
    dependencyManifestsSha256: {
      'package.json': 'hash-pkg-1',
      'pnpm-lock.yaml': 'hash-lock-1',
    },
    paasNodes: [
      {
        nodeId: 'vps-sg-01',
        hostname: 'sg-01.internal',
        dockerStatus: 'ok',
        easyTierMeshOnline: true,
        apps: [
          {
            appId: 'app-api',
            name: 'api-gateway',
            healthy: true,
            status: 'running',
          },
        ],
      },
    ],
  };

  it('classifies matching obligations as intact with no reverification proposals', () => {
    const obligations: ObligationRecord[] = [
      {
        id: 'obl-intact-1',
        companyId: 42,
        title: 'Production runtime baseline',
        expectedRepoGitSha: 'abc123def456',
        expectedTrackedFiles: {
          'packages/ai-runtime/src/index.ts': 'hash-index-1',
        },
        expectedDependencyManifestSha256: {
          'package.json': 'hash-pkg-1',
          'pnpm-lock.yaml': 'hash-lock-1',
        },
        expectedPaasNodeIds: ['vps-sg-01'],
        expectedPaasAppIds: ['app-api'],
      },
    ];

    const report = evaluateObligationDrift(obligations, baseSnapshot);

    expect(report.companyId).toBe(42);
    expect(report.summary).toEqual({
      totalEvaluated: 1,
      intact: 1,
      drifted: 0,
      breached: 0,
      skippedCrossCompany: 0,
    });
    expect(report.evaluations[0]?.status).toBe('intact');
    expect(report.evaluations[0]?.reasonCodes).toEqual([]);
    expect(report.proposals).toEqual([]);
    expect(report.reportSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('detects repo git SHA, tracked file SHA-256, and dependency manifest drift and emits advisory-only proposals', () => {
    const obligations: ObligationRecord[] = [
      {
        id: 'obl-repo-drift',
        companyId: 42,
        title: 'Repository & manifest integrity',
        expectedRepoGitSha: 'expected-sha-999',
        expectedTrackedFiles: {
          'packages/ai-runtime/src/index.ts': 'hash-index-old',
          'packages/ai-runtime/src/missing.ts': 'hash-missing',
        },
        expectedDependencyManifestSha256: {
          'pnpm-lock.yaml': 'hash-lock-old',
        },
      },
    ];

    const report = evaluateObligationDrift(obligations, baseSnapshot);

    expect(report.summary).toEqual({
      totalEvaluated: 1,
      intact: 0,
      drifted: 1,
      breached: 0,
      skippedCrossCompany: 0,
    });
    expect(report.evaluations[0]?.status).toBe('drifted');
    expect(report.evaluations[0]?.reasonCodes).toEqual([
      'DEPENDENCY_MANIFEST_DRIFT',
      'REPO_GIT_SHA_DRIFT',
      'TRACKED_FILE_MISSING',
      'TRACKED_FILE_SHA256_DRIFT',
    ]);

    expect(report.proposals).toHaveLength(1);
    const proposal = report.proposals[0];
    expect(proposal?.companyId).toBe(42);
    expect(proposal?.obligationId).toBe('obl-repo-drift');
    expect(proposal?.status).toBe('drifted');
    expect(proposal?.advisoryOnly).toBe(true);
    expect(proposal?.automatedSelfAccept).toBe(false);
    expect(proposal?.reasonCodes).toEqual([
      'DEPENDENCY_MANIFEST_DRIFT',
      'REPO_GIT_SHA_DRIFT',
      'TRACKED_FILE_MISSING',
      'TRACKED_FILE_SHA256_DRIFT',
    ]);
  });

  it('classifies PaaS node degradation (docker, EasyTier mesh, unhealthy app) as breached', () => {
    const degradedSnapshot: WorldStateSnapshot = {
      ...baseSnapshot,
      paasNodes: [
        {
          nodeId: 'vps-sg-01',
          dockerStatus: 'degraded',
          easyTierMeshOnline: false,
          apps: [
            {
              appId: 'app-api',
              healthy: false,
              status: 'crashloop',
              detail: 'OOMKilled',
            },
          ],
        },
      ],
    };

    const obligations: ObligationRecord[] = [
      {
        id: 'obl-paas-health',
        companyId: 42,
        title: 'SG PaaS node availability',
        expectedPaasNodeIds: ['vps-sg-01', 'vps-id-02'],
        expectedPaasAppIds: ['app-api'],
      },
    ];

    const report = evaluateObligationDrift(obligations, degradedSnapshot);

    expect(report.summary).toEqual({
      totalEvaluated: 1,
      intact: 0,
      drifted: 0,
      breached: 1,
      skippedCrossCompany: 0,
    });
    expect(report.evaluations[0]?.status).toBe('breached');
    expect(report.evaluations[0]?.reasonCodes).toEqual([
      'PAAS_APP_UNHEALTHY',
      'PAAS_DOCKER_DEGRADED',
      'PAAS_EASYTIER_MESH_OFFLINE',
      'PAAS_NODE_MISSING',
    ]);
    expect(report.proposals).toHaveLength(1);
    expect(report.proposals[0]?.status).toBe('breached');
    expect(report.proposals[0]?.advisoryOnly).toBe(true);
    expect(report.proposals[0]?.automatedSelfAccept).toBe(false);
  });

  it('enforces strict cross-company isolation and never emits proposals for foreign obligations', () => {
    const obligations: ObligationRecord[] = [
      {
        id: 'obl-own-company',
        companyId: 42,
        title: 'Own company obligation',
        expectedRepoGitSha: 'abc123def456',
      },
      {
        id: 'obl-foreign-company',
        companyId: 999,
        title: 'Foreign company obligation',
        expectedRepoGitSha: 'different-sha',
        expectedPaasNodeIds: ['missing-node'],
      },
    ];

    const report = evaluateObligationDrift(obligations, baseSnapshot);

    expect(report.summary).toEqual({
      totalEvaluated: 1,
      intact: 1,
      drifted: 0,
      breached: 0,
      skippedCrossCompany: 1,
    });
    expect(report.evaluations.map((e) => e.obligationId)).toEqual(['obl-own-company']);
    expect(report.proposals).toEqual([]);
    expect(report.skippedCrossCompany).toEqual([
      {
        obligationId: 'obl-foreign-company',
        obligationCompanyId: 999,
        snapshotCompanyId: 42,
        reasonCode: 'CROSS_COMPANY_MISMATCH',
      },
    ]);
  });

  it('redacts credentials and registered secrets across findings and proposals', () => {
    const redactor = createRedactor();
    redactor.registerSecret('top-secret-vps-token-987654');

    const snapshotWithSecrets: WorldStateSnapshot = {
      ...baseSnapshot,
      paasNodes: [
        {
          nodeId: 'vps-sg-01',
          dockerStatus: 'error: Bearer supersecretbearertoken123',
          easyTierMeshOnline: true,
          apps: [
            {
              appId: 'app-api',
              healthy: false,
              status: 'failed',
              detail:
                'failed with api_key=sk-proj-1234567890abcdef and top-secret-vps-token-987654',
            },
          ],
        },
      ],
    };

    const obligations: ObligationRecord[] = [
      {
        id: 'obl-secret-check',
        companyId: 42,
        title: 'Check auth password=my-raw-password',
        expectedPaasNodeIds: ['vps-sg-01'],
      },
    ];

    const report = evaluateObligationDrift(obligations, snapshotWithSecrets, { redactor });
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain('supersecretbearertoken123');
    expect(serialized).not.toContain('sk-proj-1234567890abcdef');
    expect(serialized).not.toContain('top-secret-vps-token-987654');
    expect(serialized).not.toContain('my-raw-password');
    expect(serialized).toContain('[REDACTED');
  });

  it('produces deterministic reportSha256 and proposalIds independent of input ordering', () => {
    const oblA: ObligationRecord = {
      id: 'obl-a',
      companyId: 42,
      title: 'Obligation A',
      expectedRepoGitSha: 'stale-sha-a',
      expectedTrackedFiles: {
        'b.ts': 'hash-b',
        'a.ts': 'hash-a',
      },
    };
    const oblB: ObligationRecord = {
      id: 'obl-b',
      companyId: 42,
      title: 'Obligation B',
      expectedPaasNodeIds: ['vps-sg-01'],
    };

    const report1 = evaluateObligationDrift([oblA, oblB], baseSnapshot);
    const report2 = evaluateObligationDrift([oblB, oblA], baseSnapshot);

    expect(report1.reportSha256).toBe(report2.reportSha256);
    expect(report1.proposals).toEqual(report2.proposals);
    expect(report1.evaluations).toEqual(report2.evaluations);

    const changedReport = evaluateObligationDrift([oblA, oblB], {
      ...baseSnapshot,
      repoGitSha: 'different-sha-xyz',
    });
    expect(changedReport.reportSha256).not.toBe(report1.reportSha256);
  });
});
