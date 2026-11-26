import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { createLogger, type LogLevel } from '@moonwitness/logger';

export interface IdentityAppConfig {
  readonly host: string;
  readonly port: number;
}

export interface IdentityDatabase {
  readonly close: () => Promise<void>;
}

export interface BuildAppOptions {
  readonly config?: IdentityAppConfig;
  readonly database?: IdentityDatabase;
  readonly logger?: FastifyBaseLogger;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const logger =
    options.logger ??
    createLogger({
      name: '@moonwitness/id',
      level: (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
    });

  const app = Fastify({ logger, trustProxy: false });
  app.decorate('identityConfig', options.config);
  app.decorate('identityDatabase', options.database);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    readonly identityConfig?: IdentityAppConfig;
    readonly identityDatabase?: IdentityDatabase;
  }
}
