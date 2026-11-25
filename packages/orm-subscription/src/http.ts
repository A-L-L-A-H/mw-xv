import type { FastifyInstance } from 'fastify';
import {
  parsePositiveId,
  requireAuthorizedModelAccess,
  type AddonHttpPlugin,
} from '@moonwitness/orm';
import { Subscription } from './models/index.js';
import {
  activateSubscription,
  createSubscriptionFromSaleOrder,
  suspendSubscription,
} from './automation.js';

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

    fastify.post<{ Params: { id: string } }>(
      '/api/subscriptions/:id/activate',
      async (req, reply) => {
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
      }
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/subscriptions/:id/suspend',
      async (req, reply) => {
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
      }
    );
  };
}

export const subscriptionHttpPlugin = createSubscriptionHttpPlugin();
