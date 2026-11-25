import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runOutboxLoop } from '@moonwitness/jobs';
import { registerNotificationOutboxConsumer } from '@moonwitness/orm-notification';
import { registerWebhookOutboxConsumer } from '@moonwitness/orm-integration';
import { createServiceToken } from '@moonwitness/orm';
import { registerWhatsAppOutboxConsumer } from '../whatsapp/outbox-consumer.js';
import { createAttachmentStorage } from '../storage/attachment-storage.js';
import {
  closeS3AttachmentStorage,
  S3AttachmentStorage,
  type AttachmentStorage,
} from '@moonwitness/orm-storage';
import { validateWhatsAppProductionConfig } from '../whatsapp/config.js';
import { startWorkerCommand } from './worker-bootstrap.js';

validateWhatsAppProductionConfig(process.env);
const attachmentStorageToken = createServiceToken<AttachmentStorage>('api.attachmentStorage');

await startWorkerCommand({
  name: 'outbox-worker',
  healthPortEnvVar: 'OUTBOX_WORKER_HEALTH_PORT',
  metricsToken: process.env.METRICS_TOKEN,
  async setup({ services, registerCleanup }) {
    const attachmentStorage = createAttachmentStorage();
    services.register(attachmentStorageToken, attachmentStorage);
    if (attachmentStorage instanceof S3AttachmentStorage) {
      registerCleanup(() => closeS3AttachmentStorage(attachmentStorage));
    }
    registerCleanup(registerNotificationOutboxConsumer());
    registerCleanup(
      registerWebhookOutboxConsumer(async (secretRef, companyId) => {
        if (!secretRef.startsWith(`MW_WEBHOOK_SECRET_C${companyId}_`)) return null;
        if (!/^MW_WEBHOOK_SECRET_C[1-9][0-9]*_[A-Z0-9_]{1,100}$/u.test(secretRef)) return null;
        return process.env[secretRef] ?? null;
      })
    );
    registerCleanup(registerWhatsAppOutboxConsumer(attachmentStorage));
    const consumerModule = process.env.OUTBOX_HANDLERS_MODULE;
    if (consumerModule) await import(pathToFileURL(path.resolve(consumerModule)).href);
  },
  async run({ signal }) {
    await runOutboxLoop(`moonwitness-outbox-${randomUUID()}`, signal);
  },
});
