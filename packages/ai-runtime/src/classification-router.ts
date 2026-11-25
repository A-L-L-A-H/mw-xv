import type {
  AiProvider,
  Clock,
  DataClassification,
  LatencyTier,
  ModelModality,
  ModelProfileConfig,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
  TaskClass,
} from './types.js';
import { ProviderError, SYSTEM_CLOCK } from './types.js';
import type { ProviderResilienceGuard } from './resilience.js';

export type DataClassificationAlias = DataClassification | 'local-only' | 'cloud-eligible';

const CLASSIFICATION_RANK: Readonly<Record<DataClassification, number>> = {
  cloud_eligible: 1,
  local_only: 2,
  restricted: 3,
};

export function normalizeDataClassification(
  value: DataClassificationAlias | string,
  providerId = 'classification-router',
  correlationId = 'classification-normalization'
): DataClassification {
  if (value === 'local_only' || value === 'local-only') return 'local_only';
  if (value === 'cloud_eligible' || value === 'cloud-eligible') return 'cloud_eligible';
  if (value === 'restricted') return 'restricted';

  throw new ProviderError(`Invalid data classification "${value}"`, {
    code: 'policy_blocked',
    reasonCode: 'INVALID_CLASSIFICATION_OVERRIDE',
    providerId,
    correlationId,
    retryable: false,
  });
}

export function isProviderCloudEgress(
  provider: Pick<AiProvider, 'kind'>,
  deploymentZone?: 'local' | 'cloud'
): boolean {
  // FreeLLMAPI is always cloud egress, even when privately hosted inside the
  // Compose network. Never allow a deployment-zone override to downgrade it.
  if (provider.kind === 'freellmapi') return true;
  if (deploymentZone !== undefined) {
    return deploymentZone === 'cloud';
  }
  return provider.kind === 'openai' || provider.kind === 'anthropic';
}

export interface CloudEgressPolicyApproval {
  readonly companyId: number;
  readonly workContractId?: string;
  readonly providerId: string;
  readonly classification: Extract<DataClassification, 'local_only' | 'restricted'>;
  readonly approvedBy: string;
  readonly reason: string;
  readonly expiresAt?: string;
}

export interface ClassificationRoutingPolicy {
  readonly allowedClassification: DataClassificationAlias;
  readonly allowCloudFallback: boolean;
  readonly approvedCloudOverrides?: readonly CloudEgressPolicyApproval[];
  readonly requestedOverrideClassification?: DataClassificationAlias;
}

export interface RegisteredRouteTarget {
  readonly id: string;
  readonly provider: AiProvider;
  readonly model: ModelProfileConfig;
  readonly deploymentZone?: 'local' | 'cloud';
  readonly supportedTaskClasses?: readonly TaskClass[];
  readonly latencyTier?: LatencyTier;
  readonly enabled?: boolean;
  readonly resilienceGuard?: ProviderResilienceGuard;
}

export interface ModelSelectionCriteria {
  readonly taskClass?: TaskClass;
  readonly preferredLatencyTier?: LatencyTier;
  readonly maxCostMicrosPerMillionInputTokens?: number;
  readonly maxCostMicrosPerMillionOutputTokens?: number;
  readonly requiredCapabilities?: Partial<ProviderCapabilities>;
  readonly requiredModalities?: readonly ModelModality[];
  readonly preferredProviderIds?: readonly string[];
  readonly minimumContextWindowTokens?: number;
}

export interface ClassificationRoutingRequest {
  readonly correlationId: string;
  readonly companyId: number;
  readonly workContractId?: string;
  readonly dataClassification: DataClassificationAlias;
  readonly policy: ClassificationRoutingPolicy;
  readonly criteria?: ModelSelectionCriteria;
  readonly targetProviderId?: string;
  readonly targetModelId?: string;
}

export interface ClassificationRoutingDecision {
  readonly correlationId: string;
  readonly effectiveClassification: DataClassification;
  readonly selectedTarget: RegisteredRouteTarget;
  readonly fallbackTargets: readonly RegisteredRouteTarget[];
  readonly blockedTargets: readonly {
    readonly targetId: string;
    readonly providerId: string;
    readonly reasonCode: string;
    readonly detail: string;
  }[];
  readonly overrideApproved: boolean;
}

