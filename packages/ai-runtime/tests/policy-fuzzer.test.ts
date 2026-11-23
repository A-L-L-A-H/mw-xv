import { describe, expect, it } from 'vitest';
import {
  createMulberry32,
  fuzzPolicyInvariants,
  type PolicyRuleSpec,
} from '../src/policy-fuzzer.js';

describe('M17.02 policy-fuzzer', () => {
  it('produces deterministic sequences from createMulberry32', () => {
    const rngA = createMulberry32(42);
    const rngB = createMulberry32(42);
    expect([rngA(), rngA(), rngA()]).toEqual([rngB(), rngB(), rngB()]);
  });

  it('passes when candidate policy is strictly as safe as baseline', () => {
    const baseline: PolicyRuleSpec[] = [
      {
        ruleId: 'allow-workspace-read',
        actionPattern: 'repo.read',
        resourcePattern: 'workspace/src/*',
        effect: 'allow',
        maxRiskTier: 2,
      },
    ];

    const report = fuzzPolicyInvariants(baseline, baseline, { seed: 99, iterations: 120 });
    expect(report.passed).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.automatedPromotionAllowed).toBe(false);
    expect(report.automatedSelfMerge).toBe(false);
    expect(report.fuzzReportSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('detects contradictions, shadow-allow regressions, and boundary escapes', () => {
    const baseline: PolicyRuleSpec[] = [
      {
        ruleId: 'deny-all-secrets',
        actionPattern: '*',
        resourcePattern: 'secrets/*',
        effect: 'deny',
      },
    ];

    const candidate: PolicyRuleSpec[] = [
      {
        ruleId: 'allow-everything',
        actionPattern: '*',
        resourcePattern: '*',
        effect: 'allow',
      },
      {
        ruleId: 'deny-repo-read',
        actionPattern: 'repo.read',
        resourcePattern: '*',
        effect: 'deny',
      },
    ];

    const report = fuzzPolicyInvariants(baseline, candidate, { seed: 1337, iterations: 150 });
    expect(report.passed).toBe(false);
    expect(report.contradictionCount).toBeGreaterThan(0);
    expect(report.shadowAllowCount).toBeGreaterThan(0);
    expect(report.boundaryEscapeCount).toBeGreaterThan(0);
    expect(report.automatedPromotionAllowed).toBe(false);
  });
});
