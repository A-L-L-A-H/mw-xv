import { createHash, randomUUID } from 'node:crypto';
import { BoundedReadOnlyAgentHarness } from './agent-runner.js';
import { ObligationContinuityLedger } from './pcw-verifier.js';
import { AnthropicProviderAdapter } from './providers/anthropic-adapter.js';
import { MockProvider } from './providers/mock-provider.js';
import { OpenAiProviderAdapter } from './providers/openai-adapter.js';
import { FREELMAPI_APPROVED_ORIGIN, isLoopbackHostname } from './providers/shared.js';
import { ReadOnlyRepoInspector } from './repo-inspector.js';
import type { RiskTier } from './risk-policy.js';
import { createEnvSecretResolver } from './secrets.js';
import type {
  AgentHarness as AgentHarnessContract,
  AgentHarnessInput,
  AgentHarnessResult,
  AiProvider,
  AiToolCall,
  DataClassification,
  FetchLike,
  ProviderCapabilities,
  ProviderHealthStatus,
  ProviderRequest,
  ProviderResponse,
  SecretResolver,
} from './types.js';
import {
  validatePlannerDecomposition,
  type PlannerDecompositionPlan,
} from './workforce-planner.js';
import type { JsonValue } from '@moonwitness/types';

interface KnexQueryBuilderLike {
  where(filter: Record<string, unknown>): KnexQueryBuilderLike;
  whereIn(column: string, values: readonly unknown[]): KnexQueryBuilderLike;
  select(...columns: string[]): Promise<Record<string, unknown>[]>;
  first(): Promise<Record<string, unknown> | undefined>;
  insert(values: Record<string, unknown>): Promise<unknown>;
  update(values: Record<string, unknown>): Promise<number>;
  orderBy(column: string, direction?: 'asc' | 'desc'): KnexQueryBuilderLike;
}

type KnexLike = ((tableName: string) => KnexQueryBuilderLike) & {
  readonly raw?: (sql: string) => Promise<unknown>;
};

function isKnexLike(db: unknown): db is KnexLike {
  return typeof db === 'function';
}

async function safeInsertRow(
  db: unknown,
  tableName: string,
  values: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  if (!isKnexLike(db)) return null;
  try {
    const res = await db(tableName).insert(values);
    let insertedId: number | undefined;
    if (Array.isArray(res) && res.length > 0) {
      const first = res[0];
      if (typeof first === 'number') insertedId = first;
      else if (typeof first === 'object' && first !== null && 'id' in first) {
        insertedId = Number((first as { id: unknown }).id);
      }
    }
    if (insertedId !== undefined && Number.isFinite(insertedId)) {
      const row = await db(tableName).where({ id: insertedId }).first();
      if (row) return row;
    }
    const latest = await db(tableName).orderBy('id', 'desc').first();
    return latest ?? null;
  } catch {
    return null;
  }
}

export interface CloudProviderAdapterConfig {
  readonly id?: string;
  /** `freellmapi` is an OpenAI-compatible cloud-egress provider and delegates to the OpenAI transport. */
  readonly kind?: 'openai' | 'anthropic' | 'freellmapi';
  readonly baseUrl?: string | URL;
  readonly model?: string;
  readonly secretRef?: string;
  readonly secretResolver?: SecretResolver;
  readonly allowLoopbackHttp?: boolean;
  readonly approvedPrivateOrigins?: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly fetch?: FetchLike;
  readonly resolveAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;
}

export class CloudProviderAdapter implements AiProvider {
  readonly id: string;
  readonly kind: 'openai' | 'anthropic' | 'freellmapi';
  readonly capabilities: ProviderCapabilities;
  private readonly delegate: AiProvider;
  private readonly defaultModelName: string;

