import { createDatabase } from '../database/knex.js';
import { bootstrapApiAddons } from '../addons/registry.js';
import { runSchedulerLoop } from '@moonwitness/jobs';
import {
  readWorkerHealthPort,
  startWorkerHealthServer,
  type WorkerHealthServer,
} from './worker-health.js';
import { createProcessShutdownController } from '../lifecycle/process-shutdown.js';
import { ServiceContainer, createServiceToken } from '@moonwitness/orm';
import {
  ensureWhatsAppAttachmentCron,
  registerWhatsAppAttachmentJob,
} from './whatsapp-attachments-job.js';

const db = createDatabase();
let workerHealth: Awaited<ReturnType<typeof startWorkerHealthServer>> = null;
const services = new ServiceContainer();
const workerHealthToken = createServiceToken<WorkerHealthServer>('api.workerHealth');
const shutdown = createProcessShutdownController(() => workerHealth?.setReady(false), { services });

try {
  await bootstrapApiAddons(db, process.env.SUPERADMIN_PASSWORD, undefined, {
    skipBootMigrations: process.env.SKIP_BOOT_MIGRATIONS === 'true',
  });
  await ensureWhatsAppAttachmentCron(db);
  const unregisterWhatsAppAttachmentJob = registerWhatsAppAttachmentJob(db);
  if (!shutdown.signal.aborted) {
    workerHealth = await startWorkerHealthServer({
      db,
      host: process.env.WORKER_HEALTH_HOST || '127.0.0.1',
      name: 'jobs-scheduler',
      port: readWorkerHealthPort(
        process.env.JOBS_SCHEDULER_HEALTH_PORT,
        'JOBS_SCHEDULER_HEALTH_PORT'
      ),
    });
    services.register(workerHealthToken, workerHealth, () => workerHealth?.close());
  }
  try {
    await runSchedulerLoop(shutdown.signal);
  } finally {
    unregisterWhatsAppAttachmentJob();
  }
} finally {
  shutdown.dispose();
  await workerHealth?.close();
  await db.destroy();
}
