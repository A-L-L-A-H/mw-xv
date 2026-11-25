import {
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
  type AuthenticatedContext,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import {
  calculateMidCycleProration,
  calculateMrrAndArr,
  type ProrationInput,
  type SubscriptionRevenueRecord,
} from './revenue-engine.js';

export const subscriptionMetricsHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/subscriptions/revenue/metrics', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { records } = req.body;
    if (!Array.isArray(records)) {
      return reply.code(400).send({ success: false, error: 'records array is required' });
    }

    for (const record of records) {
      if (
        !isRecord(record) ||
        typeof record.customerId !== 'string' ||
        typeof record.interval !== 'string' ||
        typeof record.intervalPriceCents !== 'number' ||
        typeof record.status !== 'string'
      ) {
        return reply.code(400).send({
          success: false,
          error: 'Each record must include customerId, interval, intervalPriceCents, and status',
        });
      }
    }

    try {
      const result = calculateMrrAndArr(records as readonly SubscriptionRevenueRecord[]);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/subscriptions/prorate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { currentPlanPeriodCents, newPlanPeriodCents, cycleStart, cycleEnd, changeAt } = req.body;

    if (
      typeof currentPlanPeriodCents !== 'number' ||
      typeof newPlanPeriodCents !== 'number' ||
      cycleStart === undefined ||
      cycleEnd === undefined ||
      changeAt === undefined
    ) {
      return reply.code(400).send({
        success: false,
        error:
          'currentPlanPeriodCents, newPlanPeriodCents, cycleStart, cycleEnd, and changeAt are required',
      });
    }

    try {
      const result = calculateMidCycleProration(req.body as unknown as ProrationInput);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};