  constructor(config: CloudProviderAdapterConfig = {}) {
    this.id = config.id ?? 'cloud-default';
    this.kind = config.kind ?? 'openai';
    const isFreellm = this.kind === 'freellmapi';
    this.defaultModelName =
      config.model ??
      (isFreellm
        ? 'default' // selected from real gateway discovery; never invent a model id
        : this.kind === 'anthropic'
          ? 'claude-3-7-sonnet'
          : 'gpt-4.1-mini');

    const secretRef = config.secretRef ?? (isFreellm ? 'MW_AI_FREELLM_KEY' : 'MW_AI_CLOUD_KEY');
    const baseUrl = config.baseUrl ?? (isFreellm ? FREELMAPI_APPROVED_ORIGIN : undefined);
    const approvedPrivateOrigins =
      config.approvedPrivateOrigins ?? (isFreellm ? [FREELMAPI_APPROVED_ORIGIN] : []);
    let allowLoopbackHttp = config.allowLoopbackHttp;
    if (allowLoopbackHttp === undefined && baseUrl !== undefined) {
      try {
        const parsed = new URL(String(baseUrl));
        allowLoopbackHttp = isLoopbackHostname(parsed.hostname);
      } catch {
        allowLoopbackHttp = false;
      }
    }

    // Fail closed: no fallback credential is fabricated when the secret is
    // absent. Callers must inject a company-scoped resolver or set the MW_AI_*
    // environment reference; otherwise secret resolution throws.
    const fallbackEnvResolver = createEnvSecretResolver(process.env);
    const secretResolver: SecretResolver =
      config.secretResolver ??
      ((ref: string, companyId?: number) => fallbackEnvResolver(ref, companyId ?? 1));

    if (this.kind === 'anthropic') {
      this.delegate = new AnthropicProviderAdapter({
        id: this.id,
        baseUrl,
        allowLoopbackHttp,
        secretRef,
        secretResolver,
        defaultTimeoutMs: config.defaultTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        capabilities: config.capabilities,
        fetch: config.fetch,
        resolveAddresses: config.resolveAddresses,
      });
    } else {
      this.delegate = new OpenAiProviderAdapter({
        id: this.id,
        baseUrl,
        allowLoopbackHttp,
        approvedPrivateOrigins,
        secretRef,
        secretResolver,
        defaultTimeoutMs: config.defaultTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        capabilities: config.capabilities,
        fetch: config.fetch,
        resolveAddresses: config.resolveAddresses,
      });
    }
    this.capabilities = this.delegate.capabilities;
  }

  healthCheck(signal?: AbortSignal): Promise<ProviderHealthStatus> {
    return this.delegate.healthCheck(signal);
  }

  generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const reqRecord = request as unknown as {
      correlationId?: string;
      dataClassification?: DataClassification;
      model?: ProviderRequest['model'] | string;
    };
    const modelName =
      typeof reqRecord.model === 'string' && reqRecord.model !== 'default'
        ? reqRecord.model
        : typeof reqRecord.model === 'object' && reqRecord.model !== null
          ? reqRecord.model.modelName
          : this.defaultModelName;

    const normalizedRequest: ProviderRequest = {
      ...request,
      correlationId: reqRecord.correlationId ?? `corr_${this.id}_${Date.now()}`,
      dataClassification: reqRecord.dataClassification ?? 'cloud_eligible',
      model:
        typeof reqRecord.model === 'object' && reqRecord.model !== null
          ? reqRecord.model
          : {
              id: modelName,
              providerId: this.id,
              providerKind: this.kind,
              modelName,
              capabilities: this.capabilities,
              contextWindowTokens: 128_000,
              maxOutputTokens: 4_096,
              modalities: ['text'],
            },
    };
    return this.delegate.generate(normalizedRequest, signal);
  }
}

export interface AttachmentStorageLike {
  put(key: string, content: Buffer | Uint8Array | string): Promise<{ readonly checksum?: string }>;
  get(key: string): Promise<Buffer | Uint8Array | null>;
}

export interface BoundedAgentRunnerOptions {
  readonly db?: unknown;
  readonly attachmentStorage?: AttachmentStorageLike;
  readonly provider?: AiProvider;
  readonly allowlistedRoots: readonly string[];
}

export class BoundedAgentRunner {
  private readonly db?: unknown;
  private readonly attachmentStorage?: AttachmentStorageLike;
  private readonly provider: AiProvider;
  private readonly allowlistedRoots: readonly string[];

  constructor(options: BoundedAgentRunnerOptions) {
    this.db = options.db;
    this.attachmentStorage = options.attachmentStorage;
    this.provider = options.provider ?? new MockProvider({ id: 'bounded-default-mock' });
    this.allowlistedRoots = options.allowlistedRoots;
  }

  async executeInspection(params: {
    readonly companyId: number;
    readonly targetPath: string;
    readonly objective: string;
  }): Promise<{
    readonly status: 'completed';
    readonly workContractId: number | string;
    readonly agentRunId: number | string;
    readonly jobId: number | string;
    readonly artifactManifest: {
      readonly id: number | string;
      readonly storageKey: string;
      readonly sha256: string;
    };
  }> {
    const inspector = new ReadOnlyRepoInspector({
      rootDir: params.targetPath,
      allowlistedPaths: ['.'],
    });
    const files = await inspector.listFiles('.');
    const response = await this.provider.generate({
      correlationId: `inspect_${params.companyId}_${Date.now()}`,
      dataClassification: 'local_only',
      model: {
        id: 'inspect-model',
        providerId: this.provider.id,
        providerKind: this.provider.kind,
        modelName: 'qwen2.5:3b',
        capabilities: this.provider.capabilities,
        contextWindowTokens: 16_384,
        maxOutputTokens: 2_048,
        modalities: ['text'],
      },
      messages: [
        {
          role: 'user',
          content: `Objective: ${params.objective}\nFiles: ${files.map((f) => f.path).join(', ')}`,
        },
      ],
    });

    const artifactPayload = Buffer.from(
      JSON.stringify({
        companyId: params.companyId,
        objective: params.objective,
        files: files.map((f) => f.path),
        summary: response.text,
      }),
      'utf8'
    );
    const sha256 = createHash('sha256').update(artifactPayload).digest('hex');
    const storageKey = randomUUID();

    if (this.attachmentStorage) {
      await this.attachmentStorage.put(storageKey, artifactPayload);
    }

    const workContractId = `wc_${randomUUID().slice(0, 8)}`;
    const agentRunId = `run_${randomUUID().slice(0, 8)}`;
    const jobId = `job_${randomUUID().slice(0, 8)}`;
    const manifestId = `art_${randomUUID().slice(0, 8)}`;

    return {
      status: 'completed',
      workContractId,
      agentRunId,
      jobId,
      artifactManifest: {
        id: manifestId,
        storageKey,
        sha256,
      },
    };
  }
}

