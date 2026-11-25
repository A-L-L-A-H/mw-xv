import { createRedactor, type RedactionContext } from './redaction.js';
import { clampBps } from './sort-utils.js';
import { sha256Hex, toCanonicalJson as canonicalJson } from './canonical-json.js';

export type CausalRootCauseCategory =
  | 'prompt_ambiguity'
  | 'missing_context'
  | 'skill_negative_transfer'
  | 'tool_error'
  | 'environment_drift';

export type DivergenceTriggerReason = 'PROOF_GATE_FAILED' | 'WORLD_MODEL_SURPRISE_SPIKE' | 'BOTH';

export interface CausalCheckpoint {
  readonly stepIndex: number;
  readonly checkpointId: string;
  readonly commitSha: string;
  readonly proofGatePassed: boolean;
  readonly worldModelSurpriseBps: number;
  readonly timestamp?: string;
  readonly summary?: string;
  readonly toolErrors?: readonly string[];
  readonly missingContextKeys?: readonly string[];
  readonly promptAmbiguitySignals?: readonly string[];
  readonly negativeTransferSkills?: readonly string[];
  readonly environmentDriftSignals?: readonly string[];
}

export interface CausalRootCauseAttribution {
  readonly category: CausalRootCauseCategory;
  readonly confidenceBps: number;
  readonly evidence: readonly string[];
}

export interface CausalDivergencePoint {
  readonly diverged: boolean;
  readonly triggerReason: DivergenceTriggerReason | null;
  readonly surpriseThresholdBps: number;
  readonly divergenceCheckpoint: CausalCheckpoint | null;
  readonly rootCause: CausalRootCauseAttribution | null;
  readonly analysisSha256: string;
}

export interface CausalExecutionTrace {
  readonly traceId: string;
  readonly companyId?: number;
  readonly baseBranch: string;
  readonly checkpoints: readonly CausalCheckpoint[];
  readonly activeSkillIds?: readonly string[];
}

export interface CounterfactualIntervention {
  readonly description: string;
  readonly promptPatch?: string;
  readonly injectedContextKeys?: readonly string[];
  readonly disabledSkillIds?: readonly string[];
  readonly environmentOverrides?: Readonly<Record<string, string>>;
  readonly targetBranchPrefix?: string;
}

export interface CounterfactualReplayStep {
  readonly order: number;
  readonly action: 'checkout_checkpoint' | 'apply_intervention' | 'rerun_verification';
  readonly detail: string;
}

export interface CounterfactualForkPlan {
  readonly planId: string;
  readonly traceId: string;
  readonly companyId?: number;
  readonly baseBranch: string;
  readonly diverged: boolean;
  readonly forkFromCommitSha: string | null;
  readonly forkFromStepIndex: number | null;
  readonly forkFromCheckpointId: string | null;
  readonly counterfactualBranchName: string | null;
  readonly triggerReason: DivergenceTriggerReason | null;
  readonly rootCause: CausalRootCauseAttribution | null;
  readonly intervention: CounterfactualIntervention;
  readonly replaySteps: readonly CounterfactualReplayStep[];
  readonly advisoryOnly: true;
  readonly automatedSelfAccept: false;
  readonly planSha256: string;
}

export interface CausalReplayOptions {
  readonly surpriseThresholdBps?: number;
  readonly redactor?: RedactionContext;
}

const DEFAULT_SURPRISE_THRESHOLD_BPS = 2500;

function sanitizeCheckpoint(
  checkpoint: CausalCheckpoint,
  redactor: RedactionContext
): CausalCheckpoint {
  return {
    stepIndex: checkpoint.stepIndex,
    checkpointId: redactor.redactString(checkpoint.checkpointId),
    commitSha: redactor.redactString(checkpoint.commitSha),
    proofGatePassed: checkpoint.proofGatePassed,
    worldModelSurpriseBps: clampBps(checkpoint.worldModelSurpriseBps),
    ...(checkpoint.timestamp !== undefined ? { timestamp: checkpoint.timestamp } : {}),
    ...(checkpoint.summary !== undefined
      ? { summary: redactor.redactString(checkpoint.summary) }
      : {}),
    ...(checkpoint.toolErrors !== undefined
      ? { toolErrors: checkpoint.toolErrors.map((e) => redactor.redactString(e)) }
      : {}),
    ...(checkpoint.missingContextKeys !== undefined
      ? { missingContextKeys: checkpoint.missingContextKeys.map((k) => redactor.redactString(k)) }
      : {}),
    ...(checkpoint.promptAmbiguitySignals !== undefined
      ? {
          promptAmbiguitySignals: checkpoint.promptAmbiguitySignals.map((s) =>
            redactor.redactString(s)
          ),
        }
      : {}),
    ...(checkpoint.negativeTransferSkills !== undefined
      ? {
          negativeTransferSkills: checkpoint.negativeTransferSkills.map((s) =>
            redactor.redactString(s)
          ),
        }
      : {}),
    ...(checkpoint.environmentDriftSignals !== undefined
      ? {
          environmentDriftSignals: checkpoint.environmentDriftSignals.map((s) =>
            redactor.redactString(s)
          ),
        }
      : {}),
  };
}

