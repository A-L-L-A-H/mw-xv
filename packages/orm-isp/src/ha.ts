export interface HaNasCandidate {
  readonly id: number;
  readonly name: string;
  readonly ha_priority?: number | null;
  readonly health_status?: string | null;
  readonly is_active: boolean;
}

export function selectHealthyNas<T extends HaNasCandidate>(devices: readonly T[]): T | undefined {
  const active = devices.filter((d) => d.is_active && d.health_status !== 'offline');
  if (active.length === 0) return undefined;

  const healthy = active.filter((d) => (d.health_status ?? 'healthy') === 'healthy');
  const pool = healthy.length > 0 ? healthy : active;
  return [...pool].sort(
    (a, b) => (a.ha_priority ?? 100) - (b.ha_priority ?? 100) || a.id - b.id
  )[0];
}