export interface RoutedExecutionResult {
  readonly response: ProviderResponse;
  readonly decision: ClassificationRoutingDecision;
  readonly attempts: number;
  readonly usedFallback: boolean;
  readonly attemptedTargetIds: readonly string[];
}

function hasAllRequiredCapabilities(
  target: RegisteredRouteTarget,
  required?: Partial<ProviderCapabilities>
): boolean {
  if (!required) return true;
  const provCaps = target.provider.capabilities;
  const modelCaps = target.model.capabilities;

  if (required.textGeneration && (!provCaps.textGeneration || !modelCaps.textGeneration)) {
    return false;
  }
  if (required.toolCall && (!provCaps.toolCall || !modelCaps.toolCall)) {
    return false;
  }
  if (required.streaming && (!provCaps.streaming || !modelCaps.streaming)) {
    return false;
  }
  if (required.structuredOutput && (!provCaps.structuredOutput || !modelCaps.structuredOutput)) {
    return false;
  }
  return true;
}

function hasRequiredModalities(
  model: ModelProfileConfig,
  required?: readonly ModelModality[]
): boolean {
  if (!required || required.length === 0) return true;
  const supported = new Set(model.modalities);
  return required.every((modality) => supported.has(modality));
}

function isCloudOverrideApproved(
  approvals: readonly CloudEgressPolicyApproval[] | undefined,
  params: {
    readonly companyId: number;
    readonly workContractId?: string;
    readonly providerId: string;
    readonly classification: DataClassification;
    readonly nowMs: number;
  }
): boolean {
  if (!approvals || approvals.length === 0) return false;
  if (params.classification === 'cloud_eligible') return true;

  return approvals.some((approval) => {
    if (approval.companyId !== params.companyId) return false;
    if (approval.providerId !== params.providerId) return false;
    if (approval.classification !== params.classification) return false;
    if (approval.workContractId && approval.workContractId !== params.workContractId) return false;
    if (!approval.approvedBy.trim() || !approval.reason.trim()) return false;
    if (approval.expiresAt !== undefined) {
      const expiresAtMs = Date.parse(approval.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= params.nowMs) {
        return false;
      }
    }
    return true;
  });
}

function scoreTarget(
  target: RegisteredRouteTarget,
  criteria: ModelSelectionCriteria | undefined,
  effectiveClassification: DataClassification
): number {
  let score = 0;
  const isCloud = isProviderCloudEgress(target.provider, target.deploymentZone);

  if (
    !isCloud &&
    (effectiveClassification === 'local_only' || effectiveClassification === 'restricted')
  ) {
    score -= 100_000;
  }

  if (criteria?.preferredProviderIds) {
    const idx = criteria.preferredProviderIds.indexOf(target.provider.id);
    if (idx !== -1) {
      score -= 10_000 - idx * 100;
    }
  }

  if (criteria?.taskClass && target.supportedTaskClasses?.includes(criteria.taskClass)) {
    score -= 1_000;
  }

  if (criteria?.preferredLatencyTier && target.latencyTier === criteria.preferredLatencyTier) {
    score -= 500;
  }

  const inputPrice = target.model.pricing?.inputMicrosPerMillionTokens ?? 0;
  const outputPrice = target.model.pricing?.outputMicrosPerMillionTokens ?? 0;
  score += Math.min(99_999, Math.floor((inputPrice + outputPrice) / 1_000));

  return score;
}

export class DataClassificationRouter {
  private readonly targets = new Map<string, RegisteredRouteTarget>();
  private readonly clock: Clock;

  constructor(options?: {
    readonly targets?: readonly RegisteredRouteTarget[];
    readonly providers?: readonly AiProvider[];
    readonly clock?: Clock;
  }) {
    this.clock = options?.clock ?? SYSTEM_CLOCK;
    for (const target of options?.targets ?? []) {
      this.registerTarget(target);
    }
    for (const provider of options?.providers ?? []) {
      this.registerTarget({
        id: provider.id,
        provider,
        model: {
          id: `${provider.id}-default`,
          providerId: provider.id,
          providerKind: provider.kind,
          modelName: 'default',
          capabilities: provider.capabilities,
          contextWindowTokens: 16_384,
          maxOutputTokens: 2_048,
          modalities: ['text'],
        },
      });
    }
  }

