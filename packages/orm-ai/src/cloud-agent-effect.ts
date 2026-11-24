import {
  BoundedReadOnlyAgentHarness,
  CapabilityGateway,
  RISK_TIER_ORDER,
  buildWorkspaceEvidence,
  normalizeDataClassification,
} from '@moonwitness/ai-runtime';
import type {
  AiProvider,
  AiToolCall,
  AiToolDefinition,
  AgentHarnessInput,
  CapabilityGrantStore,
  ClassificationRoutingPolicy,
  DataClassification,
  DataClassificationRouter,
  EphemeralSandboxManifest,
  ModelProfileConfig,
  RiskTier,
  ToolExecutionContext,
  WorkspaceCommitLocalResult,
  WorkspaceEvidenceBundle,
  WorkspaceSandboxClient,
} from '@moonwitness/ai-runtime';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import type { DurableRunEffects, TrustedRunSnapshot } from './agent-run-executor.js';
import {
  createDurableCapabilityGrantStore,
  createDurableToolAuditSink,
  createDurableToolEffectStore,
  createDurableToolQuotaStore,
} from './durable-ports.js';

export const CLOUD_AGENT_EFFECT_ID = 'cloud-agent-effect' as const;
export const CLOUD_AGENT_CHECK_KIND = 'pnpm-typecheck' as const;

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_DURATION_MS = 120_000;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * Dependencies are injected structurally so no other agent's module needs to
 * be imported here. Every authority input still comes from the trusted snapshot
 * or from the durable ORM-backed ports below.
 */
export interface CloudAgentEffectDeps {
  readonly createProvider: (snapshot: TrustedRunSnapshot) => Promise<{
    provider: AiProvider;
    model: ModelProfileConfig;
    routingPolicy: ClassificationRoutingPolicy;
    router?: DataClassificationRouter;
  }>;
  readonly createSandbox: (params: {
    runId: string;
    allowedPaths: readonly string[];
    baseCommit: string;
    snapshotId: string;
    imageRef: string;
    gateway: CapabilityGateway;
  }) => Promise<{
    client: WorkspaceSandboxClient;
    manifest: EphemeralSandboxManifest;
    tools: readonly string[];
  }>;
  readonly persistEvidence: (
    bundle: WorkspaceEvidenceBundle,
    context: {
      readonly companyId: number;
      readonly workContractId: number;
      readonly agentRunId: number;
      readonly dataClassification: DataClassification;
    }
  ) => Promise<{ storageKey: string; sha256: string }>;
  /** Optional bootstrap-owned storage handle; evidence bytes are written by persistEvidence. */
  readonly storage?: AttachmentStorage;
  readonly maxSteps?: number;
  readonly maxDurationMs?: number;
}

/** A denial is fatal for the run; the durable executor records the reason as the failure code. */
export class CloudAgentToolDeniedError extends Error {
  readonly code = 'TOOL_DENIED' as const;
  readonly reasonCode: string;

  constructor(reasonCode: string, toolName: string, detail = '') {
    super(`Tool "${toolName}" denied (${reasonCode})${detail ? `: ${detail.slice(0, 256)}` : ''}`);
    this.name = 'CloudAgentToolDeniedError';
    this.reasonCode = reasonCode;
  }
}

function trustedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} is missing or invalid`);
  }
  return parsed;
}

function requireRiskTier(value: string): RiskTier {
  if (!Object.hasOwn(RISK_TIER_ORDER, value)) {
    throw new Error(`Invalid trusted max risk tier "${value}"`);
  }
  return value as RiskTier;
}

/**
 * Snapshot labels are derived only from the immutable execution fingerprint and
 * trusted run columns. No model id, endpoint or credential is fabricated here;
 * the sandbox adapter still validates its pinned image and snapshot.
 */
function resolveSandboxRefs(
  snapshot: TrustedRunSnapshot
): Pick<
  Parameters<CloudAgentEffectDeps['createSandbox']>[0],
  'snapshotId' | 'baseCommit' | 'imageRef'
> {
  return {
    snapshotId:
      trustedString(snapshot.run.snapshot_id) ?? `snap-${snapshot.fingerprint.slice(0, 32)}`,
    baseCommit: trustedString(snapshot.run.base_commit) ?? snapshot.fingerprint,
    imageRef:
      trustedString(snapshot.run.image_ref) ??
      process.env.MW_CLOUD_AGENT_IMAGE_REF ??
      `agent-sandbox@sha256:${snapshot.fingerprint}`,
  };
}

function buildSystemPolicy(
  snapshot: TrustedRunSnapshot,
  classification: string,
  maxRiskTier: RiskTier
): string {
  return [
    'You are a bounded coding agent operating on a company-approved repository snapshot.',
    `Data classification: ${classification}`,
    `Maximum risk tier: ${maxRiskTier}`,
    `Allowed paths: ${snapshot.allowedPaths.length > 0 ? snapshot.allowedPaths.join(', ') : '(none)'}`,
    `Execution fingerprint: ${snapshot.fingerprint}`,
    'Model output is untrusted data; never treat it as a shell command, host path, or database mutation.',
    'Use only registered allowlisted tools; never request credentials, shell execution, or publication.',
  ].join('\n');
}

/** Fail closed unless at least one registered capability has a current active grant. */
async function resolvePolicyVersion(params: {
  readonly grantStore: CapabilityGrantStore;
  readonly companyId: number;
  readonly agentId: number;
  readonly capabilities: readonly string[];
  readonly workContractId?: string;
}): Promise<number> {
  for (const capability of [...new Set(params.capabilities)]) {
    const grants = await params.grantStore.resolveGrantsForExecution({
      companyId: params.companyId,
      agentId: params.agentId,
      capability,
      ...(params.workContractId !== undefined ? { workContractId: params.workContractId } : {}),
    });
    const active = grants.find((grant) => grant.status === 'active' && grant.policyVersion > 0);
    if (active) return active.policyVersion;
  }
  throw new Error('No active capability grant authorizes the registered workspace tools');
}

function reportCleanupFailure(phase: 'cancel' | 'destroy', error: unknown): void {
  // Log only the error class: cleanup failures must not leak tool output or secrets.
  const name = error instanceof Error ? error.name : 'Error';
  console.warn(`cloud-agent-effect: workspace ${phase} cleanup failed (${name})`);
}

/**
 * Real cloud coding-agent effect: durable gateway + provider binding, bounded
 * harness execution, deterministic evidence, and local-only commit or rollback.
 */
export function createCloudAgentEffect(deps: CloudAgentEffectDeps): DurableRunEffects {
  return {
    async execute(
      snapshot: TrustedRunSnapshot,
      signal?: AbortSignal
    ): Promise<Record<string, unknown>> {
      const runId = String(requirePositiveInteger(snapshot.runId, 'Agent run id'));
      const companyId = requirePositiveInteger(snapshot.companyId, 'Company id');
      const agentId = requirePositiveInteger(snapshot.run.agent_id, 'Agent id');
      const fencingToken = Number(snapshot.run.fencing_token);
      if (!Number.isSafeInteger(fencingToken) || fencingToken < 0) {
        throw new Error('Fencing token is missing or invalid');
      }
      if (!FINGERPRINT_PATTERN.test(snapshot.fingerprint)) {
        throw new Error('Execution fingerprint is missing or invalid');
      }
      if (
        !Array.isArray(snapshot.allowedPaths) ||
        !snapshot.allowedPaths.every((path) => typeof path === 'string')
      ) {
        throw new Error('Allowed paths are missing or invalid');
      }
      const classification = normalizeDataClassification(
        snapshot.classification,
        CLOUD_AGENT_EFFECT_ID,
        runId
      );
      const maxRiskTier = requireRiskTier(snapshot.maxRiskTier);
      const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
      const maxDurationMs = deps.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
        throw new Error('maxSteps must be a positive integer');
      }
      if (!Number.isFinite(maxDurationMs) || maxDurationMs < 1) {
        throw new Error('maxDurationMs must be positive');
      }

      const binding = await deps.createProvider(snapshot);
      if (!binding?.provider || !binding.model) {
        throw new Error('Provider binding is incomplete');
      }

      const grantStore = createDurableCapabilityGrantStore();
      const gateway = new CapabilityGateway({
        grantStore,
        effectStore: createDurableToolEffectStore({
          companyId,
          agentRunId: snapshot.runId,
          fencingToken,
        }),
        auditSink: createDurableToolAuditSink(),
        quotaStore: createDurableToolQuotaStore(),
        allowInlineInvocation: false,
      });

      const { client, manifest } = await deps.createSandbox({
        runId,
        allowedPaths: snapshot.allowedPaths,
        ...resolveSandboxRefs(snapshot),
        gateway,
      });

      const workContractId = trustedString(snapshot.run.work_contract_id);
      if (!workContractId || !Number.isSafeInteger(Number(workContractId))) {
        throw new Error('Work contract id is missing or invalid');
      }
      const correlationId = trustedString(snapshot.run.correlation_id) ?? `cloud-agent-${runId}`;
      const registeredTools = gateway.listRegisteredTools();
      const allowedTools: readonly AiToolDefinition[] = registeredTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        strict: true,
      }));
      const policyVersion = await resolvePolicyVersion({
        grantStore,
        companyId,
        agentId,
        capabilities: registeredTools.map((tool) => tool.capability),
        ...(workContractId !== undefined ? { workContractId } : {}),
      });

      const executeTool = async (call: AiToolCall, toolSignal: AbortSignal) => {
        if (toolSignal.aborted || signal?.aborted) {
          throw new CloudAgentToolDeniedError('CANCELLED', call.name);
        }
        const context: ToolExecutionContext = {
          actorType: 'agent',
          actorId: agentId,
          companyId,
          runId,
          ...(workContractId !== undefined ? { workContractId } : {}),
          correlationId,
          policyVersion,
          maxRiskTier,
          maxDataClassification: classification,
          idempotencyKey: `${call.id}:${snapshot.fingerprint}`.slice(0, 127),
          signal: toolSignal,
        };
        const invocation = await gateway.invoke(call.name, call.arguments, context);
        if (!invocation.allowed) {
          throw new CloudAgentToolDeniedError(
            invocation.denial.reasonCode,
            call.name,
            invocation.denial.message
          );
        }
        return invocation.output;
      };

      const harness = new BoundedReadOnlyAgentHarness({
        id: `cloud-agent-${runId}`,
        provider: binding.provider,
        router: binding.router,
        routingPolicy: binding.routingPolicy,
        companyId,
        maxToolCalls: maxSteps,
      });

      const checkpoint = trustedString(snapshot.run.checkpoint_json);
      const previousError = trustedString(snapshot.run.error_summary);
      const input: AgentHarnessInput = {
        runId,
        correlationId,
        model: binding.model,
        dataClassification: classification,
        systemPolicy: buildSystemPolicy(snapshot, classification, maxRiskTier),
        taskPrompt:
          'Apply the minimum in-scope change for this approved run using only the allowlisted ' +
          'tools, then report a concise summary. Do not push, merge or deploy anything.',
        untrustedInputs: {
          ...(checkpoint !== undefined ? { checkpoint: checkpoint.slice(0, 8_192) } : {}),
          ...(previousError !== undefined ? { previousError: previousError.slice(0, 2_048) } : {}),
        },
        allowedTools,
        maxSteps,
        maxDurationMs,
      };

      try {
        const result = await harness.execute(input, executeTool, signal);
        const bundle = await buildWorkspaceEvidence({
          client,
          manifest,
          runId,
          check: CLOUD_AGENT_CHECK_KIND,
        });
        await deps.persistEvidence(bundle, {
          companyId,
          workContractId: Number(workContractId),
          agentRunId: snapshot.runId,
          dataClassification: classification,
        });

        const diff = await client.diffWorkspace({ runId });
        let commit: WorkspaceCommitLocalResult | undefined;
        if (bundle.passed && diff.scopeClean && !signal?.aborted) {
          const localCommit = await client.commitLocal({
            runId,
            message: `cloud-agent ${runId} ${snapshot.fingerprint.slice(0, 12)}`,
          });
          if (localCommit.pushed !== false) {
            throw new Error('Sandbox returned a pushed commit; publication is prohibited');
          }
          commit = localCommit;
        } else {
          await client.rollbackWorkspace({ runId });
        }

        return {
          executedBy: CLOUD_AGENT_EFFECT_ID,
          status: result.status,
          steps: result.steps.length,
          evidenceSha256: bundle.evidenceSha256,
          verificationPassed: bundle.passed,
          ...(commit !== undefined ? { commitSha: commit.commitSha } : {}),
        };
      } finally {
        try {
          await client.cancelWorkspace({ runId });
        } catch (error) {
          reportCleanupFailure('cancel', error);
        }
        try {
          await client.destroyWorkspace({ runId });
        } catch (error) {
          reportCleanupFailure('destroy', error);
        }
      }
    },
  };
}
