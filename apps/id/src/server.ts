import { buildApp, type BuildAppOptions } from './app.js';
import { createLogger, type LogLevel } from '@moonwitness/logger';

export interface IdentityServerOptions extends BuildAppOptions {
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
