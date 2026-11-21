import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { MAX_ATTACHMENT_BYTES } from '@moonwitness/types';
import { createAttachmentScanner } from '../whatsapp/clamav-scanner.js';
import type { WhatsappRouteOptions } from '../whatsapp/route-helpers.js';
import { registerWhatsAppMediaRoutes } from './whatsapp/media.routes.js';
import { registerWhatsAppWebhookRoutes } from './whatsapp/webhooks.routes.js';
import { registerWhatsAppStatusRoutes } from './whatsapp/statuses.routes.js';
import { registerWhatsAppAccountRoutes } from './whatsapp/accounts.routes.js';
import { registerWhatsAppTriageRoutes } from './whatsapp/triage.routes.js';
import { registerWhatsAppConversationRoutes } from './whatsapp/conversations.routes.js';
import { registerWhatsAppGroupRoutes } from './whatsapp/groups.routes.js';
import { registerWhatsAppGroupManagementRoutes } from './whatsapp/group-management.routes.js';
import { registerWhatsAppMessageRoutes } from './whatsapp/messages.routes.js';
import { registerWhatsAppMessageActionRoutes } from './whatsapp/message-actions.routes.js';

export const whatsappRoutes: FastifyPluginAsync<WhatsappRouteOptions> = async (app, options) => {
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
