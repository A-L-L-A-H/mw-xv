import type { Knex } from 'knex';
import type { AddonHttpPlugin, AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import {
  mapFrameworks,
  testControl,
  calculateRiskScore,
  verifyEvidence,
  assessComplianceMaturity,
  trackRemediations,
  type ControlTestInput,
  type EvidenceVerificationInput,
  type MaturityAssessmentInput,
  type RiskScoreInput,
} from './compliance-engine.js';

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

function requireDb(req: AddonHttpRequestBase): Knex {
  const app = req as unknown as { server?: { db?: Knex } };
  const db = app.server?.db;
  if (!db) throw new Error('Database not available on request context');
  return db;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];
const VALID_LIKELIHOODS = ['almost_certain', 'likely', 'possible', 'unlikely', 'rare'];
const VALID_IMPACTS = ['catastrophic', 'major', 'moderate', 'minor', 'negligible'];

export const complianceHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/compliance/frameworks/map', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { frameworkIds, includeControls, includeGaps, includeOverlaps } = req.body;

    if (!Array.isArray(frameworkIds) || frameworkIds.some(id => typeof id !== 'string')) {
      return reply.code(400).send({ success: false, error: 'frameworkIds must be an array of framework code strings' });
    }

    try {
      const result = await mapFrameworks(requireDb(req), {
        companyId: auth.companyId,
        frameworkIds: frameworkIds as string[],
        includeControls: Boolean(includeControls),
        includeGaps: Boolean(includeGaps),
        includeOverlaps: Boolean(includeOverlaps),
      });
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/compliance/controls/test', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { controlId, evidence, testProcedure, automationLevel } = req.body;

    if (typeof controlId !== 'string' || !controlId) {
      return reply.code(400).send({ success: false, error: 'controlId is required' });
    }
    if (!Array.isArray(evidence) || evidence.length === 0) {
      return reply.code(400).send({ success: false, error: 'evidence array with at least one entry is required' });
    }
    const validAutomation = ['manual', 'semi_automated', 'fully_automated'];
    if (automationLevel !== undefined && !validAutomation.includes(automationLevel as string)) {
      return reply.code(400).send({ success: false, error: `Invalid automationLevel. Must be one of: ${validAutomation.join(', ')}` });
    }

    try {
      const input: ControlTestInput = {
        companyId: auth.companyId,
        controlId,
        evidence: (evidence as Array<Record<string, unknown>>).map(entry => ({
          type: String(entry.type),
          reference: String(entry.reference),
          hash: String(entry.hash),
          collectedDate: String(entry.collectedDate),
          automated: entry.automated === true,
        })),
        testProcedure: typeof testProcedure === 'string' ? testProcedure : '',
        automationLevel: automationLevel as ControlTestInput['automationLevel'],
      };

      const result = await testControl(requireDb(req), input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/compliance/risk/score', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { severity, likelihood, impact } = req.body;

    if (!VALID_SEVERITIES.includes(severity as string)) {
      return reply.code(400).send({ success: false, error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}` });
    }
    if (!VALID_LIKELIHOODS.includes(likelihood as string)) {
      return reply.code(400).send({ success: false, error: `Invalid likelihood. Must be one of: ${VALID_LIKELIHOODS.join(', ')}` });
    }
    if (!VALID_IMPACTS.includes(impact as string)) {
      return reply.code(400).send({ success: false, error: `Invalid impact. Must be one of: ${VALID_IMPACTS.join(', ')}` });
    }

    try {
      const input: RiskScoreInput = {
        severity: severity as RiskScoreInput['severity'],
        likelihood: likelihood as RiskScoreInput['likelihood'],
        impact: impact as RiskScoreInput['impact'],
      };
      const result = calculateRiskScore(input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/compliance/evidence/verify', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { evidenceId, expectedHash, verifyExpiry } = req.body;

    if (typeof evidenceId !== 'string' || !evidenceId || typeof expectedHash !== 'string') {
      return reply.code(400).send({ success: false, error: 'evidenceId and expectedHash are required' });
    }

    try {
      const input: EvidenceVerificationInput = {
        companyId: auth.companyId,
        evidenceId,
        expectedHash,
        verifyExpiry: verifyExpiry === true,
      };

      const result = await verifyEvidence(requireDb(req), input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/compliance/maturity/assess', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const {
      frameworkId,
      assessmentDate,
      controlsTested,
      controlsPassed,
      controlsFailed,
      controlsNotApplicable,
      criticalFindings,
      highFindings,
      mediumFindings,
      lowFindings,
    } = req.body;

    if (typeof frameworkId !== 'string' || !frameworkId || typeof assessmentDate !== 'string') {
      return reply.code(400).send({ success: false, error: 'frameworkId and assessmentDate are required' });
    }

    try {
      const input: MaturityAssessmentInput = {
        companyId: auth.companyId,
        frameworkId,
        assessmentDate,
        controlsTested: Number(controlsTested ?? 0),
        controlsPassed: Number(controlsPassed ?? 0),
        controlsFailed: Number(controlsFailed ?? 0),
        controlsNotApplicable: Number(controlsNotApplicable ?? 0),
        criticalFindings: Number(criticalFindings ?? 0),
        highFindings: Number(highFindings ?? 0),
        mediumFindings: Number(mediumFindings ?? 0),
        lowFindings: Number(lowFindings ?? 0),
      };

      const result = await assessComplianceMaturity(requireDb(req), input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/compliance/remediations/track', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const {
      includeOverdue,
      includePending,
      includeMetrics,
      includeStale,
      escalationThresholdDays,
      staleThresholdDays,
      periodStart,
      periodEnd,
    } = req.body;

    try {
      const result = await trackRemediations(requireDb(req), {
        companyId: auth.companyId,
        includeOverdue: includeOverdue === true,
        includePending: includePending === true,
        includeMetrics: includeMetrics === true,
        includeStale: includeStale === true,
        escalationThresholdDays: escalationThresholdDays !== undefined ? Number(escalationThresholdDays) : undefined,
        staleThresholdDays: staleThresholdDays !== undefined ? Number(staleThresholdDays) : undefined,
        periodStart: typeof periodStart === 'string' ? periodStart : undefined,
        periodEnd: typeof periodEnd === 'string' ? periodEnd : undefined,
      });
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};

export const httpPlugin = complianceHttpPlugin;
