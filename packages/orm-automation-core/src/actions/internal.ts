export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

const JOB_NAME_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;

export function isJobHandlerName(value: unknown): value is string {
  return typeof value === 'string' && JOB_NAME_PATTERN.test(value);
}

export function nowIso(): string {
  return new Date().toISOString();
}