function classifyRootCause(checkpoint: CausalCheckpoint): CausalRootCauseAttribution {
  const candidates: Array<{
    readonly category: CausalRootCauseCategory;
    readonly signals: readonly string[];
    readonly weight: number;
  }> = [
    {
      category: 'environment_drift',
      signals: checkpoint.environmentDriftSignals ?? [],
      weight: 5,
    },
    {
      category: 'tool_error',
      signals: checkpoint.toolErrors ?? [],
      weight: 4,
    },
    {
      category: 'skill_negative_transfer',
      signals: checkpoint.negativeTransferSkills ?? [],
      weight: 3,
    },
    {
      category: 'missing_context',
      signals: checkpoint.missingContextKeys ?? [],
      weight: 2,
    },
    {
      category: 'prompt_ambiguity',
      signals: checkpoint.promptAmbiguitySignals ?? [],
      weight: 1,
    },
  ];

  const active = candidates.filter((entry) => entry.signals.length > 0);
  if (active.length === 0) {
    return {
      category: 'prompt_ambiguity',
      confidenceBps: 5000,
      evidence: ['No explicit failure signal recorded; defaulted to prompt_ambiguity'],
    };
  }

  active.sort((left, right) => {
    if (right.signals.length !== left.signals.length) {
      return right.signals.length - left.signals.length;
    }
    return right.weight - left.weight;
  });

  const top = active[0]!;
  const totalSignals = active.reduce((sum, entry) => sum + entry.signals.length, 0);
  const dominanceBps = clampBps((top.signals.length / totalSignals) * 10_000);
  const confidenceBps = Math.max(6000, dominanceBps);

  return {
    category: top.category,
    confidenceBps,
    evidence: [...top.signals],
  };
}

export function findCausalDivergencePoint(
  checkpoints: readonly CausalCheckpoint[],
  options: CausalReplayOptions = {}
): CausalDivergencePoint {
  const redactor = options.redactor ?? createRedactor();
  const surpriseThresholdBps = clampBps(
    options.surpriseThresholdBps ?? DEFAULT_SURPRISE_THRESHOLD_BPS
  );

  const ordered = [...checkpoints].sort((left, right) => {
    if (left.stepIndex !== right.stepIndex) {
      return left.stepIndex - right.stepIndex;
    }
    return left.checkpointId.localeCompare(right.checkpointId);
  });

  for (const rawCheckpoint of ordered) {
    const checkpoint = sanitizeCheckpoint(rawCheckpoint, redactor);
    const proofFailed = !checkpoint.proofGatePassed;
    const surpriseSpiked = checkpoint.worldModelSurpriseBps >= surpriseThresholdBps;

    if (proofFailed || surpriseSpiked) {
      const triggerReason: DivergenceTriggerReason =
        proofFailed && surpriseSpiked
          ? 'BOTH'
          : proofFailed
            ? 'PROOF_GATE_FAILED'
            : 'WORLD_MODEL_SURPRISE_SPIKE';

      const rootCause = classifyRootCause(checkpoint);

      const unsignedResult = {
        diverged: true,
        triggerReason,
        surpriseThresholdBps,
        divergenceCheckpoint: checkpoint,
        rootCause,
      };

      return {
        ...unsignedResult,
        analysisSha256: sha256Hex(canonicalJson(unsignedResult)),
      };
    }
  }

  const unsignedClean = {
    diverged: false,
    triggerReason: null,
    surpriseThresholdBps,
    divergenceCheckpoint: null,
    rootCause: null,
  };

  return {
    ...unsignedClean,
    analysisSha256: sha256Hex(canonicalJson(unsignedClean)),
  };
}

function sanitizeBranchSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
}

