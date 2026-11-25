export { isPositiveId, isRecord } from '@moonwitness/types';

const JOB_NAME_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;

export function isJobHandlerName(value: unknown): value is string {
  return typeof value === 'string' && JOB_NAME_PATTERN.test(value);
}

export function nowIso(): string {
  return new Date().toISOString();
}
