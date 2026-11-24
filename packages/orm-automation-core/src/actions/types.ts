import type { Knex } from 'knex';

export interface ActionResult {
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly detail?: Record<string, unknown>;
  readonly error?: string;
}

export interface AutomationActionContext {
  readonly db: Knex;
  readonly companyId: number;
  readonly ruleId: number;
  readonly triggerRef: string;
  readonly dedupeKey: string | null;
}

export interface AutomationActionInput {
  readonly payload: unknown;
  readonly config: Record<string, unknown>;
}
