import { sha256Canonical } from './canonical-json.js';
import { clampBps } from './sort-utils.js';
import { createRedactor } from './redaction.js';

export type ActiveInferenceActionKind =
  'epistemic_action' | 'optimal_question' | 'pragmatic_action';

export interface ActiveInferenceCandidate {
  readonly actionId: string;
  readonly kind: ActiveInferenceActionKind;
  readonly label: string;
  readonly goalAlignmentBps: number;
  readonly successProbabilityBps: number;
  readonly priorUncertaintyBps: number;
  readonly expectedPosteriorUncertaintyBps: number;
  readonly estimatedTokens?: number;
  readonly estimatedLatencyMs?: number;
  readonly humanInterruptionCostBps?: number;
  readonly reversible?: boolean;
}

export interface ActiveInferencePolicy {
  readonly companyId?: string;
  readonly pragmaticWeightBps?: number;
  readonly epistemicWeightBps?: number;
  readonly costWeightBps?: number;
  readonly maxTokenBudget?: number;
  readonly maxLatencyMs?: number;
  readonly irreversibleRiskPenaltyBps?: number;
  readonly uncertaintyThresholdBps?: number;
}

export interface EvaluatedActiveInferenceCandidate {
  readonly actionId: string;
  readonly kind: ActiveInferenceActionKind;
  readonly label: string;
  readonly pragmaticValueBps: number;
  readonly epistemicInfoGainBps: number;
  readonly computeCostBps: number;
  readonly expectedFreeEnergyBps: number;
  readonly reversible: boolean;
}

export interface ActiveInferenceDecision {
  readonly companyId?: string;
  readonly selectedActionKind: ActiveInferenceActionKind;
  readonly selectedActionId: string | null;
  readonly selectedCandidate: EvaluatedActiveInferenceCandidate | null;
  readonly rankedCandidates: readonly EvaluatedActiveInferenceCandidate[];
  readonly selectionRationale: string;
  readonly automatedSelfAccept: false;
  readonly automatedPromotionAllowed: false;
  readonly decisionSha256: string;
}

const DEFAULT_PRAGMATIC_WEIGHT_BPS = 10_000;
const DEFAULT_EPISTEMIC_WEIGHT_BPS = 10_000;
const DEFAULT_COST_WEIGHT_BPS = 5000;
const DEFAULT_MAX_TOKEN_BUDGET = 8000;
const DEFAULT_MAX_LATENCY_MS = 10_000;
const DEFAULT_IRREVERSIBLE_RISK_PENALTY_BPS = 2000;
const DEFAULT_UNCERTAINTY_THRESHOLD_BPS = 4000;
const DEFAULT_HUMAN_INTERRUPTION_COST_BPS = 1500;

