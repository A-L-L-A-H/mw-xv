import type {
  AgentRunCheckpoint,
  AgentRunStateStore,
  CapabilityGrantRecord,
  CapabilityGrantScope,
  CapabilityGrantStore,
  CommittedAgentRunRecord,
  LeaseVerificationResult,
  PolicyAuditEntry,
  ToolAuditSink,
  ToolEffectAcknowledgement,
  ToolEffectStore,
  ToolQuotaStore,
} from '@moonwitness/ai-runtime';
import { AuditLog } from '@moonwitness/orm-base';
import { acknowledgeToolEffect } from './agent-run-executor.js';
import { AgentRun, AgentRunEffect } from './models/runs.js';
import { CapabilityGrant, ExecutionPolicy } from './models.js';

/**
 * Durable implementations of the ai-runtime ports.
 *
 * These adapt existing ORM tables instead of introducing a second state store:
 * - tool effect acknowledgements -> ai.agent_run_effect (caller-owned effect_key)
 * - harness checkpoints / committed runs -> ai.agent_run_effect under the
 *   reserved `harness:checkpoint:` and `harness:commit:` key prefixes
 * - capability grants / policy versions -> ai.capability_grant, ai.execution_policy
 * - audit trail and per-run quota -> append-only base.audit_log
 * - run lease -> ai.agent_run (fencing token + status)
 *
 * No raw credential is ever persisted here: only reference names, digests and
 * tool metadata cross this boundary.
 */

/** Reserved effect_key prefixes for harness state (never used for tool effects). */
const HARNESS_CHECKPOINT_PREFIX = 'harness:checkpoint:';
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const HARNESS_COMMIT_PREFIX = 'harness:commit:';
export const TOOL_AUDIT_MODEL = 'ai.tool_invocation';

function parseIntegerId(value: string | number | undefined | null): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fail closed to an empty scope: the gateway will deny on a scope mismatch.
  }
  return {};
}

function parseGrantScope(raw: string | null | undefined): CapabilityGrantScope {
  const parsed = parseJsonObject(raw);
  return {
    ...(Array.isArray(parsed.allowedPaths)
      ? { allowedPaths: parsed.allowedPaths.filter((p): p is string => typeof p === 'string') }
      : {}),
    ...(Array.isArray(parsed.allowedWorkContractIds)
      ? {
          allowedWorkContractIds: parsed.allowedWorkContractIds.filter(
            (p): p is string => typeof p === 'string'
          ),
        }
      : {}),
    ...(Array.isArray(parsed.allowedResources)
      ? {
          allowedResources: parsed.allowedResources.filter(
            (p): p is string => typeof p === 'string'
          ),
        }
      : {}),
    ...(typeof parsed.allowWrite === 'boolean' ? { allowWrite: parsed.allowWrite } : {}),
  };
}

function readEffectOutput(outputJson: string | null | undefined): unknown {
  if (!outputJson) return null;
  try {
    return JSON.parse(outputJson) as unknown;
  } catch {
    return null;
  }
}

export interface DurableRunScope {
  readonly companyId: number;
  readonly agentRunId: number;
  readonly fencingToken: number;
}

/** Durable idempotency ledger backed by ai.agent_run_effect. */
export function createDurableToolEffectStore(scope: DurableRunScope): ToolEffectStore {
  return {
    async find(key: string): Promise<ToolEffectAcknowledgement | null> {
      const row = await AgentRunEffect.query().findOne({
        company_id: scope.companyId,
        agent_run_id: scope.agentRunId,
        effect_key: key,
      });
      if (!row) return null;
      return {
        key,
        argsDigest: row.args_sha256,
        output: readEffectOutput(row.output_json) as ToolEffectAcknowledgement['output'],
        auditRef: row.fencing_token ? `${scope.agentRunId}:${row.fencing_token}` : key,
      };
    },
    async acknowledge(record: ToolEffectAcknowledgement): Promise<void> {
      await acknowledgeToolEffect({
        companyId: scope.companyId,
        agentRunId: scope.agentRunId,
        effectKey: record.key,
        argsDigest: record.argsDigest,
        output: record.output,
        fencingToken: scope.fencingToken,
      });
    },
  };
}

/** Durable capability grant lookup. Returns no grants when the policy version is stale. */
export function createDurableCapabilityGrantStore(): CapabilityGrantStore {
  return {
    async resolveGrantsForExecution(params: {
      readonly companyId: number;
      readonly agentId: number | string;
      readonly capability: string;
      readonly workContractId?: string;
    }): Promise<readonly CapabilityGrantRecord[]> {
      const query = CapabilityGrant.query().where({
        company_id: params.companyId,
        agent_id: parseIntegerId(params.agentId),
        capability: params.capability,
        status: 'active',
      });
      if (params.workContractId !== undefined) {
        query.andWhere('work_contract_id', parseIntegerId(params.workContractId));
      }
      const rows = await query;
      return rows.map((row): CapabilityGrantRecord => {
        const workContractId = parseIntegerId(row.work_contract_id);
        return {
          grantId: String(row.id),
          companyId: row.company_id,
          agentId: row.agent_id,
          ...(workContractId > 0 ? { workContractId: String(workContractId) } : {}),
          capability: row.capability,
          scope: parseGrantScope(row.scope_json),
          policyVersion: row.policy_version,
          maxCallsPerRun: row.max_calls_per_run,
          issuedBy: parseIntegerId(row.issued_by as string | number | undefined),
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
          status: row.status,
          ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
          ...(row.revocation_reason ? { revocationReason: row.revocation_reason } : {}),
          ...(row.audit_ref ? { auditRef: row.audit_ref } : {}),
        };
      });
    },
    async getCurrentPolicyVersion(companyId: number): Promise<number> {
      const policy = await ExecutionPolicy.query()
        .where({ company_id: companyId, enabled: true })
        .orderBy('policy_version', 'desc')
        .first();
      // Fail closed: without an active policy every grant is treated as stale.
      return policy?.policy_version ?? 0;
    },
  };
}

