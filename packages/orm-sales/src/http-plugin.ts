import type { AddonHttpPlugin, AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import { compileQuote, type QuoteCompileInput } from './quote-engine.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface AuthenticatedContext {
  readonly userId: number;
  readonly role: string;
  readonly companyId: number;
}

function requireAuth(
  req: AddonHttpRequestBase,
  reply: AddonHttpReply
): AuthenticatedContext | null {
  if (!req.auth) {
    reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  const companyId = req.auth.companyId;
  if (typeof companyId !== 'number' || !Number.isInteger(companyId) || companyId <= 0) {
    reply.code(403).send({ success: false, error: 'Active company is required' });
    return null;
  }
  return {
    userId: req.auth.userId,
    role: req.auth.role ?? 'user',
    companyId,
  };
}

export const quoteHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/sales/quotes/compile', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { quoteId, customerId, currency, lines } = req.body;
    if (
      typeof quoteId !== 'string' ||
      typeof customerId !== 'string' ||
      typeof currency !== 'string' ||
      !Array.isArray(lines)
    ) {
      return reply.code(400).send({
        success: false,
        error: 'quoteId, customerId, currency, and lines array are required',
      });
    }

    for (const line of lines) {
      if (
        !isRecord(line) ||
        typeof line.lineId !== 'string' ||
        typeof line.sku !== 'string' ||
        typeof line.quantity !== 'number' ||
        typeof line.unitPriceCents !== 'number' ||
        typeof line.unitCostCents !== 'number'
      ) {
        return reply.code(400).send({
          success: false,
          error: 'Each line must include lineId, sku, quantity, unitPriceCents, and unitCostCents',
        });
      }
    }

    try {
      const result = compileQuote(req.body as unknown as QuoteCompileInput);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};
