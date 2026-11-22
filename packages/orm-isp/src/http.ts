import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AddonHttpPlugin } from '@moonwitness/orm';
import { ISPNAS, ISPRadiusOutbox, ISPSubscriber } from './models/index.js';

interface RequestAuth {
  readonly userId: number;
  readonly role: string;
  readonly companyId?: number;
}

export interface IspHttpPluginOptions {
  readonly ispServiceUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

function requestAuth(req: FastifyRequest): RequestAuth | null {
  const auth = (req as { auth?: RequestAuth | null }).auth;
  return auth && typeof auth.userId === 'number' ? auth : null;
}

function parsePositiveId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requireAuthorizedCompany(
  req: FastifyRequest,
  reply: FastifyReply
): { auth: RequestAuth; companyId: number } | null {
  const auth = requestAuth(req);
  if (!auth) {
    void reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  if (!auth.companyId) {
    void reply.code(403).send({ success: false, error: 'Active company context required' });
    return null;
  }
  return { auth, companyId: auth.companyId };
}

function isAdminRole(role: string): boolean {
  return role === 'system' || role === 'superadmin';
}

export function createIspHttpPlugin(options: IspHttpPluginOptions = {}): AddonHttpPlugin {
  return async (fastifyApp) => {
    const fastify = fastifyApp as FastifyInstance;
    const baseUrl = (options.ispServiceUrl ?? process.env.MW_ISP_URL ?? 'http://127.0.0.1:3002').replace(
      /\/+$/u,
      ''
    );
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;

    fastify.get('/api/isp/health', async (req, reply) => {
      const ctx = requireAuthorizedCompany(req, reply);
      if (!ctx) return;

      let runtime: 'connected' | 'unreachable' = 'unreachable';
      try {
        const res = await fetchImpl(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) runtime = 'connected';
      } catch {
        runtime = 'unreachable';
      }

      const [nasCount, subscriberCount] = await Promise.all([
        ISPNAS.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
        ISPSubscriber.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      ]);

      return {
        success: true,
        data: {
          runtime,
          nasCount,
          subscriberCount,
        },
      };
    });

    fastify.post<{ Params: { id: string } }>('/api/isp/nas/:id/sync', async (req, reply) => {
      const ctx = requireAuthorizedCompany(req, reply);
      if (!ctx) return;
      if (!isAdminRole(ctx.auth.role)) {
        return reply.code(403).send({ success: false, error: 'Admin role required to sync NAS' });
      }
      const nasId = parsePositiveId(req.params.id);
      if (!nasId) return reply.code(400).send({ success: false, error: 'Invalid NAS ID' });

      const nas = await ISPNAS.query().findOne({
        id: nasId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!nas) return reply.code(404).send({ success: false, error: 'NAS device not found' });

      const response = await fetchImpl(`${baseUrl}/api/clients`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: nas.name,
          ip_address: nas.ip_address,
          secret: nas.secret,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        return reply.code(502).send({
          success: false,
          error: `ISP runtime sync failed (${response.status})`,
        });
      }

      return {
        success: true,
        data: {
          nasId: nas.id,
          name: nas.name,
          ipAddress: nas.ip_address,
          synced: true,
        },
      };
    });

    fastify.post<{ Params: { id: string } }>(
      '/api/isp/subscribers/:id/suspend',
      async (req, reply) => {
        const ctx = requireAuthorizedCompany(req, reply);
        if (!ctx) return;
        const subscriberId = parsePositiveId(req.params.id);
        if (!subscriberId) {
          return reply.code(400).send({ success: false, error: 'Invalid subscriber ID' });
        }

        const subscriber = await ISPSubscriber.query().findOne({
          id: subscriberId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!subscriber) {
          return reply.code(404).send({ success: false, error: 'Subscriber not found' });
        }

        await ISPSubscriber.query().findById(subscriber.id).patch({ status: 'suspended' });
        await ISPRadiusOutbox.query().insert({
          company_id: ctx.companyId,
          username: subscriber.username,
          type: 'disconnect',
          status: 'pending',
          framed_ip_address: subscriber.ip_address ?? null,
          created_at: new Date().toISOString().slice(0, 19),
        });

        return {
          success: true,
          data: {
            id: subscriber.id,
            username: subscriber.username,
            status: 'suspended',
          },
        };
      }
    );
  };
}

export const ispHttpPlugin = createIspHttpPlugin();
