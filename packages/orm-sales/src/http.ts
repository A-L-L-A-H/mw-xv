import type { FastifyInstance } from 'fastify';
import {
  parsePositiveId,
  requireAuthorizedModelAccess,
  type AddonHttpPlugin,
} from '@moonwitness/orm';
import { SaleOrder } from './models/index.js';
import { confirmSaleOrder, convertOpportunityToSaleOrder } from './automation.js';

export function createSalesHttpPlugin(): AddonHttpPlugin {
  return async (fastifyApp) => {
    const fastify = fastifyApp as FastifyInstance;

    fastify.post<{ Params: { id: string }; Body: { name?: string } | undefined }>(
      '/api/sales/opportunities/:id/convert-to-order',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, SaleOrder.modelName, 'create');
        if (!ctx) return;
        const opportunityId = parsePositiveId(req.params.id);
        if (!opportunityId) {
          return reply.code(400).send({ success: false, error: 'Invalid opportunity ID' });
        }

        try {
          const saleOrder = await convertOpportunityToSaleOrder(opportunityId, {
            companyId: ctx.companyId,
            name: req.body?.name,
            salespersonId: ctx.auth.userId,
          });
          return reply.code(201).send({ success: true, data: saleOrder });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Conversion failed';
          return reply.code(404).send({ success: false, error: message });
        }
      }
    );

    fastify.post<{ Params: { id: string }; Body: { confirmDate?: string } | undefined }>(
      '/api/sales/orders/:id/confirm',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, SaleOrder.modelName, 'write');
        if (!ctx) return;
        const orderId = parsePositiveId(req.params.id);
        if (!orderId) {
          return reply.code(400).send({ success: false, error: 'Invalid sales order ID' });
        }

        try {
          const saleOrder = await confirmSaleOrder(orderId, {
            companyId: ctx.companyId,
            confirmDate: req.body?.confirmDate,
          });
          return reply.code(200).send({ success: true, data: saleOrder });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Confirmation failed';
          return reply.code(404).send({ success: false, error: message });
        }
      }
    );
  };
}

export const salesHttpPlugin = createSalesHttpPlugin();
