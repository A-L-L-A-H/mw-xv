import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { registerJobHandler } from '@moonwitness/jobs';
import { runDurableAgentRun } from '@moonwitness/orm-ai';
import { AuditLog, Company, CompanyMembership } from '@moonwitness/orm-base';
import type { WorkflowRole } from '@moonwitness/orm-workflow';
import { isRecord } from '@moonwitness/types';

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
          return runDurableAgentRun(payload, context, {
            async execute() {
              return { executedBy: 'api-durable-executor', handlerName };
            },
          });
        },
      });
    } catch {
      // Handler was already registered in this process.
    }
  }
  aiJobHandlersRegistered = true;
}

export async function hasCompanyAccess(
  userId: number,
  companyId: number,
  role: string
): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId < 1) return false;
  if (!Number.isSafeInteger(companyId) || companyId < 1) return false;
  const company = await Company.query().findOne({ id: companyId, active: true });
  if (!company) return false;
  const membership = await CompanyMembership.query().findOne({
    user_id: userId,
    company_id: companyId,
    active: true,
  });
  if (membership) return true;
  if (role === 'system') return true;
  return false;
}

export async function requireAiCompanyContext(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<{ userId: number; companyId: number; role: WorkflowRole } | null> {
  reply.header('Cache-Control', 'private, no-store');
  const auth = req.auth;
  if (!auth) {
    await reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  if (!auth.companyId) {
    await reply.code(403).send({ success: false, error: 'Active company context required' });
    return null;
  }
  const role: WorkflowRole =
    auth.role === 'superadmin' || auth.role === 'system' ? auth.role : 'user';
  const allowed = await hasCompanyAccess(auth.userId, auth.companyId, role);
  if (!allowed) {
    await reply.code(403).send({ success: false, error: 'Company access denied' });
    return null;
  }

  const queryRecord = isRecord(req.query) ? req.query : null;
  if (queryRecord && queryRecord.company_id !== undefined) {
    const requestedCompanyId = Number(queryRecord.company_id);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      await reply.code(403).send({ success: false, error: 'Cross-company query access denied' });
      return null;
    }
  }
  if (queryRecord && queryRecord.companyId !== undefined) {
    const requestedCompanyId = Number(queryRecord.companyId);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      await reply.code(403).send({ success: false, error: 'Cross-company query access denied' });
      return null;
    }
  }
  const bodyRecord = isRecord(req.body) ? req.body : null;
  if (bodyRecord && bodyRecord.company_id !== undefined) {
    const requestedCompanyId = Number(bodyRecord.company_id);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      await reply.code(403).send({ success: false, error: 'Cross-company mutation access denied' });
      return null;
    }
  }
  if (bodyRecord && bodyRecord.companyId !== undefined) {
    const requestedCompanyId = Number(bodyRecord.companyId);
    if (!Number.isSafeInteger(requestedCompanyId) || requestedCompanyId !== auth.companyId) {
      await reply.code(403).send({ success: false, error: 'Cross-company mutation access denied' });
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
