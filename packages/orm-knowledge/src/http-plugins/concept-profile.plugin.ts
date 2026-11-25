import type { AddonHttpPlugin } from '@moonwitness/orm';
import { readConceptProfileVersion } from '../concept-profile-store.js';
import { resolveCorpusDataRoot } from '../corpus-root.js';
import { hasValidationError } from './helpers.js';

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'error'],
  properties: { success: { const: false }, error: { type: 'string' } },
} as const;

export const conceptProfileHttpPlugin: AddonHttpPlugin = async (app) => {
  if (!app.db) {
    throw new Error('conceptProfileHttpPlugin requires app.db to be initialized');
  }
  const db = app.db;

  app.get<{ Params: { profileId: string }; Querystring: { version?: string } }>(
    '/api/research/concept-profiles/:profileId',
    {
      attachValidation: true,
      schema: {
        tags: ['Research'],
        summary: 'Read one tenant-scoped INTERNAL concept profile version',
        description:
          'Returns one exact concept profile version after current tenant, evidence, source, and digest validation. It does not approve profile interpretations or expose a list or write operation.',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['profileId'],
          properties: {
            profileId: {
              type: 'string',
              pattern: '^mw:concept-profile:[a-z0-9][a-z0-9._-]{0,179}$',
            },
          },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { version: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' } },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'data'],
            properties: {
              success: { const: true },
              data: {
                type: 'object',
                additionalProperties: false,
                required: ['profileId', 'conceptId', 'version', 'digest', 'visibility', 'document'],
                properties: {
                  profileId: { type: 'string' },
                  conceptId: { type: 'string' },
                  version: { type: 'integer', minimum: 1 },
                  digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                  visibility: { const: 'INTERNAL' },
                  document: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const auth = request.auth;
      if (!auth) return reply.code(401).send({ success: false, error: 'Authentication required' });
      const userId = auth.userId;
      const companyId = auth.companyId;
      if (
        (auth.role !== 'user' && auth.role !== 'superadmin') ||
        !Number.isSafeInteger(userId) ||
        !userId ||
        userId < 1 ||
        !Number.isSafeInteger(companyId) ||
        !companyId ||
        companyId < 1
      ) {
        return reply.code(403).send({ success: false, error: 'Profile is unavailable' });
      }
      const version =
        request.query.version === undefined ? undefined : Number(request.query.version);
      if (
        hasValidationError(request) ||
        (version !== undefined &&
          (!Number.isSafeInteger(version) ||
            version < 1 ||
            String(version) !== request.query.version))
      ) {
        return reply.code(400).send({ success: false, error: 'Invalid profile version' });
      }
      try {
        const profile = await readConceptProfileVersion(db, {
          authenticatedReader: {
            userId,
            companyId,
            role: auth.role,
          },
          corpusRootDirectory: resolveCorpusDataRoot(),
          profileId: request.params.profileId,
          version,
        });
        if (!profile) {
          return reply.code(404).send({ success: false, error: 'Profile is unavailable' });
        }
        return reply.send({
          success: true,
          data: {
            profileId: profile.profileId,
            conceptId: profile.conceptId,
            version: profile.version,
            digest: profile.digest,
            visibility: profile.visibility,
            document: profile.document,
          },
        });
      } catch {
        return reply.code(404).send({ success: false, error: 'Profile is unavailable' });
      }
    }
  );
};
