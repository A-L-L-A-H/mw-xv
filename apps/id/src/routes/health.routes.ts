import type { FastifyInstance, FastifyReply, FastifyPluginAsync } from 'fastify';

export interface IdentityReadinessState {
  readonly database: 'connected' | 'disconnected';
  readonly migrations: 'applied' | 'pending';
}

export interface HealthRoutesOptions {
  readonly checkDatabase?: () => Promise<boolean>;
  readonly checkMigrations?: () => Promise<boolean>;
}

function stableReadiness(reply: FastifyReply, state: IdentityReadinessState) {
  const ready = state.database === 'connected' && state.migrations === 'applied';
  return reply
    .header('Cache-Control', 'no-store')
    .status(ready ? 200 : 503)
    .send({
      status: ready ? 'healthy' : 'unhealthy',
      database: state.database,
      migrations: state.migrations,
    });
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (fastify, options) => {
  fastify.get('/livez', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').send({ status: 'alive' })
  );

  fastify.get('/readyz', async (_request, reply) => {
    const database = options.checkDatabase
      ? await options.checkDatabase().catch(() => false)
      : false;
    const migrations = database && options.checkMigrations
      ? await options.checkMigrations().catch(() => false)
      : false;
    return stableReadiness(reply, {
      database: database ? 'connected' : 'disconnected',
      migrations: migrations ? 'applied' : 'pending',
    });
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    readonly identityHealth?: HealthRoutesOptions;
  }
}

export function identityReadinessFromInstance(app: FastifyInstance): HealthRoutesOptions {
  return app.identityHealth ?? {};
}
