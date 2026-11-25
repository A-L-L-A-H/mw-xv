import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerJobHandler, runWorkerLoop } from '@moonwitness/jobs';
import { registerWorkflowExpiryHandler } from '@moonwitness/orm-workflow';
import { registerIspJobHandlers } from '@moonwitness/orm-isp';
import { registerCloudJobHandlers } from '@moonwitness/orm-cloud';
import { registerWhatsAppAttachmentJob } from './whatsapp-attachments-job.js';
import { startWorkerCommand } from './worker-bootstrap.js';

await startWorkerCommand({
  name: 'jobs-worker',
  healthPortEnvVar: 'JOBS_WORKER_HEALTH_PORT',
  async setup({ db, registerCleanup }) {
    registerCleanup(registerWhatsAppAttachmentJob(db));
    const handlerModule = process.env.JOB_HANDLERS_MODULE;
    if (handlerModule) await import(pathToFileURL(path.resolve(handlerModule)).href);
  },
  async run({ signal, getWorkerHealth, registerCleanup }) {
    registerCleanup(
      registerJobHandler({
        name: 'example.noop',
        version: 1,
        parse(payload: unknown): unknown {
          return payload;
        },
        async run() {
          return { completed: true };
        },
      })
    );
    registerCleanup(registerWorkflowExpiryHandler());
    registerCleanup(registerIspJobHandlers());
    registerCleanup(registerCloudJobHandlers());
    await runWorkerLoop({ workerId: `moonwitness-${randomUUID()}` }, signal, 1000, {
      onDrainStart: (reason) => getWorkerHealth()?.beginDrain(reason),
      onDrainComplete: (outcome) => {
        // Safe summary only: no job payloads, tokens or connection strings.
        console.info(
          `jobs-worker drain complete: state=${outcome.state} completed=${outcome.completed} ` +
            `abandoned=${outcome.abandoned} timedOut=${outcome.timedOut}`
        );
      },
    });
  },
});
