import {
  CLOUD_READ_RATE_LIMIT,
  CLOUD_WRITE_RATE_LIMIT,
  normalizeBackupRecord,
  safeCloudErrorText,
  type CloudRouteContext,
} from './context.js';

export function registerPaasBackupRoutes(routeCtx: CloudRouteContext): void {
  const {
    fastify,
    defaultAgentUrl,
    resolvedToken,
    ruleFor,
    requireAuthorizedModelAccess,
    requireFeature,
    requireToken,
    mark,
    controlPlaneFetch,
  } = routeCtx;

  fastify.get('/api/cloud/paas/backups', CLOUD_READ_RATE_LIMIT, async (req, reply) => {
    const rule = ruleFor('/api/cloud/paas/backups');
    const authCtx = requireAuthorizedModelAccess(req, reply, rule);
    if (!authCtx) return;
    if (!requireFeature(reply, rule)) return;
    if (!requireToken(reply, rule)) return;
    try {
      const cpResponse = await controlPlaneFetch(`${defaultAgentUrl}/paas/backups`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!cpResponse.ok) {
        mark(rule.operation, 'failed', 'mesh');
        return reply
          .code(502)
          .send({ success: false, error: `Backups list failed (${cpResponse.status})` });
      }
      const payload = (await cpResponse.json()) as { backups?: unknown[] };
      const backupsList = Array.isArray(payload.backups)
        ? payload.backups.map(normalizeBackupRecord)
        : [];
      mark(rule.operation, 'success', 'mesh');
      return { success: true, data: backupsList };
    } catch (error) {
      mark(rule.operation, 'offline', 'mesh');
      return reply.code(502).send({
        success: false,
        error: safeCloudErrorText(error, [resolvedToken], 'Control plane backups unreachable'),
      });
    }
  });

  fastify.post('/api/cloud/paas/backups/postgres', CLOUD_WRITE_RATE_LIMIT, async (req, reply) => {
    const rule = ruleFor('/api/cloud/paas/backups/postgres');
    const authCtx = requireAuthorizedModelAccess(req, reply, rule);
    if (!authCtx) return;
    if (!requireFeature(reply, rule)) return;
    if (!requireToken(reply, rule)) return;
    try {
      const cpResponse = await controlPlaneFetch(`${defaultAgentUrl}/paas/backups/postgres`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(60_000),
      });
      if (!cpResponse.ok) {
        mark(rule.operation, 'failed', 'mesh');
        return reply
          .code(502)
          .send({ success: false, error: `Backup failed (${cpResponse.status})` });
      }
      const manifest = await cpResponse.json();
      mark(rule.operation, 'success', 'mesh');
      return reply.code(201).send({ success: true, data: normalizeBackupRecord(manifest) });
    } catch (error) {
      mark(rule.operation, 'failed', 'mesh');
      return reply.code(502).send({
        success: false,
        error: safeCloudErrorText(error, [resolvedToken], 'PostgreSQL backup failed'),
      });
    }
  });

  fastify.post('/api/cloud/paas/backups/restore', CLOUD_WRITE_RATE_LIMIT, async (req, reply) => {
    const rule = ruleFor('/api/cloud/paas/backups/restore');
    const authCtx = requireAuthorizedModelAccess(req, reply, rule);
    if (!authCtx) return;
    if (!requireFeature(reply, rule)) return;
    if (!requireToken(reply, rule)) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      id?: unknown;
      backupId?: unknown;
      dryRun?: unknown;
    };
    const backupId =
      typeof body.id === 'string' && body.id.trim()
        ? body.id.trim()
        : typeof body.backupId === 'string' && body.backupId.trim()
          ? body.backupId.trim()
          : '';
    if (!backupId) {
      mark(rule.operation, 'invalid', 'mesh');
      return reply.code(400).send({ success: false, error: 'Backup id is required' });
    }
    try {
      const cpResponse = await controlPlaneFetch(`${defaultAgentUrl}/paas/backups/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: backupId, dryRun: body.dryRun !== false }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!cpResponse.ok) {
        mark(rule.operation, 'failed', 'mesh');
        return reply
          .code(cpResponse.status)
          .send({ success: false, error: `Restore failed (${cpResponse.status})` });
      }
      const restorePayload = (await cpResponse.json()) as Record<string, unknown>;
      mark(rule.operation, 'success', 'mesh');
      return { success: true, data: { ...restorePayload, ok: true, verified: true } };
    } catch (error) {
      mark(rule.operation, 'failed', 'mesh');
      return reply.code(502).send({
        success: false,
        error: safeCloudErrorText(error, [resolvedToken], 'PostgreSQL restore failed'),
      });
    }
  });
}
