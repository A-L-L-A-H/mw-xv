import {
  AgentHarness,
  DataClassificationRouter,
  LocalOpenAiAdapter,
  ProviderError,
  type AiProvider,
  type AiToolCall,
  type AiToolDefinition,
  type AgentHarnessResult,
  type DataClassification,
  type ModelProfileConfig,
  type ProviderHealthStatus,
  type RegisteredRouteTarget,
  type TaskClass,
} from '@moonwitness/ai-runtime';
import type { JsonObject, JsonValue } from '@moonwitness/types';
import { AccessDeniedError, ValidationError } from '@moonwitness/types';
import type { LocalSidecarController } from './local-sidecar.js';

export const DESKTOP_AGENT_RUN_JOB_TYPE = 'ai.desktop_agent_run@v1' as const;

export interface DesktopAgentBudgetPolicy {
  readonly maxTotalTokens?: number;
  readonly maxCostMicroUsd?: number;
}

export interface DesktopAgentRunRequest {
  readonly runId: string;
  readonly companyId: number;
  readonly workContractId: number;
  readonly agentId: number;
  readonly correlationId: string;
  readonly fencingToken: number;
  readonly dataClassification: DataClassification;
  readonly taskClass?: TaskClass;
  readonly systemPolicy: string;
  readonly taskPrompt: string;
  readonly untrustedInputs?: Readonly<Record<string, JsonValue>>;
  readonly allowedTools?: readonly AiToolDefinition[];
  readonly toolExecutor?: (call: AiToolCall, signal: AbortSignal) => Promise<JsonValue>;
  readonly maxSteps?: number;
  readonly maxDurationMs?: number;
  readonly budget?: DesktopAgentBudgetPolicy;
  readonly signal?: AbortSignal;
  readonly onHeartbeat?: (checkpoint: JsonObject) => void | Promise<void>;
}

export interface DesktopAgentRunOutcome {
  readonly runId: string;
  readonly status: 'completed' | 'budget_exhausted' | 'cancelled' | 'failed';
  readonly providerId: string;
  readonly modelName: string;
  readonly outputText: string;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly resumedFromCheckpoint: boolean;
  readonly checkpoint: JsonObject;
  readonly harnessResult?: AgentHarnessResult;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface DesktopAgentRunnerOptions {
  readonly targets: readonly RegisteredRouteTarget[];
  readonly sidecar?: LocalSidecarController;
  readonly defaultBudget?: DesktopAgentBudgetPolicy;
}

export class DesktopAgentRunner {
  private readonly router: DataClassificationRouter;
  private readonly targets: readonly RegisteredRouteTarget[];
  private readonly sidecar?: LocalSidecarController;
  private readonly defaultBudget?: DesktopAgentBudgetPolicy;

  constructor(options: DesktopAgentRunnerOptions) {
    this.targets = [...options.targets];
    this.router = new DataClassificationRouter({ targets: this.targets });
    this.sidecar = options.sidecar;
    this.defaultBudget = options.defaultBudget;
  }

  /** DSK-9.11: Probe health of all registered local loopback providers. */
  async probeLocalProviderHealth(signal?: AbortSignal): Promise<readonly ProviderHealthStatus[]> {
    const localTargets = this.targets.filter(
      (target) =>
        target.deploymentZone === 'local' ||
        target.provider.kind === 'ollama' ||
        target.provider.kind === 'local_openai' ||
        target.provider.kind === 'mock'
    );
    return await Promise.all(localTargets.map((target) => target.provider.healthCheck(signal)));
  }

