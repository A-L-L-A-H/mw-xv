import { formatStartupFailure, startupErrorContext } from './startup-diagnostics.js';

async function main() {
  try {
    // Keep configuration and app imports inside the guarded startup path. ESM
    // evaluates static imports before main() and would otherwise bypass this catch.
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
      'API server listening'
    );

    if (process.env.PRINT_ROUTES !== 'false') {
      const lines = [...app.routeList]
        .sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method))
        .map((r) => `  ${r.method.padEnd(7)} ${r.url}`);
      app.log.info(`Available routes (${lines.length}):\n${lines.join('\n')}`);
    }

    let shutdownInProgress = false;
    const shutdown = async (signal: NodeJS.Signals) => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;
      try {
        await gracefulShutdown(
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
          },
          signal
        );
      } catch (error) {
        app.log.error({ err: startupErrorContext(error) }, 'API shutdown failed');
        process.exitCode = 1;
      }
    };

    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
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

    if (process.env.SKIP_BOOT_MIGRATIONS === 'true') {
      void waitForSchemaReady(app.db, { desired })
        .then(async () => {
          await registerApiAddons(app.db);
          await verifyDefaultBaseAccounts(app.db, true);
          app.schemaReadiness.ready = true;
          app.schemaReadiness.status = 'applied';
          app.schemaReadiness.version = desired.version;
          app.schemaReadiness.digest = desired.digest;
          app.log.info('Startup checks passed: database, base addon and default accounts.');
        })
        .catch(async (error) => {
          app.log.fatal({ err: startupErrorContext(error) }, 'Schema readiness check failed');
          process.exitCode = 1;
          await shutdown('SIGTERM');
        });
    } else {
      void runApiSchemaMigration(migrationDb, {
        desired,
        readiness: app.schemaReadiness,
        migrate: async () => {
          await installApiAddons(migrationDb, config.superadminPassword, undefined, {
            skipBootMigrations: false,
          });
          await registerApiAddons(app.db);
          await verifyDefaultBaseAccounts(app.db, true);
        },
      })
        .then(() => {
          app.log.info('Startup checks passed: database, base addon and default accounts.');
        })
        .catch(async (error) => {
          app.log.fatal({ err: startupErrorContext(error) }, 'Schema migration failed');
          process.exitCode = 1;
          await shutdown('SIGTERM');
        });
    }
  } catch (err) {
    console.error(formatStartupFailure(err));
    process.exit(1);
  }
}

main();
