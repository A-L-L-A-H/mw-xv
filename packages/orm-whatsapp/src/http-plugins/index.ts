import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { MAX_ATTACHMENT_BYTES } from '@moonwitness/types';
import '../runtime/fastify-augment.js';
import { createAttachmentScanner } from '../runtime/clamav-scanner.js';
import type { WhatsappRouteOptions } from '../runtime/route-helpers.js';
import { registerWhatsAppMediaRoutes } from './media.routes.js';
import { registerWhatsAppWebhookRoutes } from './webhooks.routes.js';
import { registerWhatsAppStatusRoutes } from './statuses.routes.js';
import { registerWhatsAppAccountRoutes } from './accounts.routes.js';
import { registerWhatsAppTriageRoutes } from './triage.routes.js';
import { registerWhatsAppConversationRoutes } from './conversations.routes.js';
import { registerWhatsAppGroupRoutes } from './groups.routes.js';
import { registerWhatsAppGroupManagementRoutes } from './group-management.routes.js';
import { registerWhatsAppMessageRoutes } from './messages.routes.js';
import { registerWhatsAppMessageActionRoutes } from './message-actions.routes.js';

export const whatsappHttpPlugin: FastifyPluginAsync<WhatsappRouteOptions> = async (
  app,
  options
) => {
  const attachmentScanner =
    options.attachmentScanner === undefined ? createAttachmentScanner() : options.attachmentScanner;
  registerWhatsAppMediaRoutes(app, options, attachmentScanner);
  await app.register(multipart, {
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 5, fieldSize: 16 * 1024 },
  });
  registerWhatsAppWebhookRoutes(app, options);
  registerWhatsAppStatusRoutes(app, options, attachmentScanner);
  registerWhatsAppAccountRoutes(app, options);
  registerWhatsAppTriageRoutes(app);
  registerWhatsAppConversationRoutes(app, options);
  registerWhatsAppGroupRoutes(app, options);
  registerWhatsAppGroupManagementRoutes(app);
  registerWhatsAppMessageRoutes(app, options, attachmentScanner);
  registerWhatsAppMessageActionRoutes(app, options);
};

export {
  registerWhatsAppMediaRoutes,
  registerWhatsAppWebhookRoutes,
  registerWhatsAppStatusRoutes,
  registerWhatsAppAccountRoutes,
  registerWhatsAppTriageRoutes,
  registerWhatsAppConversationRoutes,
  registerWhatsAppGroupRoutes,
  registerWhatsAppGroupManagementRoutes,
  registerWhatsAppMessageRoutes,
  registerWhatsAppMessageActionRoutes,
};
