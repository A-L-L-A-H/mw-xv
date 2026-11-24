import { describe, expect, it } from 'vitest';
import {
  evaluateExpectedFreeEnergy,
  type ActiveInferenceCandidate,
} from '../src/active-inference.js';

describe('M16.02 Active Inference Expected Free Energy', () => {
  it('defaults safely to epistemic_action when no candidates are provided', () => {
    const decision = evaluateExpectedFreeEnergy([], { companyId: 'co-alpha' });

    expect(decision.selectedActionKind).toBe('epistemic_action');
    expect(decision.selectedActionId).toBeNull();
    expect(decision.selectedCandidate).toBeNull();
    expect(decision.rankedCandidates).toEqual([]);
    expect(decision.automatedSelfAccept).toBe(false);
    expect(decision.automatedPromotionAllowed).toBe(false);
    expect(decision.decisionSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('selects epistemic_action when uncertainty is high and probing yields large information gain', () => {
    const candidates: ActiveInferenceCandidate[] = [
      {
        actionId: 'act-exec',
        kind: 'pragmatic_action',
        label: 'Apply database migration immediately',
        goalAlignmentBps: 8000,
        successProbabilityBps: 3500,
        priorUncertaintyBps: 8000,
        expectedPosteriorUncertaintyBps: 7500,
        estimatedTokens: 1500,
        estimatedLatencyMs: 2000,
        reversible: false,
      },
      {
        actionId: 'act-probe',
        kind: 'epistemic_action',
        label: 'Inspect schema diff and migration locks',
        goalAlignmentBps: 5000,
        successProbabilityBps: 9500,
        priorUncertaintyBps: 8000,
        expectedPosteriorUncertaintyBps: 1500,
        estimatedTokens: 600,
        estimatedLatencyMs: 800,
        reversible: true,
      },
    ];

    const decision = evaluateExpectedFreeEnergy(candidates, {
      companyId: 'co-alpha',
    });

    expect(decision.selectedActionKind).toBe('epistemic_action');
    expect(decision.selectedActionId).toBe('act-probe');
    expect(decision.selectedCandidate?.epistemicInfoGainBps).toBe(6500);
    expect(decision.rankedCandidates[0]?.expectedFreeEnergyBps).toBeLessThan(
      decision.rankedCandidates[1]!.expectedFreeEnergyBps
    );
    expect(decision.automatedSelfAccept).toBe(false);
    expect(decision.automatedPromotionAllowed).toBe(false);
  });

  it('selects optimal_question when a single surgical question resolves ambiguity better than probing or guessing', () => {
    const candidates: ActiveInferenceCandidate[] = [
      {
        actionId: 'act-guess',
        kind: 'pragmatic_action',
        label: 'Guess customer SLA tier',
        goalAlignmentBps: 7000,
        successProbabilityBps: 4000,
        priorUncertaintyBps: 8500,
        expectedPosteriorUncertaintyBps: 8500,
        estimatedTokens: 1000,
        estimatedLatencyMs: 1000,
        reversible: false,
      },
      {
        actionId: 'act-ask',
        kind: 'optimal_question',
        label: 'Ask user whether target environment is staging or production',
        goalAlignmentBps: 6000,
        successProbabilityBps: 9500,
        priorUncertaintyBps: 8500,
        expectedPosteriorUncertaintyBps: 500,
        estimatedTokens: 200,
        estimatedLatencyMs: 300,
        humanInterruptionCostBps: 1000,
        reversible: true,
      },
    ];

    const decision = evaluateExpectedFreeEnergy(candidates);

    expect(decision.selectedActionKind).toBe('optimal_question');
    expect(decision.selectedActionId).toBe('act-ask');
    expect(decision.selectedCandidate?.epistemicInfoGainBps).toBe(8000);
    expect(decision.automatedSelfAccept).toBe(false);
  });

  it('selects pragmatic_action when uncertainty is low and pragmatic value is high', () => {
    const candidates: ActiveInferenceCandidate[] = [
      {
        actionId: 'act-probe',
        kind: 'epistemic_action',
        label: 'Re-read already verified config',
        goalAlignmentBps: 3000,
        successProbabilityBps: 9000,
        priorUncertaintyBps: 1000,
        expectedPosteriorUncertaintyBps: 800,
        estimatedTokens: 800,
        estimatedLatencyMs: 1000,
      },
      {
        actionId: 'act-execute',
        kind: 'pragmatic_action',
        label: 'Run verified patch and unit tests',
        goalAlignmentBps: 9500,
        successProbabilityBps: 9500,
        priorUncertaintyBps: 1000,
        expectedPosteriorUncertaintyBps: 500,
        estimatedTokens: 1200,
        estimatedLatencyMs: 1500,
        reversible: true,
      },
    ];

    const decision = evaluateExpectedFreeEnergy(candidates);

    expect(decision.selectedActionKind).toBe('pragmatic_action');
    expect(decision.selectedActionId).toBe('act-execute');
    expect(decision.selectedCandidate?.pragmaticValueBps).toBe(9025);
  });

  it('redacts secrets in labels and produces order-invariant deterministic decisionSha256', () => {
    const c1: ActiveInferenceCandidate = {
      actionId: 'act-a',
      kind: 'epistemic_action',
      label: 'Check token Bearer sk-proj-supersecret1234567890',
      goalAlignmentBps: 5000,
      successProbabilityBps: 8000,
      priorUncertaintyBps: 6000,
      expectedPosteriorUncertaintyBps: 2000,
    };
    const c2: ActiveInferenceCandidate = {
      actionId: 'act-b',
      kind: 'pragmatic_action',
      label: 'Execute safe dry-run',
      goalAlignmentBps: 8500,
      successProbabilityBps: 9000,
      priorUncertaintyBps: 2000,
      expectedPosteriorUncertaintyBps: 1500,
    };

    const d1 = evaluateExpectedFreeEnergy([c1, c2]);
    const d2 = evaluateExpectedFreeEnergy([c2, c1]);

    expect(d1.decisionSha256).toBe(d2.decisionSha256);
    expect(d1.rankedCandidates.find((c) => c.actionId === 'act-a')?.label).not.toContain(
      'sk-proj-supersecret1234567890'
    );
  });
});