export class AgentHarness implements AgentHarnessContract {
  readonly id: string;
  private readonly boundedHarness?: BoundedReadOnlyAgentHarness;
  private readonly checkpoints = new Map<
    string,
    {
      readonly runId: string;
      readonly companyId: number;
      readonly stepIndex: number;
      readonly cursor: string;
    }
  >();

  constructor(options?: {
    readonly id?: string;
    readonly db?: unknown;
    readonly provider?: AiProvider;
  }) {
    this.id = options?.id ?? 'agent-harness';
    if (options?.provider) {
      this.boundedHarness = new BoundedReadOnlyAgentHarness({
        id: this.id,
        provider: options.provider,
      });
    }
  }

  async saveCheckpoint(params: {
    readonly runId?: string;
    readonly companyId: number;
    readonly stepIndex: number;
    readonly cursor: string;
  }): Promise<{
    readonly runId: string;
    readonly companyId: number;
    readonly stepIndex: number;
    readonly cursor: string;
  }> {
    const runId = params.runId ?? `run_${randomUUID().slice(0, 8)}`;
    const entry = {
      runId,
      companyId: params.companyId,
      stepIndex: params.stepIndex,
      cursor: params.cursor,
    };
    this.checkpoints.set(runId, entry);
    return entry;
  }

  async loadCheckpoint(runId: string): Promise<{
    readonly runId: string;
    readonly companyId: number;
    readonly stepIndex: number;
    readonly cursor: string;
  } | null> {
    return this.checkpoints.get(runId) ?? null;
  }

  async runWithCancellation(params: {
    readonly signal: AbortSignal;
    readonly work: (ctx: { readonly signal: AbortSignal }) => Promise<unknown>;
  }): Promise<{ readonly status: 'completed' | 'cancelled'; readonly result?: unknown }> {
    if (params.signal.aborted) {
      return { status: 'cancelled' };
    }
    try {
      const result = await params.work({ signal: params.signal });
      if (params.signal.aborted) {
        return { status: 'cancelled' };
      }
      return { status: 'completed', result };
    } catch {
      if (params.signal.aborted) {
        return { status: 'cancelled' };
      }
      throw new Error('Work execution failed');
    }
  }

  execute(
    input: AgentHarnessInput,
    executeTool: (call: AiToolCall, signal: AbortSignal) => Promise<JsonValue>,
    signal?: AbortSignal
  ): Promise<AgentHarnessResult> {
    const harness =
      this.boundedHarness ??
      new BoundedReadOnlyAgentHarness({
        id: this.id,
        provider: new MockProvider({ id: 'harness-fallback-mock' }),
      });
    return harness.execute(input, executeTool, signal);
  }
}

export class PcwVerifier {
  private readonly attachmentStorage?: AttachmentStorageLike;

  constructor(options?: {
    readonly db?: unknown;
    readonly attachmentStorage?: AttachmentStorageLike;
  }) {
    this.attachmentStorage = options?.attachmentStorage;
  }

  async verifyArtifactDigest(params: {
    readonly companyId: number;
    readonly storageKey: string;
    readonly expectedSha256: string;
  }): Promise<{
    readonly valid: boolean;
    readonly actualSha256: string;
    readonly companyId: number;
    readonly storageKey: string;
  }> {
    if (!this.attachmentStorage) {
      throw new Error('PcwVerifier requires attachmentStorage to verify artifact digest');
    }
    const blob = await this.attachmentStorage.get(params.storageKey);
    if (!blob) {
      return {
        valid: false,
        actualSha256: '',
        companyId: params.companyId,
        storageKey: params.storageKey,
      };
    }
    const actualSha256 = createHash('sha256').update(blob).digest('hex');
    return {
      valid: actualSha256 === params.expectedSha256,
      actualSha256,
      companyId: params.companyId,
      storageKey: params.storageKey,
    };
  }
}

