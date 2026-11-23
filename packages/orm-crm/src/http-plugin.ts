import type { AddonHttpPlugin, AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import {
  scoreLead,
  forecastPipelineRevenue,
  type LeadSignals,
  type LeadScoringWeights,
  type LeadTierThresholds,
  type PipelineDeal,
} from './lead-scoring.js';

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

export const crmHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/crm/leads/score', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { signals, weights, thresholds } = req.body;
    if (!isRecord(signals)) {
      return reply.code(400).send({ success: false, error: 'signals object is required' });
    }

    const { firmographicFit, engagement, buyingIntent, budgetFit, timelineUrgency, adjustments } =
      signals;
    if (
      typeof firmographicFit !== 'number' ||
      typeof engagement !== 'number' ||
      typeof buyingIntent !== 'number' ||
      typeof budgetFit !== 'number' ||
      typeof timelineUrgency !== 'number'
    ) {
      return reply.code(400).send({ success: false, error: 'signals must contain numeric scores' });
    }

    if (adjustments !== undefined && !isRecord(adjustments)) {
      return reply
        .code(400)
        .send({ success: false, error: 'adjustments must be a record of numbers' });
    }

    try {
      const result = scoreLead(
        signals as unknown as LeadSignals,
        weights as LeadScoringWeights | undefined,
        thresholds as LeadTierThresholds | undefined
      );
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/crm/pipeline/forecast', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { deals, stageProbabilitiesBps } = req.body;
    if (!Array.isArray(deals)) {
      return reply.code(400).send({ success: false, error: 'deals array is required' });
    }

    for (const deal of deals) {
      if (
        !isRecord(deal) ||
        typeof deal.id !== 'string' ||
        typeof deal.stage !== 'string' ||
        typeof deal.amountCents !== 'number'
      ) {
        return reply
          .code(400)
          .send({
            success: false,
            error: 'Each deal must include id, stage, and numeric amountCents',
          });
      }
    }

    if (stageProbabilitiesBps !== undefined && !isRecord(stageProbabilitiesBps)) {
      return reply
        .code(400)
        .send({ success: false, error: 'stageProbabilitiesBps must be an object' });
    }

    try {
      const result = forecastPipelineRevenue(
        deals as readonly PipelineDeal[],
        stageProbabilitiesBps as Record<string, number> | undefined
      );
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};
