import type { AddonHttpPlugin } from '@moonwitness/orm';
import {
  evaluateChildProtectionAndPublicationGate,
  validateChildProtectionGateInput,
} from '@moonwitness/research';

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'error'],
  properties: { success: { const: false }, error: { type: 'string' } },
} as const;

const gateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'allowed', 'audit_summary', 'detected_minor_identifier_paths'],
  properties: {
    success: { type: 'boolean' },
    allowed: { type: 'boolean' },
    audit_summary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'record_id_sha256',
        'effective_classification',
        'requested_channel',
        'allowed',
        'reasons',
        'decision_digest',
      ],
      properties: {
        record_id_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        effective_classification: { type: 'string' },
        requested_channel: { type: 'string' },
        allowed: { type: 'boolean' },
        reasons: { type: 'array', items: { type: 'string' } },
        decision_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
    detected_minor_identifier_paths: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const;

export const childProtectionHttpPlugin: AddonHttpPlugin = async (app) => {
  if (!app.db) {
    throw new Error('childProtectionHttpPlugin requires app.db to be initialized');
  }
  const db = app.db;

  app.post(
    '/api/research/child-protection/gate-check',
    {
      schema: {
        tags: ['Research'],
        summary: 'Evaluate child-protection and publication risk gate (fail-closed)',
        description:
          'Superadmin safeguarding gate evaluator. Returns only sanitized hash-bound decision metadata and JSON paths; never echoes raw candidate payloads or minor identifiers.',
        security: [{ bearerAuth: [] }],
        response: {
          200: gateResponseSchema,
          400: errorSchema,
          401: errorSchema,
          403: gateResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }
      if (auth.role !== 'superadmin' || !auth.companyId) {
        return reply.code(403).send({
          success: false,
          allowed: false,
          audit_summary: {
            record_id_sha256: '0'.repeat(64),
            effective_classification: 'CHILD_SENSITIVE',
            requested_channel: 'public_projection',
            allowed: false,
            reasons: ['safeguarding_process_not_approved'],
            decision_digest: '0'.repeat(64),
          },
          detected_minor_identifier_paths: [],
        });
      }

      const activeMembership = await db.transaction(async (trx) => {
        const user = await trx('users')
          .where({ id: auth.userId, role: auth.role, active: true })
          .first('id');
        const company = await trx('companies')
          .where({ id: auth.companyId, active: true })
          .first('id');
        const membership = await trx('company_memberships')
          .where({ user_id: auth.userId, company_id: auth.companyId, active: true })
          .first('id');
        return Boolean(user && company && membership);
      });

      if (!activeMembership) {
        return reply.code(403).send({
          success: false,
          allowed: false,
          audit_summary: {
            record_id_sha256: '0'.repeat(64),
            effective_classification: 'CHILD_SENSITIVE',
            requested_channel: 'public_projection',
            allowed: false,
            reasons: ['safeguarding_process_not_approved'],
            decision_digest: '0'.repeat(64),
          },
          detected_minor_identifier_paths: [],
        });
      }

      const validation = validateChildProtectionGateInput(request.body);
      if (!validation.valid) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid child-protection gate request',
        });
      }

      const decision = evaluateChildProtectionAndPublicationGate(request.body);
      return reply.code(decision.allowed ? 200 : 403).send({
        success: decision.allowed,
        allowed: decision.allowed,
        audit_summary: decision.audit_summary,
        detected_minor_identifier_paths: decision.detected_minor_identifier_paths,
      });
    }
  );
};
