import { buildApp, type BuildAppOptions } from './app.js';
import { createLogger, type LogLevel } from '@moonwitness/logger';
import { healthRoutes, type HealthRoutesOptions } from './routes/health.routes.js';
import { bootstrapRoutes, type BootstrapRoutesOptions } from './routes/bootstrap.routes.js';
import { setupPageRoutes } from './ui/setup-page.js';

export interface IdentityServerOptions
  extends BuildAppOptions,
    HealthRoutesOptions,
    BootstrapRoutesOptions {
  readonly host?: string;
  readonly port?: number;
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
  await app.ready();
  let started = false;

  return {
    app,
    start: async () => {
      if (started) return app.server.address()?.toString() ?? `${host}:${port}`;
      const address = await app.listen({ host, port });
      started = true;
      return address;
    },
    stop: async () => {
      if (!started) return;
      await app.close();
      started = false;
    },
  };
}
