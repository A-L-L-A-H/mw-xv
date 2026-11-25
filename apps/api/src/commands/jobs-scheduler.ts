import { runSchedulerLoop } from '@moonwitness/jobs';
import {
  ensureWhatsAppAttachmentCron,
  registerWhatsAppAttachmentJob,
} from './whatsapp-attachments-job.js';
import { ensureIspCrons, registerIspJobHandlers } from '@moonwitness/orm-isp';
import { ensureCloudCrons, registerCloudJobHandlers } from '@moonwitness/orm-cloud';
import { startWorkerCommand } from './worker-bootstrap.js';

await startWorkerCommand({
  name: 'jobs-scheduler',
  healthPortEnvVar: 'JOBS_SCHEDULER_HEALTH_PORT',
  async setup({ db, registerCleanup }) {
    await ensureWhatsAppAttachmentCron(db);
    await ensureIspCrons(db);
    await ensureCloudCrons(db);
    registerCleanup(registerWhatsAppAttachmentJob(db));
    registerCleanup(registerIspJobHandlers());
    registerCleanup(registerCloudJobHandlers());
  },
  async run({ signal }) {
    await runSchedulerLoop(signal);
  },
});
