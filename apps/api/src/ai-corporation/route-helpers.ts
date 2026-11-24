import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditLog, Company, CompanyMembership } from '@moonwitness/orm-base';
import type { WorkflowRole } from '@moonwitness/orm-workflow';
import { isRecord } from '@moonwitness/types';

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
