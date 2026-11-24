import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../database/knex.js';
import { bootstrapApiWorker } from '../addons/registry.js';
import { registerJobHandler, runWorkerLoop } from '@moonwitness/jobs';
import {
  readWorkerHealthHost,
  readWorkerHealthPort,
  startWorkerHealthServer,
  type WorkerHealthServer,
} from './worker-health.js';
import { registerWorkflowExpiryHandler } from '@moonwitness/orm-workflow';
import { registerIspJobHandlers } from '@moonwitness/orm-isp';
import { registerCloudJobHandlers } from '@moonwitness/orm-cloud';
import { createProcessShutdownController } from '../lifecycle/process-shutdown.js';
import { ServiceContainer, createServiceToken } from '@moonwitness/orm';
import { registerWhatsAppAttachmentJob } from './whatsapp-attachments-job.js';

const db = createDatabase();
let workerHealth: Awaited<ReturnType<typeof startWorkerHealthServer>> = null;
const services = new ServiceContainer();
const workerHealthToken = createServiceToken<WorkerHealthServer>('api.workerHealth');
const shutdown = createProcessShutdownController(() => workerHealth?.beginDrain('SIGTERM'), {
  services,
});

try {
  await bootstrapApiWorker(db);
  const unregisterWhatsAppAttachmentJob = registerWhatsAppAttachmentJob(db);
  const handlerModule = process.env.JOB_HANDLERS_MODULE;
  if (handlerModule) await import(pathToFileURL(path.resolve(handlerModule)).href);
  if (!shutdown.signal.aborted) {
    workerHealth = await startWorkerHealthServer({
      db,
      host: readWorkerHealthHost(process.env.WORKER_HEALTH_HOST, 'WORKER_HEALTH_HOST'),
      name: 'jobs-worker',
      port: readWorkerHealthPort(process.env.JOBS_WORKER_HEALTH_PORT, 'JOBS_WORKER_HEALTH_PORT'),
    });
    services.register(workerHealthToken, workerHealth, () => workerHealth?.close());
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
  const unregisterIsp = registerIspJobHandlers();
  const unregisterCloud = registerCloudJobHandlers();
  try {
    await runWorkerLoop({ workerId: `moonwitness-${randomUUID()}` }, shutdown.signal, 1000, {
      onDrainStart: (reason) => workerHealth?.beginDrain(reason),
      onDrainComplete: (outcome) => {
        // Safe summary only: no job payloads, tokens or connection strings.
        console.info(
          `jobs-worker drain complete: state=${outcome.state} completed=${outcome.completed} ` +
            `abandoned=${outcome.abandoned} timedOut=${outcome.timedOut}`
        );
      },
    });
  } finally {
    unregisterCloud();
    unregisterIsp();
    unregisterWorkflow();
    unregisterExample();
    unregisterWhatsAppAttachmentJob();
  }
} finally {
  shutdown.dispose();
  await workerHealth?.close();
  await db.destroy();
}
