import { buildApp } from './app.js';

async function main(): Promise<void> {
  const app = await buildApp();
  const config = app.whatsappConfig;

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down WhatsApp service');
    const forceTimer = setTimeout(() => {
      app.server.closeAllConnections();
    }, 10_000);
    forceTimer.unref();

    try {
      await app.close();
    } catch (error) {
      app.log.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Error during WhatsApp service shutdown'
      );
      process.exitCode = 1;
    } finally {
      clearTimeout(forceTimer);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const address = await app.listen({
    host: config.host,
    port: config.port,
  });

  app.log.info(
    {
      address,
      driver: config.driver,
      docs: `${address}/docs`,
      health: `${address}/healthz`,
    },
    '@moonwitness/whatsapp service listening'
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
