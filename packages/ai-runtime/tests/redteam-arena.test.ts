import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REDTEAM_SCENARIOS,
  runAdversarialRedTeamArena,
  type RedTeamAttackCategory,
  type RedTeamScenario,
} from '../src/redteam-arena.js';

describe('M16.04 Offline Adversarial Red-Team Self-Play Arena', () => {
  it('provides default scenarios covering all 6 required adversarial attack categories', () => {
    const categories = new Set<RedTeamAttackCategory>(
      DEFAULT_REDTEAM_SCENARIOS.map((scenario) => scenario.category)
    );

    expect(categories).toEqual(
      new Set<RedTeamAttackCategory>([
        'prompt_injection',
        'path_traversal',
        'overconfident_plan',
        'a2a_spoofing',
        'paas_quota_bypass',
        'self_accept_forgery',
      ])
    );
  });

  it('reports 10000 bps defense pass rate and zero breaches when blue team blocks all attacks', () => {
    const report = runAdversarialRedTeamArena(DEFAULT_REDTEAM_SCENARIOS, (scenario) => ({
      blocked: true,
      reasonCode: `BLOCKED_${scenario.category.toUpperCase()}`,
      summary: `Blue team blocked ${scenario.scenarioId}`,
    }));

    expect(report.totalScenarios).toBe(DEFAULT_REDTEAM_SCENARIOS.length);
    expect(report.blockedCount).toBe(DEFAULT_REDTEAM_SCENARIOS.length);
    expect(report.breachCount).toBe(0);
    expect(report.defensePassRateBps).toBe(10000);
    expect(report.breaches).toHaveLength(0);
    expect(report.candidateRuleProposals).toHaveLength(0);
    expect(report.automatedPromotionAllowed).toBe(false);
    expect(report.automatedSelfAccept).toBe(false);
    expect(report.arenaSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('records breaches and automatically synthesizes regression invariant rule proposals', () => {
    const report = runAdversarialRedTeamArena(DEFAULT_REDTEAM_SCENARIOS, (scenario) => {
      if (scenario.category === 'prompt_injection' || scenario.category === 'self_accept_forgery') {
        return {
          blocked: false,
          reasonCode: 'DEFENSE_GAP_DETECTED',
          summary: `Blue team missed ${scenario.category}`,
          evidence: { apiKey: 'sk-proj-leaktest1234567890abcdef' },
        };
      }
      return {
        blocked: true,
        reasonCode: 'BLOCKED',
        summary: `Blocked ${scenario.category}`,
      };
    });

    expect(report.totalScenarios).toBe(6);
    expect(report.blockedCount).toBe(4);
    expect(report.breachCount).toBe(2);
    expect(report.defensePassRateBps).toBe(6667);
    expect(report.breaches).toHaveLength(2);
    expect(report.candidateRuleProposals).toHaveLength(2);
    expect(report.automatedPromotionAllowed).toBe(false);
    expect(report.automatedSelfAccept).toBe(false);

    for (const proposal of report.candidateRuleProposals) {
      expect(proposal.accepted).toBe(true);
      expect(proposal.automatedPromotionAllowed).toBe(false);
      expect(proposal.ruleSpec).not.toBeNull();
      expect(proposal.testSkeleton).not.toBeNull();
      expect(proposal.ruleSha256).toMatch(/^[0-9a-f]{64}$/u);
    }

    // Secrets in evidence must be redacted
    expect(JSON.stringify(report.breaches)).not.toContain('sk-proj-leaktest1234567890abcdef');
  });

  it('produces deterministic arenaSha256 digests for identical runs', () => {
    const customScenarios: readonly RedTeamScenario[] = [DEFAULT_REDTEAM_SCENARIOS[0]!];
    const evaluator = () => ({
      blocked: false,
      reasonCode: 'MISSED',
      summary: 'Allowed untrusted prompt',
    });

    const runA = runAdversarialRedTeamArena(customScenarios, evaluator);
    const runB = runAdversarialRedTeamArena(customScenarios, evaluator);

    expect(runA.arenaSha256).toBe(runB.arenaSha256);
  });
});
