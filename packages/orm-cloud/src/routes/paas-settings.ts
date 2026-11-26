import { CloudApp } from '../models/index.js';
import {
  buildDeclarativeCaddySpec,
  isValidPublicDomain,
  promotePreviewAppsToWildcard,
  readPaasInstanceSettings,
  reconcileCaddyWithAgent,
  savePaasInstanceSettings,
} from '../paas-state.js';
import {
  fetchAgentMeshStatus,
  listAgentContainers,
  verifyAgentDns,
} from '../providers/moonwitness-mesh.js';
import {
  CLOUD_READ_RATE_LIMIT,
  CLOUD_WRITE_RATE_LIMIT,
  safeCloudErrorText,
  type CloudRouteContext,
} from './context.js';

export function registerPaasSettingsAndMeshRoutes(routeCtx: CloudRouteContext): void {
  const {
    fastify,
    defaultAgentUrl,
    resolvedToken,
    fetchImpl,
    ruleFor,
    requireAuthorizedModelAccess,
    requireFeature,
    requireToken,
    mark,
    controlPlaneFetch,
  } = routeCtx;

  fastify.get('/api/cloud/paas/settings', CLOUD_READ_RATE_LIMIT, async (req, reply) => {
    const rule = ruleFor('/api/cloud/paas/settings');
    const authCtx = requireAuthorizedModelAccess(req, reply, rule);
    if (!authCtx) return;
    if (!requireFeature(reply, rule)) return;
    if (!requireToken(reply, rule)) return;

    try {
      const settings = await readPaasInstanceSettings();
      const caddySpec = await buildDeclarativeCaddySpec();
      mark(rule.operation, 'success');
      return {
        success: true,
        data: {
          ...settings,
          routes: caddySpec.routes,
          previewListeners: caddySpec.previewListeners,
          hasPreviewApps: caddySpec.previewListeners.length > 0,
        },
      };
    } catch (error) {
      mark(rule.operation, 'failed', 'mesh');
      return reply.code(502).send({
        success: false,
        error: safeCloudErrorText(error, [resolvedToken], 'PaaS settings read failed'),
      });
    }
  });

  fastify.post<{
    Body: {
      instanceDomain?: string;
      wildcardDomain?: string;
      whatsappDomain?: string;
      expectedIpv4?: string;
      checkHttps?: boolean;
    };
  }>('/api/cloud/paas/settings/verify-dns', CLOUD_WRITE_RATE_LIMIT, async (req, reply) => {
    const rule = ruleFor('/api/cloud/paas/settings/verify-dns');
    const authCtx = requireAuthorizedModelAccess(req, reply, rule);
    if (!authCtx) return;
    if (!requireFeature(reply, rule)) return;
    if (!requireToken(reply, rule)) return;

    const { instanceDomain, wildcardDomain, whatsappDomain, expectedIpv4, checkHttps } = req.body;
    try {
      const verification = await verifyAgentDns({
        endpoint: defaultAgentUrl,
        fetchImpl,
        ...(instanceDomain !== undefined ? { instanceDomain } : {}),
        ...(wildcardDomain !== undefined ? { wildcardDomain } : {}),
        ...(whatsappDomain !== undefined ? { whatsappDomain } : {}),
        ...(expectedIpv4 !== undefined ? { expectedIpv4 } : {}),
        ...(checkHttps !== undefined ? { checkHttps } : {}),
      });
      mark(rule.operation, 'success');
      return { success: true, data: verification };
    } catch (error) {
      mark(rule.operation, 'failed', 'mesh');
      return reply.code(502).send({
        success: false,
        error: safeCloudErrorText(error, [resolvedToken], 'DNS verification failed'),
      });
    }
  });

  fastify.post<{
    Body: {
      instanceDomain?: string;
      wildcardDomain?: string;
      whatsappDomain?: string;
      publicPort?: number;
      publicPortEnabled?: boolean;
      publicIpv4?: string;
    };
  }>('/api/cloud/paas/settings/apply', CLOUD_WRITE_RATE_LIMIT, async (req, reply) => {
    const rule = ruleFor('/api/cloud/paas/settings/apply');
    const authCtx = requireAuthorizedModelAccess(req, reply, rule);
    if (!authCtx) return;
    if (!requireFeature(reply, rule)) return;
    if (!requireToken(reply, rule)) return;

    const {
      instanceDomain,
      wildcardDomain,
      whatsappDomain,
      publicPort,
      publicPortEnabled,
      publicIpv4,
    } = req.body;

    if (publicPortEnabled !== undefined && typeof publicPortEnabled !== 'boolean') {
      mark(rule.operation, 'invalid');
      return reply.code(400).send({ success: false, error: 'publicPortEnabled must be a boolean' });
    }
    if (
      publicPort !== undefined &&
      (!Number.isSafeInteger(publicPort) || publicPort < 1 || publicPort > 65535)
    ) {
      mark(rule.operation, 'invalid');
      return reply
        .code(400)
        .send({ success: false, error: 'publicPort must be an integer between 1 and 65535' });
    }
    const nextPublicPortEnabled = publicPortEnabled ?? true;

    const dnsCheck = await verifyAgentDns({
      endpoint: defaultAgentUrl,
      fetchImpl,
      instanceDomain,
      checkHttps: true,
    });
    const httpsReady = dnsCheck.httpsReady as
      { reachable?: boolean; tlsVerified?: boolean } | undefined;

    if (nextPublicPortEnabled === false && (!httpsReady?.reachable || !httpsReady?.tlsVerified)) {
      mark(rule.operation, 'denied');
      return reply.code(400).send({
        success: false,
        error:
          'Refusing to disable the public port: HTTPS /readyz is not reachable or TLS verification failed on the instance domain',
      });
    }

    try {
      await savePaasInstanceSettings({
        instanceDomain,
        wildcardDomain,
        whatsappDomain,
        publicPort,
        publicPortEnabled: nextPublicPortEnabled,
        publicIpv4,
      });
      await reconcileCaddyWithAgent({ token: resolvedToken });
      mark(rule.operation, 'success');
      return { success: true, data: { ok: true } };
    } catch (error) {
      mark(rule.operation, 'failed', 'mesh');
      return reply.code(502).send({
        success: false,
        error: safeCloudErrorText(error, [resolvedToken], 'PaaS settings apply failed'),
      });
    }
  });

  fastify.post<{ Body: { wildcardDomain?: string } }>(
    '/api/cloud/paas/settings/promote-wildcard',
    CLOUD_WRITE_RATE_LIMIT,
    async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/settings/promote-wildcard');
      const authCtx = requireAuthorizedModelAccess(req, reply, rule);
      if (!authCtx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      const { wildcardDomain } = req.body;
      if (
        !wildcardDomain ||
        typeof wildcardDomain !== 'string' ||
        !isValidPublicDomain(wildcardDomain)
      ) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({
          success: false,
          error: 'wildcardDomain is required and must be a valid public domain',
        });
      }

      try {
        const promotedApps: string[] = [];
        await promotePreviewAppsToWildcard({
          wildcardDomain,
          upAgentCompose: async (slug, env) => {
            const appRow = await CloudApp.query().findOne({ name: slug });
            const composeSpec = appRow?.compose_spec;
            if (!composeSpec) {
              promotedApps.push(slug);
              return;
            }
            const cpResponse = await controlPlaneFetch(`${defaultAgentUrl}/agent/compose/up`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slug, composeSpec, env }),
            });
            if (!cpResponse.ok) throw new Error(`compose up failed: ${cpResponse.status}`);
            promotedApps.push(slug);
          },
        });
        mark(rule.operation, 'success');
        return { success: true, data: { promotedCount: promotedApps.length, apps: promotedApps } };
      } catch (error) {
        mark(rule.operation, 'failed', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeCloudErrorText(error, [resolvedToken], 'promote-wildcard failed'),
        });
      }
    }
  );

  fastify.get('/api/cloud/paas/mesh/status', CLOUD_READ_RATE_LIMIT, async (req, reply) => {
    const rule = ruleFor('/api/cloud/paas/mesh/status');
    const authCtx = requireAuthorizedModelAccess(req, reply, rule);
    if (!authCtx) return;
    if (!requireFeature(reply, rule)) return;
    if (!requireToken(reply, rule)) return;

    try {
      const mesh = await fetchAgentMeshStatus({ endpoint: defaultAgentUrl, fetchImpl });
      const containers = await listAgentContainers({ endpoint: defaultAgentUrl, fetchImpl });
      const caddySpec = await buildDeclarativeCaddySpec();
      mark(rule.operation, 'success');
      return {
        success: true,
        data: {
          mesh,
          containers,
          routes: caddySpec.routes,
          previewListeners: caddySpec.previewListeners,
        },
      };
    } catch (error) {
      mark(rule.operation, 'failed', 'mesh');
      return reply.code(502).send({
        success: false,
        error: safeCloudErrorText(error, [resolvedToken], 'mesh status failed'),
      });
    }
  });
}
