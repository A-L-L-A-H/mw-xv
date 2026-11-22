import type { AddonHttpHostContext, AddonHttpPlugin } from '@moonwitness/orm';
import {
  containsProhibitedMinorIdentifiers,
  evaluateChildProtectionAndPublicationGate,
  type ResearchEvidenceReference,
} from '@moonwitness/research';
import {
  BugCaseWorkflowError,
  intakeBugCase,
  readBugCaseHistory,
  transitionBugCaseWorkflow,
  type BugCaseClassification,
} from '../bug-case-workflow.js';
import {
  BugOutcomeVerificationError,
  verifyBugCaseOutcomeWithEvidence,
  type BugOutcomeTestProof,
  type TrustedBugOutcomeEvidenceResolver,
} from '../bug-outcome-verification.js';

export interface BugCaseHttpPluginOptions extends AddonHttpHostContext {
  readonly resolveTrustedOutcomeEvidence?: TrustedBugOutcomeEvidenceResolver;
  readonly safeguardingProcessApproved?: boolean;
}

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'error'],
  properties: { success: { const: false }, error: { type: 'string' } },
} as const;

const bugCaseSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'program_id',
    'case_id',
    'title',
    'classification',
    'synthetic',
    'case_state',
    'human_approval_status',
    'publication_status',
    'resolved_status',
    'revision',
    'event_count',
  ],
  properties: {
    program_id: { type: 'string' },
    case_id: { type: 'string' },
    title: { type: 'string' },
    classification: { type: 'string' },
    synthetic: { type: 'boolean' },
    case_state: { type: 'string' },
    human_approval_status: { type: 'string' },
    publication_status: { type: 'string' },
    resolved_status: { type: 'string' },
    revision: { type: 'integer' },
    event_count: { type: 'integer' },
  },
} as const;

function mapWorkflowError(
  error: unknown
): { status: 400 | 403 | 404 | 409; message: string } | null {
  if (error instanceof BugCaseWorkflowError) {
    if (error.code === 'FORBIDDEN') return { status: 403, message: 'BUG case action denied' };
    if (error.code === 'NOT_FOUND') return { status: 404, message: 'BUG case not found' };
    if (error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'CONFLICT') {
      return { status: 409, message: error.message };
    }
    return { status: 400, message: error.message };
  }
  if (error instanceof BugOutcomeVerificationError) {
    return { status: 400, message: error.message };
  }
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    if (error.code === 'FORBIDDEN') return { status: 403, message: 'BUG case action denied' };
    if (error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'STALE_REVISION') {
      return { status: 409, message: 'Workflow conflict or stale revision' };
    }
    if (error.code === 'INVALID_TRANSITION') {
      return { status: 409, message: 'Workflow transition is not valid in the current state' };
    }
  }
  return null;
}

