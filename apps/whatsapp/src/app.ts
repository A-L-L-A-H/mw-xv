import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import FastifyVite from '@fastify/vite';
import type { Knex } from 'knex';
import { createLogger, type LogLevel } from '@moonwitness/logger';
import {
  BaileysGatewayManager,
  getBaileysGatewayManager,
  setBaileysGatewayManager,
} from '@moonwitness/orm-whatsapp';
import { registerAuthGuard } from './auth.js';
import { forceBaileysDriver, loadConfig, type WhatsappServiceConfig } from './config.js';
import { bootstrapWhatsappOrm, createDatabase } from './db.js';
import { attachBaileysOrmSync, syncDeviceStatusToOrm } from './orm-sync.js';
import { registerApiV1Routes } from './routes/api-v1.js';
import { registerGowaCompatRoutes } from './routes/gowa-compat.js';

export interface BuildWhatsappAppOptions {
  env?: NodeJS.ProcessEnv;
  db?: Knex;
  installSchema?: boolean;
  registerVite?: boolean;
  viteDev?: boolean;
  baileysManager?: BaileysGatewayManager;
}

export interface WhatsappAppContext {
  app: FastifyInstance;
  db: Knex;
  config: WhatsappServiceConfig;
  manager: BaileysGatewayManager;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Knex;
    whatsappConfig: WhatsappServiceConfig;
    baileysManager: BaileysGatewayManager;
  }
}

export async function buildApp(options: BuildWhatsappAppOptions = {}): Promise<FastifyInstance> {
  forceBaileysDriver(options.env ?? process.env);
  const config = loadConfig(options.env ?? process.env);
  const ownsDb = !options.db;
  const db = options.db ?? createDatabase(config);

  try {
    await bootstrapWhatsappOrm(db, { installSchema: options.installSchema });
  } catch (error) {
    if (ownsDb) await db.destroy();
    throw error;
  }

  const logger = createLogger({
    name: 'whatsapp',
    level: (process.env.LOG_LEVEL as LogLevel) ?? (config.nodeEnv === 'test' ? 'silent' : 'info'),
    enableFile: process.env.LOG_TO_FILE === 'true' && config.nodeEnv !== 'test',
    prettyPrint: process.env.LOG_PRETTY !== 'false' && config.nodeEnv === 'development',
  }) as unknown as FastifyBaseLogger;

  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 1024 * 1024,
  });

  const ownsManager = !options.baileysManager;
  const manager =
    options.baileysManager ??
    new BaileysGatewayManager({
      authDir: config.baileysAuthDir,
      onConnectionUpdate: (event) => {
        void syncDeviceStatusToOrm(db, event).catch((error: unknown) => {
          app.log.warn(
            {
              err: error instanceof Error ? error.message : String(error),
              deviceId: event.deviceId,
            },
            'Failed to sync Baileys connection update to ORM'
          );
        });
      },
    });
  setBaileysGatewayManager(manager);

  const detachInboundSync = attachBaileysOrmSync(manager, db, config, app.log);

  app.decorate('db', db);
  app.decorate('whatsappConfig', config);
  app.decorate('baileysManager', manager);

  await app.register(cors, { origin: config.corsOrigins });
  await app.register(sensible);
  await app.register(multipart, {
    limits: {
      fileSize: 16 * 1024 * 1024,
      files: 1,
    },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'MoonWitness WhatsApp Service',
        description:
          'Standalone WhatsApp service powered by Fastify 5, @moonwitness/orm-whatsapp, and native Baileys.',
        version: '1.0.0-rc.1',
      },
      servers: [{ url: config.publicUrl }],
      tags: [
        { name: 'Health', description: 'Liveness and readiness probes' },
        {
          name: 'GoWA Compatibility',
          description: 'Drop-in GoWA REST endpoints backed by Baileys',
        },
        { name: 'ORM API v1', description: 'Standalone @moonwitness/orm WhatsApp REST endpoints' },
      ],
      components: {
        securitySchemes: {
          basicAuth: { type: 'http', scheme: 'basic' },
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ basicAuth: [] }, { bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  registerAuthGuard(app, config);
  registerGowaCompatRoutes(app, db, config);
  registerApiV1Routes(app, db, config);

  const shouldRegisterVite = options.registerVite ?? true;
  if (shouldRegisterVite) {
    const appRoot = path.resolve(import.meta.dirname, '..');
    const builtClientIndex = path.join(appRoot, 'dist', 'client', 'index.html');
    const viteDev =
      options.viteDev ??
      (config.nodeEnv === 'production'
        ? false
        : config.nodeEnv === 'test'
          ? !existsSync(builtClientIndex)
          : true);

    await app.register(FastifyVite, {
      root: appRoot,
      dev: viteDev,
      spa: true,
    });

    app.get('/', async (_req, reply) => reply.html());
    await app.vite.ready();
  }

  app.addHook('onClose', async () => {
    detachInboundSync();
    await manager.closeAll().catch(() => undefined);
    if (ownsManager || getBaileysGatewayManager() === manager) {
      setBaileysGatewayManager(null);
    }
    if (ownsDb) {
      await db.destroy();
    }
  });

  return app;
}