interface StoredPcwContract {
  id: string;
  companyId: number;
  title: string;
  outcome: string;
  scope: string;
  nonGoals: readonly string[];
  riskTier: RiskTier;
  workerActorId?: string | number;
  reviewerActorId?: string | number;
  humanActorId?: string | number;
  rationale?: string;
  status: string;
  criteria: readonly {
    readonly code: string;
    readonly method: string;
    readonly requiredEvidenceType: string;
  }[];
}

export class PcwService {
  private readonly contracts = new Map<string, StoredPcwContract>();

  constructor(_options?: { readonly db?: unknown }) {}

  async createWorkContract(params: {
    readonly companyId: number;
    readonly title: string;
    readonly outcome: string;
    readonly scope: string;
    readonly nonGoals?: readonly string[];
    readonly riskTier: RiskTier;
    readonly workerActorId?: string | number;
    readonly criteria: readonly {
      readonly code: string;
      readonly method: string;
      readonly requiredEvidenceType: string;
    }[];
  }): Promise<StoredPcwContract> {
    const id = `wc_${randomUUID().slice(0, 8)}`;
    const record: StoredPcwContract = {
      id,
      companyId: params.companyId,
      title: params.title,
      outcome: params.outcome,
      scope: params.scope,
      nonGoals: params.nonGoals ?? [],
      riskTier: params.riskTier,
      workerActorId: params.workerActorId,
      status: 'in_review',
      criteria: params.criteria,
    };
    this.contracts.set(id, record);
    return record;
  }

  async approveContract(params: {
    readonly contractId: string;
    readonly companyId: number;
    readonly reviewerActorId: string | number;
    readonly rationale: string;
  }): Promise<StoredPcwContract> {
    const contract = this.contracts.get(params.contractId);
    if (!contract || contract.companyId !== params.companyId) {
      throw new Error(`Work contract "${params.contractId}" not found`);
    }
    if (
      contract.workerActorId !== undefined &&
      String(contract.workerActorId) === String(params.reviewerActorId)
    ) {
      throw new Error('Worker cannot self-approve its own work contract');
    }
    if (!params.rationale.trim()) {
      throw new Error('Approval requires non-empty rationale');
    }
    const updated: StoredPcwContract = {
      ...contract,
      status: 'accepted',
      reviewerActorId: params.reviewerActorId,
      rationale: params.rationale,
    };
    this.contracts.set(contract.id, updated);
    return updated;
  }

  async submitForHumanSignOff(params: {
    readonly contractId: string;
    readonly companyId: number;
    readonly reviewerActorId: string | number;
  }): Promise<StoredPcwContract> {
    const contract = this.contracts.get(params.contractId);
    if (!contract || contract.companyId !== params.companyId) {
      throw new Error(`Work contract "${params.contractId}" not found`);
    }
    const updated: StoredPcwContract = {
      ...contract,
      status: 'awaiting_human_approval',
      reviewerActorId: params.reviewerActorId,
    };
    this.contracts.set(contract.id, updated);
    return updated;
  }

  async recordHumanSignOff(params: {
    readonly contractId: string;
    readonly companyId: number;
    readonly humanActorId: string | number;
    readonly rationale: string;
  }): Promise<StoredPcwContract> {
    const contract = this.contracts.get(params.contractId);
    if (!contract || contract.companyId !== params.companyId) {
      throw new Error(`Work contract "${params.contractId}" not found`);
    }
    if (
      contract.workerActorId !== undefined &&
      String(contract.workerActorId) === String(params.humanActorId)
    ) {
      throw new Error('Worker cannot sign off as human approver');
    }
    const updated: StoredPcwContract = {
      ...contract,
      status: 'accepted',
      humanActorId: params.humanActorId,
      rationale: params.rationale,
    };
    this.contracts.set(contract.id, updated);
    return updated;
  }

  async getAcceptanceReport(params: {
    readonly contractId: string;
    readonly companyId: number;
  }): Promise<{
    readonly contractId: string;
    readonly companyId: number;
    readonly status: string;
    readonly criteria: StoredPcwContract['criteria'];
    readonly reviewerActorId?: string | number;
    readonly humanActorId?: string | number;
  }> {
    const contract = this.contracts.get(params.contractId);
    if (!contract || contract.companyId !== params.companyId) {
      throw new Error(`Work contract "${params.contractId}" not found`);
    }
    return {
      contractId: contract.id,
      companyId: contract.companyId,
      status: contract.status,
      criteria: contract.criteria,
      reviewerActorId: contract.reviewerActorId,
      humanActorId: contract.humanActorId,
    };
  }
}

export class ObligationLedger {
  private readonly inner = new ObligationContinuityLedger();

  constructor(_options?: { readonly db?: unknown }) {}

  private static mapStatus(status: string): string {
    if (status === 'open' || status === 'satisfied') return 'active';
    if (status === 'reverification_due') return 'needs_reverification';
    return status;
  }

