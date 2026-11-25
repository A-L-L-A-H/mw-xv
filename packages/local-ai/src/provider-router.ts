import { isLoopbackEndpointUrl as isSharedLoopbackEndpointUrl } from '@moonwitness/types';

export type RouterProviderKind = 'ollama' | 'lm-studio' | 'llama-cpp' | 'openai-compatible';
export type ProviderLocality = 'local' | 'cloud';
export type PrivacyTier = 'offline-strict' | 'hybrid';

export interface RouterProviderConfig {
  readonly id: string;
  readonly kind: RouterProviderKind;
  readonly locality: ProviderLocality;
  readonly endpoint: string;
  readonly model: string;
  readonly priority?: number;
  readonly initialLatencyMs?: number;
  readonly costPer1kTokensUsd?: number;
  readonly timeoutMs?: number;
}

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly windowSize: number;
  readonly cooldownMs: number;
}

export interface BudgetCeilingConfig {
  readonly maxTotalTokens?: number;
  readonly maxTotalCostUsd?: number;
  readonly maxRequestTokens?: number;
  readonly maxRequestCostUsd?: number;
}

export interface ProviderRouterConfig {
  readonly privacyTier: PrivacyTier;
  readonly providers: readonly RouterProviderConfig[];
  readonly circuitBreaker?: Partial<CircuitBreakerConfig>;
  readonly budget?: BudgetCeilingConfig;
  readonly now?: () => number;
}

export interface ProviderRouteRequest {
  readonly prompt: string;
  readonly maxOutputTokens?: number;
  readonly sensitive?: boolean;
  readonly preferredProviderId?: string;
}

export interface ProviderExecutionResult {
  readonly text: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly latencyMs: number;
}

export type ProviderExecutor = (
  provider: RouterProviderConfig,
  request: ProviderRouteRequest
) => Promise<ProviderExecutionResult>;

export interface ProviderRouteResponse {
  readonly providerId: string;
  readonly providerKind: RouterProviderKind;
  readonly locality: ProviderLocality;
  readonly text: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly attempts: readonly {
    readonly providerId: string;
    readonly ok: boolean;
    readonly error?: string;
  }[];
}

export interface ProviderHealthSnapshot {
  readonly providerId: string;
  readonly kind: RouterProviderKind;
  readonly locality: ProviderLocality;
  readonly circuitState: 'closed' | 'open' | 'half-open';
  readonly consecutiveFailures: number;
  readonly windowFailures: number;
  readonly ewmaLatencyMs: number;
}

export interface BudgetUsageSnapshot {
  readonly totalTokensUsed: number;
  readonly totalCostUsd: number;
  readonly maxTotalTokens?: number;
  readonly maxTotalCostUsd?: number;
}

export class ProviderRouterError extends Error {
  readonly code:
    'PRIVACY_BLOCKED' | 'BUDGET_EXCEEDED' | 'NO_ELIGIBLE_PROVIDER' | 'ALL_PROVIDERS_FAILED';

  constructor(
    code: 'PRIVACY_BLOCKED' | 'BUDGET_EXCEEDED' | 'NO_ELIGIBLE_PROVIDER' | 'ALL_PROVIDERS_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'ProviderRouterError';
    this.code = code;
  }
}

interface ProviderState {
  readonly config: RouterProviderConfig;
  consecutiveFailures: number;
  recentOutcomes: boolean[];
  openedAtMs: number | null;
  ewmaLatencyMs: number;
}

const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  failureThreshold: 3,
  windowSize: 6,
  cooldownMs: 30_000,
};

export function isLoopbackEndpointUrl(endpoint: string): boolean {
  return isSharedLoopbackEndpointUrl(endpoint, {
    rejectQuery: true,
    allowIpv4LoopbackSubnet: false,
  });
}

