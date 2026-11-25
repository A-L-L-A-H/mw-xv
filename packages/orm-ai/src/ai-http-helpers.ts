import { randomUUID } from 'node:crypto';
import type { AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import { validateDiffScope, type PcwCheckStatus } from '@moonwitness/ai-runtime';
import { registerJobHandler } from '@moonwitness/jobs';
import { AuditLog } from '@moonwitness/orm-base';
import type { WorkflowRole } from '@moonwitness/orm-workflow';
import { isRecord } from '@moonwitness/types';
import { runDurableAgentRun } from './agent-run-executor.js';
import { getCloudAgentEffect } from './cloud-agent-effect-factory.js';
import { ExecutionPolicy } from './models.js';
import { hasCompanyAccess } from './company-access.js';

export type { AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
export type { WorkflowRole } from '@moonwitness/orm-workflow';
export { isRecord };
export { hasCompanyAccess } from './company-access.js';

export interface AiCompanyContext {
  readonly userId: number;
  readonly companyId: number;
  readonly role: WorkflowRole;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export interface AiRunJobPayload {
  readonly agentRunId: number;
  readonly companyId: number;
}

let aiJobHandlersRegistered = false;

export function parseAiRunJobPayload(raw: unknown): AiRunJobPayload {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (
    !isRecord(value) ||
    typeof value.agentRunId !== 'number' ||
    !Number.isSafeInteger(value.agentRunId) ||
    typeof value.companyId !== 'number' ||
    !Number.isSafeInteger(value.companyId)
  ) {
    throw new Error('Invalid AI agent run job payload');
  }
  return { agentRunId: value.agentRunId, companyId: value.companyId };
}

export function ensureAiJobHandlersRegistered(): void {
  if (aiJobHandlersRegistered) return;
  for (const handlerName of ['ai.agent_run.execute', 'ai.agent_run.inspect']) {
    try {
      registerJobHandler<AiRunJobPayload>({
        name: handlerName,
        version: 1,
        parse: parseAiRunJobPayload,
        async run(payload, context) {
          if (context.companyId !== undefined && context.companyId !== payload.companyId) {
            throw new Error('Cross-company agent run dispatch rejected');
          }
          // A hosting app (API/worker bootstrap) installs the fully composed
          // effect via setCloudAgentEffect(). Without it there is no safe way
          // to execute a run: fail closed so the run is marked failed with no
          // evidence rather than silently completing.
          const effect = getCloudAgentEffect();
          if (!effect) {
            throw new Error('Cloud coding-agent effect is not configured');
          }
          const { isInteractiveRunBlocked } = await import('./interactive-sessions.js');
          if (await isInteractiveRunBlocked(payload.agentRunId, payload.companyId)) {
            return { status: 'replayed', agentRunId: payload.agentRunId };
          }
          try {
            return await runDurableAgentRun(payload, context, effect);
          } finally {
            const { InteractiveSession } = await import('./models/interactive-sessions.js');
            const { reconcileInteractiveSession } = await import('./interactive-sessions.js');
            const session = await InteractiveSession.query().findOne({
              company_id: payload.companyId,
              agent_run_id: payload.agentRunId,
            });
            if (session) await reconcileInteractiveSession(session.id, payload.companyId);
          }
        },
      });
    } catch {
      // Handler was already registered in this process.
    }
  }
  aiJobHandlersRegistered = true;
}

export async function requireAiCompanyContext(
  req: AddonHttpRequestBase,
  reply: AddonHttpReply
): Promise<AiCompanyContext | null> {
  reply.header?.('Cache-Control', 'private, no-store');
  const auth = req.auth;
  if (!auth) {
    reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  if (!auth.companyId) {
    reply.code(403).send({ success: false, error: 'Active company context required' });
    return null;
  }
  const role: WorkflowRole =
    auth.role === 'superadmin' || auth.role === 'system' ? auth.role : 'user';
  const allowed = await hasCompanyAccess(auth.userId, auth.companyId, role);
  if (!allowed) {
    reply.code(403).send({ success: false, error: 'Company access denied' });
    return null;
  }

  const queryRecord = isRecord(req.query) ? req.query : null;
  if (queryRecord && queryRecord.company_id !== undefined) {
    const requestedCompanyId = Number(queryRecord.company_id);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      reply.code(403).send({ success: false, error: 'Cross-company query access denied' });
      return null;
    }
  }
  if (queryRecord && queryRecord.companyId !== undefined) {
    const requestedCompanyId = Number(queryRecord.companyId);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      reply.code(403).send({ success: false, error: 'Cross-company query access denied' });
      return null;
    }
  }
  const bodyRecord = isRecord(req.body) ? req.body : null;
  if (bodyRecord && bodyRecord.company_id !== undefined) {
    const requestedCompanyId = Number(bodyRecord.company_id);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      reply.code(403).send({ success: false, error: 'Cross-company mutation access denied' });
      return null;
    }
  }
  if (bodyRecord && bodyRecord.companyId !== undefined) {
    const requestedCompanyId = Number(bodyRecord.companyId);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      reply.code(403).send({ success: false, error: 'Cross-company mutation access denied' });
      return null;
    }
  }

  return { userId: auth.userId, companyId: auth.companyId, role };
}

