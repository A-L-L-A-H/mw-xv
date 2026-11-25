import { createHash } from 'node:crypto';

type UnknownRecord = Record<string, unknown>;

function canonicalRunSnapshot(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalRunSnapshot).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalRunSnapshot(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function estimateRunSteps(
  solverProfile: { max_steps: number; tolerance: number },
  mesh?: { element_count: number }
): number {
  const base = solverProfile.max_steps;
  const meshFactor = mesh ? Math.max(1, Math.sqrt(mesh.element_count / 1000)) : 1;
  const toleranceFactor = Math.max(1, 1e-6 / solverProfile.tolerance);
  return Math.ceil(base * meshFactor * toleranceFactor);
}

export function computeRunChecksum(inputSnapshot: object): string {
  return createHash('sha256').update(canonicalRunSnapshot(inputSnapshot)).digest('hex');
}

export function isRunFinished(run: {
  status: string;
  finished_at?: string | Date | null;
}): boolean {
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') {
    return true;
  }
  if (run.finished_at && run.status === 'running') {
    return true;
  }
  return false;
}