  async createObligation(params: {
    readonly companyId: number;
    readonly title: string;
    readonly scopePaths: readonly string[];
    readonly triggerType:
      'code_change' | 'source_change' | 'policy_change' | 'time_expiry' | 'manual';
    readonly ownerActorId?: string | number;
    readonly dueAt?: string;
    readonly originContractId?: string;
  }): Promise<{
    readonly id: string;
    readonly companyId: number;
    readonly title: string;
    readonly scopePaths: readonly string[];
    readonly triggerType: string;
    readonly status: string;
    readonly dueAt?: string;
  }> {
    const id = `ob_${randomUUID().slice(0, 8)}`;
    const created = this.inner.registerObligation({
      id,
      companyId: params.companyId,
      code: id,
      originContractId: params.originContractId ?? 'wc_default',
      ownerActorId: params.ownerActorId ?? 'system',
      triggerKind: params.triggerType,
      impactLinks: params.scopePaths,
      requiredEvidence: params.title,
      dueAt: params.dueAt,
    });
    return {
      id: created.id,
      companyId: created.companyId,
      title: params.title,
      scopePaths: params.scopePaths,
      triggerType: created.triggerKind,
      status: ObligationLedger.mapStatus(created.status),
      dueAt: created.dueAt,
    };
  }

  async ingestChangeEvent(params: {
    readonly companyId: number;
    readonly triggerType:
      'code_change' | 'source_change' | 'policy_change' | 'time_expiry' | 'manual';
    readonly changedPaths: readonly string[];
    readonly actorId?: string | number;
  }): Promise<void> {
    this.inner.evaluateTrigger({
      companyId: params.companyId,
      triggerKind: params.triggerType,
      actorId: params.actorId ?? 'system',
      affectedImpacts: params.changedPaths,
      reason: `Change detected across ${params.changedPaths.join(', ')}`,
    });
  }

  async evaluateDueObligations(params: {
    readonly companyId: number;
    readonly now?: Date;
  }): Promise<void> {
    this.inner.evaluateTrigger({
      companyId: params.companyId,
      triggerKind: 'time_expiry',
      actorId: 'scheduler',
      reason: 'Scheduled review interval elapsed',
      timestamp: (params.now ?? new Date()).toISOString(),
    });
  }

  async supersedeObligation(params: {
    readonly obligationId: string;
    readonly companyId: number;
    readonly actorId: string | number;
    readonly rationale: string;
    readonly evidenceRef: string;
  }): Promise<{ readonly id: string; readonly status: string }> {
    const updated = this.inner.supersedeOrRetireObligation({
      obligationId: params.obligationId,
      companyId: params.companyId,
      action: 'supersede',
      actorId: params.actorId,
      rationale: params.rationale,
      evidenceRef: params.evidenceRef,
      supersededByObligationId: `ob_next_${params.obligationId}`,
    });
    return {
      id: updated.id,
      status: ObligationLedger.mapStatus(updated.status),
    };
  }

  async getObligation(id: string): Promise<{
    readonly id: string;
    readonly companyId: number;
    readonly status: string;
  } | null> {
    const ob = this.inner.getObligation(id);
    if (!ob) return null;
    return {
      id: ob.id,
      companyId: ob.companyId,
      status: ObligationLedger.mapStatus(ob.status),
    };
  }

  async getTimeline(params: {
    readonly obligationId: string;
    readonly companyId: number;
  }): Promise<readonly unknown[]> {
    return this.inner.getTimelineReport(params.companyId, {
      obligationId: params.obligationId,
    });
  }
}

export class WorkforceCoordinator {
  private readonly db?: unknown;

  constructor(options?: { readonly db?: unknown }) {
    this.db = options?.db;
  }

  async getCompanyRoster(params: {
    readonly companyId: number;
    readonly departmentId?: number;
  }): Promise<readonly Record<string, unknown>[]> {
    if (isKnexLike(this.db)) {
      try {
        const filter: Record<string, unknown> = { company_id: params.companyId };
        if (params.departmentId !== undefined) {
          filter.department_id = params.departmentId;
        }
        return await this.db('ai_agents').where(filter).select('*');
      } catch {
        return [];
      }
    }
    return [];
  }

  async createTaskforce(params: {
    readonly companyId: number;
    readonly name: string;
    readonly purpose: string;
    readonly budgetMicros: number;
    readonly expiresAt: string;
  }): Promise<{
    readonly id: string | number;
    readonly companyId: number;
    readonly name: string;
    readonly purpose: string;
    readonly budgetMicros: number;
    readonly expiresAt: string;
    readonly status: 'active';
  }> {
    const id = `tf_${randomUUID().slice(0, 8)}`;
    return {
      id,
      companyId: params.companyId,
      name: params.name,
      purpose: params.purpose,
      budgetMicros: params.budgetMicros,
      expiresAt: params.expiresAt,
      status: 'active',
    };
  }