export async function recordAiAudit(
  userId: number,
  model: string,
  recordId: number,
  operation: string,
  changes: Record<string, unknown>
): Promise<void> {
  await AuditLog.query().insert({
    model,
    record_id: recordId,
    operation,
    actor_id: userId,
    changes: JSON.stringify(changes),
  });
}

export function normalizeSlugCode(raw: unknown, fallbackPrefix: string): string {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/gu, '_')
      .replace(/^[^a-z]+/u, 'a');
    if (cleaned.length >= 2) return cleaned.slice(0, 120);
  }
  return `${fallbackPrefix}_${randomUUID().slice(0, 8)}`;
}

export async function ensureDefaultExecutionPolicy(companyId: number) {
  const existing = await ExecutionPolicy.query()
    .where({ company_id: companyId, active: true })
    .orderBy('id', 'asc')
    .first();
  if (existing) return existing;
  return ExecutionPolicy.query().insertAndFetch({
    company_id: companyId,
    code: 'default_r0_policy',
    policy_version: 1,
    name: 'Default R0 Read-Only Policy',
    default_risk_tier: 'R0',
    max_risk_tier: 'R2',
    allowed_classification: 'local_only',
    allow_cloud_fallback: false,
    require_independent_review: true,
    require_human_signoff: false,
    max_steps: 8,
    max_wall_clock_seconds: 120,
    max_tokens_per_run: 32000,
    max_cost_micros_per_run: 100000,
    max_delegation_depth: 2,
    max_concurrent_runs: 2,
    enabled: true,
  });
}

const VALID_PCW_CHECK_STATUSES = new Set<PcwCheckStatus>([
  'pass',
  'fail',
  'skipped',
  'not_applicable',
  'not_run',
]);

export function parseContractScopePaths(scopeJson: string | null | undefined): {
  readonly allowedPaths: string[];
  readonly forbiddenPaths: string[];
} {
  if (typeof scopeJson !== 'string' || !scopeJson.trim()) {
    return { allowedPaths: [], forbiddenPaths: [] };
  }
  try {
    const parsed: unknown = JSON.parse(scopeJson);
    if (!isRecord(parsed)) {
      return { allowedPaths: [], forbiddenPaths: [] };
    }
    const allowedPaths = toStringArray(parsed.allowedPaths ?? parsed.allowed_paths ?? parsed.paths);
    const forbiddenPaths = toStringArray(parsed.forbiddenPaths ?? parsed.forbidden_paths);
    return { allowedPaths, forbiddenPaths };
  } catch {
    return { allowedPaths: [], forbiddenPaths: [] };
  }
}

export interface ProofGateEvaluationError {
  readonly statusCode: number;
  readonly code: string;
  readonly error: string;
  readonly details?: Record<string, unknown>;
}

