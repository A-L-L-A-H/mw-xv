import type { FastifyPluginAsync } from 'fastify';
import { listApprovedPublications, readApprovedPublication } from '@moonwitness/orm-knowledge';

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

const notFoundSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'error'],
  properties: { success: { const: false }, error: { type: 'string' } },
} as const;

/**
 * K8-003 fail-closed public publication read API.
 * Serves ONLY latest revisions that pass PUBLIC_APPROVED, permitted rights,
 * independent review, non-minor, and canonical digest re-verification.
 */
export const publicationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
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
      const data = await listApprovedPublications(fastify.db, query.limit ?? 50);
      return reply.send({ success: true, data });
    }
  );

  fastify.get(
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
          404: notFoundSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store, must-revalidate');
      const { publicationId } = request.params as { publicationId: string };
      const publication = await readApprovedPublication(fastify.db, publicationId);
      if (!publication) {
        return reply.code(404).send({ success: false, error: 'Publication not found' });
      }
      reply.header('ETag', `"${publication.projection_digest}"`);
      return reply.send({ success: true, data: publication });
    }
  );
};
