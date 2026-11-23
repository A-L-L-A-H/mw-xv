import type { AddonHttpPlugin } from '@moonwitness/orm';
import {
  listApprovedPublications,
  PublicationStoreError,
  readApprovedPublication,
  readPublicationAuditHistory,
  supersedeOrTakedownPublication,
  type PublicationProjectionPayload,
} from '../publication-store.js';

const citationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source_id', 'edition_id', 'locator', 'content_sha256', 'rights_evidence_ref'],
  properties: {
    source_id: { type: 'string' },
    edition_id: { type: 'string' },
    locator: { type: 'string' },
    content_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    rights_evidence_ref: { type: 'string' },
  },
} as const;

const approvedViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'publication_id',
    'revision',
    'subject_id',
    'title',
    'summary',
    'citations',
    'projection_digest',
    'recorded_at',
  ],
  properties: {
    publication_id: { type: 'string' },
    revision: { type: 'integer' },
    subject_id: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    citations: { type: 'array', items: citationSchema },
    projection_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    recorded_at: { type: 'string' },
  },
} as const;

const auditRevisionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'company_id',
    'publication_id',
    'revision',
    'subject_id',
    'title',
    'classification',
    'rights_state',
    'minor_involved',
    'review_status',
    'synthetic',
    'projection_digest',
    'requester_id',
    'reviewer_id',
    'supersedes_digest',
    'takedown_reason_code',
    'recorded_at',
  ],
  properties: {
    id: { type: 'integer' },
    company_id: { type: 'integer' },
    publication_id: { type: 'string' },
    revision: { type: 'integer' },
    subject_id: { type: 'string' },
    title: { type: 'string' },
    classification: { type: 'string' },
    rights_state: { type: 'string' },
    minor_involved: { type: 'boolean' },
    review_status: { type: 'string' },
    synthetic: { type: 'boolean' },
    projection_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    requester_id: { type: 'integer' },
    reviewer_id: { type: ['integer', 'null'] },
    supersedes_digest: { type: ['string', 'null'] },
    takedown_reason_code: { type: ['string', 'null'] },
    recorded_at: { type: 'string' },
  },
} as const;

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'error'],
  properties: { success: { const: false }, error: { type: 'string' } },
} as const;

function mapStoreError(error: unknown): { status: 400 | 403 | 404 | 409; message: string } | null {
  if (!(error instanceof PublicationStoreError)) return null;
  const status: 400 | 403 | 404 | 409 =
    error.code === 'FORBIDDEN'
      ? 403
      : error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'CONFLICT'
          ? 409
          : 400;
  return { status, message: error.message };
}

/**
 * K8-003 fail-closed public publication read API + K8-006 editorial revision
 * superseding, immediate takedown, and immutable audit history routes.
 */
