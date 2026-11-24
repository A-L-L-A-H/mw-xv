import { describe, expect, it } from 'vitest';
import {
  calculateBudgetUtilization,
  canTransitionPolicyStatus,
  isAllocationTerminal,
  isMandateActive,
  isPolicyTerminal,
  summarizeBudgetAllocations,
} from '../src/domain.js';

describe('policy status transitions', () => {
  it('allows draft to enter review', () => {
    expect(canTransitionPolicyStatus('draft', 'in_review')).toBe(true);
  });

  it('allows enactment to come into force', () => {
    expect(canTransitionPolicyStatus('enacted', 'in_force')).toBe(true);
  });

  it('rejects skipping the review stage', () => {
    expect(canTransitionPolicyStatus('draft', 'in_force')).toBe(false);
  });

  it('rejects returning from in_force to enacted', () => {
    expect(canTransitionPolicyStatus('in_force', 'enacted')).toBe(false);
  });

  it('treats repealed as terminal', () => {
    expect(isPolicyTerminal('repealed')).toBe(true);
    expect(canTransitionPolicyStatus('repealed', 'in_review')).toBe(false);
  });
});

describe('mandate activity window', () => {
  const mandate = {
    status: 'active' as const,
    starts_on: '2024-01-01',
    ends_on: '2029-01-01',
  };

  it('is active within the window', () => {
    expect(isMandateActive(mandate, '2026-06-15')).toBe(true);
  });

  it('is active on boundary dates', () => {
    expect(isMandateActive(mandate, '2024-01-01')).toBe(true);
    expect(isMandateActive(mandate, '2029-01-01')).toBe(true);
  });

  it('is inactive before the window opens', () => {
    expect(isMandateActive(mandate, '2023-12-31')).toBe(false);
  });

  it('is inactive after the window closes', () => {
    expect(isMandateActive(mandate, '2029-01-02')).toBe(false);
  });

  it('is inactive for non-active statuses regardless of dates', () => {
    expect(
      isMandateActive({ status: 'revoked', starts_on: null, ends_on: null }, '2026-06-15')
    ).toBe(false);
  });
});

describe('budget allocation summaries', () => {
  const allocations = [
    { fiscal_year: 2025, amount_minor: 1_000_000, status: 'released' as const },
    { fiscal_year: 2025, amount_minor: 500_000, status: 'proposed' as const },
    { fiscal_year: 2026, amount_minor: 250_000, status: 'spent' as const },
    { fiscal_year: 2026, amount_minor: 250_000, status: 'returned' as const },
  ];

  it('totals every allocation', () => {
    expect(summarizeBudgetAllocations(allocations).totalMinor).toBe(2_000_000);
  });

  it('sums released and spent as released', () => {
    expect(summarizeBudgetAllocations(allocations).releasedMinor).toBe(1_250_000);
  });

  it('sums proposed and approved as pending', () => {
    expect(summarizeBudgetAllocations(allocations).pendingMinor).toBe(500_000);
  });

  it('groups by fiscal year in ascending order', () => {
    const { byFiscalYear } = summarizeBudgetAllocations(allocations);
    expect(byFiscalYear).toEqual([
      { fiscalYear: 2025, amountMinor: 1_500_000 },
      { fiscalYear: 2026, amountMinor: 500_000 },
    ]);
  });

  it('computes utilization from spent allocations only', () => {
    expect(calculateBudgetUtilization(allocations, 1_000_000)).toBe(25);
  });

  it('returns zero utilization for a non-positive budget', () => {
    expect(calculateBudgetUtilization(allocations, 0)).toBe(0);
  });
});

describe('allocation terminality', () => {
  it('marks spent and returned as terminal', () => {
    expect(isAllocationTerminal('spent')).toBe(true);
    expect(isAllocationTerminal('returned')).toBe(true);
  });

  it('marks proposed, approved and released as non-terminal', () => {
    expect(isAllocationTerminal('proposed')).toBe(false);
    expect(isAllocationTerminal('approved')).toBe(false);
    expect(isAllocationTerminal('released')).toBe(false);
  });
});
