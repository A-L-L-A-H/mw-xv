import Fastify, { LogController } from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { createLocalAiRuntime, type LocalAiRuntime } from '@moonwitness/local-ai';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import type { Knex } from 'knex';
import {
  LocalFileAttachmentStorage,
  S3AttachmentStorage,
  closeS3AttachmentStorage,
  type AttachmentStorage,
} from '@moonwitness/orm-storage';
import { createLogger, type LogLevel } from '@moonwitness/logger';
import { isRecord, PlatformError } from '@moonwitness/types';
import ormPlugin from './plugins/orm.plugin.js';
import authPlugin, { validateJwtSecret } from './plugins/auth.plugin.js';
import observabilityPlugin from './plugins/observability.plugin.js';
import { createPostgresRateLimitStoreCtor } from './plugins/rate-limit-store.js';
import { config, localAiConfig } from './config/env.js';
import { createDatabase } from './database/knex.js';
import { databaseErrorCode, databaseErrorContext } from './database/errors.js';
import { installPrivacySafeNotFoundHandler } from './not-found.js';
import { createAttachmentStorage } from './storage/attachment-storage.js';
import { whatsappLogErrorContext } from './whatsapp/log-redaction.js';
import type { AttachmentScanner } from './whatsapp/clamav-scanner.js';
import type { createVideoPoster } from './whatsapp/media-thumbnail.js';
import { installApiAddons, registerApiAddonRoutes } from './addons/registry.js';

declare module 'fastify' {
  interface FastifyInstance {
    localAi: LocalAiRuntime;
  }
}

function errorProperty(error: unknown, key: string): unknown {
  return isRecord(error) && key in error ? error[key] : undefined;
}

export interface BuildAppOptions {
  db?: Knex;
  /** Overrides SUPERADMIN_PASSWORD (used by tests). */
  superadminPassword?: string;
  /** Overrides JWT_SECRET (used by tests). */
  jwtSecret?: string;
  /** Overrides AUTH_LOGIN_RATE_MAX (used by tests). */
  loginRateMax?: number;
  metricsToken?: string;
  /** Overrides the WhatsApp gateway probe for isolated tests. */
  checkWhatsAppGateway?: () => Promise<boolean>;
  /** Overrides attachment storage for isolated tests or custom providers. */
  attachmentStorage?: AttachmentStorage;
  /** Overrides the malware scanner for isolated tests. */
  attachmentScanner?: AttachmentScanner | null;
  /** Overrides video poster generation for isolated tests. */
  createVideoPoster?: typeof createVideoPoster;
  /** Overrides contact avatar CDN access for isolated tests. */
  fetchContactAvatar?: typeof fetch;
  /** @deprecated Use attachmentStorage; retained for existing test/app callers. */
  attachmentStorageDirectory?: string;
}

function requestIdFromHeader(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(candidate) ? candidate : null;
}

export function resolveCorsOrigin(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv = config.env
): boolean | string[] {
  const raw = env.CORS_ORIGINS?.trim();
  if (raw) {
    const origins = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const origin of origins) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`CORS_ORIGINS entry must be a valid http or https origin: ${origin}`);
      }
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error(`CORS_ORIGINS entry must be an origin without path/query: ${origin}`);
      }
    }
    return origins;
  }
  return nodeEnv === 'production' ? false : true;
}

