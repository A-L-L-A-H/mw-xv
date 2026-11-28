import { formatStartupFailure, startupErrorContext } from './startup-diagnostics.js';
import type { gracefulShutdown } from './lifecycle/graceful-shutdown.js';

type ServerApp = Awaited<ReturnType<(typeof import('./app.js'))['buildApp']>>;

function logRegisteredRoutes(app: ServerApp): void {
  if (process.env.PRINT_ROUTES === 'false') return;
  const lines = [...app.routeList]
    .sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method))
    .map((r) => `  ${r.method.padEnd(7)} ${r.url}`);
  app.log.info(`Available routes (${lines.length}):\n${lines.join('\n')}`);
}

function registerProcessSignals(
  app: ServerApp,
  migrationDb: { destroy(): Promise<void> },
  runGracefulShutdown: typeof gracefulShutdown
): (signal: NodeJS.Signals) => Promise<void> {
  let shutdownInProgress = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    try {
      await runGracefulShutdown(
        {
          close: () => app.close(),
          closeConnections: async () => {
            app.server.closeAllConnections();
            await migrationDb.destroy();
          },
          log: (level, message) => {
            if (level === 'info') app.log.info({ signal }, message);
            else app.log.error({ signal }, message);
          },
          forceExit: (code) => process.exit(code),
        },
        signal
      );
    } catch (error) {
      app.log.error({ err: startupErrorContext(error) }, 'API shutdown failed');
      process.exitCode = 1;
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
    process.once(signal, () => void shutdown(signal));
  }
  process.once('unhandledRejection', (reason) => {
    app.log.fatal({ err: startupErrorContext(reason) }, 'Unhandled promise rejection');
    process.exitCode = 1;
    void shutdown('SIGTERM');
  });
  process.once('uncaughtException', (error) => {
    app.log.fatal({ err: startupErrorContext(error) }, 'Uncaught exception');
    process.exitCode = 1;
    void shutdown('SIGTERM');
  });
  return shutdown;
}

function scheduleSchemaStartup(
  app: ServerApp,
  migrationDb: ReturnType<(typeof import('./database/knex.js'))['createMigrationDatabase']>,
  desired: ReturnType<(typeof import('@moonwitness/orm'))['computeDesiredSchemaState']>,
  superadminPassword: string | undefined,
  onBootFailure: (label: string, error: unknown) => Promise<void>,
  deps: {
    waitForSchemaReady: (typeof import('./database/schema-state.js'))['waitForSchemaReady'];
    runApiSchemaMigration: (typeof import('./database/schema-state.js'))['runApiSchemaMigration'];
    installApiAddons: (typeof import('./addons/registry.js'))['installApiAddons'];
    registerApiAddons: (typeof import('./addons/registry.js'))['registerApiAddons'];
    verifyDefaultBaseAccounts: (typeof import('./startup-checks.js'))['verifyDefaultBaseAccounts'];
  }
): void {
  if (process.env.SKIP_BOOT_MIGRATIONS === 'true') {
    void deps
      .waitForSchemaReady(app.db, { desired })
      .then(async () => {
        await deps.registerApiAddons(app.db);
        await deps.verifyDefaultBaseAccounts(app.db, true);
        Object.assign(app.schemaReadiness, {
          ready: true,
          status: 'applied',
          version: desired.version,
          digest: desired.digest,
        });
        app.log.info('Startup checks passed: database, base addon and default accounts.');
      })
      .catch((error) => void onBootFailure('Schema readiness check failed', error));
    return;
  }
  void deps
    .runApiSchemaMigration(migrationDb, {
      desired,
      readiness: app.schemaReadiness,
      migrate: async () => {
        await deps.installApiAddons(migrationDb, superadminPassword, undefined, {
          skipBootMigrations: false,
        });
        await deps.registerApiAddons(app.db);
        await deps.verifyDefaultBaseAccounts(app.db, true);
      },
    })
    .then(() => app.log.info('Startup checks passed: database, base addon and default accounts.'))
    .catch((error) => void onBootFailure('Schema migration failed', error));
}

async function main() {
  try {
    const { config } = await import('./config/env.js');
    const { validateWhatsAppProductionConfig } = await import('./whatsapp/config.js');
    validateWhatsAppProductionConfig(process.env);
    const { buildApp } = await import('./app.js');
    const { computeDesiredSchemaState, Registry } = await import('@moonwitness/orm');
    const { getApiAddonManifests, installApiAddons, registerApiAddons } =
      await import('./addons/registry.js');
    const { API_SCHEMA_VERSION, runApiSchemaMigration, waitForSchemaReady } =
      await import('./database/schema-state.js');
    const { createMigrationDatabase } = await import('./database/knex.js');
    const { verifyDefaultBaseAccounts, verifyRequiredModels } = await import('./startup-checks.js');
    const { gracefulShutdown } = await import('./lifecycle/graceful-shutdown.js');

    const app = await buildApp({ installSchema: false });
    verifyRequiredModels(Registry.getNames());
    const migrationDb = createMigrationDatabase();
    const desired = computeDesiredSchemaState(getApiAddonManifests(), API_SCHEMA_VERSION);
    const address = await app.listen({ port: config.port, host: config.host });
    app.log.info(
      { address, docs: `${address}/docs`, models: Registry.getNames() },
      'API listening'
    );
    logRegisteredRoutes(app);

    const shutdown = registerProcessSignals(app, migrationDb, gracefulShutdown);
    const onBootFailure = async (label: string, error: unknown) => {
      app.log.fatal({ err: startupErrorContext(error) }, label);
      process.exitCode = 1;
      await shutdown('SIGTERM');
    };
    scheduleSchemaStartup(app, migrationDb, desired, config.superadminPassword, onBootFailure, {
      waitForSchemaReady,
      runApiSchemaMigration,
      installApiAddons,
      registerApiAddons,
      verifyDefaultBaseAccounts,
    });
  } catch (err) {
    console.error(formatStartupFailure(err));
    process.exit(1);
  }
}

main();
