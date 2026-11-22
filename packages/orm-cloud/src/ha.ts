export interface HaTargetCandidate {
  readonly id: number;
  readonly name: string;
  readonly priority?: number | null;
  readonly health_status?: string | null;
  readonly is_active: boolean;
}

export function selectHealthyDeploymentTarget<T extends HaTargetCandidate>(
  targets: readonly T[]
): T | undefined {
  const active = targets.filter((t) => t.is_active && t.health_status !== 'offline');
  if (active.length === 0) return undefined;

  const healthy = active.filter((t) => (t.health_status ?? 'healthy') === 'healthy');
  const pool = healthy.length > 0 ? healthy : active;
  return [...pool].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id - b.id)[0];
}