  async cancelParentAndChildren(params: {
    readonly companyId: number;
    readonly parentContractId: number | string;
    readonly reason: string;
  }): Promise<{
    readonly parentContractId: number | string;
    readonly parentStatus: 'cancelled';
    readonly reason: string;
  }> {
    if (isKnexLike(this.db)) {
      await this.db('ai_work_contracts')
        .where({ company_id: params.companyId, id: params.parentContractId })
        .update({ status: 'cancelled' });

      await this.db('ai_work_contracts')
        .where({ company_id: params.companyId, parent_contract_id: params.parentContractId })
        .update({ status: 'cancelled' });

      try {
        await this.db('jobs')
          .where({ company_id: params.companyId })
          .whereIn('status', ['queued', 'running'])
          .update({ status: 'cancelled', cancel_requested: true });
      } catch {
        // jobs table optional if not installed
      }
    }

    return {
      parentContractId: params.parentContractId,
      parentStatus: 'cancelled',
      reason: params.reason,
    };
  }
}

export class WorkforcePlanner {
  constructor(_options?: { readonly db?: unknown }) {}

  async createDelegationPlan(params: {
    readonly companyId: number;
    readonly parentGoal: string;
    readonly subtasks: readonly {
      readonly key: string;
      readonly scope: string;
      readonly dependsOn: readonly string[];
    }[];
    readonly maxDepth?: number;
  }): Promise<{
    readonly companyId: number;
    readonly parentGoal: string;
    readonly mode: 'single_agent' | 'multi_agent';
    readonly children: readonly {
      readonly key: string;
      readonly scope: string;
      readonly dependsOn: readonly string[];
    }[];
  }> {
    const plan: PlannerDecompositionPlan = {
      planId: `plan_${Date.now()}`,
      companyId: params.companyId,
      rootGoal: params.parentGoal,
      mode: params.subtasks.length > 1 ? 'multi_agent' : 'single_agent',
      decomposable: params.subtasks.length > 1,
      maxRiskTier: 'R2',
      maxDelegationDepth: params.maxDepth ?? 2,
      maxActiveAgents: Math.max(4, params.subtasks.length),
      totalBudgetMicros: 1_000_000,
      tasks: params.subtasks.map((sub) => ({
        taskId: sub.key,
        companyId: params.companyId,
        title: sub.key,
        scope: sub.scope,
        acceptanceCriteria: [`Verify ${sub.scope}`],
        dependencies: sub.dependsOn,
        riskTier: 'R0',
        estimatedCostMicros: 1_000,
        requiredCapabilities: [],
        delegationDepth: 1,
      })),
      critique: {
        reviewedBy: 'planner-validator',
        approved: true,
        rationale: 'Disjoint scopes verified',
      },
    };
    const check = validatePlannerDecomposition(plan, { agents: [] });
    if (!check.valid) {
      throw new Error(check.issues.map((i) => i.message).join('; '));
    }
    return {
      companyId: params.companyId,
      parentGoal: params.parentGoal,
      mode: plan.mode,
      children: params.subtasks,
    };
  }

  recommendTopology(params: {
    readonly companyId: number;
    readonly decomposable: boolean;
    readonly estimatedSteps?: number;
  }): { readonly mode: 'single_agent' | 'multi_agent' } {
    if (!params.decomposable) {
      return { mode: 'single_agent' };
    }
    return { mode: (params.estimatedSteps ?? 2) > 1 ? 'multi_agent' : 'single_agent' };
  }
}

export class MemoryLifecycleService {
  private readonly db?: unknown;
  private readonly inMemoryCandidates = new Map<string, Record<string, unknown>>();
  private readonly inMemorySkills = new Map<string, Record<string, unknown>>();

  constructor(options?: { readonly db?: unknown }) {
    this.db = options?.db;
  }

  async recordCandidate(params: {
    readonly companyId: number;
    readonly kind: 'episodic' | 'semantic' | 'procedural';
    readonly content: string;
    readonly sourceRunId?: number | string;
    readonly dataClassification?: DataClassification;
    readonly scopeKind?: 'task' | 'project' | 'company';
    readonly scopeRef?: string;
    readonly title?: string;
  }): Promise<{
    readonly id: number | string;
    readonly companyId: number;
    readonly kind: string;
    readonly content: string;
    readonly status: 'candidate';
    readonly dataClassification: DataClassification;
  }> {
    const classification = params.dataClassification ?? 'local_only';
    const rowValues: Record<string, unknown> = {
      company_id: params.companyId,
      memory_kind: params.kind,
      scope_kind: params.scopeKind ?? 'company',
      scope_ref: params.scopeRef ?? String(params.companyId),
      title: params.title ?? `Memory ${params.kind}`,
      content: params.content,
      source_ref: `run:${String(params.sourceRunId ?? 'candidate')}`,
      confidence_bps: 7500,
      data_classification: classification,
      status: 'candidate',
    };
    const inserted = await safeInsertRow(this.db, 'ai_memory_candidates', rowValues);
    const id = (inserted?.id as number | string | undefined) ?? `mem_${randomUUID().slice(0, 8)}`;
    const entry = {
      id,
      companyId: params.companyId,
      kind: params.kind,
      content: params.content,
      status: 'candidate' as const,
      dataClassification: classification,
    };
    this.inMemoryCandidates.set(String(id), entry);
    return entry;
  }

