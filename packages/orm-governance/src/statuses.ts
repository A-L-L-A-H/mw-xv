export const OFFICIAL_STATUSES = ['active', 'suspended', 'dismissed', 'retired'] as const;
export type OfficialStatus = (typeof OFFICIAL_STATUSES)[number];

export const MANDATE_STATUSES = ['active', 'expired', 'revoked', 'pending'] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export const POLICY_STATUSES = [
  'draft',
  'in_review',
  'enacted',
  'in_force',
  'superseded',
  'repealed',
] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const REGULATION_STATUSES = [
  'proposed',
  'ratified',
  'in_force',
  'annulled',
  'archived',
] as const;
export type RegulationStatus = (typeof REGULATION_STATUSES)[number];

export const PROGRAM_STATUSES = ['planned', 'running', 'completed', 'halted', 'cancelled'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const ALLOCATION_STATUSES = [
  'proposed',
  'approved',
  'released',
  'spent',
  'returned',
] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];
