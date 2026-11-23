import { describe, expect, it } from 'vitest';
import { createRedactor } from '../src/redaction.js';
import {
  findCausalDivergencePoint,
  planCounterfactualFork,
  type CausalCheckpoint,
} from '../src/causal-replay.js';

describe('findCausalDivergencePoint', () => {
  it('returns diverged=false when all checkpoints pass proof gate and stay below surprise threshold', () => {
    const checkpoints: CausalCheckpoint[] = [
      {
        stepIndex: 0,
        checkpointId: 'cp-0',
        commitSha: 'aaa1111',
        proofGatePassed: true,
        worldModelSurpriseBps: 0,
      },
      {
        stepIndex: 1,
        checkpointId: 'cp-1',
        commitSha: 'bbb2222',
        proofGatePassed: true,
        worldModelSurpriseBps: 1200,
      },
    ];

    const result = findCausalDivergencePoint(checkpoints, { surpriseThresholdBps: 2500 });
    expect(result.diverged).toBe(false);
    expect(result.triggerReason).toBeNull();
    expect(result.divergenceCheckpoint).toBeNull();
    expect(result.rootCause).toBeNull();
    expect(result.analysisSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('locates the exact earliest divergence checkpoint even when input is unsorted', () => {
    const checkpoints: CausalCheckpoint[] = [
      {
        stepIndex: 4,
        checkpointId: 'cp-4',
        commitSha: 'eee5555',
        proofGatePassed: false,
        worldModelSurpriseBps: 8000,
        toolErrors: ['vitest exited 1'],
      },
      {
        stepIndex: 2,
        checkpointId: 'cp-2',
        commitSha: 'ccc3333',
        proofGatePassed: true,
        worldModelSurpriseBps: 4500,
        negativeTransferSkills: ['legacy-skill-v1'],
      },
      {
        stepIndex: 1,
        checkpointId: 'cp-1',
        commitSha: 'bbb2222',
        proofGatePassed: true,
        worldModelSurpriseBps: 500,
      },
    ];

    const result = findCausalDivergencePoint(checkpoints, { surpriseThresholdBps: 2500 });
    expect(result.diverged).toBe(true);
    expect(result.triggerReason).toBe('WORLD_MODEL_SURPRISE_SPIKE');
    expect(result.divergenceCheckpoint?.stepIndex).toBe(2);
    expect(result.divergenceCheckpoint?.commitSha).toBe('ccc3333');
    expect(result.rootCause?.category).toBe('skill_negative_transfer');
    expect(result.rootCause?.evidence).toEqual(['legacy-skill-v1']);
  });

  it('classifies all 5 root-cause categories accurately', () => {
    const cases: Array<{
      readonly expected: string;
      readonly cp: CausalCheckpoint;
    }> = [
      {
        expected: 'environment_drift',
        cp: {
          stepIndex: 1,
          checkpointId: 'cp-env',
          commitSha: '1111111',
          proofGatePassed: false,
          worldModelSurpriseBps: 3000,
          environmentDriftSignals: ['node_version_mismatch'],
        },
      },
      {
        expected: 'tool_error',
        cp: {
          stepIndex: 1,
          checkpointId: 'cp-tool',
          commitSha: '2222222',
          proofGatePassed: false,
          worldModelSurpriseBps: 100,
          toolErrors: ['ENOENT config.json'],
        },
      },
      {
        expected: 'skill_negative_transfer',
        cp: {
          stepIndex: 1,
          checkpointId: 'cp-skill',
          commitSha: '3333333',
          proofGatePassed: false,
          worldModelSurpriseBps: 100,
          negativeTransferSkills: ['old-migration-skill'],
        },
      },
      {
        expected: 'missing_context',
        cp: {
          stepIndex: 1,
          checkpointId: 'cp-ctx',
          commitSha: '4444444',
          proofGatePassed: false,
          worldModelSurpriseBps: 100,
          missingContextKeys: ['TENANT_SCHEMA_VERSION'],
        },
      },
      {
        expected: 'prompt_ambiguity',
        cp: {
          stepIndex: 1,
          checkpointId: 'cp-prompt',
          commitSha: '5555555',
          proofGatePassed: false,
          worldModelSurpriseBps: 100,
          promptAmbiguitySignals: ['unclear target directory'],
        },
      },
    ];

    for (const testCase of cases) {
      const result = findCausalDivergencePoint([testCase.cp]);
      expect(result.rootCause?.category).toBe(testCase.expected);
    }
  });
});

describe('planCounterfactualFork', () => {
  it('compiles a deterministic counterfactual fork plan from the exact divergence commit SHA', () => {
    const trace = {
      traceId: 'trace-900',
      companyId: 12,
      baseBranch: 'main',
      checkpoints: [
        {
          stepIndex: 0,
          checkpointId: 'cp-0',
          commitSha: '0000aaaa',
          proofGatePassed: true,
          worldModelSurpriseBps: 0,
        },
        {
          stepIndex: 1,
          checkpointId: 'cp-1',
          commitSha: '1111bbbb2222cccc',
          proofGatePassed: false,
          worldModelSurpriseBps: 5000,
          missingContextKeys: ['DB_MIGRATION_LOCK'],
        },
        {
          stepIndex: 2,
          checkpointId: 'cp-2',
          commitSha: '9999dddd',
          proofGatePassed: false,
          worldModelSurpriseBps: 9000,
          toolErrors: ['cascading failure'],
        },
      ],
    };

    const intervention = {
      description: 'Inject DB_MIGRATION_LOCK context before step 1',
      injectedContextKeys: ['DB_MIGRATION_LOCK'],
      targetBranchPrefix: 'cf-replay',
    };

    const plan1 = planCounterfactualFork(trace, intervention);
    const plan2 = planCounterfactualFork(trace, intervention);

    expect(plan1.diverged).toBe(true);
    expect(plan1.forkFromCommitSha).toBe('1111bbbb2222cccc');
    expect(plan1.forkFromStepIndex).toBe(1);
    expect(plan1.forkFromCheckpointId).toBe('cp-1');
    expect(plan1.counterfactualBranchName).toBe('cf-replay/step-1-1111bbbb2222');
    expect(plan1.triggerReason).toBe('BOTH');
    expect(plan1.rootCause?.category).toBe('missing_context');
    expect(plan1.replaySteps).toHaveLength(3);
    expect(plan1.advisoryOnly).toBe(true);
    expect(plan1.automatedSelfAccept).toBe(false);
    expect(plan1.planSha256).toBe(plan2.planSha256);
    expect(plan1.planId).toBe(plan2.planId);
  });

  it('redacts secrets in intervention and checkpoint signals', () => {
    const redactor = createRedactor();
    const secret = 'sk-proj-counterfactualsecret9999';
    redactor.registerSecret(secret);

    const plan = planCounterfactualFork(
      {
        traceId: 'trace-sec',
        baseBranch: 'main',
        checkpoints: [
          {
            stepIndex: 3,
            checkpointId: 'cp-3',
            commitSha: 'abcdef123456',
            proofGatePassed: false,
            worldModelSurpriseBps: 0,
            toolErrors: [`Authorization: Bearer ${secret}`],
          },
        ],
      },
      {
        description: `Retry without leaking ${secret}`,
        environmentOverrides: { API_TOKEN: secret },
      },
      { redactor }
    );

    expect(JSON.stringify(plan)).not.toContain(secret);
    expect(plan.automatedSelfAccept).toBe(false);
  });
});
