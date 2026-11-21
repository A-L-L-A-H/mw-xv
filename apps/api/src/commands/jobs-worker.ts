import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../database/knex.js';
import { bootstrapApiAddons } from '../addons/registry.js';
import { registerJobHandler, runWorkerLoop } from '@moonwitness/jobs';
import { readWorkerHealthPort, startWorkerHealthServer } from './worker-health.js';
import { registerWorkflowExpiryHandler } from '@moonwitness/orm-workflow';
import { createProcessShutdownController } from '../lifecycle/process-shutdown.js';
import { registerWhatsAppAttachmentJob } from './whatsapp-attachments-job.js';

const db = createDatabase();
let workerHealth: Awaited<ReturnType<typeof startWorkerHealthServer>> = null;
const shutdown = createProcessShutdownController(() => {
  workerHealth?.setReady(false);
});

try {
  await bootstrapApiAddons(db, process.env.SUPERADMIN_PASSWORD, undefined, {
    skipBootMigrations: process.env.SKIP_BOOT_MIGRATIONS === 'true',
  });
  const unregisterWhatsAppAttachmentJob = registerWhatsAppAttachmentJob(db);
  const handlerModule = process.env.JOB_HANDLERS_MODULE;
  if (handlerModule) await import(pathToFileURL(path.resolve(handlerModule)).href);
  if (!shutdown.signal.aborted) {
    workerHealth = await startWorkerHealthServer({
      db,
      host: process.env.WORKER_HEALTH_HOST || '127.0.0.1',
      name: 'jobs-worker',
      port: readWorkerHealthPort(process.env.JOBS_WORKER_HEALTH_PORT, 'JOBS_WORKER_HEALTH_PORT'),
    });
  }
  const unregisterExample = registerJobHandler({
    name: 'example.noop',
    version: 1,
    parse(payload: unknown): unknown {
      return payload;
    },
    async run() {
      return { completed: true };
    },
  });
  const unregisterWorkflow = registerWorkflowExpiryHandler();
  try {
    await runWorkerLoop({ workerId: `moonwitness-${randomUUID()}` }, shutdown.signal);
  } finally {
    unregisterWorkflow();
    unregisterExample();
    unregisterWhatsAppAttachmentJob();
  }
} finally {
  shutdown.dispose();
  await workerHealth?.close();
  await db.destroy();
}
