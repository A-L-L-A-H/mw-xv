import type { AddonHttpPlugin, AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import { computeSignalFinalScore, type SignalScoreInput, type SignalScoreWeights } from './scoring.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface AuthenticatedContext {
  readonly userId: number;
  readonly role: string;
  readonly companyId: number;
}

function requireAuth(req: AddonHttpRequestBase, reply: AddonHttpReply): AuthenticatedContext | null {
  if (!req.auth) {
    reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  const companyId = req.auth.companyId;
  if (typeof companyId !== 'number' || !Number.isInteger(companyId) || companyId <= 0) {
    reply.code(403).send({ success: false, error: 'Active company is required' });
    return null;
  }
  return { userId: req.auth.userId, role: req.auth.role ?? 'user', companyId };
}

function parseWeights(value: unknown): SignalScoreWeights | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('weights must be an object');
  for (const key of ['keywordWeight', 'recencyDecay', 'sourceAuthority', 'velocity'] as const) {
    const entry = value[key];
    if (entry !== undefined && typeof entry !== 'number') {
      throw new Error(`weights.${key} must be a number`);
    }
  }
  return value as unknown as SignalScoreWeights;
}

export const signalHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/signal/score', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { keywordWeight, recencyDecay, sourceAuthority, velocity, weights } = req.body;
    if (
      typeof keywordWeight !== 'number' ||
      typeof recencyDecay !== 'number' ||
      typeof sourceAuthority !== 'number' ||
      typeof velocity !== 'number'
    ) {
      return reply.code(400).send({
        success: false,
        error: 'keywordWeight, recencyDecay, sourceAuthority, and velocity must be numbers',
      });
    }

    let scoreWeights: SignalScoreWeights | undefined;
    try {
      scoreWeights = parseWeights(weights);
      const input: SignalScoreInput = { keywordWeight, recencyDecay, sourceAuthority, velocity };
      const result = computeSignalFinalScore(input, scoreWeights);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};
