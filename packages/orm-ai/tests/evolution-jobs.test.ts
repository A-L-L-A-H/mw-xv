import { describe, expect, it } from 'vitest';
import {
  AI_EVOLUTION_CYCLE_JOB,
  AI_OBLIGATION_SWEEP_JOB,
  runEvolutionCycleJob,
  runObligationSweepJob,
} from '../src/evolution-jobs.js';

describe('evolution-jobs', () => {
  it('exports versioned job identifiers', () => {
    expect(AI_EVOLUTION_CYCLE_JOB).toBe('ai.evolution_cycle@v1');
    expect(AI_OBLIGATION_SWEEP_JOB).toBe('ai.obligation_sweep@v1');
  });

  it('orchestrates M14.01 synthesis + ablation gate without ever self-promoting', () => {
    const result = runEvolutionCycleJob({
      companyId: 1,
      synthesis: {
        companyId: 1,
        runId: 'run-101',
        workContractId: 'wc-101',
        proofGatePassed: true,
        checks: [{ name: 'vitest', passed: true, summary: '12 passed' }],
        diffSummary: 'Hardened retry backoff on webhook worker',
        lessons: ['Cap exponential backoff at 30s with jitter'],
        skillSlug: 'webhook-backoff',
      },
      defaultAblation: {
        baselineResults: [
          { caseId: 'case-1', passed: true },
          { caseId: 'case-2', passed: false },
        ],
        candidateResults: [
          { caseId: 'case-1', passed: true },
          { caseId: 'case-2', passed: true },
        ],
      },
    });

    expect(result.jobName).toBe(AI_EVOLUTION_CYCLE_JOB);
    expect(result.selfPromoted).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.automatedPromotionAllowed).toBe(false);
    expect(result.synthesis.accepted).toBe(true);
    expect(result.synthesis.candidates.length).toBeGreaterThan(0);
    expect(result.ablationReports.length).toBe(result.synthesis.candidates.length);
    expect(result.eligibleCandidateIds.length).toBe(result.synthesis.candidates.length);
    expect(result.cycleSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('skips ablation when proof gate failed and rejects cross-company evolution cycles', () => {
    const failed = runEvolutionCycleJob({
      companyId: 1,
      synthesis: {
        companyId: 1,
        runId: 'run-102',
        workContractId: 'wc-102',
        proofGatePassed: false,
        checks: [{ name: 'vitest', passed: false }],
        diffSummary: 'Broken patch',
        lessons: ['Should not synthesize'],
      },
      defaultAblation: {
        baselineResults: [{ caseId: 'case-1', passed: true }],
        candidateResults: [{ caseId: 'case-1', passed: true }],
      },
    });

    expect(failed.synthesis.accepted).toBe(false);
    expect(failed.ablationReports).toHaveLength(0);
    expect(failed.eligibleCandidateIds).toHaveLength(0);
    expect(failed.selfPromoted).toBe(false);

    expect(() =>
      runEvolutionCycleJob({
        companyId: 1,
        synthesis: {
          companyId: 2,
          runId: 'run-103',
          workContractId: 'wc-103',
          proofGatePassed: true,
          checks: [],
          diffSummary: 'Cross-company attempt',
          lessons: [],
        },
      })
    ).toThrow(/Cross-company/u);
  });

  it('orchestrates M14.02 obligation drift scan without ever self-accepting', () => {
    const result = runObligationSweepJob({
      companyId: 1,
      obligations: [
        {
          id: 'obl-1',
          companyId: 1,
          title: 'Keep production API healthy',
          expectedPaasNodeIds: ['node-prod-1'],
          expectedPaasAppIds: ['app-prod-api'],
        },
        {
          id: 'obl-other',
          companyId: 2,
          title: 'Other company obligation',
          expectedPaasAppIds: ['app-other'],
        },
      ],
      worldSnapshot: {
        companyId: 1,
        observedAt: '2026-11-23T02:00:00Z',
        paasNodes: [
          {
            nodeId: 'node-prod-1',
            dockerStatus: 'running',
            easyTierMeshOnline: true,
            apps: [
              {
                appId: 'app-prod-api',
                healthy: false,
                status: 'degraded',
              },
            ],
          },
        ],
      },
    });

    expect(result.jobName).toBe(AI_OBLIGATION_SWEEP_JOB);
    expect(result.selfAccepted).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.automatedAcceptanceAllowed).toBe(false);
    expect(result.driftedCount).toBe(1);
    expect(result.proposalCount).toBe(1);
    expect(result.report.skippedCrossCompany).toHaveLength(1);
    expect(result.sweepSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects cross-company worldSnapshot in obligation sweep job', () => {
    expect(() =>
      runObligationSweepJob({
        companyId: 1,
        obligations: [],
        worldSnapshot: {
          companyId: 2,
          observedAt: '2026-11-23T02:00:00Z',
        },
      })
    ).toThrow(/Cross-company/u);
  });
});