export const bugCaseHttpPlugin: AddonHttpPlugin = async (app, options) => {
  if (!app.db) {
    throw new Error('bugCaseHttpPlugin requires app.db to be initialized');
  }
  const db = app.db;
  const pluginOptions = options as BugCaseHttpPluginOptions | undefined;
  const defaultDenyEvidenceResolver: TrustedBugOutcomeEvidenceResolver = async () => null;
  const resolveOutcomeEvidence =
    typeof pluginOptions?.resolveTrustedOutcomeEvidence === 'function'
      ? pluginOptions.resolveTrustedOutcomeEvidence
      : defaultDenyEvidenceResolver;
  const safeguardingApproved = pluginOptions?.safeguardingProcessApproved === true;

  app.post(
    '/api/research/bug-cases',
    {
      schema: {
        tags: ['Research'],
        summary: 'Role-safe BUG case intake with fail-closed child-protection screening',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'program_id',
            'case_id',
            'title',
            'classification',
            'synthetic',
            'summary',
            'idempotency_key',
          ],
          properties: {
            program_id: { type: 'string' },
            case_id: { type: 'string' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            classification: {
              enum: ['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'CHILD_SENSITIVE'],
            },
            synthetic: { type: 'boolean' },
            minor_involved: { type: 'boolean' },
            summary: { type: 'string', minLength: 1, maxLength: 2000 },
            idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
        response: {
          201: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: { success: { const: true }, data: bugCaseSummarySchema },
          },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const auth = request.auth;
      if (!auth) return reply.code(401).send({ success: false, error: 'Authentication required' });
      if ((auth.role !== 'user' && auth.role !== 'superadmin') || !auth.companyId) {
        return reply.code(403).send({ success: false, error: 'Active company context required' });
      }

      const body = request.body as {
        program_id: `mw:bug-program:slot-${string}`;
        case_id: `mw:bug-case:${string}`;
        title: string;
        classification: BugCaseClassification;
        synthetic: boolean;
        minor_involved?: boolean;
        summary: string;
        idempotency_key: string;
      };

      const slotMatch = /^mw:bug-program:slot-(\d{2})$/u.exec(body.program_id);
      const slotNumber = slotMatch ? Number(slotMatch[1]) : undefined;
      const isChildSensitive =
        body.classification === 'CHILD_SENSITIVE' ||
        body.minor_involved === true ||
        slotNumber === 13;

      if (isChildSensitive) {
        const gate = evaluateChildProtectionAndPublicationGate({
          schema_version: 1,
          record_id: body.case_id,
          classification: body.classification,
          inherited_classifications: [],
          program_slot: slotNumber,
          minor_involved: true,
          synthetic: body.synthetic,
          requested_channel: 'internal_review',
          safeguarding_process_approved: safeguardingApproved,
          candidate_payload: { title: body.title, summary: body.summary },
        });
        if (!gate.allowed) {
          return reply.code(403).send({
            success: false,
            error: 'Child-sensitive intake is disabled until safeguarding escalation is approved',
          });
        }
      } else if (
        containsProhibitedMinorIdentifiers({ title: body.title, summary: body.summary }).length > 0
      ) {
        return reply.code(403).send({
          success: false,
          error: 'Prohibited personal or minor identifiers are blocked from submission',
        });
      }

      try {
        const created = await intakeBugCase({
          db,
          actor: { userId: auth.userId, companyId: auth.companyId, role: auth.role },
          programId: body.program_id,
          caseId: body.case_id,
          title: body.title,
          classification: body.classification,
          synthetic: body.synthetic,
          summary: body.summary,
          idempotencyKey: body.idempotency_key,
        });
        return reply.code(201).send({
          success: true,
          data: {
            program_id: created.bugCase.program_id,
            case_id: created.bugCase.case_id,
            title: created.bugCase.title,
            classification: created.bugCase.classification,
            synthetic: created.bugCase.synthetic,
            case_state: created.bugCase.case_state,
            human_approval_status: created.bugCase.human_approval_status,
            publication_status: created.bugCase.publication_status,
            resolved_status: created.bugCase.resolved_status,
            revision: created.bugCase.revision,
            event_count: 1,
          },
        });
      } catch (error) {
        const mapped = mapWorkflowError(error);
        if (mapped) {
          return reply.code(mapped.status).send({ success: false, error: mapped.message });
        }
        throw error;
      }
    }
  );

  app.post(
    '/api/research/bug-cases/:caseId/transitions',
    {
      schema: {
        tags: ['Research'],
        summary: 'Transition a BUG case across triage, plan, action, reopen, or replan',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['caseId'],
          properties: { caseId: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'expected_workflow_revision', 'idempotency_key', 'details'],
          properties: {
            action: { enum: ['triage', 'plan', 'record_action', 'reopen', 'replan'] },
            expected_workflow_revision: { type: 'integer', minimum: 0 },
            idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
            details: { type: 'object', additionalProperties: true },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: { success: { const: true }, data: bugCaseSummarySchema },
          },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const auth = request.auth;
      if (!auth) return reply.code(401).send({ success: false, error: 'Authentication required' });
      if ((auth.role !== 'user' && auth.role !== 'superadmin') || !auth.companyId) {
        return reply.code(403).send({ success: false, error: 'Active company context required' });
      }
      const { caseId } = request.params as { caseId: `mw:bug-case:${string}` };
      const body = request.body as {
        action: 'triage' | 'plan' | 'record_action' | 'reopen' | 'replan';
        expected_workflow_revision: number;
        idempotency_key: string;
        details: Record<string, unknown>;
      };
      try {
        const result = await transitionBugCaseWorkflow({
          db,
          actor: { userId: auth.userId, companyId: auth.companyId, role: auth.role },
          caseId,
          action: body.action,
          expectedWorkflowRevision: body.expected_workflow_revision,
          idempotencyKey: body.idempotency_key,
          details: body.details,
        });
        return reply.send({
          success: true,
          data: {
            program_id: result.bugCase.program_id,
            case_id: result.bugCase.case_id,
            title: result.bugCase.title,
            classification: result.bugCase.classification,
            synthetic: result.bugCase.synthetic,
            case_state: result.bugCase.case_state,
            human_approval_status: result.bugCase.human_approval_status,
            publication_status: result.bugCase.publication_status,
            resolved_status: result.bugCase.resolved_status,
            revision: result.bugCase.revision,
            event_count: result.events.length,
          },
        });
      } catch (error) {
        const mapped = mapWorkflowError(error);
        if (mapped) {
          return reply.code(mapped.status).send({ success: false, error: mapped.message });
        }
        throw error;
      }
    }
  );

  app.post(
    '/api/research/bug-cases/:caseId/verify-outcome',
    {
      schema: {
        tags: ['Research'],
        summary: 'Independently verify a BUG case outcome with K3-002 evidence and test proof',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['caseId'],
          properties: { caseId: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'expected_workflow_revision',
            'idempotency_key',
            'evidence',
            'outcome_test_proof',
          ],
          properties: {
            expected_workflow_revision: { type: 'integer', minimum: 0 },
            idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
            evidence: { type: 'object', additionalProperties: true },
            outcome_test_proof: {
              type: 'object',
              additionalProperties: false,
              required: ['test_run_id', 'passed', 'summary', 'artifact_sha256'],
              properties: {
                test_run_id: { type: 'string', minLength: 1 },
                passed: { type: 'boolean' },
                summary: { type: 'string', minLength: 1 },
                artifact_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: { success: { const: true }, data: bugCaseSummarySchema },
          },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const auth = request.auth;
      if (!auth) return reply.code(401).send({ success: false, error: 'Authentication required' });
      if (auth.role !== 'superadmin' || !auth.companyId) {
        return reply.code(403).send({ success: false, error: 'Outcome verification denied' });
      }
      const { caseId } = request.params as { caseId: `mw:bug-case:${string}` };
      const body = request.body as {
        expected_workflow_revision: number;
        idempotency_key: string;
        evidence: ResearchEvidenceReference;
        outcome_test_proof: BugOutcomeTestProof;
      };
      try {
        const result = await verifyBugCaseOutcomeWithEvidence({
          db,
          actor: { userId: auth.userId, companyId: auth.companyId, role: auth.role },
          caseId,
          expectedWorkflowRevision: body.expected_workflow_revision,
          idempotencyKey: body.idempotency_key,
          evidence: body.evidence,
          resolveTrustedEvidence: resolveOutcomeEvidence,
          outcomeTestProof: body.outcome_test_proof,
        });
        return reply.send({
          success: true,
          data: {
            program_id: result.bugCase.program_id,
            case_id: result.bugCase.case_id,
            title: result.bugCase.title,
            classification: result.bugCase.classification,
            synthetic: result.bugCase.synthetic,
            case_state: result.bugCase.case_state,
            human_approval_status: result.bugCase.human_approval_status,
            publication_status: result.bugCase.publication_status,
            resolved_status: result.bugCase.resolved_status,
            revision: result.bugCase.revision,
            event_count: result.events.length,
          },
        });
      } catch (error) {
        const mapped = mapWorkflowError(error);
        if (mapped) {
          return reply.code(mapped.status).send({ success: false, error: mapped.message });
        }
        throw error;
      }
    }
  );

  app.get(
    '/api/research/bug-cases/:caseId',
    {
      schema: {
        tags: ['Research'],
        summary: 'Read role-safe BUG case status inside active company scope',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['caseId'],
          properties: { caseId: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: { success: { const: true }, data: bugCaseSummarySchema },
          },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const auth = request.auth;
      if (!auth) return reply.code(401).send({ success: false, error: 'Authentication required' });
      if ((auth.role !== 'user' && auth.role !== 'superadmin') || !auth.companyId) {
        return reply.code(403).send({ success: false, error: 'Active company context required' });
      }
      const { caseId } = request.params as { caseId: string };
      try {
        const result = await readBugCaseHistory(db, caseId, {
          userId: auth.userId,
          companyId: auth.companyId,
          role: auth.role,
        });
        if (result.bugCase.classification === 'CHILD_SENSITIVE' && auth.role !== 'superadmin') {
          return reply.code(404).send({ success: false, error: 'BUG case not found' });
        }
        return reply.send({
          success: true,
          data: {
            program_id: result.bugCase.program_id,
            case_id: result.bugCase.case_id,
            title: result.bugCase.title,
            classification: result.bugCase.classification,
            synthetic: result.bugCase.synthetic,
            case_state: result.bugCase.case_state,
            human_approval_status: result.bugCase.human_approval_status,
            publication_status: result.bugCase.publication_status,
            resolved_status: result.bugCase.resolved_status,
            revision: result.bugCase.revision,
            event_count: result.events.length,
          },
        });
      } catch (error) {
        const mapped = mapWorkflowError(error);
        if (mapped) {
          return reply.code(mapped.status).send({ success: false, error: mapped.message });
        }
        throw error;
      }
    }
  );
};