export function estimatePromptTokens(prompt: string): number {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export interface MultiProviderLlmRouter {
  route(request: ProviderRouteRequest, executor: ProviderExecutor): Promise<ProviderRouteResponse>;
  getEligibleProviders(request: ProviderRouteRequest): readonly RouterProviderConfig[];
  getHealthSnapshot(): readonly ProviderHealthSnapshot[];
  getBudgetUsage(): BudgetUsageSnapshot;
  resetCircuit(providerId: string): void;
}

export function createMultiProviderLlmRouter(config: ProviderRouterConfig): MultiProviderLlmRouter {
  if (config.providers.length === 0) {
    throw new TypeError('ProviderRouterConfig.providers must contain at least one provider');
  }

  const now = config.now ?? (() => Date.now());
  const cb: CircuitBreakerConfig = {
    failureThreshold:
      config.circuitBreaker?.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER.failureThreshold,
    windowSize: config.circuitBreaker?.windowSize ?? DEFAULT_CIRCUIT_BREAKER.windowSize,
    cooldownMs: config.circuitBreaker?.cooldownMs ?? DEFAULT_CIRCUIT_BREAKER.cooldownMs,
  };
  if (
    !Number.isInteger(cb.failureThreshold) ||
    cb.failureThreshold < 1 ||
    !Number.isInteger(cb.windowSize) ||
    cb.windowSize < 1 ||
    !Number.isFinite(cb.cooldownMs) ||
    cb.cooldownMs < 0
  ) {
    throw new TypeError('circuitBreaker bounds must be positive counts and non-negative cooldown');
  }

  const states = new Map<string, ProviderState>();
  for (const provider of config.providers) {
    if (states.has(provider.id)) {
      throw new TypeError(`Duplicate provider id "${provider.id}"`);
    }
    states.set(provider.id, {
      config: provider,
      consecutiveFailures: 0,
      recentOutcomes: [],
      openedAtMs: null,
      ewmaLatencyMs: provider.initialLatencyMs ?? (provider.locality === 'local' ? 120 : 450),
    });
  }

  let totalTokensUsed = 0;
  let totalCostUsd = 0;

  function getCircuitState(
    state: ProviderState,
    currentMs: number
  ): 'closed' | 'open' | 'half-open' {
    if (state.openedAtMs === null) return 'closed';
    if (currentMs - state.openedAtMs >= cb.cooldownMs) return 'half-open';
    return 'open';
  }

  function isPrivacyAllowed(provider: RouterProviderConfig, sensitive: boolean): boolean {
    const isTrulyLocal = provider.locality === 'local' && isLoopbackEndpointUrl(provider.endpoint);
    if (config.privacyTier === 'offline-strict') {
      return isTrulyLocal;
    }
    // hybrid: sensitive prompts are restricted to local loopback providers
    if (sensitive) {
      return isTrulyLocal;
    }
    return true;
  }

  function computeCostUsd(provider: RouterProviderConfig, tokens: number): number {
    const rate = provider.costPer1kTokensUsd ?? 0;
    return Number(((tokens / 1000) * rate).toFixed(6));
  }

  function checkBudgetPreFlight(provider: RouterProviderConfig, estimatedTokens: number): void {
    const budget = config.budget;
    if (!budget) return;

    if (budget.maxRequestTokens !== undefined && estimatedTokens > budget.maxRequestTokens) {
      throw new ProviderRouterError(
        'BUDGET_EXCEEDED',
        `Estimated request tokens (${estimatedTokens}) exceed maxRequestTokens (${budget.maxRequestTokens})`
      );
    }
    if (
      budget.maxTotalTokens !== undefined &&
      totalTokensUsed + estimatedTokens > budget.maxTotalTokens
    ) {
      throw new ProviderRouterError(
        'BUDGET_EXCEEDED',
        `Cumulative tokens (${totalTokensUsed + estimatedTokens}) would exceed maxTotalTokens (${budget.maxTotalTokens})`
      );
    }

    const estimatedCost = computeCostUsd(provider, estimatedTokens);
    if (budget.maxRequestCostUsd !== undefined && estimatedCost > budget.maxRequestCostUsd) {
      throw new ProviderRouterError(
        'BUDGET_EXCEEDED',
        `Estimated request cost ($${estimatedCost}) exceeds maxRequestCostUsd ($${budget.maxRequestCostUsd})`
      );
    }
    if (
      budget.maxTotalCostUsd !== undefined &&
      totalCostUsd + estimatedCost > budget.maxTotalCostUsd
    ) {
      throw new ProviderRouterError(
        'BUDGET_EXCEEDED',
        `Cumulative cost ($${(totalCostUsd + estimatedCost).toFixed(6)}) would exceed maxTotalCostUsd ($${budget.maxTotalCostUsd})`
      );
    }
  }

  function rankEligible(request: ProviderRouteRequest): ProviderState[] {
    const currentMs = now();
    const sensitive = request.sensitive === true;

    const privacyFiltered = [...states.values()].filter((state) =>
      isPrivacyAllowed(state.config, sensitive)
    );

    if (privacyFiltered.length === 0) {
      throw new ProviderRouterError(
        'PRIVACY_BLOCKED',
        `No provider satisfies privacyTier=${config.privacyTier} (sensitive=${sensitive})`
      );
    }

    const healthy = privacyFiltered.filter((state) => getCircuitState(state, currentMs) !== 'open');

    if (healthy.length === 0) {
      throw new ProviderRouterError(
        'NO_ELIGIBLE_PROVIDER',
        'All privacy-eligible providers currently have open circuit breakers'
      );
    }

    return healthy.sort((a, b) => {
      if (request.preferredProviderId) {
        if (
          a.config.id === request.preferredProviderId &&
          b.config.id !== request.preferredProviderId
        ) {
          return -1;
        }
        if (
          b.config.id === request.preferredProviderId &&
          a.config.id !== request.preferredProviderId
        ) {
          return 1;
        }
      }
      // Always prefer local before cloud in hybrid mode
      if (a.config.locality !== b.config.locality) {
        return a.config.locality === 'local' ? -1 : 1;
      }
      // Latency-weighted deterministic score (lower is better)
      const scoreA = a.ewmaLatencyMs + (a.config.priority ?? 0) * 10;
      const scoreB = b.ewmaLatencyMs + (b.config.priority ?? 0) * 10;
      if (scoreA !== scoreB) return scoreA - scoreB;
      return a.config.id.localeCompare(b.config.id);
    });
  }

  function recordSuccess(state: ProviderState, latencyMs: number): void {
    state.consecutiveFailures = 0;
    state.openedAtMs = null;
    state.recentOutcomes.push(true);
    if (state.recentOutcomes.length > cb.windowSize) {
      state.recentOutcomes.shift();
    }
    state.ewmaLatencyMs = Number((state.ewmaLatencyMs * 0.7 + latencyMs * 0.3).toFixed(2));
  }

  function recordFailure(state: ProviderState, currentMs: number): void {
    state.consecutiveFailures += 1;
    state.recentOutcomes.push(false);
    if (state.recentOutcomes.length > cb.windowSize) {
      state.recentOutcomes.shift();
    }
    const windowFailures = state.recentOutcomes.filter((ok) => !ok).length;
    if (state.consecutiveFailures >= cb.failureThreshold || windowFailures >= cb.failureThreshold) {
      state.openedAtMs = currentMs;
    }
  }

  return {
    getEligibleProviders(request: ProviderRouteRequest): readonly RouterProviderConfig[] {
      return rankEligible(request).map((state) => state.config);
    },

    getHealthSnapshot(): readonly ProviderHealthSnapshot[] {
      const currentMs = now();
      return [...states.values()].map((state) => ({
        providerId: state.config.id,
        kind: state.config.kind,
        locality: state.config.locality,
        circuitState: getCircuitState(state, currentMs),
        consecutiveFailures: state.consecutiveFailures,
        windowFailures: state.recentOutcomes.filter((ok) => !ok).length,
        ewmaLatencyMs: state.ewmaLatencyMs,
      }));
    },

    getBudgetUsage(): BudgetUsageSnapshot {
      return {
        totalTokensUsed,
        totalCostUsd,
        ...(config.budget?.maxTotalTokens !== undefined
          ? { maxTotalTokens: config.budget.maxTotalTokens }
          : {}),
        ...(config.budget?.maxTotalCostUsd !== undefined
          ? { maxTotalCostUsd: config.budget.maxTotalCostUsd }
          : {}),
      };
    },

    resetCircuit(providerId: string): void {
      const state = states.get(providerId);
      if (!state) return;
      state.consecutiveFailures = 0;
      state.recentOutcomes = [];
      state.openedAtMs = null;
    },

    async route(
      request: ProviderRouteRequest,
      executor: ProviderExecutor
    ): Promise<ProviderRouteResponse> {
      const candidates = rankEligible(request);
      const estimatedTokens =
        estimatePromptTokens(request.prompt) + (request.maxOutputTokens ?? 256);

      const attempts: Array<{
        readonly providerId: string;
        readonly ok: boolean;
        readonly error?: string;
      }> = [];

      for (const candidate of candidates) {
        checkBudgetPreFlight(candidate.config, estimatedTokens);
        try {
          const result = await executor(candidate.config, request);
          const actualTokens = Math.max(0, result.promptTokens + result.completionTokens);
          const actualCost = computeCostUsd(candidate.config, actualTokens);

          totalTokensUsed += actualTokens;
          totalCostUsd = Number((totalCostUsd + actualCost).toFixed(6));
          recordSuccess(candidate, result.latencyMs);
          attempts.push({ providerId: candidate.config.id, ok: true });

          return {
            providerId: candidate.config.id,
            providerKind: candidate.config.kind,
            locality: candidate.config.locality,
            text: result.text,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            totalTokens: actualTokens,
            costUsd: actualCost,
            latencyMs: result.latencyMs,
            attempts,
          };
        } catch (error) {
          recordFailure(candidate, now());
          attempts.push({
            providerId: candidate.config.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      throw new ProviderRouterError(
        'ALL_PROVIDERS_FAILED',
        `All ${candidates.length} eligible provider(s) failed: ${attempts.map((a) => `${a.providerId}:${a.error}`).join('; ')}`
      );
    },
  };
}
