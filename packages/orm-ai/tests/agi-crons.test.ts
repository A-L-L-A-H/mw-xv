import { describe, expect, it } from 'vitest';
import { verifyMerkleInclusionProof } from '@moonwitness/ai-runtime';
import {
  AGI_CRON_SCHEDULES,
  AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB,
  AI_M16_REDTEAM_ARENA_SWEEP_JOB,
  AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB,
  AI_M17_INCIDENT_HEALER_SWEEP_JOB,
  runEpistemicCalibrationAuditJob,
  runIncidentHealerSweepJob,
  runRedTeamArenaSweepJob,
  runSleepDreamConsolidationJob,
} from '../src/evolution-jobs.js';

describe('Wave E.24 AGI Scheduled Cron Handlers', () => {
  it('registers all 4 M15/M16/M17 cron definitions with constitutional locks', () => {
    const jobNames = AGI_CRON_SCHEDULES.map((entry) => entry.jobName);
    expect(jobNames).toContain(AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB);
    expect(jobNames).toContain(AI_M16_REDTEAM_ARENA_SWEEP_JOB);
    expect(jobNames).toContain(AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB);
    expect(jobNames).toContain(AI_M17_INCIDENT_HEALER_SWEEP_JOB);

    for (const schedule of AGI_CRON_SCHEDULES) {
      expect(schedule.cronExpression.trim().length).toBeGreaterThan(0);
      expect(schedule.requiresHumanApproval).toBe(true);
      expect(schedule.automatedPromotionAllowed).toBe(false);
      expect(schedule.automatedSelfMerge).toBe(false);
    }
  });

  it('executes ai.m16.sleep_dream_consolidation end-to-end with constitutional locks', () => {
    const result = runSleepDreamConsolidationJob({
      companyId: 7,
      nowIso: '2026-11-23T03:00:00.000Z',
      memories: [
        {
          memoryId: 'mem-1',
          companyId: '7',
          topicKey: 'deploy.rollback',
          content: 'Verify migration checksum before rollback.',
          provenance: 'run:101',
          createdAtIso: '2026-11-22T10:00:00.000Z',
          importanceBps: 8500,
          retrievalConfidenceBps: 9000,
        },
        {
          memoryId: 'mem-2',
          companyId: '7',
          topicKey: 'deploy.rollback',
          content: 'Always snapshot DB schema before rollback.',
          provenance: 'run:102',
          createdAtIso: '2026-11-22T12:00:00.000Z',
          importanceBps: 8800,
          retrievalConfidenceBps: 9200,
        },
      ],
      knowledgeNodes: [
        {
          nodeId: 'kn-1',
          companyId: '7',
          domain: 'ops',
          claim: 'Zero-downtime blue/green switchover is verified.',
          verified: false,
          confidenceBps: 6200,
          evidenceCount: 1,
        },
      ],
      skillNodes: [
        {
          skillId: 'sk-1',
          companyId: '7',
          domain: 'security',
          name: 'secret-rotation',
          proficiencyBps: 8000,
        },
      ],
    });

    expect(result.jobName).toBe(AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB);
    expect(result.companyId).toBe(7);
    expect(result.selfPromoted).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.automatedPromotionAllowed).toBe(false);
    expect(result.automatedSelfMerge).toBe(false);
    expect(result.survivingCount).toBeGreaterThanOrEqual(1);
    expect(result.probeCount).toBeGreaterThanOrEqual(1);
    expect(result.cycleSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('executes ai.m16.redteam_arena_sweep and anchors audit leaf in Merkle transparency log', () => {
    const priorEvent = { event: 'genesis-audit', companyId: 7 };
    const result = runRedTeamArenaSweepJob({
      companyId: 7,
      priorAuditEvents: [priorEvent],
      blueTeamEvaluator: (scenario) => ({
        blocked: scenario.category !== 'overconfident_plan',
        reasonCode:
          scenario.category === 'overconfident_plan' ? 'UNVERIFIED_PLAN_BREACH' : 'POLICY_BLOCKED',
        summary: `Evaluated ${scenario.scenarioId}`,
      }),
    });

    expect(result.jobName).toBe(AI_M16_REDTEAM_ARENA_SWEEP_JOB);
    expect(result.selfPromoted).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.automatedPromotionAllowed).toBe(false);
    expect(result.automatedSelfMerge).toBe(false);
    expect(result.breachCount).toBe(1);
    expect(result.merkleAuditTree.leafCount).toBe(2);
    expect(result.merkleRootHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.sweepSha256).toMatch(/^[0-9a-f]{64}$/u);

    const leafEvent = result.merkleAuditTree.redactedEvents[1];
    const verification = verifyMerkleInclusionProof(
      leafEvent,
      result.inclusionProof,
      result.merkleRootHash
    );
    expect(verification.valid).toBe(true);
  });

  it('executes ai.m15.epistemic_calibration_audit and detects overconfident drift', () => {
    const overconfidentPredictions = Array.from({ length: 12 }, (_, index) => ({
      predictionId: `pred-${index}`,
      predictedProbability: 0.95,
      outcome: index < 3 ? (1 as const) : (0 as const),
      domain: 'deployment-risk',
    }));

    const result = runEpistemicCalibrationAuditJob({
      companyId: 7,
      predictions: overconfidentPredictions,
    });

    expect(result.jobName).toBe(AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB);
    expect(result.selfPromoted).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.automatedPromotionAllowed).toBe(false);
    expect(result.automatedSelfMerge).toBe(false);
    expect(result.r4HumanGateLocked).toBe(true);
    expect(result.driftDetected).toBe(true);
    expect(result.autonomyPolicy.mode).toBe('require_human_gate');
    expect(result.calibrationReport.sampleCount).toBe(12);
    expect(result.auditSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('executes ai.m17.incident_healer_sweep with secret redaction, policy fuzzing, and self-merge lock', () => {
    const rawSecret = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
    const result = runIncidentHealerSweepJob({
      companyId: 7,
      incidentId: 'inc-2026-11-23-01',
      logs: [
        {
          timestamp: '2026-11-23T02:55:00.000Z',
          service: 'billing-worker',
          level: 'error',
          errorCode: 'ERR_DB_TIMEOUT',
          message: `Connection failed using token ${rawSecret} on shard 42`,
        },
        {
          timestamp: '2026-11-23T02:56:00.000Z',
          service: 'billing-worker',
          level: 'fatal',
          errorCode: 'ERR_DB_TIMEOUT',
          message: `Connection failed using token ${rawSecret} on shard 43`,
        },
      ],
      baselinePolicyRules: [
        {
          ruleId: 'allow-read-workspace',
          actionPattern: 'repo.read',
          resourcePattern: 'workspace/src/*',
          effect: 'allow',
          maxRiskTier: 2,
        },
      ],
      candidatePolicyRules: [
        {
          ruleId: 'allow-read-workspace',
          actionPattern: 'repo.read',
          resourcePattern: 'workspace/src/*',
          effect: 'allow',
          maxRiskTier: 2,
        },
      ],
      fuzzerOptions: { seed: 42, iterations: 50 },
    });

    expect(result.jobName).toBe(AI_M17_INCIDENT_HEALER_SWEEP_JOB);
    expect(result.selfPromoted).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.automatedPromotionAllowed).toBe(false);
    expect(result.automatedSelfMerge).toBe(false);
    expect(result.healingProposal.automatedSelfMerge).toBe(false);
    expect(result.policyFuzzReport.automatedSelfMerge).toBe(false);
    expect(result.policyFuzzPassed).toBe(true);
    expect(result.faultClusterCount).toBe(1);
    expect(JSON.stringify(result.healingProposal)).not.toContain(rawSecret);
    expect(result.sweepSha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});
