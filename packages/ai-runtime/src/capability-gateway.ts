import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue } from '@moonwitness/types';
import { normalizeDataClassification } from './classification-router.js';
import { createRedactor, type RedactionContext } from './redaction.js';
import {
  evaluateRiskTierPolicy,
  type EmergencyStopController,
  type HumanApprovalToken,
  type RiskTier,
} from './risk-policy.js';
import { validateJsonSchema } from './schema-validator.js';
import type { Clock, DataClassification, JsonSchemaNode } from './types.js';
import { SYSTEM_CLOCK } from './types.js';

export const CAPABILITY_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@v[1-9][0-9]*$/u;

export type ToolSideEffectKind =
  'read_only' | 'reversible_write' | 'external_effect' | 'destructive';

export interface CapabilityGrantScope {
  readonly allowedPaths?: readonly string[];
  readonly allowedWorkContractIds?: readonly string[];
  readonly allowedResources?: readonly string[];
  readonly allowWrite?: boolean;
}

export interface CapabilityGrantRecord {
  readonly grantId: string;
  readonly companyId: number;
  readonly agentId: number | string;
  readonly workContractId?: string;
  readonly capability: string;
  readonly scope: CapabilityGrantScope;
  readonly policyVersion: number;
  readonly maxCallsPerRun: number;
  readonly maxCallsPerWindow?: number;
  readonly issuedBy: number | string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly revokedAt?: string;
  readonly revocationReason?: string;
  readonly auditRef?: string;
}

export interface CapabilityGrantStore {
  resolveGrantsForExecution(params: {
    readonly companyId: number;
    readonly agentId: number | string;
    readonly capability: string;
    readonly workContractId?: string;
  }): Promise<readonly CapabilityGrantRecord[]> | readonly CapabilityGrantRecord[];
  getCurrentPolicyVersion(companyId: number): Promise<number> | number;
}

export class InMemoryCapabilityGrantStore implements CapabilityGrantStore {
  private readonly grants = new Map<string, CapabilityGrantRecord>();
  private readonly policyVersions = new Map<number, number>();
  private readonly clock: Clock;

  constructor(clock: Clock = SYSTEM_CLOCK) {
    this.clock = clock;
  }

  setPolicyVersion(companyId: number, version: number): void {
    this.policyVersions.set(companyId, version);
  }

  getCurrentPolicyVersion(companyId: number): number {
    return this.policyVersions.get(companyId) ?? 1;
  }

  upsertGrant(grant: CapabilityGrantRecord): void {
    if (!CAPABILITY_IDENTIFIER_REGEX.test(grant.capability)) {
      throw new Error(`Invalid capability identifier "${grant.capability}"`);
    }
    this.grants.set(grant.grantId, grant);
  }

  revokeGrant(grantId: string, reason: string): boolean {
    const existing = this.grants.get(grantId);
    if (!existing) return false;
    this.grants.set(grantId, {
      ...existing,
      status: 'revoked',
      revokedAt: new Date(this.clock.now()).toISOString(),
      revocationReason: reason,
    });
    return true;
  }

  resolveGrantsForExecution(params: {
    readonly companyId: number;
    readonly agentId: number | string;
    readonly capability: string;
    readonly workContractId?: string;
  }): readonly CapabilityGrantRecord[] {
    const matching: CapabilityGrantRecord[] = [];
    for (const grant of this.grants.values()) {
      if (grant.companyId !== params.companyId) continue;
      if (grant.agentId !== params.agentId) continue;
      if (grant.capability !== params.capability) continue;
      if (
        grant.workContractId &&
        params.workContractId &&
        grant.workContractId !== params.workContractId
      ) {
        continue;
      }
      matching.push(grant);
    }
    return matching;
  }
}

