import { createDatabase } from '../database/knex.js';
import { bootstrapApiWorker } from '../addons/registry.js';
import { runSchedulerLoop } from '@moonwitness/jobs';
import {
  readWorkerHealthHost,
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
import { ensureIspCrons, registerIspJobHandlers } from '@moonwitness/orm-isp';
import { ensureCloudCrons, registerCloudJobHandlers } from '@moonwitness/orm-cloud';

const db = createDatabase();
let workerHealth: Awaited<ReturnType<typeof startWorkerHealthServer>> = null;
const services = new ServiceContainer();
const workerHealthToken = createServiceToken<WorkerHealthServer>('api.workerHealth');
const shutdown = createProcessShutdownController(() => workerHealth?.beginDrain('SIGTERM'), {
  services,
});

try {
  await bootstrapApiWorker(db);
  await ensureWhatsAppAttachmentCron(db);
  await ensureIspCrons(db);
  await ensureCloudCrons(db);
  const unregisterWhatsAppAttachmentJob = registerWhatsAppAttachmentJob(db);
  const unregisterIsp = registerIspJobHandlers();
  const unregisterCloud = registerCloudJobHandlers();
  if (!shutdown.signal.aborted) {
    workerHealth = await startWorkerHealthServer({
      db,
      host: readWorkerHealthHost(process.env.WORKER_HEALTH_HOST, 'WORKER_HEALTH_HOST'),
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
    unregisterCloud();
    unregisterIsp();
    unregisterWhatsAppAttachmentJob();
  }
} finally {
  shutdown.dispose();
  await workerHealth?.close();
  await db.destroy();
}
