import type { AllocationStatus, MandateStatus, PolicyStatus } from './statuses.js';

export type { AllocationStatus, MandateStatus, PolicyStatus };

export interface BudgetLineSummary {
  readonly fiscalYear: number;
  readonly amountMinor: number;
}

export interface BudgetAllocationLike {
  readonly fiscal_year: number;
  readonly amount_minor: number;
  readonly status: AllocationStatus;
}

const POLICY_TRANSITIONS: Readonly<Record<PolicyStatus, readonly PolicyStatus[]>> = {
  draft: ['in_review', 'repealed'],
  in_review: ['enacted', 'draft', 'repealed'],
  enacted: ['in_force', 'repealed'],
  in_force: ['superseded', 'repealed'],
  superseded: ['repealed'],
  repealed: [],
};

const ALLOCATION_TERMINAL: ReadonlySet<AllocationStatus> = new Set(['spent', 'returned']);

export function canTransitionPolicyStatus(current: PolicyStatus, next: PolicyStatus): boolean {
  return POLICY_TRANSITIONS[current].includes(next);
}

export function isPolicyTerminal(status: PolicyStatus): boolean {
  return status === 'repealed';
}

export function isMandateActive(
  mandate: { status: MandateStatus; starts_on?: string | null; ends_on?: string | null },
  asOfDate: string
): boolean {
  if (mandate.status !== 'active') return false;
  if (mandate.starts_on && asOfDate < mandate.starts_on) return false;
  if (mandate.ends_on && asOfDate > mandate.ends_on) return false;
  return true;
}

export function summarizeBudgetAllocations(allocations: readonly BudgetAllocationLike[]): {
  totalMinor: number;
  releasedMinor: number;
  pendingMinor: number;
  byFiscalYear: readonly BudgetLineSummary[];
} {
  const totalMinor = allocations.reduce((sum, a) => sum + a.amount_minor, 0);
  const releasedMinor = allocations
    .filter((a) => a.status === 'released' || a.status === 'spent')
    .reduce((sum, a) => sum + a.amount_minor, 0);
  const pendingMinor = allocations
    .filter((a) => a.status === 'proposed' || a.status === 'approved')
    .reduce((sum, a) => sum + a.amount_minor, 0);

  const byYear = new Map<number, number>();
  for (const allocation of allocations) {
    byYear.set(
      allocation.fiscal_year,
      (byYear.get(allocation.fiscal_year) ?? 0) + allocation.amount_minor
    );
  }
  const byFiscalYear = [...byYear.entries()]
    .sort(([left], [right]) => left - right)
    .map(([fiscalYear, amountMinor]) => ({ fiscalYear, amountMinor }));

  return { totalMinor, releasedMinor, pendingMinor, byFiscalYear };
}

export function calculateBudgetUtilization(
  allocations: readonly BudgetAllocationLike[],
  totalBudgetMinor: number
): number {
  if (totalBudgetMinor <= 0) return 0;
  const spentMinor = allocations
    .filter((a) => a.status === 'spent')
    .reduce((sum, a) => sum + a.amount_minor, 0);
  return Math.round((spentMinor / totalBudgetMinor) * 10_000) / 100;
}

export function isAllocationTerminal(status: AllocationStatus): boolean {
  return ALLOCATION_TERMINAL.has(status);
}
