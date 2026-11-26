import { buildApp, type BuildAppOptions } from './app.js';
import { createLogger, type LogLevel } from '@moonwitness/logger';
import { healthRoutes, type HealthRoutesOptions } from './routes/health.routes.js';
import { bootstrapRoutes, type BootstrapRoutesOptions } from './routes/bootstrap.routes.js';
import { setupPageRoutes } from './ui/setup-page.js';
import { authRoutes, type AuthDatabasePort, type AuthRoutesOptions } from './routes/auth.routes.js';
import { login as loginService, type LoginDatabasePort } from './auth/login-service.js';
import { runOutboxPublisher, type DeliveryAdapter } from './events/outbox-publisher.js';

export interface IdentityServerOptions extends BuildAppOptions, HealthRoutesOptions, BootstrapRoutesOptions {
  readonly host?: string;
  readonly port?: number;
  readonly authDatabase?: AuthDatabasePort;
  readonly login?: AuthRoutesOptions['login'];
  readonly readSession?: AuthRoutesOptions['readSession'];
  readonly production?: AuthRoutesOptions['production'];
  readonly outboxDelivery?: DeliveryAdapter;
  readonly startOutboxPublisher?: boolean;
}

function identityLogin(options: {
  readonly database?: AuthDatabasePort;
  readonly now?: () => Date;
}): AuthRoutesOptions['login'] {
  return async (input) => {
    if (!options.database) throw new Error('Identity database unavailable');
    return loginService({
      ...input,
      database: options.database as LoginDatabasePort,
      ...(options.now ? { now: options.now() } : {}),
    });
  };
}

export interface IdentityServer {
  readonly app: Awaited<ReturnType<typeof buildApp>>;
  readonly start: () => Promise<string>;
  readonly stop: () => Promise<void>;
}

export async function createIdentityServer(options: IdentityServerOptions = {}): Promise<IdentityServer> {
  const host = options.host ?? process.env.IDENTITY_HOST ?? '127.0.0.1';
  const port = options.port ?? Number.parseInt(process.env.IDENTITY_PORT ?? '3000', 10);
  const logger =
    options.logger ??
    createLogger({
      name: '@moonwitness/id',
      level: (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
    });

  const app = await buildApp({ ...options, config: { host, port }, logger });
  app.decorate('identityHealth', {
    ...(options.checkDatabase ? { checkDatabase: options.checkDatabase } : {}),
    ...(options.checkMigrations ? { checkMigrations: options.checkMigrations } : {}),
  });
  await app.register(healthRoutes, {
    ...(options.checkDatabase ? { checkDatabase: options.checkDatabase } : {}),
    ...(options.checkMigrations ? { checkMigrations: options.checkMigrations } : {}),
  });
  await app.register(bootstrapRoutes, {
    bootstrapDatabase: options.bootstrapDatabase,
    ...(options.hasPlatformOwner ? { hasPlatformOwner: options.hasPlatformOwner } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.installationScope ? { installationScope: options.installationScope } : {}),
  });
  await app.register(setupPageRoutes, {
    bootstrapDatabase: options.bootstrapDatabase,
    ...(options.hasPlatformOwner ? { hasPlatformOwner: options.hasPlatformOwner } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.installationScope ? { installationScope: options.installationScope } : {}),
  });
  await app.register(authRoutes, {
    database: options.authDatabase ?? options.bootstrapDatabase as AuthDatabasePort | undefined,
    login: options.login ?? identityLogin({
      database: options.authDatabase ?? options.bootstrapDatabase as AuthDatabasePort | undefined,
      ...(options.now ? { now: options.now } : {}),
    }),
    ...(options.now ? { now: options.now } : {}),
    ...(options.production !== undefined ? { production: options.production } : {}),
  });
  await app.ready();
  let started = false;
  const publisherController = new AbortController();
  let publisherPromise: Promise<void> | null = null;

  return {
    app,
    start: async () => {
      if (started) return app.server.address()?.toString() ?? `${host}:${port}`;
      const address = await app.listen({ host, port });
      started = true;
      if (options.outboxDelivery && options.startOutboxPublisher && !publisherPromise) {
        publisherPromise = runOutboxPublisher({
          database: options.bootstrapDatabase as unknown as {
            raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
          },
          delivery: options.outboxDelivery,
          signal: publisherController.signal,
        }).catch(() => undefined);
      }
      return address;
    },
    stop: async () => {
      if (!started) return;
      publisherController.abort();
      if (publisherPromise) await publisherPromise;
      await app.close();
      started = false;
    },
  };
}
