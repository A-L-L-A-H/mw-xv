import type { AiEvalSummaryDto } from '@/components/ai/ai-api';

/**
 * Client-safe view of the evaluation contract owned by
 * `@moonwitness/ai-evaluation` (`CapabilityGateId` / `G0`-`G6` and the four
 * `MemoryAblationMode` arms). The Board must not import that package directly:
 * it reaches Node-only code through `@moonwitness/ai-runtime`. These helpers
 * only interpret the already-reduced DTO returned by `/api/ai/eval-summary`.
 *
 * Every result field is nullable. A missing or malformed value is rendered as
 * "no data" — never as PASS, zero regressions, or a fabricated pass rate.
 */

export const NO_DATA = '—';

export const CAPABILITY_GATE_METADATA = [
  {
    gate: 'G0',
    label: 'Governed Assistant',
    criterion: 'Schema-valid outputs, redaction, and policy adherence',
  },
  {
    gate: 'G1',
    label: 'Bounded Actor',
    criterion: 'Read-only inspection and scoped tool calls without boundary violation',
  },
  {
    gate: 'G2',
    label: 'Persistent Worker',
    criterion: 'Crash recovery, lease fencing, and continuing obligation continuity',
  },
  {
    gate: 'G3',
    label: 'Coordinated Team',
    criterion: 'Multi-agent decomposition outperforms single-agent on decomposable tasks',
  },
  {
    gate: 'G4',
    label: 'Adaptive Organization',
    criterion: 'Governed taskforce formation and scoped workforce assignment',
  },
  {
    gate: 'G5',
    label: 'Experience-Driven Improvement',
    criterion: 'Approved memory and skill versions improve cost/latency on held-out tasks',
  },
  {
    gate: 'G6',
    label: 'Cross-Domain Transfer Research',
    criterion: 'Novel task transfer with zero safety regressions (Non-AGI research gate)',
  },
] as const;

export const ABLATION_ARM_METADATA = [
  {
    arm: 'no-memory',
    description: 'Baseline run without memory or skill retrieval',
  },
  {
    arm: 'episodic-only',
    description: 'Approved episodic memory retrieval only',
  },
  {
    arm: 'skill-only',
    description: 'Approved procedural skill versions only',
  },
  {
    arm: 'combined',
    description: 'Combined episodic memory + procedural skill versions',
  },
] as const;

export interface CapabilityGateView {
  readonly gate: string;
  readonly label: string;
  readonly criterion: string;
  readonly passed: boolean | null;
  readonly safetyRegressions: number | null;
}

export interface AblationArmView {
  readonly arm: string;
  readonly description: string;
  readonly passRate: number | null;
  readonly harmRate: number | null;
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function toCapabilityGateViews(
  summary: AiEvalSummaryDto | null | undefined
): CapabilityGateView[] {
  const gates = summary?.capabilityGates;
  return CAPABILITY_GATE_METADATA.map((meta) => {
    const live = Array.isArray(gates) ? gates.find((gate) => gate.gate === meta.gate) : undefined;
    return {
      gate: meta.gate,
      label: meta.label,
      criterion: meta.criterion,
      passed: typeof live?.passed === 'boolean' ? live.passed : null,
      safetyRegressions: isCount(live?.safetyRegressions) ? live.safetyRegressions : null,
    };
  });
}

export function toAblationArmViews(
  summary: AiEvalSummaryDto | null | undefined
): AblationArmView[] {
  const conditions = summary?.ablationConditions;
  return ABLATION_ARM_METADATA.map((meta) => {
    const live = conditions?.[meta.arm];
    return {
      arm: meta.arm,
      description: meta.description,
      passRate: isRate(live?.passRate) ? live.passRate : null,
      harmRate: isRate(live?.harmRate) ? live.harmRate : null,
    };
  });
}

export function countPassedGates(
  gates: readonly CapabilityGateView[]
): { readonly passed: number; readonly total: number } | null {
  if (gates.length === 0 || gates.some((gate) => gate.passed === null)) return null;
  return {
    passed: gates.filter((gate) => gate.passed === true).length,
    total: gates.length,
  };
}

export function totalSafetyRegressions(
  gates: readonly CapabilityGateView[]
): number | null {
  if (gates.length === 0 || gates.some((gate) => gate.safetyRegressions === null)) return null;
  return gates.reduce((total, gate) => total + (gate.safetyRegressions ?? 0), 0);
}

export function formatRate(value: number | null): string {
  return value === null ? NO_DATA : `${(value * 100).toFixed(0)}%`;
}

export function formatCount(value: number | null): string {
  return value === null ? NO_DATA : String(value);
}
