import { describe, expect, it } from 'vitest';
import { runCandidateAblationGate } from '../src/ablation-gate.js';

describe('runCandidateAblationGate', () => {
  it('marks candidate eligible when passRateDelta > 0 with zero regressions and zero harm', () => {
    const report = runCandidateAblationGate({
      candidateId: 'skill_cand_001',
      baselineResults: [
        { caseId: 'case-1', passed: true },
        { caseId: 'case-2', passed: false },
        { caseId: 'case-3', passed: false },
        { caseId: 'case-4', passed: true },
      ],
      candidateResults: [
        { caseId: 'case-1', passed: true },
        { caseId: 'case-2', passed: true },
        { caseId: 'case-3', passed: false },
        { caseId: 'case-4', passed: true },
      ],
    });

    expect(report.totalCases).toBe(4);
    expect(report.baselinePassRate).toBe(0.5);
    expect(report.candidatePassRate).toBe(0.75);
    expect(report.passRateDelta).toBe(0.25);
    expect(report.improvementCount).toBe(1);
    expect(report.regressionCount).toBe(0);
    expect(report.harmCount).toBe(0);
    expect(report.eligibleForWorkflowPromotion).toBe(true);
    expect(report.gateSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects promotion when passRateDelta is zero', () => {
    const report = runCandidateAblationGate({
      candidateId: 'skill_cand_002',
      baselineResults: [
        { caseId: 'case-1', passed: true },
        { caseId: 'case-2', passed: false },
      ],
      candidateResults: [
        { caseId: 'case-1', passed: true },
        { caseId: 'case-2', passed: false },
      ],
    });

    expect(report.passRateDelta).toBe(0);
    expect(report.regressionCount).toBe(0);
    expect(report.harmCount).toBe(0);
    expect(report.eligibleForWorkflowPromotion).toBe(false);
  });

  it('rejects promotion when any regression occurs even if net passRateDelta is positive', () => {
    const report = runCandidateAblationGate({
      candidateId: 'skill_cand_003',
      baselineResults: [
        { caseId: 'case-1', passed: true },
        { caseId: 'case-2', passed: false },
        { caseId: 'case-3', passed: false },
      ],
      candidateResults: [
        { caseId: 'case-1', passed: false },
        { caseId: 'case-2', passed: true },
        { caseId: 'case-3', passed: true },
      ],
    });

    expect(report.passRateDelta).toBeGreaterThan(0);
    expect(report.regressionCount).toBe(1);
    expect(report.harmCount).toBe(0);
    expect(report.eligibleForWorkflowPromotion).toBe(false);
  });

  it('rejects promotion when any candidate case is flagged harmed', () => {
    const report = runCandidateAblationGate({
      candidateId: 'skill_cand_004',
      baselineResults: [
        { caseId: 'case-1', passed: false },
        { caseId: 'case-2', passed: true },
      ],
      candidateResults: [
        { caseId: 'case-1', passed: true },
        { caseId: 'case-2', passed: true, harmed: true },
      ],
    });

    expect(report.passRateDelta).toBe(0.5);
    expect(report.regressionCount).toBe(0);
    expect(report.harmCount).toBe(1);
    expect(report.eligibleForWorkflowPromotion).toBe(false);
  });

  it('fails closed on empty evaluation sets', () => {
    const report = runCandidateAblationGate({
      candidateId: 'skill_cand_empty',
      baselineResults: [],
      candidateResults: [],
    });

    expect(report.totalCases).toBe(0);
    expect(report.baselinePassRate).toBe(0);
    expect(report.candidatePassRate).toBe(0);
    expect(report.passRateDelta).toBe(0);
    expect(report.eligibleForWorkflowPromotion).toBe(false);
    expect(report.gateSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('produces identical gateSha256 regardless of input ordering', () => {
    const first = runCandidateAblationGate({
      candidateId: 'skill_cand_det',
      baselineResults: [
        { caseId: 'case-a', passed: false },
        { caseId: 'case-b', passed: true },
      ],
      candidateResults: [
        { caseId: 'case-a', passed: true },
        { caseId: 'case-b', passed: true },
      ],
    });

    const second = runCandidateAblationGate({
      candidateId: 'skill_cand_det',
      baselineResults: [
        { caseId: 'case-b', passed: true },
        { caseId: 'case-a', passed: false },
      ],
      candidateResults: [
        { caseId: 'case-b', passed: true },
        { caseId: 'case-a', passed: true },
      ],
    });

    expect(second.gateSha256).toBe(first.gateSha256);
    expect(second.caseDeltas).toEqual(first.caseDeltas);
  });
});