  selectProvider(params: {
    readonly dataClassification: DataClassificationAlias;
    readonly requiredCapabilities?: Partial<ProviderCapabilities>;
    readonly companyId?: number;
    readonly correlationId?: string;
  }): AiProvider {
    const decision = this.evaluateRouting({
      correlationId: params.correlationId ?? 'select-provider',
      companyId: params.companyId ?? 1,
      dataClassification: params.dataClassification,
      policy: {
        allowedClassification: params.dataClassification,
        allowCloudFallback:
          params.dataClassification === 'cloud_eligible' ||
          params.dataClassification === 'cloud-eligible',
      },
      criteria: {
        requiredCapabilities: params.requiredCapabilities,
      },
    });
    return decision.selectedTarget.provider;
  }

  registerTarget(target: RegisteredRouteTarget): void {
    this.targets.set(target.id, target);
  }

  unregisterTarget(targetId: string): boolean {
    return this.targets.delete(targetId);
  }

  listTargets(): readonly RegisteredRouteTarget[] {
    return [...this.targets.values()];
  }

  evaluateRouting(request: ClassificationRoutingRequest): ClassificationRoutingDecision {
    const correlationId = request.correlationId;
    const rawClassification = normalizeDataClassification(
      request.dataClassification,
      'classification-router',
      correlationId
    );
    const policyAllowedClassification = normalizeDataClassification(
      request.policy.allowedClassification,
      'classification-router',
      correlationId
    );

    let effectiveClassification = rawClassification;
    let overrideApproved = false;

    if (request.policy.requestedOverrideClassification !== undefined) {
      const requestedOverride = normalizeDataClassification(
        request.policy.requestedOverrideClassification,
        'classification-router',
        correlationId
      );
      if (CLASSIFICATION_RANK[requestedOverride] < CLASSIFICATION_RANK[rawClassification]) {
        throw new ProviderError(
          `Classification override "${requestedOverride}" cannot weaken "${rawClassification}"`,
          {
            code: 'policy_blocked',
            reasonCode: 'INVALID_CLASSIFICATION_OVERRIDE',
            providerId: 'classification-router',
            correlationId,
            retryable: false,
          }
        );
      }
      effectiveClassification = requestedOverride;
    }

    if (
      CLASSIFICATION_RANK[effectiveClassification] >
      CLASSIFICATION_RANK[policyAllowedClassification]
    ) {
      const canOverrideViaApproval =
        effectiveClassification !== 'cloud_eligible' &&
        (request.policy.approvedCloudOverrides?.length ?? 0) > 0;
      if (!canOverrideViaApproval && policyAllowedClassification === 'cloud_eligible') {
        throw new ProviderError(
          `Data classification "${effectiveClassification}" exceeds policy ceiling "${policyAllowedClassification}"`,
          {
            code: 'policy_blocked',
            reasonCode: 'CLASSIFICATION_EGRESS_BLOCKED',
            providerId: 'classification-router',
            correlationId,
            retryable: false,
          }
        );
      }
    }

    const nowMs = this.clock.now();
    const eligible: RegisteredRouteTarget[] = [];
    const blockedTargets: {
      readonly targetId: string;
      readonly providerId: string;
      readonly reasonCode: string;
      readonly detail: string;
    }[] = [];

    for (const target of this.targets.values()) {
      if (target.enabled === false) continue;
      if (request.targetProviderId && target.provider.id !== request.targetProviderId) continue;
      if (request.targetModelId && target.model.id !== request.targetModelId) continue;

      const isCloud = isProviderCloudEgress(target.provider, target.deploymentZone);
      if (
        isCloud &&
        (effectiveClassification === 'local_only' || effectiveClassification === 'restricted')
      ) {
        const approved = isCloudOverrideApproved(request.policy.approvedCloudOverrides, {
          companyId: request.companyId,
          workContractId: request.workContractId,
          providerId: target.provider.id,
          classification: effectiveClassification,
          nowMs,
        });
        if (!approved) {
          blockedTargets.push({
            targetId: target.id,
            providerId: target.provider.id,
            reasonCode: 'CLASSIFICATION_EGRESS_BLOCKED',
            detail: `Cloud provider "${target.provider.id}" blocked for "${effectiveClassification}" data`,
          });
          continue;
        }
        overrideApproved = true;
      }

      const criteria = request.criteria;
      if (!hasAllRequiredCapabilities(target, criteria?.requiredCapabilities)) {
        blockedTargets.push({
          targetId: target.id,
          providerId: target.provider.id,
          reasonCode: 'CAPABILITY_UNSUPPORTED',
          detail: `Target "${target.id}" lacks required provider/model capabilities`,
        });
        continue;
      }
      if (!hasRequiredModalities(target.model, criteria?.requiredModalities)) {
        blockedTargets.push({
          targetId: target.id,
          providerId: target.provider.id,
          reasonCode: 'CAPABILITY_UNSUPPORTED',
          detail: `Target "${target.id}" lacks required modalities`,
        });
        continue;
      }
      if (
        criteria?.minimumContextWindowTokens !== undefined &&
        target.model.contextWindowTokens < criteria.minimumContextWindowTokens
      ) {
        blockedTargets.push({
          targetId: target.id,
          providerId: target.provider.id,
          reasonCode: 'CAPABILITY_UNSUPPORTED',
          detail: `Target "${target.id}" context window below minimum`,
        });
        continue;
      }
      if (
        criteria?.maxCostMicrosPerMillionInputTokens !== undefined &&
        (target.model.pricing?.inputMicrosPerMillionTokens ?? 0) >
          criteria.maxCostMicrosPerMillionInputTokens
      ) {
        continue;
      }
      if (
        criteria?.maxCostMicrosPerMillionOutputTokens !== undefined &&
        (target.model.pricing?.outputMicrosPerMillionTokens ?? 0) >
          criteria.maxCostMicrosPerMillionOutputTokens
      ) {
        continue;
      }

      eligible.push(target);
    }

    if (eligible.length === 0) {
      const egressBlocked = blockedTargets.find(
        (item) => item.reasonCode === 'CLASSIFICATION_EGRESS_BLOCKED'
      );
      if (egressBlocked) {
        throw new ProviderError(egressBlocked.detail, {
          code: 'policy_blocked',
          reasonCode: 'CLASSIFICATION_EGRESS_BLOCKED',
          providerId: egressBlocked.providerId,
          correlationId,
          retryable: false,
        });
      }
      throw new ProviderError(
        `No eligible model found for classification "${effectiveClassification}"`,
        {
          code: 'policy_blocked',
          reasonCode: 'NO_ELIGIBLE_MODEL',
          providerId: 'classification-router',
          correlationId,
          retryable: false,
        }
      );
    }

    eligible.sort((a, b) => {
      const scoreDiff =
        scoreTarget(a, request.criteria, effectiveClassification) -
        scoreTarget(b, request.criteria, effectiveClassification);
      if (scoreDiff !== 0) return scoreDiff;
      return a.id.localeCompare(b.id);
    });

    const [selectedTarget, ...fallbackTargets] = eligible;
    return {
      correlationId,
      effectiveClassification,
      selectedTarget,
      fallbackTargets,
      blockedTargets,
      overrideApproved,
    };
  }