export function evaluateExpectedFreeEnergy(
  candidates: readonly ActiveInferenceCandidate[],
  policy: ActiveInferencePolicy = {}
): ActiveInferenceDecision {
  const redactor = createRedactor();
  const pragmaticWeightBps = clampBps(policy.pragmaticWeightBps ?? DEFAULT_PRAGMATIC_WEIGHT_BPS);
  const epistemicWeightBps = clampBps(policy.epistemicWeightBps ?? DEFAULT_EPISTEMIC_WEIGHT_BPS);
  const costWeightBps = clampBps(policy.costWeightBps ?? DEFAULT_COST_WEIGHT_BPS);
  const maxTokenBudget = Math.max(1, Math.floor(policy.maxTokenBudget ?? DEFAULT_MAX_TOKEN_BUDGET));
  const maxLatencyMs = Math.max(1, Math.floor(policy.maxLatencyMs ?? DEFAULT_MAX_LATENCY_MS));
  const irreversibleRiskPenaltyBps = clampBps(
    policy.irreversibleRiskPenaltyBps ?? DEFAULT_IRREVERSIBLE_RISK_PENALTY_BPS
  );
  const uncertaintyThresholdBps = clampBps(
    policy.uncertaintyThresholdBps ?? DEFAULT_UNCERTAINTY_THRESHOLD_BPS
  );

  if (candidates.length === 0) {
    const emptyBase = {
      companyId: policy.companyId?.trim(),
      selectedActionKind: 'epistemic_action' as const,
      selectedActionId: null,
      selectedCandidate: null,
      rankedCandidates: [] as readonly EvaluatedActiveInferenceCandidate[],
      selectionRationale:
        'No action candidates supplied; defaulting to epistemic_action to gather context safely.',
      automatedSelfAccept: false as const,
      automatedPromotionAllowed: false as const,
    };

    return {
      ...emptyBase,
      decisionSha256: sha256Canonical(emptyBase),
    };
  }

  const evaluated: EvaluatedActiveInferenceCandidate[] = candidates.map((candidate) => {
    const goalAlignmentBps = clampBps(candidate.goalAlignmentBps);
    const successProbabilityBps = clampBps(candidate.successProbabilityBps);
    const priorUncertaintyBps = clampBps(candidate.priorUncertaintyBps);
    const expectedPosteriorUncertaintyBps = clampBps(candidate.expectedPosteriorUncertaintyBps);
    const reversible = candidate.reversible ?? true;

    const pragmaticValueBps = clampBps(
      Math.round((goalAlignmentBps * successProbabilityBps) / 10_000)
    );
    const epistemicInfoGainBps = clampBps(
      Math.max(0, priorUncertaintyBps - expectedPosteriorUncertaintyBps)
    );

    const tokenCostBps = clampBps(
      Math.round((Math.max(0, candidate.estimatedTokens ?? 0) / maxTokenBudget) * 10_000)
    );
    const latencyCostBps = clampBps(
      Math.round((Math.max(0, candidate.estimatedLatencyMs ?? 0) / maxLatencyMs) * 10_000)
    );
    const interruptionCostBps =
      candidate.kind === 'optimal_question'
        ? clampBps(candidate.humanInterruptionCostBps ?? DEFAULT_HUMAN_INTERRUPTION_COST_BPS)
        : 0;
    const riskPenaltyBps =
      !reversible && priorUncertaintyBps >= uncertaintyThresholdBps
        ? irreversibleRiskPenaltyBps
        : 0;

    const computeCostBps = clampBps(
      Math.round((tokenCostBps + latencyCostBps) / 2) + interruptionCostBps + riskPenaltyBps
    );

    // Expected Free Energy G(pi) = weightedCost - weightedPragmatic - weightedEpistemic (lower is better)
    const expectedFreeEnergyBps =
      Math.round((computeCostBps * costWeightBps) / 10_000) -
      Math.round((pragmaticValueBps * pragmaticWeightBps) / 10_000) -
      Math.round((epistemicInfoGainBps * epistemicWeightBps) / 10_000);

    return {
      actionId: candidate.actionId,
      kind: candidate.kind,
      label: redactor.redactString(candidate.label.trim()),
      pragmaticValueBps,
      epistemicInfoGainBps,
      computeCostBps,
      expectedFreeEnergyBps,
      reversible,
    };
  });

  evaluated.sort((left, right) => {
    if (left.expectedFreeEnergyBps !== right.expectedFreeEnergyBps) {
      return left.expectedFreeEnergyBps - right.expectedFreeEnergyBps;
    }
    if (right.epistemicInfoGainBps !== left.epistemicInfoGainBps) {
      return right.epistemicInfoGainBps - left.epistemicInfoGainBps;
    }
    if (right.pragmaticValueBps !== left.pragmaticValueBps) {
      return right.pragmaticValueBps - left.pragmaticValueBps;
    }
    return left.actionId.localeCompare(right.actionId);
  });

  const winner = evaluated[0]!;
  const decisionBase = {
    companyId: policy.companyId?.trim(),
    selectedActionKind: winner.kind,
    selectedActionId: winner.actionId,
    selectedCandidate: winner,
    rankedCandidates: evaluated,
    selectionRationale: `Selected ${winner.kind} (${winner.actionId}) with lowest expectedFreeEnergyBps=${String(winner.expectedFreeEnergyBps)} (pragmatic=${String(winner.pragmaticValueBps)}, epistemic=${String(winner.epistemicInfoGainBps)}, cost=${String(winner.computeCostBps)}).`,
    automatedSelfAccept: false as const,
    automatedPromotionAllowed: false as const,
  };

  return {
    ...decisionBase,
    decisionSha256: sha256Canonical(decisionBase),
  };
}