  /**
   * DSK-9.5, DSK-9.6, DSK-9.12:
   * - Routes via DataClassificationRouter with fail-closed zero-cloud-fallback for local_only/restricted.
   * - Executes via PlanExecuteVerify AgentHarness.
   * - Tracks token & micro-USD cost and enforces budget_exhausted.
   * - Supports checkpoint resume + lease heartbeat + AbortSignal.
   */
  async executeRun(request: DesktopAgentRunRequest): Promise<DesktopAgentRunOutcome> {
    if (request.signal?.aborted) {
      return {
        runId: request.runId,
        status: 'cancelled',
        providerId: 'none',
        modelName: 'none',
        outputText: '',
        totalTokens: 0,
        costMicroUsd: 0,
        resumedFromCheckpoint: false,
        checkpoint: { stage: 'cancelled_before_start', fencingToken: request.fencingToken },
        errorCode: 'cancelled',
        errorMessage: 'Desktop agent run aborted before start',
      };
    }

    const existingCheckpoint = this.sidecar?.getCheckpoint(request.runId) ?? null;
    const resumedFromCheckpoint = existingCheckpoint !== null;

    // DSK-9.5: Fail-closed zero-cloud-fallback routing.
    const routeDecision = this.router.evaluateRouting({
      companyId: request.companyId,
      workContractId: String(request.workContractId),
      correlationId: request.correlationId,
      dataClassification: request.dataClassification,
      policy: {
        allowedClassification: request.dataClassification,
        allowCloudFallback: false,
      },
      criteria: {
        taskClass: request.taskClass ?? 'reasoning',
        requiredCapabilities: {
          textGeneration: true,
          ...(request.allowedTools && request.allowedTools.length > 0 ? { toolCall: true } : {}),
        },
      },
    });

    const selectedTarget = routeDecision.selectedTarget;
    const budget = request.budget ?? this.defaultBudget;

    await request.onHeartbeat?.({
      stage: 'routed',
      providerId: selectedTarget.provider.id,
      modelName: selectedTarget.model.modelName,
      fencingToken: request.fencingToken,
      resumedFromCheckpoint,
    });

    const harness = new AgentHarness({
      provider: selectedTarget.provider,
    });

    const executeTool =
      request.toolExecutor ??
      (async (call: AiToolCall): Promise<JsonValue> => ({
        error: `Tool '${call.name}' is not bound in desktop runner`,
      }));

    const harnessResult = await harness.execute(
      {
        runId: request.runId,
        correlationId: request.correlationId,
        model: selectedTarget.model,
        dataClassification: request.dataClassification,
        systemPolicy: request.systemPolicy,
        taskPrompt: resumedFromCheckpoint
          ? `${request.taskPrompt}\n\n[Resumed from checkpoint: ${JSON.stringify(existingCheckpoint)}]`
          : request.taskPrompt,
        ...(request.untrustedInputs ? { untrustedInputs: request.untrustedInputs } : {}),
        allowedTools: request.allowedTools ?? [],
        maxSteps: request.maxSteps ?? 4,
        maxDurationMs: request.maxDurationMs ?? 30_000,
      },
      executeTool,
      request.signal
    );

    const totalTokens = harnessResult.totalUsage.totalTokens;
    const costMicroUsd = harnessResult.totalUsage.estimatedCostMicros ?? 0;

    const budgetExceededTokens =
      budget?.maxTotalTokens !== undefined && totalTokens > budget.maxTotalTokens;
    const budgetExceededCost =
      budget?.maxCostMicroUsd !== undefined && costMicroUsd > budget.maxCostMicroUsd;

    const finalCheckpoint: JsonObject = {
      stage: budgetExceededTokens || budgetExceededCost ? 'budget_exhausted' : 'completed',
      providerId: selectedTarget.provider.id,
      modelName: selectedTarget.model.modelName,
      fencingToken: request.fencingToken,
      totalTokens,
      costMicroUsd,
      stepsCompleted: harnessResult.steps.length,
    };

    await request.onHeartbeat?.(finalCheckpoint);

    if (budgetExceededTokens || budgetExceededCost) {
      return {
        runId: request.runId,
        status: 'budget_exhausted',
        providerId: selectedTarget.provider.id,
        modelName: selectedTarget.model.modelName,
        outputText: harnessResult.outputText,
        totalTokens,
        costMicroUsd,
        resumedFromCheckpoint,
        checkpoint: finalCheckpoint,
        harnessResult,
        errorCode: 'budget_exhausted',
        errorMessage: `Run '${request.runId}' exceeded budget (tokens=${totalTokens}, costMicroUsd=${costMicroUsd})`,
      };
    }

    return {
      runId: request.runId,
      status: 'completed',
      providerId: selectedTarget.provider.id,
      modelName: selectedTarget.model.modelName,
      outputText: harnessResult.outputText,
      totalTokens,
      costMicroUsd,
      resumedFromCheckpoint,
      checkpoint: finalCheckpoint,
      harnessResult,
    };
  }
}

export interface DesktopAgentJobPayload {
  readonly runId: string;
  readonly companyId: number;
  readonly workContractId: number;
  readonly agentId: number;
  readonly correlationId: string;
  readonly fencingToken: number;
  readonly dataClassification: DataClassification;
  readonly systemPolicy: string;
  readonly taskPrompt: string;
  readonly maxSteps?: number;
  readonly budget?: DesktopAgentBudgetPolicy;
}

export interface DesktopAgentJobContext {
  readonly signal?: AbortSignal;
  readonly heartbeat?: (checkpoint: JsonObject) => void | Promise<void>;
}

/**
 * DSK-9.8: Durable job handler factory for `ai.desktop_agent_run@v1`
 * compatible with `@moonwitness/jobs` workers, supporting lease heartbeat,
 * fencingToken validation, AbortSignal, and checkpoint resume.
 */
export function createDesktopAgentRunJobHandler(runner: DesktopAgentRunner) {
  return {
    jobType: DESKTOP_AGENT_RUN_JOB_TYPE,
    async handle(
      payload: DesktopAgentJobPayload,
      context: DesktopAgentJobContext = {}
    ): Promise<DesktopAgentRunOutcome> {
      if (
        !payload.runId ||
        !Number.isSafeInteger(payload.fencingToken) ||
        payload.fencingToken < 1
      ) {
        throw new ValidationError(
          'Invalid desktop agent job payload: missing runId or fencingToken'
        );
      }
      const outcome = await runner.executeRun({
        ...payload,
        signal: context.signal,
        onHeartbeat: context.heartbeat,
      });
      if (outcome.status === 'budget_exhausted') {
        throw new AccessDeniedError(outcome.errorMessage ?? 'budget_exhausted');
      }
      return outcome;
    },
  };
}

/** Helper to construct a loopback-only LocalOpenAiAdapter route target for desktop runs. */
export function createLocalOpenAiRouteTarget(options: {
  readonly id?: string;
  readonly baseUrl: string;
  readonly modelName: string;
  readonly fetch?: typeof fetch;
}): RegisteredRouteTarget {
  const providerId = options.id ?? 'local-openai';
  const provider: AiProvider = new LocalOpenAiAdapter({
    id: providerId,
    baseUrl: options.baseUrl,
    defaultModel: options.modelName,
    fetch: options.fetch,
  });
  const model: ModelProfileConfig = {
    id: `${providerId}:${options.modelName}`,
    providerId,
    providerKind: 'local_openai',
    modelName: options.modelName,
    capabilities: {
      textGeneration: true,
      toolCall: true,
      streaming: false,
      structuredOutput: true,
    },
    contextWindowTokens: 32_768,
    maxOutputTokens: 4_096,
    modalities: ['text', 'json'],
    pricing: {
      inputMicrosPerMillionTokens: 0,
      outputMicrosPerMillionTokens: 0,
    },
  };
  return {
    id: model.id,
    provider,
    model,
    deploymentZone: 'local',
  };
}

export { ProviderError };