export function evaluateProofGateV2(
  body: Record<string, unknown>,
  contractScopeJson: string | null | undefined,
  actionLabel: 'acceptance' | 'sync' = 'acceptance'
): ProofGateEvaluationError | null {
  const proofSource = isRecord(body.proof)
    ? body.proof
    : isRecord(body.proofGate)
      ? body.proofGate
      : body;

  const rawChecks = proofSource.checks ?? body.checks;
  if (rawChecks !== undefined) {
    if (!Array.isArray(rawChecks)) {
      return {
        statusCode: 422,
        code: 'INVALID_CHECK_MATRIX',
        error: 'Proof Gate v2 checks must be an array',
      };
    }
    const failedChecks: string[] = [];
    for (const [idx, item] of rawChecks.entries()) {
      if (!isRecord(item)) {
        return {
          statusCode: 422,
          code: 'INVALID_CHECK_MATRIX',
          error: `Proof Gate v2 check at index ${idx} must be an object`,
        };
      }
      const code =
        typeof item.code === 'string' && item.code.trim() ? item.code.trim() : `check_${idx + 1}`;
      const status = item.status;
      if (typeof status !== 'string' || !VALID_PCW_CHECK_STATUSES.has(status as PcwCheckStatus)) {
        return {
          statusCode: 422,
          code: 'INVALID_CHECK_STATUS',
          error: `Proof Gate v2 check '${code}' has invalid status '${String(status)}'`,
          details: { checkCode: code },
        };
      }
      if (status === 'skipped') {
        const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
        if (!reason) {
          return {
            statusCode: 422,
            code: 'MISSING_SKIP_REASON',
            error: `Skipped check '${code}' requires a non-empty reason`,
            details: { checkCode: code },
          };
        }
      }
      const mandatory = item.mandatory !== false;
      if (status === 'fail') {
        failedChecks.push(code);
      } else if (mandatory && status !== 'pass') {
        return {
          statusCode: 422,
          code: 'MANDATORY_CHECK_NOT_PASSED',
          error: `Mandatory check '${code}' has status '${status}' and must pass before ${actionLabel}`,
          details: { checkCode: code, status },
        };
      }
    }
    if (failedChecks.length > 0) {
      return {
        statusCode: 422,
        code: 'PROOF_CHECK_FAILED',
        error: `Proof Gate v2 rejected failed check(s): ${failedChecks.join(', ')}`,
        details: { failedChecks },
      };
    }
  }

  const explicitOutOfScope = toStringArray(
    proofSource.out_of_scope_files ??
      proofSource.outOfScopeFiles ??
      body.out_of_scope_files ??
      body.outOfScopeFiles
  );
  if (explicitOutOfScope.length > 0) {
    return {
      statusCode: 422,
      code: 'OUT_OF_SCOPE_DIFF_DETECTED',
      error: `Proof Gate v2 detected out-of-scope file modifications: ${explicitOutOfScope.join(', ')}`,
      details: { outOfScopeFiles: explicitOutOfScope },
    };
  }

  const changedFiles = toStringArray(
    proofSource.changed_files ?? proofSource.changedFiles ?? body.changed_files ?? body.changedFiles
  );
  if (changedFiles.length > 0) {
    const contractScope = parseContractScopePaths(contractScopeJson);
    const bodyAllowed = toStringArray(
      proofSource.allowed_paths ??
        proofSource.allowedPaths ??
        body.allowed_paths ??
        body.allowedPaths
    );
    const bodyForbidden = toStringArray(
      proofSource.forbidden_paths ??
        proofSource.forbiddenPaths ??
        body.forbidden_paths ??
        body.forbiddenPaths
    );
    const allowedPaths = bodyAllowed.length > 0 ? bodyAllowed : contractScope.allowedPaths;
    const forbiddenPaths = bodyForbidden.length > 0 ? bodyForbidden : contractScope.forbiddenPaths;

    const diffScope = validateDiffScope(
      changedFiles,
      allowedPaths.length > 0 ? allowedPaths : ['.'],
      forbiddenPaths
    );
    if (!diffScope.scopeClean) {
      return {
        statusCode: 422,
        code: 'OUT_OF_SCOPE_DIFF_DETECTED',
        error: 'Proof Gate v2 rejected out-of-scope or unsafe file modifications',
        details: {
          outOfScopeFiles: diffScope.outOfScopeFiles,
          unsafePaths: diffScope.unsafePaths,
        },
      };
    }
  }

  return null;
}