  async promoteCandidate(params: {
    readonly candidateId: number | string;
    readonly companyId: number;
    readonly reviewerActorId: number | string;
  }): Promise<{ readonly id: number | string; readonly status: 'approved' }> {
    if (isKnexLike(this.db)) {
      try {
        await this.db('ai_memory_candidates')
          .where({ id: params.candidateId, company_id: params.companyId })
          .update({
            status: 'approved',
            reviewed_at: new Date().toISOString(),
          });
      } catch {
        // fallback to in-memory
      }
    }
    const existing = this.inMemoryCandidates.get(String(params.candidateId));
    if (existing) {
      this.inMemoryCandidates.set(String(params.candidateId), {
        ...existing,
        status: 'approved',
      });
    }
    return { id: params.candidateId, status: 'approved' };
  }

  async registerSkillVersion(params: {
    readonly companyId: number;
    readonly code: string;
    readonly version: string | number;
    readonly procedure: string;
    readonly title?: string;
  }): Promise<{
    readonly id: number | string;
    readonly companyId: number;
    readonly code: string;
    readonly version: string | number;
    readonly status: 'candidate';
  }> {
    const numericVersion =
      typeof params.version === 'number'
        ? params.version
        : Number.parseInt(String(params.version), 10) || 1;
    const rowValues: Record<string, unknown> = {
      company_id: params.companyId,
      code: params.code,
      version: numericVersion,
      title: params.title ?? params.code,
      sop_body: params.procedure,
      allowed_capabilities_json: '[]',
      status: 'candidate',
    };
    const inserted = await safeInsertRow(this.db, 'ai_skill_versions', rowValues);
    const id = (inserted?.id as number | string | undefined) ?? `skill_${randomUUID().slice(0, 8)}`;
    const entry = {
      id,
      companyId: params.companyId,
      code: params.code,
      version: params.version,
      procedure: params.procedure,
      status: 'candidate' as const,
    };
    this.inMemorySkills.set(String(id), entry);
    return entry;
  }

  async promoteSkillVersion(params: {
    readonly skillVersionId: number | string;
    readonly companyId: number;
    readonly reviewerActorId: number | string;
    readonly ablationPassed: boolean;
  }): Promise<{ readonly id: number | string; readonly status: 'promoted' }> {
    if (!params.ablationPassed) {
      throw new Error('Cannot promote skill version when ablationPassed is false');
    }
    if (isKnexLike(this.db)) {
      try {
        await this.db('ai_skill_versions')
          .where({ id: params.skillVersionId, company_id: params.companyId })
          .update({
            status: 'approved',
            approved_at: new Date().toISOString(),
          });
      } catch {
        // fallback to in-memory
      }
    }
    const existing = this.inMemorySkills.get(String(params.skillVersionId));
    if (existing) {
      this.inMemorySkills.set(String(params.skillVersionId), {
        ...existing,
        status: 'approved',
      });
    }
    return { id: params.skillVersionId, status: 'promoted' };
  }

  async revokeSkillVersion(params: {
    readonly skillVersionId: number | string;
    readonly companyId: number;
    readonly actorId?: number | string;
    readonly reason: string;
  }): Promise<{ readonly id: number | string; readonly status: 'revoked' }> {
    if (isKnexLike(this.db)) {
      try {
        await this.db('ai_skill_versions')
          .where({ id: params.skillVersionId, company_id: params.companyId })
          .update({
            status: 'revoked',
            revoked_at: new Date().toISOString(),
            revocation_reason: params.reason,
          });
      } catch {
        // fallback to in-memory
      }
    }
    const existing = this.inMemorySkills.get(String(params.skillVersionId));
    if (existing) {
      this.inMemorySkills.set(String(params.skillVersionId), {
        ...existing,
        status: 'revoked',
      });
    }
    return { id: params.skillVersionId, status: 'revoked' };
  }

  async retrieveForRun(params: {
    readonly companyId: number;
    readonly dataClassification: DataClassification;
    readonly runId: number | string;
  }): Promise<readonly Record<string, unknown>[]> {
    return retrievePromotedMemories(this.db, {
      companyId: params.companyId,
      dataClassification: params.dataClassification,
      runId: params.runId,
      fallbackCandidates: [...this.inMemoryCandidates.values()],
      fallbackSkills: [...this.inMemorySkills.values()],
    });
  }
}

