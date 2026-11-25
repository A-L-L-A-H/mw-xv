import { BotFlowStatus, BotRunStatus, BotStepKind, BotStepRunStatus } from './models.js';

const FLOW_TRANSITIONS = new Set([
  `${BotFlowStatus.DRAFT}>${BotFlowStatus.ACTIVE}`,
  `${BotFlowStatus.DRAFT}>${BotFlowStatus.ARCHIVED}`,
  `${BotFlowStatus.ACTIVE}>${BotFlowStatus.PAUSED}`,
  `${BotFlowStatus.ACTIVE}>${BotFlowStatus.ARCHIVED}`,
  `${BotFlowStatus.PAUSED}>${BotFlowStatus.ACTIVE}`,
  `${BotFlowStatus.PAUSED}>${BotFlowStatus.ARCHIVED}`,
]);

const RUN_TRANSITIONS = new Set([
  `${BotRunStatus.PENDING}>${BotRunStatus.RUNNING}`,
  `${BotRunStatus.PENDING}>${BotRunStatus.CANCELLED}`,
  `${BotRunStatus.RUNNING}>${BotRunStatus.SUCCEEDED}`,
  `${BotRunStatus.RUNNING}>${BotRunStatus.FAILED}`,
  `${BotRunStatus.RUNNING}>${BotRunStatus.CANCELLED}`,
]);

const STEP_RUN_TRANSITIONS = new Set([
  `${BotStepRunStatus.PENDING}>${BotStepRunStatus.IN_PROGRESS}`,
  `${BotStepRunStatus.PENDING}>${BotStepRunStatus.SKIPPED}`,
  `${BotStepRunStatus.IN_PROGRESS}>${BotStepRunStatus.SUCCEEDED}`,
  `${BotStepRunStatus.IN_PROGRESS}>${BotStepRunStatus.FAILED}`,
  `${BotStepRunStatus.IN_PROGRESS}>${BotStepRunStatus.SKIPPED}`,
]);

const STEP_KIND_SEQUENCE: Record<string, number> = {
  [BotStepKind.START]: 1,
  [BotStepKind.ACTION]: 2,
  [BotStepKind.CONDITION]: 3,
  [BotStepKind.WAIT]: 4,
  [BotStepKind.END]: 5,
};

export function canTransitionFlow(transition: { from: string; to: string }): boolean {
  return FLOW_TRANSITIONS.has(`${transition.from}>${transition.to}`);
}

export function canTransitionRun(transition: { from: string; to: string }): boolean {
  return RUN_TRANSITIONS.has(`${transition.from}>${transition.to}`);
}

export function canTransitionStepRun(transition: { from: string; to: string }): boolean {
  return STEP_RUN_TRANSITIONS.has(`${transition.from}>${transition.to}`);
}

export function validateStepKindSequence(prevKind: string, nextKind: string): boolean {
  const prev = STEP_KIND_SEQUENCE[prevKind];
  const next = STEP_KIND_SEQUENCE[nextKind];
  if (prev === undefined || next === undefined) return false;
  return next >= prev;
}

export function validateCronExpression(expr: string): { valid: boolean; reason: string | null } {
  const parts = expr.trim().split(/\s+/);
  const ranges = [
    { min: 0, max: 59, name: 'minute' },
    { min: 0, max: 23, name: 'hour' },
    { min: 1, max: 31, name: 'day of month' },
    { min: 1, max: 12, name: 'month' },
    { min: 0, max: 6, name: 'day of week' },
  ];
  for (let i = 0; i < 5; i++) {
    if (i >= parts.length) {
      return {
        valid: false,
        reason: 'Cron expression must have 5 fields (minute hour day month weekday)',
      };
    }
    const part = parts[i];
    const { min, max, name } = ranges[i];
    if (part === '*') continue;
    if (/^\d+$/.test(part)) {
      const val = parseInt(part, 10);
      if (val < min || val > max) {
        return { valid: false, reason: `${name} out of range (${min}-${max})` };
      }
      continue;
    }
    if (/^\d+-\d+$/.test(part)) {
      const [a, b] = part.split('-').map((x) => parseInt(x, 10));
      if (a < min || b > max || a > b) {
        return { valid: false, reason: `${name} range invalid` };
      }
      continue;
    }
    if (/^\*\/\d+$/.test(part)) {
      const step = parseInt(part.slice(2), 10);
      if (step <= 0 || step > max) {
        return { valid: false, reason: `${name} step invalid` };
      }
      continue;
    }
    return { valid: false, reason: `Invalid ${name} field: ${part}` };
  }
  if (parts.length > 5) {
    return {
      valid: false,
      reason: 'Cron expression must have 5 fields (minute hour day month weekday)',
    };
  }
  return { valid: true, reason: null };
}