/** Append-only audit trail in base.audit_log. */
export function createDurableToolAuditSink(): ToolAuditSink {
  return {
    async record(entry: PolicyAuditEntry): Promise<void> {
      await AuditLog.query().insert({
        model: TOOL_AUDIT_MODEL,
        record_id: parseIntegerId(entry.runId),
        operation: entry.allowed ? 'tool.invoke' : 'tool.denied',
        actor_id: parseIntegerId(entry.actorId),
        changes: JSON.stringify({
          auditRef: entry.auditRef,
          timestamp: entry.timestamp,
          allowed: entry.allowed,
          companyId: entry.companyId,
          actorType: entry.actorType,
          actorId: entry.actorId,
          runId: entry.runId,
          correlationId: entry.correlationId,
          toolName: entry.toolName,
          capability: entry.capability,
          riskTier: entry.riskTier,
          grantId: entry.grantId,
          policyVersion: entry.policyVersion,
          reasonCode: entry.reasonCode,
          idempotentReplay: entry.idempotentReplay,
        }),
      });
    },
  };
}

/** Per-run quota derived from the durable tool audit trail. */
export function createDurableToolQuotaStore(): ToolQuotaStore {
  return {
    async getRunUsage(runId: string, grantId: string): Promise<number> {
      const rows = await AuditLog.query().where({
        model: TOOL_AUDIT_MODEL,
        record_id: parseIntegerId(runId),
        operation: 'tool.invoke',
      });
      return rows.filter((row) => parseJsonObject(row.changes).grantId === grantId).length;
    },
    async incrementRunUsage(runId: string, grantId: string): Promise<number> {
      // The audit sink appends the durable row after a successful invocation.
      // Return the projected count for callers that inspect it; the next read
      // is backed by the shared audit table so multiple workers agree.
      return (await this.getRunUsage(runId, grantId)) + 1;
    },
  };
}

function harnessKey(scope: DurableRunScope, suffix: string): string {
  return `${HARNESS_CHECKPOINT_PREFIX}${scope.companyId}:${scope.agentRunId}:${suffix}`;
}

function commitKey(companyId: number, idempotencyKey: string): string {
  return `${HARNESS_COMMIT_PREFIX}${companyId}:${idempotencyKey}`;
}

/**
 * Durable harness checkpoints and committed run results in the same effect
 * ledger. Suitable for use as `BoundedReadOnlyAgentHarness.stateStore`.
 */
export function createDurableAgentRunStateStore(scope: DurableRunScope): AgentRunStateStore {
  const readRecord = async <T>(key: string): Promise<T | null> => {
    const row = await AgentRunEffect.query().findOne({
      company_id: scope.companyId,
      agent_run_id: scope.agentRunId,
      effect_key: key,
    });
    return row ? (readEffectOutput(row.output_json) as T) : null;
  };
  const writeRecord = async (key: string, digest: string, value: unknown): Promise<void> => {
    await acknowledgeToolEffect({
      companyId: scope.companyId,
      agentRunId: scope.agentRunId,
      effectKey: key,
      argsDigest: digest,
      output: value,
      fencingToken: scope.fencingToken,
    });
  };

  return {
    async verifyLease(runId: string, fencingToken: number): Promise<LeaseVerificationResult> {
      const run = await AgentRun.query().findById(scope.agentRunId);
      if (!run) return { valid: false, reason: 'not_found' };
      if (run.company_id !== scope.companyId) {
        return { valid: false, reason: 'not_found' };
      }
      if (TERMINAL_RUN_STATUSES.has(String(run.status))) {
        return {
          valid: false,
          reason: String(run.status) === 'cancelled' ? 'cancelled' : 'stale_fencing_token',
          currentFencingToken: run.fencing_token,
        };
      }
      if (run.status !== 'running' || run.fencing_token !== fencingToken) {
        return {
          valid: false,
          reason: 'stale_fencing_token',
          currentFencingToken: run.fencing_token,
        };
      }
      return { valid: true, fencingToken: run.fencing_token };
    },
    async loadCheckpoint(runId: string): Promise<AgentRunCheckpoint | null> {
      return readRecord<AgentRunCheckpoint>(harnessKey(scope, runId));
    },
    async saveCheckpoint(checkpoint: AgentRunCheckpoint): Promise<void> {
      await writeRecord(
        harnessKey(scope, checkpoint.runId),
        checkpoint.checkpointSha256,
        checkpoint
      );
    },
    async getCommittedByIdempotencyKey(
      companyId: number,
      idempotencyKey: string
    ): Promise<CommittedAgentRunRecord | null> {
      return readRecord<CommittedAgentRunRecord>(commitKey(companyId, idempotencyKey));
    },
    async commitRunResult(record: CommittedAgentRunRecord): Promise<CommittedAgentRunRecord> {
      await writeRecord(
        commitKey(record.companyId, record.idempotencyKey),
        record.artifactSha256,
        record
      );
      return record;
    },
  };
}