export const publicationHttpPlugin: AddonHttpPlugin = async (app) => {
  if (!app.db) {
    throw new Error('publicationHttpPlugin requires app.db to be initialized');
  }
  const db = app.db;

  app.get(
    '/api/public/publications',
    {
      schema: {
        tags: ['Public Knowledge'],
        summary: 'List approved, rights-cleared public publication projections',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: {
              success: { const: true },
              data: { type: 'array', items: approvedViewSchema },
            },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store, must-revalidate');
      const query = request.query as { limit?: number };
      const data = await listApprovedPublications(db, query.limit ?? 50);
      return reply.send({ success: true, data });
    }
  );

  app.get(
    '/api/public/publications/:publicationId',
    {
      schema: {
        tags: ['Public Knowledge'],
        summary: 'Read one approved public publication projection by ID',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['publicationId'],
          properties: {
            publicationId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: {
              success: { const: true },
              data: approvedViewSchema,
            },
          },
          304: { type: 'null' },
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store, must-revalidate');
      const { publicationId } = request.params as { publicationId: string };
      const publication = await readApprovedPublication(db, publicationId);
      if (!publication) {
        return reply.code(404).send({ success: false, error: 'Publication not found' });
      }
      const etag = `"${publication.projection_digest}"`;
      reply.header('ETag', etag);
      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }
      return reply.send({ success: true, data: publication });
    }
  );

  app.post(
    '/api/research/publications/:publicationId/supersede',
    {
      schema: {
        tags: ['Research'],
        summary: 'Supersede an approved publication with a new immutable revision',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['publicationId'],
          properties: {
            publicationId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expected_current_revision', 'reason_code', 'next_projection'],
          properties: {
            expected_current_revision: { type: 'integer', minimum: 1 },
            reason_code: { type: 'string', minLength: 1, maxLength: 120 },
            idempotency_key: { type: 'string', minLength: 4, maxLength: 128 },
            next_title: { type: 'string', minLength: 1, maxLength: 240 },
            next_projection: {
              type: 'object',
              additionalProperties: false,
              required: ['summary', 'citations'],
              properties: {
                summary: { type: 'string', minLength: 1, maxLength: 4000 },
                citations: { type: 'array', minItems: 1, items: citationSchema },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: { success: { const: true }, data: auditRevisionSchema },
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
        return reply
          .code(403)
          .send({ success: false, error: 'Publication management unavailable' });
      }
      const { publicationId } = request.params as { publicationId: `mw:publication:${string}` };
      const body = request.body as {
        expected_current_revision: number;
        reason_code: string;
        idempotency_key?: string;
        next_title?: string;
        next_projection: PublicationProjectionPayload;
      };
      try {
        const revision = await supersedeOrTakedownPublication({
          db,
          actor: { userId: auth.userId, companyId: auth.companyId, role: auth.role },
          publicationId,
          expectedCurrentRevision: body.expected_current_revision,
          action: 'supersede',
          reasonCode: body.reason_code,
          idempotencyKey: body.idempotency_key,
          nextTitle: body.next_title,
          nextProjection: body.next_projection,
        });
        return reply.send({ success: true, data: revision });
      } catch (error) {
        const mapped = mapStoreError(error);
        if (mapped) {
          return reply.code(mapped.status).send({ success: false, error: mapped.message });
        }
        throw error;
      }
    }
  );

  app.post(
    '/api/research/publications/:publicationId/takedown',
    {
      schema: {
        tags: ['Research'],
        summary:
          'Immediately retract/takedown a publication while retaining immutable audit history',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['publicationId'],
          properties: {
            publicationId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expected_current_revision', 'reason_code'],
          properties: {
            expected_current_revision: { type: 'integer', minimum: 1 },
            reason_code: { type: 'string', minLength: 1, maxLength: 120 },
            idempotency_key: { type: 'string', minLength: 4, maxLength: 128 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: { success: { const: true }, data: auditRevisionSchema },
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
        return reply
          .code(403)
          .send({ success: false, error: 'Publication management unavailable' });
      }
      const { publicationId } = request.params as { publicationId: `mw:publication:${string}` };
      const body = request.body as {
        expected_current_revision: number;
        reason_code: string;
        idempotency_key?: string;
      };
      try {
        const revision = await supersedeOrTakedownPublication({
          db,
          actor: { userId: auth.userId, companyId: auth.companyId, role: auth.role },
          publicationId,
          expectedCurrentRevision: body.expected_current_revision,
          action: 'takedown',
          reasonCode: body.reason_code,
          idempotencyKey: body.idempotency_key,
        });
        return reply.send({ success: true, data: revision });
      } catch (error) {
        const mapped = mapStoreError(error);
        if (mapped) {
          return reply.code(mapped.status).send({ success: false, error: mapped.message });
        }
        throw error;
      }
    }
  );

  app.get(
    '/api/research/publications/:publicationId/audit',
    {
      schema: {
        tags: ['Research'],
        summary: 'Read immutable editorial revision and takedown audit lineage',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['publicationId'],
          properties: {
            publicationId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: {
              success: { const: true },
              data: { type: 'array', items: auditRevisionSchema },
            },
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
        return reply.code(403).send({ success: false, error: 'Publication audit unavailable' });
      }
      const { publicationId } = request.params as { publicationId: string };
      try {
        const audit = await readPublicationAuditHistory(db, publicationId, {
          userId: auth.userId,
          companyId: auth.companyId,
          role: auth.role,
        });
        return reply.send({ success: true, data: audit });
      } catch (error) {
        const mapped = mapStoreError(error);
        if (mapped) {
          return reply.code(mapped.status).send({ success: false, error: mapped.message });
        }
        throw error;
      }
    }
  );
};
