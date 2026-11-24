import { startObservabilityServer } from './server.js';

async function main(): Promise<void> {
  const handle = await startObservabilityServer();
  console.log(`Agent observability listening at ${handle.address}`);
  console.log(`OTLP/HTTP JSON endpoint: ${handle.address}`);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; closing agent observability`);
    await handle.app.close();
  };

  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