export interface ToolExecutionContext {
  readonly actorType: 'agent' | 'user';
  readonly actorId: number | string;
  readonly companyId: number;
  readonly runId: string;
  readonly workContractId?: string;
  readonly correlationId: string;
  readonly policyVersion: number;
  readonly maxRiskTier?: RiskTier;
  readonly maxDataClassification?: DataClassification;
  readonly readOnlyMode?: boolean;
  readonly humanApprovalToken?: HumanApprovalToken;
  readonly confirmationToken?: string;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export interface TypedToolDefinition<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonValue = JsonValue,
> {
  readonly name: string;
  readonly version: number;
  readonly capability: string;
  readonly ownerAddon: string;
  readonly riskTier: RiskTier;
  readonly dataClassification: DataClassification;
  readonly sideEffect: ToolSideEffectKind;
  readonly requiresConfirmation: boolean;
  readonly idempotent: boolean;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly inputSchema: JsonSchemaNode;
  readonly outputSchema?: JsonSchemaNode;
  readonly description: string;
  readonly validateArgs?: (args: TInput) => boolean;
  execute(args: TInput, context: ToolExecutionContext): Promise<TOutput> | TOutput;
}

export interface RelaxedToolRegistration<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonValue = JsonValue,
> {
  readonly name: string;
  readonly version?: number;
  readonly capability?: string;
  readonly ownerAddon?: string;
  readonly riskTier: RiskTier;
  readonly dataClassification?: DataClassification;
  readonly sideEffect?: ToolSideEffectKind;
  readonly requiresConfirmation?: boolean;
  readonly idempotent?: boolean;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly inputSchema?: JsonSchemaNode;
  readonly outputSchema?: JsonSchemaNode;
  readonly description?: string;
  readonly validateArgs?: (args: TInput) => boolean;
  execute(args: TInput, context: ToolExecutionContext): Promise<TOutput> | TOutput;
}

export interface PolicyDenialDetails {
  readonly code: 'policy_denied' | 'validation_failed' | 'execution_failed';
  readonly reasonCode: string;
  readonly message: string;
  readonly policyVersion: number;
  readonly companyId: number;
  readonly actorId: number | string;
  readonly runId: string;
  readonly correlationId: string;
  readonly toolName: string;
  readonly capability: string;
  readonly auditRef: string;
  readonly timestamp: string;
}

export interface PolicyAuditEntry {
  readonly auditRef: string;
  readonly timestamp: string;
  readonly allowed: boolean;
  readonly companyId: number;
  readonly actorType: 'agent' | 'user';
  readonly actorId: number | string;
  readonly runId: string;
  readonly correlationId: string;
  readonly toolName: string;
  readonly capability: string;
  readonly riskTier: RiskTier;
  readonly grantId?: string;
  readonly policyVersion: number;
  readonly reasonCode: string;
  readonly idempotentReplay: boolean;
}

export type GatewayInvokeResult =
  | {
      readonly allowed: true;
      readonly toolName: string;
      readonly capability: string;
      readonly output: JsonValue;
      readonly auditRef: string;
      readonly idempotentReplay: boolean;
      readonly untrustedOutputNotice: true;
    }
  | {
      readonly allowed: false;
      readonly denial: PolicyDenialDetails;
    };

/** Durable acknowledgement of a side-effecting tool call (backed by orm-ai in production). */
export interface ToolEffectAcknowledgement {
  readonly key: string;
  readonly argsDigest: string;
  readonly output: JsonValue;
  readonly auditRef: string;
}

export interface ToolEffectStore {
  find(key: string): Promise<ToolEffectAcknowledgement | null> | ToolEffectAcknowledgement | null;
  acknowledge(record: ToolEffectAcknowledgement): Promise<void> | void;
}

export interface ToolAuditSink {
  record(entry: PolicyAuditEntry): Promise<void> | void;
}

export interface ToolQuotaStore {
  getRunUsage(runId: string, grantId: string): Promise<number> | number;
  incrementRunUsage(runId: string, grantId: string): Promise<number> | number;
}

export interface CapabilityGatewayOptions {
  readonly grantStore?: CapabilityGrantStore;
  readonly db?: unknown;
  readonly emergencyStopController?: EmergencyStopController;
  readonly redactor?: RedactionContext;
  readonly clock?: Clock;
  readonly defaultMaxCallsPerAgentWindow?: number;
  readonly quotaWindowMs?: number;
  /** Durable ports replace the in-memory compatibility caches. */
  readonly effectStore?: ToolEffectStore;
  readonly auditSink?: ToolAuditSink;
  readonly quotaStore?: ToolQuotaStore;
  /**
   * Compatibility overload that fabricates user/approval context is retained
   * for existing deterministic tests only. Production workers must pass
   * `false` and provide real ToolExecutionContext + durable ports.
   */
  readonly allowInlineInvocation?: boolean;
}

const DEFAULT_MAX_INPUT_BYTES = 65_536;
const DEFAULT_MAX_OUTPUT_BYTES = 262_144;

const CLASSIFICATION_RANK: Readonly<Record<DataClassification, number>> = {
  cloud_eligible: 1,
  local_only: 2,
  restricted: 3,
};

function computeDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Normalize backslashes and strip leading or trailing `/` in O(n) time. */
function trimPathSlashes(value: string, edge: 'leading' | 'trailing'): string {
  const slashNormalized = value.includes('\\') ? value.replaceAll('\\', '/') : value;
  if (edge === 'leading') {
    let start = 0;
    while (start < slashNormalized.length && slashNormalized.charCodeAt(start) === 47) {
      start += 1;
    }
    return start === 0 ? slashNormalized : slashNormalized.slice(start);
  }
  let end = slashNormalized.length;
  while (end > 0 && slashNormalized.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === slashNormalized.length ? slashNormalized : slashNormalized.slice(0, end);
}

function isPathWithinScope(requestedPath: string, allowedPaths: readonly string[]): boolean {
  const normalized = trimPathSlashes(requestedPath, 'leading');
  if (!normalized || normalized.split('/').includes('..')) {
    return false;
  }
  return allowedPaths.some((allowed) => {
    const cleanAllowed = trimPathSlashes(allowed, 'trailing');
    if (cleanAllowed === '.') return true;
    return normalized === cleanAllowed || normalized.startsWith(`${cleanAllowed}/`);
  });
}

function checkGrantScope(
  grant: CapabilityGrantRecord,
  tool: TypedToolDefinition,
  args: JsonObject,
  context: ToolExecutionContext
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: string; readonly message: string } {
  if (tool.sideEffect !== 'read_only' && grant.scope.allowWrite === false) {
    return {
      ok: false,
      reasonCode: 'SCOPE_WRITE_DENIED',
      message: `Grant "${grant.grantId}" prohibits write operations`,
    };
  }

  if (
    grant.scope.allowedWorkContractIds &&
    grant.scope.allowedWorkContractIds.length > 0 &&
    (!context.workContractId ||
      !grant.scope.allowedWorkContractIds.includes(context.workContractId))
  ) {
    return {
      ok: false,
      reasonCode: 'SCOPE_CONTRACT_DENIED',
      message: `Work contract "${context.workContractId ?? 'none'}" is outside grant scope`,
    };
  }

  if (grant.scope.allowedPaths && grant.scope.allowedPaths.length > 0) {
    const pathArg =
      typeof args.path === 'string'
        ? args.path
        : typeof args.dir === 'string'
          ? args.dir
          : typeof args.pathPrefix === 'string'
            ? args.pathPrefix
            : undefined;
    if (pathArg !== undefined && !isPathWithinScope(pathArg, grant.scope.allowedPaths)) {
      return {
        ok: false,
        reasonCode: 'SCOPE_PATH_DENIED',
        message: `Path "${pathArg}" is outside grant allowedPaths`,
      };
    }
  }

  if (grant.scope.allowedResources && grant.scope.allowedResources.length > 0) {
    const resourceArg =
      typeof args.resource === 'string'
        ? args.resource
        : typeof args.targetId === 'string'
          ? args.targetId
          : undefined;
    if (resourceArg !== undefined && !grant.scope.allowedResources.includes(resourceArg)) {
      return {
        ok: false,
        reasonCode: 'SCOPE_RESOURCE_DENIED',
        message: `Resource "${resourceArg}" is outside grant allowedResources`,
      };
    }
  }

  return { ok: true };
}

interface IdempotencyEntry {
  readonly argsDigest: string;
  readonly output: JsonValue;
  readonly auditRef: string;
}

export class CapabilityGateway {
  private readonly tools = new Map<string, TypedToolDefinition>();
  private readonly grantStore: CapabilityGrantStore;
  private readonly emergencyStopController?: EmergencyStopController;
  private readonly redactor: RedactionContext;
  private readonly clock: Clock;
  private readonly runCallCounts = new Map<string, number>();
  private readonly runTotalCalls = new Map<string, number>();
  private readonly agentWindowTimestamps = new Map<string, number[]>();
  private readonly idempotencyCache = new Map<string, IdempotencyEntry>();
  private readonly auditLog: PolicyAuditEntry[] = [];
  private readonly defaultMaxCallsPerAgentWindow?: number;
  private readonly quotaWindowMs: number;
  private readonly effectStore?: ToolEffectStore;
  private readonly auditSink?: ToolAuditSink;
  private readonly quotaStore?: ToolQuotaStore;
  private readonly allowInlineInvocation: boolean;
  private readonly deniedTools = new Set<string>();
  private auditSeq = 1;

  constructor(options: CapabilityGatewayOptions = {}) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.grantStore = options.grantStore ?? new InMemoryCapabilityGrantStore(this.clock);
    this.emergencyStopController = options.emergencyStopController;
    this.redactor = options.redactor ?? createRedactor();
    this.defaultMaxCallsPerAgentWindow = options.defaultMaxCallsPerAgentWindow;
    this.quotaWindowMs = options.quotaWindowMs ?? 60_000;
    this.effectStore = options.effectStore;
    this.auditSink = options.auditSink;
    this.quotaStore = options.quotaStore;
    this.allowInlineInvocation = options.allowInlineInvocation ?? true;
  }

  /** R4 tools are always denied, even if a caller registers one. */
  denyTool(name: string): void {
    this.deniedTools.add(name);
  }

  private async writeAudit(entry: PolicyAuditEntry): Promise<void> {
    if (this.auditSink) await this.auditSink.record(entry);
  }

  registerTool<TInput extends JsonObject, TOutput extends JsonValue>(
    tool: RelaxedToolRegistration<TInput, TOutput>
  ): void {
    const inferredCapability =
      tool.capability ??
      (CAPABILITY_IDENTIFIER_REGEX.test(tool.name) ? tool.name : 'tool.execute@v1');
    if (!CAPABILITY_IDENTIFIER_REGEX.test(inferredCapability)) {
      throw new Error(
        `Invalid capability identifier "${inferredCapability}" for tool "${tool.name}"`
      );
    }
    const normalized: TypedToolDefinition<TInput, TOutput> = {
      name: tool.name,
      version: tool.version ?? 1,
      capability: inferredCapability,
      ownerAddon: tool.ownerAddon ?? 'orm-ai',
      riskTier: tool.riskTier,
      dataClassification: tool.dataClassification ?? 'local_only',
      sideEffect: tool.sideEffect ?? (tool.riskTier === 'R0' ? 'read_only' : 'reversible_write'),
      requiresConfirmation: tool.requiresConfirmation ?? tool.riskTier === 'R3',
      idempotent: tool.idempotent ?? false,
      maxInputBytes: tool.maxInputBytes,
      maxOutputBytes: tool.maxOutputBytes,
      inputSchema: tool.inputSchema ?? { type: 'object' },
      outputSchema: tool.outputSchema,
      description: tool.description ?? tool.name,
      validateArgs: tool.validateArgs,
      execute: tool.execute,
    };
    this.tools.set(tool.name, normalized as unknown as TypedToolDefinition);
  }

  getRunQuotaUsage(runId: string | number): { readonly calls: number } {
    return { calls: this.runTotalCalls.get(String(runId)) ?? 0 };
  }

  getTool(name: string): TypedToolDefinition | undefined {
    return this.tools.get(name);
  }

  listRegisteredTools(): readonly TypedToolDefinition[] {
    return [...this.tools.values()];
  }

  getAuditLog(): readonly PolicyAuditEntry[] {
    return [...this.auditLog];
  }

  private nextAuditRef(companyId: number): string {
    const seq = this.auditSeq++;
    return `audit_c${companyId}_${this.clock.now()}_${seq}`;
  }

  private recordDenial(params: {
    readonly code: PolicyDenialDetails['code'];
    readonly reasonCode: string;
    readonly message: string;
    readonly context: ToolExecutionContext;
    readonly toolName: string;
    readonly capability: string;
    readonly riskTier: RiskTier;
    readonly grantId?: string;
  }): GatewayInvokeResult {
    const auditRef = this.nextAuditRef(params.context.companyId);
    const timestamp = new Date(this.clock.now()).toISOString();
    const safeMessage = this.redactor.redactString(params.message);

    this.auditLog.push({
      auditRef,
      timestamp,
      allowed: false,
      companyId: params.context.companyId,
      actorType: params.context.actorType,
      actorId: params.context.actorId,
      runId: params.context.runId,
      correlationId: params.context.correlationId,
      toolName: params.toolName,
      capability: params.capability,
      riskTier: params.riskTier,
      grantId: params.grantId,
      policyVersion: params.context.policyVersion,
      reasonCode: params.reasonCode,
      idempotentReplay: false,
    });
    void this.writeAudit(this.auditLog.at(-1)!);

    return {
      allowed: false,
      denial: {
        code: params.code,
        reasonCode: params.reasonCode,
        message: safeMessage,
        policyVersion: params.context.policyVersion,
        companyId: params.context.companyId,
        actorId: params.context.actorId,
        runId: params.context.runId,
        correlationId: params.context.correlationId,
        toolName: params.toolName,
        capability: params.capability,
        auditRef,
        timestamp,
      },
    };
  }

  async listAuthorizedToolsForPrincipal(params: {
    readonly companyId: number;
    readonly agentId: number | string;
    readonly workContractId?: string;
    readonly policyVersion: number;
  }): Promise<readonly TypedToolDefinition[]> {
    const currentPolicyVersion = await this.grantStore.getCurrentPolicyVersion(params.companyId);
    if (params.policyVersion !== currentPolicyVersion) {
      return [];
    }
    const nowMs = this.clock.now();
    const authorized: TypedToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      const grants = await this.grantStore.resolveGrantsForExecution({
        companyId: params.companyId,
        agentId: params.agentId,
        capability: tool.capability,
        workContractId: params.workContractId,
      });
      const hasValidGrant = grants.some((grant) => {
        if (grant.status !== 'active') return false;
        if (grant.policyVersion !== currentPolicyVersion) return false;
        const expMs = Date.parse(grant.expiresAt);
        return Number.isFinite(expMs) && expMs > nowMs;
      });
      if (hasValidGrant) {
        authorized.push(tool);
      }
    }
    return authorized;
  }

