import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AddonHttpPlugin } from '@moonwitness/orm';
import { Opportunity } from '@moonwitness/orm-crm';
import { SaleOrder } from './models/index.js';
import { confirmSaleOrder, convertOpportunityToSaleOrder } from './automation.js';

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
