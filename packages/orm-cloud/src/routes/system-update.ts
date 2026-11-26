import { controlPlaneAuthHeaders, redactSecrets } from '../auth.js';
import { readBoundedResponseBody } from '../probe.js';
import {
  CLOUD_READ_RATE_LIMIT,
  CLOUD_WRITE_RATE_LIMIT,
  safeCloudErrorText,
  type CloudRouteContext,
} from './context.js';

export function registerSystemUpdateRoutes(routeCtx: CloudRouteContext): void {
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

  fastify.get<{ Querystring: { force?: string } }>(
    '/api/cloud/system/update',
    CLOUD_READ_RATE_LIMIT,
    async (req, reply) => {
      const rule = ruleFor('/api/cloud/system/update');
      const authCtx = requireAuthorizedModelAccess(req, reply, rule);
      if (!authCtx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      const force = req.query?.force === 'true' || req.query?.force === '1';
      try {
        const cpResponse = await controlPlaneFetch(
          `${defaultAgentUrl}/paas/system/update${force ? '?force=true' : ''}`,
          { headers: controlPlaneAuthHeaders(resolvedToken) }
        );
        const bounded = await readBoundedResponseBody(cpResponse, 64 * 1024);
        const bodyText = bounded.ok ? bounded.text : '';
        if (!cpResponse.ok) {
          mark(rule.operation, 'failed', 'docker_agent');
          return reply
            .code(cpResponse.status >= 400 && cpResponse.status < 600 ? cpResponse.status : 502)
            .send({
              success: false,
              error: redactSecrets(bodyText || `Control plane returned ${cpResponse.status}`, [
                resolvedToken,
              ]),
            });
        }
        const updatePayload = JSON.parse(bodyText || '{}') as Record<string, unknown>;
        mark(rule.operation, 'success', 'docker_agent');
        return { success: true, data: updatePayload };
      } catch (error) {
        mark(rule.operation, 'failed', 'docker_agent');
        return reply.code(502).send({
          success: false,
          error: safeCloudErrorText(error, [resolvedToken], 'Unable to check system updates'),
        });
      }
    }
  );

  fastify.post<{ Body: { version?: string } }>(
    '/api/cloud/system/update/apply',
    CLOUD_WRITE_RATE_LIMIT,
    async (req, reply) => {
      const rule = ruleFor('/api/cloud/system/update/apply');
      const authCtx = requireAuthorizedModelAccess(req, reply, rule);
      if (!authCtx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      const version = typeof req.body?.version === 'string' ? req.body.version.trim() : undefined;
      try {
        const cpResponse = await controlPlaneFetch(`${defaultAgentUrl}/paas/system/update/apply`, {
          method: 'POST',
          headers: controlPlaneAuthHeaders(resolvedToken, {
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(version ? { version } : {}),
        });
        const bounded = await readBoundedResponseBody(cpResponse, 64 * 1024);
        const bodyText = bounded.ok ? bounded.text : '';
        let parsedPayload: Record<string, unknown> = {};
        try {
          parsedPayload = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
        } catch {
          parsedPayload = { raw: redactSecrets(bodyText, [resolvedToken]) };
        }
        if (!cpResponse.ok) {
          mark(rule.operation, cpResponse.status === 409 ? 'conflict' : 'failed', 'docker_agent');
          return reply
            .code(cpResponse.status >= 400 && cpResponse.status < 600 ? cpResponse.status : 502)
            .send({
              success: false,
              error: redactSecrets(
                String(parsedPayload.error ?? `Update apply failed (${cpResponse.status})`),
                [resolvedToken]
              ),
              data: parsedPayload.status ?? parsedPayload,
            });
        }
        mark(rule.operation, 'success', 'docker_agent');
        return reply.code(cpResponse.status).send({ success: true, data: parsedPayload });
      } catch (error) {
        mark(rule.operation, 'failed', 'docker_agent');
        return reply.code(502).send({
          success: false,
          error: safeCloudErrorText(error, [resolvedToken], 'Unable to start system update'),
        });
      }
    }
  );
}
