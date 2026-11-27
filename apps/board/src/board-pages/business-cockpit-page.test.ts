import { describe, expect, it } from 'vitest';
import {
  computeCockpitStatusBadge,
  formatCockpitCurrency,
  type BusinessCockpitMetrics,
} from './business-cockpit-helpers';

describe('business-cockpit-helpers', () => {
  it('formats Indonesian Rupiah amounts consistently', () => {
    expect(formatCockpitCurrency(1500000)).toBe('Rp 1.500.000');
    expect(formatCockpitCurrency(0)).toBe('Rp 0');
  });

  it('evaluates operational status badges correctly', () => {
    const stableMetrics: BusinessCockpitMetrics = {
      mrrMinor: 250000000,
      activeSubscribers: 1200,
      paasTenants: 45,
      dunningOverdueCount: 12,
      paymentSuccessRatePercent: 99.2,
      coaDispatchHealthPercent: 99.8,
    };
    expect(computeCockpitStatusBadge(stableMetrics)).toEqual({
      label: 'Operational Stable',
      variant: 'default',
    });

    const alertMetrics: BusinessCockpitMetrics = {
      mrrMinor: 250000000,
      activeSubscribers: 1200,
      paasTenants: 45,
      dunningOverdueCount: 85,
      paymentSuccessRatePercent: 94.0,
      coaDispatchHealthPercent: 88.5,
    };
    expect(computeCockpitStatusBadge(alertMetrics)).toEqual({
      label: 'Attention Required',
      variant: 'destructive',
    });

  });
});