  async invoke(
    toolName: string,
    args: JsonObject,
    context: ToolExecutionContext
  ): Promise<GatewayInvokeResult>;
  async invoke(request: {
    readonly toolName: string;
    readonly args?: JsonObject;
    readonly grant?: {
      readonly id?: string | number;
      readonly companyId: number;
      readonly capability: string;
      readonly policyVersion?: number;
      readonly maxCallsPerRun?: number;
      readonly expiresAt: string;
      readonly revokedAt?: string | null;
    };
    readonly activePolicyVersion?: number;
    readonly companyId: number;
    readonly agentId?: number | string;
    readonly runId?: number | string;
    readonly correlationId?: string;
    readonly humanApproved?: boolean;
  }): Promise<JsonValue>;
  async invoke(
    toolNameOrReq:
      | string
      | {
          readonly toolName: string;
          readonly args?: JsonObject;
          readonly grant?: {
            readonly id?: string | number;
            readonly companyId: number;
            readonly capability: string;
            readonly policyVersion?: number;
            readonly maxCallsPerRun?: number;
            readonly expiresAt: string;
            readonly revokedAt?: string | null;
          };
          readonly activePolicyVersion?: number;
          readonly companyId: number;
          readonly agentId?: number | string;
          readonly runId?: number | string;
          readonly correlationId?: string;
          readonly humanApproved?: boolean;
        },
    maybeArgs?: JsonObject,
    maybeContext?: ToolExecutionContext
  ): Promise<GatewayInvokeResult | JsonValue> {
    if (typeof toolNameOrReq === 'object' && toolNameOrReq !== null) {
      if (!this.allowInlineInvocation) {
        throw new Error(
          'Inline capability invocation is disabled; supply a real ToolExecutionContext and durable ports'
        );
      }
      const req = toolNameOrReq;
      const args = req.args ?? {};
      const actorId = req.agentId ?? 'inline-agent';
      const runId = String(req.runId ?? 'inline-run');
      const policyVersion = req.activePolicyVersion ?? req.grant?.policyVersion ?? 1;
      const tool = this.tools.get(req.toolName);
      if (this.grantStore instanceof InMemoryCapabilityGrantStore) {
        this.grantStore.setPolicyVersion(req.companyId, policyVersion);
        if (req.grant) {
          this.grantStore.upsertGrant({
            grantId: String(req.grant.id ?? 'inline-grant'),
            companyId: req.grant.companyId,
            agentId: actorId,
            capability: req.grant.capability,
            scope: { allowWrite: true },
            policyVersion: req.grant.policyVersion ?? policyVersion,
            maxCallsPerRun: req.grant.maxCallsPerRun ?? 25,
            issuedBy: 'system',
            issuedAt: new Date(this.clock.now()).toISOString(),
            expiresAt: req.grant.expiresAt,
            status: req.grant.revokedAt ? 'revoked' : 'active',
            revokedAt: req.grant.revokedAt ?? undefined,
          });
        }
      }
      const actionDigest = tool
        ? computeDigest({
            tool: tool.name,
            capability: tool.capability,
            companyId: req.companyId,
            args,
          })
        : '';
      const humanApprovalToken: HumanApprovalToken | undefined =
        req.humanApproved === true
          ? {
              tokenId: 'inline-human-approval',
              companyId: req.companyId,
              runId,
              actionDigest,
              approvedByUserId: 1,
              approvedByRole: 'operator',
              issuedAt: new Date(this.clock.now()).toISOString(),
              expiresAt: new Date(this.clock.now() + 60_000).toISOString(),
            }
          : undefined;

      const res = await this.invoke(req.toolName, args, {
        actorType: 'agent',
        actorId,
        companyId: req.companyId,
        runId,
        correlationId: req.correlationId ?? `corr_${runId}`,
        policyVersion,
        humanApprovalToken,
      });
      if (!res.allowed) {
        throw new Error(res.denial.message);
      }
      return res.output;
    }

    const toolName = toolNameOrReq;
    const args = maybeArgs ?? {};
    const context = maybeContext!;
    const tool = this.tools.get(toolName);
    if (this.deniedTools.has(toolName) || tool?.riskTier === 'R4') {
      return this.recordDenial({
        code: 'policy_denied',
        reasonCode: 'R4_ALWAYS_DENIED',
        message: `Tool "${toolName}" is unconditionally prohibited`,
        context,
        toolName,
        capability: tool?.capability ?? 'unknown.unknown@v1',
        riskTier: 'R4',
      });
    }
    if (!tool) {
      return this.recordDenial({
        code: 'policy_denied',
        reasonCode: 'UNKNOWN_TOOL',
        message: `Tool "${toolName}" is not registered`,
        context,
        toolName,
        capability: 'unknown.unknown@v1',
        riskTier: 'R0',
      });
    }

    if (context.signal?.aborted) {
      return this.recordDenial({
        code: 'execution_failed',
        reasonCode: 'CANCELLED',
        message: 'Tool invocation cancelled before execution',
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
      });
    }

    // 1. Validate arguments & size limit before permission-sensitive side effects
    const inputBytes = Buffer.byteLength(JSON.stringify(args), 'utf8');
    const maxInputBytes = tool.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
    if (inputBytes > maxInputBytes) {
      return this.recordDenial({
        code: 'validation_failed',
        reasonCode: 'INPUT_TOO_LARGE',
        message: `Tool arguments (${inputBytes} bytes) exceed limit (${maxInputBytes} bytes)`,
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
      });
    }

    const argValidation = validateJsonSchema(tool.inputSchema, args);
    if (!argValidation.valid || (tool.validateArgs && !tool.validateArgs(args))) {
      const summary = !argValidation.valid
        ? argValidation.errors
            .slice(0, 4)
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; ')
        : 'Custom validateArgs rejected input';
      return this.recordDenial({
        code: 'validation_failed',
        reasonCode: 'INVALID_TOOL_ARGUMENTS',
        message: `Tool argument validation failed: ${summary}`,
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
      });
    }

    // 2. Enforce explicit classification ceiling if set
    if (context.maxDataClassification !== undefined) {
      const maxCls = normalizeDataClassification(context.maxDataClassification);
      if (CLASSIFICATION_RANK[tool.dataClassification] > CLASSIFICATION_RANK[maxCls]) {
        return this.recordDenial({
          code: 'policy_denied',
          reasonCode: 'CLASSIFICATION_CEILING_EXCEEDED',
          message: `Tool "${tool.name}" classification "${tool.dataClassification}" exceeds ceiling "${maxCls}"`,
          context,
          toolName: tool.name,
          capability: tool.capability,
          riskTier: tool.riskTier,
        });
      }
    }

    // 3. Enforce R0-R4 risk tier policy & emergency stops
    const actionDigest = computeDigest({
      tool: tool.name,
      capability: tool.capability,
      companyId: context.companyId,
      args,
    });
    const riskDecision = evaluateRiskTierPolicy({
      companyId: context.companyId,
      runId: context.runId,
      agentId: context.actorId,
      requestedTier: tool.riskTier,
      policyMaxRiskTier: context.maxRiskTier ?? 'R3',
      actionDigest,
      readOnlyMode: context.readOnlyMode,
      requireConfirmationForR2: tool.requiresConfirmation && tool.riskTier === 'R2',
      humanApprovalToken: context.humanApprovalToken,
      emergencyStopController: this.emergencyStopController,
      nowMs: this.clock.now(),
    });
    if (!riskDecision.allowed) {
      return this.recordDenial({
        code: 'policy_denied',
        reasonCode: riskDecision.reasonCode,
        message: riskDecision.message,
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
      });
    }

    if (tool.requiresConfirmation && tool.riskTier !== 'R3') {
      const hasConfirmation =
        Boolean(context.confirmationToken?.trim()) ||
        riskDecision.verifiedHumanTokenId !== undefined;
      if (!hasConfirmation) {
        return this.recordDenial({
          code: 'policy_denied',
          reasonCode: 'CONFIRMATION_REQUIRED',
          message: `Tool "${tool.name}" (${tool.riskTier}) requires explicit confirmation token`,
          context,
          toolName: tool.name,
          capability: tool.capability,
          riskTier: tool.riskTier,
        });
      }
    }

    // 4. Execution-time re-check of capability grant, expiry, revocation, and policy version
    const currentPolicyVersion = await this.grantStore.getCurrentPolicyVersion(context.companyId);
    if (context.policyVersion !== currentPolicyVersion) {
      return this.recordDenial({
        code: 'policy_denied',
        reasonCode: 'POLICY_VERSION_MISMATCH',
        message: `Execution context policyVersion (${context.policyVersion}) !== current (${currentPolicyVersion})`,
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
      });
    }

    const grants = await this.grantStore.resolveGrantsForExecution({
      companyId: context.companyId,
      agentId: context.actorId,
      capability: tool.capability,
      workContractId: context.workContractId,
    });

    const nowMs = this.clock.now();
    if (grants.length === 0) {
      return this.recordDenial({
        code: 'policy_denied',
        reasonCode: 'GRANT_NOT_FOUND',
        message: `No capability grant for "${tool.capability}" in company ${context.companyId}`,
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
      });
    }

    let selectedGrant: CapabilityGrantRecord | undefined;
    let lastRejection: { reasonCode: string; message: string; grantId: string } | undefined;

    for (const grant of grants) {
      if (grant.status === 'revoked') {
        lastRejection = {
          grantId: grant.grantId,
          reasonCode: 'GRANT_REVOKED',
          message: `Capability grant "${grant.grantId}" was revoked`,
        };
        continue;
      }
      const expiresAtMs = Date.parse(grant.expiresAt);
      if (grant.status === 'expired' || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        lastRejection = {
          grantId: grant.grantId,
          reasonCode: 'GRANT_EXPIRED',
          message: `Capability grant "${grant.grantId}" expired at ${grant.expiresAt}`,
        };
        continue;
      }
      if (grant.policyVersion !== currentPolicyVersion) {
        lastRejection = {
          grantId: grant.grantId,
          reasonCode: 'GRANT_POLICY_VERSION_STALE',
          message: `Grant "${grant.grantId}" policyVersion (${grant.policyVersion}) !== ${currentPolicyVersion}`,
        };
        continue;
      }

      const scopeCheck = checkGrantScope(grant, tool, args, context);
      if (!scopeCheck.ok) {
        lastRejection = {
          grantId: grant.grantId,
          reasonCode: scopeCheck.reasonCode,
          message: scopeCheck.message,
        };
        continue;
      }

      selectedGrant = grant;
      break;
    }

    if (!selectedGrant) {
      return this.recordDenial({
        code: 'policy_denied',
        reasonCode: lastRejection?.reasonCode ?? 'GRANT_INVALID',
        message: lastRejection?.message ?? 'No valid active grant available',
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
        grantId: lastRejection?.grantId,
      });
    }

    // 5. Idempotency check for write / side-effecting tools
    if (tool.sideEffect !== 'read_only' && tool.idempotent) {
      if (!context.idempotencyKey || !context.idempotencyKey.trim()) {
        return this.recordDenial({
          code: 'validation_failed',
          reasonCode: 'MISSING_IDEMPOTENCY_KEY',
          message: `Idempotent write tool "${tool.name}" requires an idempotencyKey`,
          context,
          toolName: tool.name,
          capability: tool.capability,
          riskTier: tool.riskTier,
          grantId: selectedGrant.grantId,
        });
      }

      const idemKey = `${context.companyId}:${tool.name}:${context.idempotencyKey}`;
      const existingEntry =
        (await this.effectStore?.find(idemKey)) ?? this.idempotencyCache.get(idemKey);
      const argsDigest = computeDigest(args);
      if (existingEntry) {
        if (existingEntry.argsDigest !== argsDigest) {
          return this.recordDenial({
            code: 'validation_failed',
            reasonCode: 'IDEMPOTENCY_CONFLICT',
            message: `Idempotency key "${context.idempotencyKey}" already used with different arguments`,
            context,
            toolName: tool.name,
            capability: tool.capability,
            riskTier: tool.riskTier,
            grantId: selectedGrant.grantId,
          });
        }

        const replayAuditRef = this.nextAuditRef(context.companyId);
        this.auditLog.push({
          auditRef: replayAuditRef,
          timestamp: new Date(nowMs).toISOString(),
          allowed: true,
          companyId: context.companyId,
          actorType: context.actorType,
          actorId: context.actorId,
          runId: context.runId,
          correlationId: context.correlationId,
          toolName: tool.name,
          capability: tool.capability,
          riskTier: tool.riskTier,
          grantId: selectedGrant.grantId,
          policyVersion: currentPolicyVersion,
          reasonCode: 'IDEMPOTENT_REPLAY',
          idempotentReplay: true,
        });

        return {
          allowed: true,
          toolName: tool.name,
          capability: tool.capability,
          output: existingEntry.output,
          auditRef: existingEntry.auditRef,
          idempotentReplay: true,
          untrustedOutputNotice: true,
        };
      }
    }

    // 6. Per-run and per-agent window quotas
    const runQuotaKey = `${context.companyId}:${context.runId}:${selectedGrant.grantId}`;
    const usedInRun =
      (await this.quotaStore?.getRunUsage(context.runId, selectedGrant.grantId)) ??
      this.runCallCounts.get(runQuotaKey) ??
      0;
    if (usedInRun + 1 > selectedGrant.maxCallsPerRun) {
      return this.recordDenial({
        code: 'policy_denied',
        reasonCode: 'RUN_TOOL_QUOTA_EXCEEDED',
        message: `Run tool quota (${selectedGrant.maxCallsPerRun}) exceeded for grant "${selectedGrant.grantId}"`,
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
        grantId: selectedGrant.grantId,
      });
    }

    const agentQuotaLimit = selectedGrant.maxCallsPerWindow ?? this.defaultMaxCallsPerAgentWindow;
    const agentWindowKey = `${context.companyId}:${String(context.actorId)}`;
    const timestamps = this.agentWindowTimestamps.get(agentWindowKey) ?? [];
    const activeTimestamps = timestamps.filter((ts) => nowMs - ts < this.quotaWindowMs);
    if (agentQuotaLimit !== undefined && activeTimestamps.length + 1 > agentQuotaLimit) {
      this.agentWindowTimestamps.set(agentWindowKey, activeTimestamps);
      return this.recordDenial({
        code: 'policy_denied',
        reasonCode: 'AGENT_WINDOW_QUOTA_EXCEEDED',
        message: `Agent window quota (${agentQuotaLimit}/${this.quotaWindowMs}ms) exceeded`,
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
        grantId: selectedGrant.grantId,
      });
    }

    this.runCallCounts.set(runQuotaKey, usedInRun + 1);
    await this.quotaStore?.incrementRunUsage(context.runId, selectedGrant.grantId);
    this.runTotalCalls.set(
      String(context.runId),
      (this.runTotalCalls.get(String(context.runId)) ?? 0) + 1
    );
    activeTimestamps.push(nowMs);
    this.agentWindowTimestamps.set(agentWindowKey, activeTimestamps);

    // 7. Execute tool handler and redact + validate output
    let rawOutput: JsonValue;
    try {
      rawOutput = await tool.execute(args, context);
    } catch (error) {
      return this.recordDenial({
        code: 'execution_failed',
        reasonCode: 'TOOL_EXECUTION_ERROR',
        message: error instanceof Error ? error.message : String(error),
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
        grantId: selectedGrant.grantId,
      });
    }

    const redactedOutput = this.redactor.redactObject(rawOutput);
    const outputBytes = Buffer.byteLength(JSON.stringify(redactedOutput), 'utf8');
    const maxOutputBytes = tool.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (outputBytes > maxOutputBytes) {
      return this.recordDenial({
        code: 'execution_failed',
        reasonCode: 'OUTPUT_TOO_LARGE',
        message: `Tool output (${outputBytes} bytes) exceeded max (${maxOutputBytes} bytes)`,
        context,
        toolName: tool.name,
        capability: tool.capability,
        riskTier: tool.riskTier,
        grantId: selectedGrant.grantId,
      });
    }

    if (tool.outputSchema) {
      const outputValidation = validateJsonSchema(tool.outputSchema, redactedOutput);
      if (!outputValidation.valid) {
        return this.recordDenial({
          code: 'execution_failed',
          reasonCode: 'INVALID_TOOL_OUTPUT',
          message: `Tool output violated outputSchema`,
          context,
          toolName: tool.name,
          capability: tool.capability,
          riskTier: tool.riskTier,
          grantId: selectedGrant.grantId,
        });
      }
    }

    const auditRef = this.nextAuditRef(context.companyId);
    if (tool.sideEffect !== 'read_only' && tool.idempotent && context.idempotencyKey) {
      const idemKey = `${context.companyId}:${tool.name}:${context.idempotencyKey}`;
      this.idempotencyCache.set(idemKey, {
        argsDigest: computeDigest(args),
        output: redactedOutput,
        auditRef,
      });
      await this.effectStore?.acknowledge({
        key: idemKey,
        argsDigest: computeDigest(args),
        output: redactedOutput,
        auditRef,
      });
    }

    this.auditLog.push({
      auditRef,
      timestamp: new Date(this.clock.now()).toISOString(),
      allowed: true,
      companyId: context.companyId,
      actorType: context.actorType,
      actorId: context.actorId,
      runId: context.runId,
      correlationId: context.correlationId,
      toolName: tool.name,
      capability: tool.capability,
      riskTier: tool.riskTier,
      grantId: selectedGrant.grantId,
      policyVersion: currentPolicyVersion,
      reasonCode: 'ALLOWED',
      idempotentReplay: false,
    });
    void this.writeAudit(this.auditLog.at(-1)!);

    return {
      allowed: true,
      toolName: tool.name,
      capability: tool.capability,
      output: redactedOutput,
      auditRef,
      idempotentReplay: false,
      untrustedOutputNotice: true,
    };
  }
}
