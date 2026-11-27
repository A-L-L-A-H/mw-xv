import { describe, expect, it } from 'vitest';
import { PaasBillingBridge } from '../src/paas-billing-bridge.js';

describe('paas-billing-bridge (orm-cloud)', () => {
  it('generates healthy billing report when under quota and current on payments', () => {
    const bridge = new PaasBillingBridge();

    const report = bridge.generateTenantBillingReport({
      tenantId: 'tenant-healthy',
      tier: 'starter',
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
      usage: {
        containerHours: 500,
        ramGbHours: 500,
        storageGb: 10,
        egressGb: 20,
      },
      daysPastDue: 0,
      previousSubscriptionStatus: 'active',
      quotaUtilizationPercent: 40,
      appIds: ['app-1'],
    });

    expect(report.tenantId).toBe('tenant-healthy');
    expect(report.status).toBe('healthy');
    expect(report.invoice.totalCents).toBeGreaterThan(0);
    expect(report.lifecycle.state).toBe('active');
  });

  it('generates critical report when past due triggers hard suspension', () => {
    const bridge = new PaasBillingBridge();

    const report = bridge.generateTenantBillingReport({
      tenantId: 'tenant-suspended',
      tier: 'starter',
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
      usage: {
        containerHours: 1000,
        ramGbHours: 1000,
        storageGb: 20,
        egressGb: 50,
      },
      daysPastDue: 15,
      previousSubscriptionStatus: 'past_due',
      quotaUtilizationPercent: 80,
      appIds: ['app-1', 'app-2'],
    });

    expect(report.status).toBe('critical');
    expect(report.lifecycle.state).toBe('hard_suspended');
    expect(report.lifecycle.enforcementPlan.action).toBe('stop');
  });
});