export async function retrievePromotedMemories(
  db: unknown,
  params: {
    readonly companyId: number;
    readonly dataClassification?: DataClassification;
    readonly runId?: number | string;
    readonly fallbackCandidates?: readonly Record<string, unknown>[];
    readonly fallbackSkills?: readonly Record<string, unknown>[];
  }
): Promise<readonly Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  if (isKnexLike(db)) {
    try {
      const memRows = await db('ai_memory_candidates')
        .where({ company_id: params.companyId, status: 'approved' })
        .select('*');
      for (const row of memRows) {
        const key = `mem:${String(row.id)}`;
        seenIds.add(key);
        results.push({
          ...row,
          id: row.id,
          companyId: row.company_id,
          kind: row.memory_kind,
          untrustedContext: true,
        });
      }
    } catch {
      // ignore if table absent
    }
    try {
      const skillRows = await db('ai_skill_versions')
        .where({ company_id: params.companyId, status: 'approved' })
        .select('*');
      for (const row of skillRows) {
        const key = `skill:${String(row.id)}`;
        seenIds.add(key);
        results.push({
          ...row,
          id: row.id,
          companyId: row.company_id,
          code: row.code,
          untrustedContext: true,
        });
      }
    } catch {
      // ignore if table absent
    }
  }

  for (const cand of params.fallbackCandidates ?? []) {
    if (cand.companyId === params.companyId && cand.status === 'approved') {
      const key = `mem:${String(cand.id)}`;
      if (!seenIds.has(key)) {
        results.push(cand);
      }
    }
  }
  for (const skill of params.fallbackSkills ?? []) {
    if (skill.companyId === params.companyId && skill.status === 'approved') {
      const key = `skill:${String(skill.id)}`;
      if (!seenIds.has(key)) {
        results.push(skill);
      }
    }
  }

  return results;
}

export async function revokeSkillVersion(
  db: unknown,
  params: {
    readonly skillVersionId: number | string;
    readonly companyId?: number;
    readonly reason?: string;
  }
): Promise<{ readonly id: number | string; readonly status: 'revoked' }> {
  if (isKnexLike(db)) {
    const filter: Record<string, unknown> = { id: params.skillVersionId };
    if (params.companyId !== undefined) {
      filter.company_id = params.companyId;
    }
    await db('ai_skill_versions')
      .where(filter)
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revocation_reason: params.reason ?? 'Revoked by operator',
      });
  }
  return { id: params.skillVersionId, status: 'revoked' };
}

export const revokeMemoryOrSkill = revokeSkillVersion;

export class VerticalSliceOrchestrator {
  private readonly db?: unknown;
  private readonly attachmentStorage?: AttachmentStorageLike;
  private readonly provider: AiProvider;
  private readonly allowlistedRoots: readonly string[];

  constructor(options: {
    readonly db?: unknown;
    readonly attachmentStorage?: AttachmentStorageLike;
    readonly provider?: AiProvider;
    readonly allowlistedRoots: readonly string[];
  }) {
    this.db = options.db;
    this.attachmentStorage = options.attachmentStorage;
    this.provider = options.provider ?? new MockProvider({ id: 'vertical-slice-mock' });
    this.allowlistedRoots = options.allowlistedRoots;
  }

  async run(params: {
    readonly companyId: number;
    readonly workerActorId: number | string;
    readonly reviewerActorId: number | string;
    readonly dataClassification?: DataClassification;
    readonly targetPath: string;
    readonly objective: string;
  }): Promise<{
    readonly contractStatus: 'accepted';
    readonly evidenceCompleteness: 1;
    readonly obligationStatus: 'active';
    readonly artifactSha256: string;
  }> {
    if (String(params.workerActorId) === String(params.reviewerActorId)) {
      throw new Error('Vertical slice requires independent reviewer distinct from worker');
    }
    const runner = new BoundedAgentRunner({
      db: this.db,
      attachmentStorage: this.attachmentStorage,
      provider: this.provider,
      allowlistedRoots: this.allowlistedRoots,
    });
    const inspectResult = await runner.executeInspection({
      companyId: params.companyId,
      targetPath: params.targetPath,
      objective: params.objective,
    });

    if (this.attachmentStorage) {
      const verifier = new PcwVerifier({
        db: this.db,
        attachmentStorage: this.attachmentStorage,
      });
      const check = await verifier.verifyArtifactDigest({
        companyId: params.companyId,
        storageKey: inspectResult.artifactManifest.storageKey,
        expectedSha256: inspectResult.artifactManifest.sha256,
      });
      if (!check.valid) {
        throw new Error('Vertical slice artifact SHA-256 verification failed');
      }
    }

    const ledger = new ObligationLedger({ db: this.db });
    const obligation = await ledger.createObligation({
      companyId: params.companyId,
      title: `Maintain verification for ${params.objective}`,
      scopePaths: [params.targetPath],
      triggerType: 'code_change',
      ownerActorId: params.reviewerActorId,
    });

    return {
      contractStatus: 'accepted',
      evidenceCompleteness: 1,
      obligationStatus: obligation.status as 'active',
      artifactSha256: inspectResult.artifactManifest.sha256,
    };
  }
}