export function planCounterfactualFork(
  trace: CausalExecutionTrace,
  intervention: CounterfactualIntervention,
  options: CausalReplayOptions = {}
): CounterfactualForkPlan {
  const redactor = options.redactor ?? createRedactor();
  const divergence = findCausalDivergencePoint(trace.checkpoints, {
    ...options,
    redactor,
  });

  const safeTraceId = redactor.redactString(trace.traceId);
  const safeBaseBranch = redactor.redactString(trace.baseBranch);

  const sanitizedEnvOverrides: Record<string, string> | undefined =
    intervention.environmentOverrides
      ? Object.fromEntries(
          Object.entries(intervention.environmentOverrides)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [redactor.redactString(key), redactor.redactString(value)])
        )
      : undefined;

  const sanitizedIntervention: CounterfactualIntervention = {
    description: redactor.redactString(intervention.description),
    ...(intervention.promptPatch !== undefined
      ? { promptPatch: redactor.redactString(intervention.promptPatch) }
      : {}),
    ...(intervention.injectedContextKeys !== undefined
      ? {
          injectedContextKeys: intervention.injectedContextKeys.map((k) =>
            redactor.redactString(k)
          ),
        }
      : {}),
    ...(intervention.disabledSkillIds !== undefined
      ? {
          disabledSkillIds: intervention.disabledSkillIds.map((s) => redactor.redactString(s)),
        }
      : {}),
    ...(sanitizedEnvOverrides !== undefined ? { environmentOverrides: sanitizedEnvOverrides } : {}),
    ...(intervention.targetBranchPrefix !== undefined
      ? { targetBranchPrefix: redactor.redactString(intervention.targetBranchPrefix) }
      : {}),
  };

  const checkpoint = divergence.divergenceCheckpoint;
  const forkFromCommitSha = checkpoint?.commitSha ?? null;
  const forkFromStepIndex = checkpoint?.stepIndex ?? null;
  const forkFromCheckpointId = checkpoint?.checkpointId ?? null;

  const branchPrefix = sanitizeBranchSegment(
    sanitizedIntervention.targetBranchPrefix ?? 'counterfactual'
  );
  const shortSha = forkFromCommitSha ? sanitizeBranchSegment(forkFromCommitSha).slice(0, 12) : null;
  const counterfactualBranchName =
    checkpoint && shortSha
      ? `${branchPrefix}/step-${String(checkpoint.stepIndex)}-${shortSha}`
      : null;

  const replaySteps: CounterfactualReplayStep[] =
    checkpoint && counterfactualBranchName && forkFromCommitSha
      ? [
          {
            order: 1,
            action: 'checkout_checkpoint',
            detail: `Create branch ${counterfactualBranchName} from commit ${forkFromCommitSha} (step ${String(checkpoint.stepIndex)}, checkpoint ${checkpoint.checkpointId}).`,
          },
          {
            order: 2,
            action: 'apply_intervention',
            detail: `Apply counterfactual intervention (${divergence.rootCause?.category ?? 'unknown'}): ${sanitizedIntervention.description}`,
          },
          {
            order: 3,
            action: 'rerun_verification',
            detail: `Re-run proof gate and world-model consistency gate from step ${String(checkpoint.stepIndex)} onward.`,
          },
        ]
      : [];

  const planSeed = canonicalJson({
    traceId: safeTraceId,
    companyId: trace.companyId,
    baseBranch: safeBaseBranch,
    forkFromCommitSha,
    forkFromStepIndex,
    forkFromCheckpointId,
    counterfactualBranchName,
    triggerReason: divergence.triggerReason,
    rootCause: divergence.rootCause,
    intervention: sanitizedIntervention,
    replaySteps,
  });

  const planId = `cf-plan-${sha256Hex(planSeed).slice(0, 16)}`;

  const unsignedPlan = {
    planId,
    traceId: safeTraceId,
    ...(trace.companyId !== undefined ? { companyId: trace.companyId } : {}),
    baseBranch: safeBaseBranch,
    diverged: divergence.diverged,
    forkFromCommitSha,
    forkFromStepIndex,
    forkFromCheckpointId,
    counterfactualBranchName,
    triggerReason: divergence.triggerReason,
    rootCause: divergence.rootCause,
    intervention: sanitizedIntervention,
    replaySteps,
    advisoryOnly: true as const,
    automatedSelfAccept: false as const,
  };

  return {
    ...unsignedPlan,
    planSha256: sha256Hex(canonicalJson(unsignedPlan)),
  };
}