function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env, nodeEnv = config.env): boolean {
  if (env.TRUST_PROXY === 'true') return true;
  if (env.TRUST_PROXY === 'false') return false;
  return nodeEnv === 'production';
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const authConfig = config.auth ?? {
    accessTtlSeconds: 15 * 60,
    refreshTtlSeconds: 14 * 24 * 60 * 60,
    loginRateMax: 10,
  };
  const jwtSecret = validateJwtSecret(options.jwtSecret ?? authConfig.jwtSecret);
  const superadminPassword = options.superadminPassword ?? config.superadminPassword;
  if (superadminPassword && (superadminPassword.length < 6 || superadminPassword.length > 1024)) {
    throw new Error('SUPERADMIN_PASSWORD must be between 6 and 1024 characters when configured');
  }

  const db = options.db ?? createDatabase();
  try {
    await installApiAddons(db, superadminPassword);
  } catch (error) {
    if (!options.db) await db.destroy();
    throw error;
  }

  const appLogger: FastifyBaseLogger = createLogger({
    name: 'api',
    level: (config.log?.level as LogLevel) ?? (config.env === 'test' ? 'silent' : 'info'),
    logDir: config.log?.dir,
    logFileName: config.log?.fileName,
    enableFile: config.log?.enableFile,
    prettyPrint: config.log?.prettyPrint,
  });

  const app = Fastify({
    bodyLimit: 1024 * 1024,
    trustProxy: resolveTrustProxy(),
    requestIdHeader: false,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: (request) => requestIdFromHeader(request.headers['x-request-id']) ?? randomUUID(),
    loggerInstance: appLogger,
    ajv: {
      customOptions: {
        coerceTypes: false,
      },
    },
  });
  app.decorate('localAi', createLocalAiRuntime(localAiConfig));

  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ req: request, res: { statusCode: reply.statusCode } }, 'request completed');
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (config.env === 'production') {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  await app.register(observabilityPlugin);

  const routes: { method: string; url: string }[] = [];
  app.decorate('routeList', routes);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || route.url.startsWith('/docs/static')) continue;
      routes.push({ method, url: route.url });
    }
  });

  await app.register(cors, { origin: resolveCorsOrigin() });
  await app.register(sensible);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Fastify Objection Knex - Enterprise ORM API',
        description:
          'High-performance Node.js REST and JSON-RPC API built with @moonwitness/orm and Fastify.',
        version: '1.0.0',
      },
      servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
      tags: [
        { name: 'Auth', description: 'Login, token refresh and current user' },
        { name: 'ORM', description: 'Generic CRUD and RPC endpoints' },
        { name: 'System', description: 'Health and status checks' },
      ],
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  if (config.env !== 'production' || process.env.ENABLE_API_DOCS === 'true') {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
      staticCSP: true,
    });
  }

  await app.register(ormPlugin, { db });
  app.addHook('onClose', async () => db.destroy());

  await app.register(rateLimit, {
    global: false,
    ...(process.env.RATE_LIMIT_STORE === 'postgres'
      ? { store: createPostgresRateLimitStoreCtor(db) as never }
      : {}),
  });
  await app.register(authPlugin, {
    jwtSecret,
    accessTtlSeconds: authConfig.accessTtlSeconds,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PlatformError) {
      const isWhatsAppRoute = request.routeOptions.url?.startsWith('/whatsapp/') === true;
      if (isWhatsAppRoute) {
        request.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp request failed');
      } else {
        request.log.error(error);
      }
      return reply.status(error.httpStatus).send({
        success: false,
        error: isWhatsAppRoute ? 'WhatsApp request failed' : error.message,
        code: error.code ?? error.name,
        requestId: request.id,
        type: error.name,
        ...(isWhatsAppRoute || error.details === undefined ? {} : { data: error.details }),
      });
    }

    const isWhatsAppRoute = request.routeOptions.url?.startsWith('/whatsapp/') === true;
    const code = databaseErrorCode(error);
    if (code) {
      const name = errorProperty(error, 'name');
      request.log.error({ name, ...databaseErrorContext(error) }, 'Database request failed');
      const conflict =
        name === 'UniqueViolationError' ||
        code === '23505' ||
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_BUSY' ||
        code === 'SQLITE_BUSY_SNAPSHOT';
      return reply.status(conflict ? 409 : 500).send({
        success: false,
        error: conflict
          ? code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT'
            ? 'Database is busy; retry the request'
            : 'Unique constraint violation'
          : 'Database request failed',
        code: conflict ? 'DB_CONFLICT' : 'DB_ERROR',
        requestId: request.id,
      });
    }
    if (isWhatsAppRoute) {
      request.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp request failed');
    } else {
      request.log.error(error);
    }

    if (errorProperty(error, 'name') === 'ValidationError') {
      const message = error instanceof Error ? error.message : 'Validation failed';
      return reply.status(400).send({
        success: false,
        error: isWhatsAppRoute ? 'Invalid WhatsApp request' : message,
        code: 'VALIDATION_ERROR',
        requestId: request.id,
        type: 'ValidationError',
        ...(isWhatsAppRoute ? {} : { data: errorProperty(error, 'data') }),
      });
    }

    const statusCode = errorProperty(error, 'statusCode');
    const resolvedStatus = typeof statusCode === 'number' ? statusCode : 500;
    const hideInternalMessage = resolvedStatus >= 500 && config.env === 'production';
    const rawCode = errorProperty(error, 'code');
    return reply.status(resolvedStatus).send({
      success: false,
      error: isWhatsAppRoute
        ? 'WhatsApp request failed'
        : hideInternalMessage
          ? 'Internal Server Error'
          : error instanceof Error
            ? error.message
            : 'Internal Server Error',
      code: typeof rawCode === 'string' ? rawCode : `HTTP_${resolvedStatus}`,
      requestId: request.id,
    });
  });

  installPrivacySafeNotFoundHandler(app);

  const attachmentStorage =
    options.attachmentStorage ??
    (options.attachmentStorageDirectory
      ? new LocalFileAttachmentStorage(options.attachmentStorageDirectory)
      : createAttachmentStorage());
  if (attachmentStorage instanceof S3AttachmentStorage) {
    app.addHook('onClose', async () => closeS3AttachmentStorage(attachmentStorage));
  }

  await registerApiAddonRoutes(app, {
    jwtSecret,
    accessTtlSeconds: authConfig.accessTtlSeconds,
    refreshTtlSeconds: authConfig.refreshTtlSeconds,
    loginRateMax: options.loginRateMax ?? authConfig.loginRateMax,
    metricsToken: options.metricsToken ?? config.metricsToken,
    attachmentStorage,
    attachmentScanner: options.attachmentScanner,
    checkWhatsAppGateway: options.checkWhatsAppGateway,
    createVideoPoster: options.createVideoPoster,
    fetchContactAvatar: options.fetchContactAvatar,
  });

  return app;
}
