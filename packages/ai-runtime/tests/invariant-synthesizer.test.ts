import { describe, expect, it } from 'vitest';
import {
  PROTECTED_CONSTITUTIONAL_GATES,
  synthesizeInvariantRuleProposal,
} from '../src/invariant-synthesizer.js';

describe('invariant-synthesizer', () => {
  it('synthesizes a deterministic candidate invariant rule spec and node:test skeleton', () => {
    const incident = {
      incidentId: 'INC-2026-001',
      title: 'Missing companyId filter on telemetry query',
      category: 'tenant-isolation',
      description: 'Query omitted companyId predicate when fetching node metrics.',
      observedViolation: 'SELECT * FROM node_metrics returned cross-tenant rows',
      expectedInvariant: 'All node_metrics queries must filter by authenticated companyId',
      severity: 'critical' as const,
      targetPaths: ['packages/ai-runtime/src/semantic-bus.ts', 'apps/api/src/routes/metrics.ts'],
    };

    const first = synthesizeInvariantRuleProposal(incident);
    const second = synthesizeInvariantRuleProposal(incident);

    expect(first.accepted).toBe(true);
    expect(first.automatedPromotionAllowed).toBe(false);
    expect(first.ruleSpec).not.toBeNull();
    expect(first.ruleSpec?.ruleId).toBe('inv-tenant-isolation-inc-2026-001');
    expect(first.ruleSpec?.automatedPromotionAllowed).toBe(false);
    expect(first.ruleSpec?.protectedGatesPreserved).toEqual(PROTECTED_CONSTITUTIONAL_GATES);
    expect(first.testSkeleton).toContain("import test from 'node:test';");
    expect(first.testSkeleton).toContain("import assert from 'node:assert/strict';");
    expect(first.testSkeleton).toContain('automatedPromotionAllowed: false');
    expect(first.ruleSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.ruleSha256).toBe(second.ruleSha256);
  });

  it('rejects fail-closed any proposal attempting to weaken protected constitutional gates', () => {
    const protectedGatesToProbe = [
      'R4',
      'R0-R4',
      'ai-drift-watchdog',
      'check-desktop-non-overlap',
      'check-api-addon-boundary',
      'check-board-shared-ui',
      'check-m15-invariants',
    ];

    for (const gate of protectedGatesToProbe) {
      const result = synthesizeInvariantRuleProposal({
        incidentId: `INC-WEAKEN-${gate}`,
        title: `Temporarily disable ${gate} during hotfix`,
        category: 'governance',
        description: `Proposal to bypass ${gate} to speed up release.`,
        observedViolation: `${gate} blocked release`,
        expectedInvariant: `Skip ${gate} for hotfix branches`,
        affectedGates: [gate],
      });

      expect(result.accepted).toBe(false);
      expect(result.automatedPromotionAllowed).toBe(false);
      expect(result.rejectionReasonCode).toBe('PROTECTED_GATE_WEAKENING_FORBIDDEN');
      expect(result.blockedGates).toContain(gate);
      expect(result.ruleSpec).toBeNull();
      expect(result.testSkeleton).toBeNull();
      expect(result.ruleSha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('rejects proposals requesting automated promotion or self-merge', () => {
    const result = synthesizeInvariantRuleProposal({
      incidentId: 'INC-AUTO-PROMOTE',
      title: 'Enable auto-promote for lint rules',
      category: 'automation',
      description: 'Allow auto-promote without human approval.',
      observedViolation: 'Manual review took 10 minutes',
      expectedInvariant: 'automatedPromotionAllowed: true for low severity rules',
    });

    expect(result.accepted).toBe(false);
    expect(result.automatedPromotionAllowed).toBe(false);
    expect(result.rejectionReasonCode).toBe('AUTOMATED_PROMOTION_FORBIDDEN');
    expect(result.ruleSpec).toBeNull();
    expect(result.testSkeleton).toBeNull();
  });

  it('rejects invalid empty incident inputs fail-closed', () => {
    const result = synthesizeInvariantRuleProposal({
      incidentId: '   ',
      title: '',
      category: 'drift',
      description: 'Missing fields',
      observedViolation: 'none',
      expectedInvariant: 'none',
    });

    expect(result.accepted).toBe(false);
    expect(result.automatedPromotionAllowed).toBe(false);
    expect(result.rejectionReasonCode).toBe('INVALID_INCIDENT_INPUT');
    expect(result.ruleSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('redacts secrets in incident text before generating rule spec and test skeleton', () => {
    const result = synthesizeInvariantRuleProposal({
      incidentId: 'INC-SECRET-01',
      title: 'Leaked header Authorization: Bearer supersecretvalue12345',
      category: 'security',
      description: 'Observed token sk-proj-abcdefghijklmnopqrstuvwxyz123456 in logs.',
      observedViolation: 'api_key=my_secret_key_value_999 printed to stdout',
      expectedInvariant: 'All outbound logs must strip bearer tokens and API keys',
    });

    expect(result.accepted).toBe(true);
    expect(result.ruleSpec?.title).not.toContain('supersecretvalue12345');
    expect(result.ruleSpec?.observedViolation).not.toContain('my_secret_key_value_999');
    expect(result.testSkeleton).not.toContain('supersecretvalue12345');
    expect(result.testSkeleton).not.toContain('my_secret_key_value_999');
  });
});
