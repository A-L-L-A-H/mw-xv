import { describe, expect, it } from 'bun:test';
import {
  SelfHealingRemediator,
  type RemediationRule,
} from '../src/self-healing-remediator.js';

const BASE_RULES: readonly RemediationRule[] = [
  {
    ruleId: 'high-error-rate-restart',
    signalType: 'http_5xx_rate',
    minSeverity: 'high',
    threshold: 5,
    action: 'restart_worker',
    cooldownMs: 60_000,
    maxBlastRadiusRatio: 0.5,
  },
];

describe('SelfHealingRemediator', () => {
  it('executes bounded remediation and records audit trail', () => {
    const executed: string[] = [];
    const remediator = new SelfHealingRemediator(BASE_RULES, (incident, rule) => {
      executed.push(`${incident.service}:${rule.action}`);
    });

    const decision = remediator.evaluate({
      incidentId: 'inc-1',
      service: 'billing-api',
      signalType: 'http_5xx_rate',
      severity: 'high',
      affectedInstances: 1,
      totalInstances: 4,
      metricValue: 8,
      timestampMs: 100_000,
    });

    expect(decision.status).toBe('executed');
    expect(decision.action).toBe('restart_worker');
    expect(executed).toEqual(['billing-api:restart_worker']);
    expect(remediator.getAuditTrail()).toHaveLength(1);
  });

  it('enforces cooldown window per service and rule', () => {
    const remediator = new SelfHealingRemediator(BASE_RULES);

    const first = remediator.evaluate({
      incidentId: 'inc-1',
      service: 'billing-api',
      signalType: 'http_5xx_rate',
      severity: 'high',
      affectedInstances: 1,
      totalInstances: 4,
      metricValue: 10,
      timestampMs: 100_000,
    });
    expect(first.status).toBe('executed');

    const second = remediator.evaluate({
      incidentId: 'inc-2',
      service: 'billing-api',
      signalType: 'http_5xx_rate',
      severity: 'critical',
      affectedInstances: 1,
      totalInstances: 4,
      metricValue: 12,
      timestampMs: 130_000,
    });
    expect(second.status).toBe('skipped_cooldown');
  });

  it('blocks remediation when blast radius exceeds guard', () => {
    const remediator = new SelfHealingRemediator(BASE_RULES);

    const decision = remediator.evaluate({
      incidentId: 'inc-3',
      service: 'checkout-api',
      signalType: 'http_5xx_rate',
      severity: 'critical',
      affectedInstances: 3,
      totalInstances: 4,
      metricValue: 20,
      timestampMs: 200_000,
    });

    expect(decision.status).toBe('blocked_blast_radius');
    expect(remediator.getAuditTrail()).toHaveLength(1);
  });
});
