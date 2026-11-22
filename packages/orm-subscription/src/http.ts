import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AddonHttpPlugin } from '@moonwitness/orm';
import { Subscription } from './models/index.js';
import {
  activateSubscription,
  createSubscriptionFromSaleOrder,
  suspendSubscription,
} from './automation.js';

interface GroupGrant {
  readonly model_name: string;
  readonly read: boolean;
  readonly create: boolean;
  readonly write: boolean;
  readonly unlink: boolean;
}

interface RequestAuth {
  readonly userId: number;
  readonly role: string;
  readonly companyId?: number;
  readonly groupPermissions?: readonly GroupGrant[];
}

function requestAuth(req: FastifyRequest): RequestAuth | null {
  const auth = (req as { auth?: RequestAuth | null }).auth;
  return auth && typeof auth.userId === 'number' ? auth : null;
}

function hasModelAccess(
  auth: RequestAuth,
  modelName: string,
  op: 'read' | 'create' | 'write' | 'unlink'
): boolean {
  if (auth.role === 'system' || auth.role === 'superadmin') return true;
  if (auth.role !== 'user') return false;
  return (auth.groupPermissions ?? []).some((g) => g.model_name === modelName && g[op] === true);
}

function requireAuthorizedModelAccess(
  req: FastifyRequest,
  reply: FastifyReply,
  modelName: string,
  op: 'read' | 'create' | 'write' | 'unlink'
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
  if (!hasModelAccess(auth, modelName, op)) {
    void reply.code(403).send({ success: false, error: `Access denied for ${modelName}:${op}` });
    return null;
  }
  return { auth, companyId: auth.companyId };
}

function parsePositiveId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function createSubscriptionHttpPlugin(): AddonHttpPlugin {
  return async (fastifyApp) => {
    const fastify = fastifyApp as FastifyInstance;

    fastify.post<{
      Params: { id: string };
      Body: { planId?: number; state?: 'pending' | 'active' } | undefined;
    }>('/api/subscriptions/from-order/:id', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, Subscription.modelName, 'create');
      if (!ctx) return;
      const orderId = parsePositiveId(req.params.id);
      if (!orderId) {
        return reply.code(400).send({ success: false, error: 'Invalid order ID' });
      }

      try {
        const subscription = await createSubscriptionFromSaleOrder(orderId, {
          companyId: ctx.companyId,
          planId: req.body?.planId,
          state: req.body?.state,
        });
        return reply.code(201).send({ success: true, data: subscription });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Creation failed';
        return reply.code(404).send({ success: false, error: message });
      }
    });

    fastify.post<{ Params: { id: string } }>('/api/subscriptions/:id/activate', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, Subscription.modelName, 'write');
      if (!ctx) return;
      const subId = parsePositiveId(req.params.id);
      if (!subId) {
        return reply.code(400).send({ success: false, error: 'Invalid subscription ID' });
      }

      try {
        const subscription = await activateSubscription(subId, {
          companyId: ctx.companyId,
        });
        return reply.code(200).send({ success: true, data: subscription });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Activation failed';
        return reply.code(404).send({ success: false, error: message });
      }
    });

    fastify.post<{ Params: { id: string } }>('/api/subscriptions/:id/suspend', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, Subscription.modelName, 'write');
      if (!ctx) return;
      const subId = parsePositiveId(req.params.id);
      if (!subId) {
        return reply.code(400).send({ success: false, error: 'Invalid subscription ID' });
      }

      try {
        const subscription = await suspendSubscription(subId, {
          companyId: ctx.companyId,
        });
        return reply.code(200).send({ success: true, data: subscription });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Suspension failed';
        return reply.code(404).send({ success: false, error: message });
      }
    });
  };
}

export const subscriptionHttpPlugin = createSubscriptionHttpPlugin();
