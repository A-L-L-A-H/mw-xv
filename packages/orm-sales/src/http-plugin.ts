import {
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
  type AuthenticatedContext,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import { compileQuote, type QuoteCompileInput } from './quote-engine.js';

export const quoteHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/sales/quotes/compile', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
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
