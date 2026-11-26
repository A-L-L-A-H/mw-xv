import type { FastifyPluginAsync } from 'fastify';

import {
  getBootstrapSetupState,
  type BootstrapStatePorts,
} from '../bootstrap/bootstrap-state.js';
import {
  claimBootstrap,
  CLAIM_FAILURE,
  redactClaimForLog,
} from '../bootstrap/claim-bootstrap.js';
import type { OwnerDatabasePort } from '../bootstrap/create-first-owner.js';

export interface BootstrapRoutesOptions extends BootstrapStatePorts {
  readonly claimDatabase?: OwnerDatabasePort;
}

export const bootstrapRoutes: FastifyPluginAsync<BootstrapRoutesOptions> = async (
  fastify,
  options
) => {
  fastify.get('/setup-status', async (_request, reply) => {
    const state = await getBootstrapSetupState(options);
    return reply.header('Cache-Control', 'no-store').send(state);
  });

  fastify.post(
    '/setup/claim',
    {
      config: { rawBody: false },
      bodyLimit: 4096,
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const secure =
        process.env.NODE_ENV !== 'production' ||
        request.protocol === 'https' ||
        request.headers['x-forwarded-proto'] === 'https';
      try {
        const claimDatabase = options.claimDatabase ??
          (options.bootstrapDatabase as OwnerDatabasePort | undefined);
        if (!claimDatabase) throw new Error('setup unavailable');
        await claimBootstrap({
          transactionDatabase: claimDatabase,
          setupToken: String(body.setupToken ?? ''),
          identifierType: body.identifierType as 'email' | 'username',
          identifierValue: String(body.identifierValue ?? ''),
          password: String(body.password ?? ''),
          installationScope: options.installationScope,
          now: options.now?.(),
          isSecure: secure,
        });
        return reply.header('Cache-Control', 'no-store').send({
          complete: true,
          nextStep: 'Sign in with your identity provider account',
        });
      } catch (error) {
        request.log.warn(
          { fields: redactClaimForLog(body), reason: CLAIM_FAILURE },
          'bootstrap claim rejected'
        );
        return reply
          .header('Cache-Control', 'no-store')
          .status(400)
          .send({ error: CLAIM_FAILURE });
      }
    }
  );
};
