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
  const str = JSON.stringify(inputSnapshot, Object.keys(inputSnapshot).sort());
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

export function isRunFinished(
  run: { status: string; finished_at?: string | Date | null }
): boolean {
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') {
    return true;
  }
  if (run.finished_at && run.status === 'running') {
    return true;
  }
  return false;
}