  /**
   * Executes a provider request while strictly enforcing classification boundaries during fallback.
   * Fallback never silently crosses from local_only/restricted to cloud or violates allowCloudFallback.
   */
  async executeWithRouting(params: {
    readonly routing: ClassificationRoutingRequest;
    readonly buildRequest: (target: RegisteredRouteTarget) => ProviderRequest;
    readonly explicitFallbackTargetIds?: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<RoutedExecutionResult> {
    const decision = this.evaluateRouting(params.routing);
    const effectiveClassification = decision.effectiveClassification;
    const primaryIsCloud = isProviderCloudEgress(
      decision.selectedTarget.provider,
      decision.selectedTarget.deploymentZone
    );

    const orderedCandidates: RegisteredRouteTarget[] = [decision.selectedTarget];
    if (params.explicitFallbackTargetIds && params.explicitFallbackTargetIds.length > 0) {
      for (const fallbackId of params.explicitFallbackTargetIds) {
        if (fallbackId === decision.selectedTarget.id) continue;
        const candidate = this.targets.get(fallbackId);
        if (!candidate) continue;

        const candidateIsCloud = isProviderCloudEgress(
          candidate.provider,
          candidate.deploymentZone
        );
        if (
          candidateIsCloud &&
          (effectiveClassification === 'local_only' || effectiveClassification === 'restricted')
        ) {
          const approved = isCloudOverrideApproved(params.routing.policy.approvedCloudOverrides, {
            companyId: params.routing.companyId,
            workContractId: params.routing.workContractId,
            providerId: candidate.provider.id,
            classification: effectiveClassification,
            nowMs: this.clock.now(),
          });
          if (!approved) {
            throw new ProviderError(
              `Fallback to cloud target "${candidate.id}" blocked across "${effectiveClassification}" boundary`,
              {
                code: 'policy_blocked',
                reasonCode: 'CLASSIFICATION_FALLBACK_BLOCKED',
                providerId: candidate.provider.id,
                correlationId: params.routing.correlationId,
                retryable: false,
              }
            );
          }
        }
        if (!primaryIsCloud && candidateIsCloud && !params.routing.policy.allowCloudFallback) {
          throw new ProviderError(
            `Fallback from local target "${decision.selectedTarget.id}" to cloud target "${candidate.id}" disallowed by policy`,
            {
              code: 'policy_blocked',
              reasonCode: 'CLASSIFICATION_FALLBACK_BLOCKED',
              providerId: candidate.provider.id,
              correlationId: params.routing.correlationId,
              retryable: false,
            }
          );
        }
        orderedCandidates.push(candidate);
      }
    } else {
      for (const fallback of decision.fallbackTargets) {
        const candidateIsCloud = isProviderCloudEgress(fallback.provider, fallback.deploymentZone);
        if (!primaryIsCloud && candidateIsCloud && !params.routing.policy.allowCloudFallback) {
          continue;
        }
        orderedCandidates.push(fallback);
      }
    }

    const attemptedTargetIds: string[] = [];
    let lastError: unknown;

    for (let index = 0; index < orderedCandidates.length; index += 1) {
      const target = orderedCandidates[index];
      attemptedTargetIds.push(target.id);
      const providerRequest = params.buildRequest(target);

      const normalizedReqClassification = normalizeDataClassification(
        providerRequest.dataClassification,
        target.provider.id,
        providerRequest.correlationId
      );
      if (
        CLASSIFICATION_RANK[normalizedReqClassification] <
        CLASSIFICATION_RANK[effectiveClassification]
      ) {
        throw new ProviderError(
          `Request data classification "${normalizedReqClassification}" silently weakened below "${effectiveClassification}"`,
          {
            code: 'policy_blocked',
            reasonCode: 'CLASSIFICATION_FALLBACK_BLOCKED',
            providerId: target.provider.id,
            correlationId: providerRequest.correlationId,
            retryable: false,
          }
        );
      }

      try {
        const response = target.resilienceGuard
          ? await target.resilienceGuard.run(
              providerRequest,
              (attemptSignal) => target.provider.generate(providerRequest, attemptSignal),
              params.signal
            )
          : await target.provider.generate(providerRequest, params.signal);

        return {
          response,
          decision,
          attempts: index + 1,
          usedFallback: index > 0,
          attemptedTargetIds,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof ProviderError) {
          if (!error.retryable || error.code === 'cancelled' || error.code === 'policy_blocked') {
            throw error;
          }
          if (index + 1 < orderedCandidates.length) {
            const nextTarget = orderedCandidates[index + 1];
            const nextIsCloud = isProviderCloudEgress(
              nextTarget.provider,
              nextTarget.deploymentZone
            );
            if (!primaryIsCloud && nextIsCloud && !params.routing.policy.allowCloudFallback) {
              throw new ProviderError(
                `Fallback from local target "${target.id}" to cloud target "${nextTarget.id}" blocked by policy`,
                {
                  code: 'policy_blocked',
                  reasonCode: 'CLASSIFICATION_FALLBACK_BLOCKED',
                  providerId: nextTarget.provider.id,
                  correlationId: params.routing.correlationId,
                  retryable: false,
                  cause: error,
                }
              );
            }
          }
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }
}
