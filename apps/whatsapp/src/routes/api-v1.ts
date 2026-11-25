import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Knex } from 'knex';
import {
  GowaError,
  WhatsappAccount,
  WhatsappConversation,
  WhatsappMessage,
  WhatsappStatus,
  getBaileysGatewayManager,
  whatsappGatewayRequest,
} from '@moonwitness/orm-whatsapp';
import type { WhatsappServiceConfig } from '../config.js';
import { testDatabaseConnection } from '../db.js';
import {
  queryOrmOverview,
  syncDeviceStatusToOrm,
  syncOutboundMessageToOrm,
  syncStatusBroadcastToOrm,
  type WhatsappAccountRecord,
} from '../orm-sync.js';

function serializeAccountSummary(account: WhatsappAccountRecord) {
  return {
    id: account.id,
    company_id: account.company_id,
    status: account.status,
    phone_number: account.phone_number ?? null,
    gateway_device_id: account.gateway_device_id ?? null,
    last_error: account.last_error ?? null,
    active: account.active,
    create_date: account.create_date,
    write_date: account.write_date,
  };
}

function handleRouteError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof GowaError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: error.message,
      code: error.upstreamCode ?? 'GATEWAY_ERROR',
    });
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return reply.code(500).send({
    success: false,
    error: message,
    code: 'INTERNAL_ERROR',
  });
}

export function registerApiV1Routes(
  app: FastifyInstance,
  db: Knex,
  config: WhatsappServiceConfig
): void {
  const healthTag = ['Health'];
  const v1Tag = ['ORM API v1'];

  app.get('/healthz', { schema: { tags: healthTag, summary: 'Liveness probe' } }, async () => ({
    status: 'ok',
    service: '@moonwitness/whatsapp',
    driver: config.driver,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  app.get(
    '/readyz',
    { schema: { tags: healthTag, summary: 'Database and ORM readiness probe' } },
    async (_req, reply) => {
      const dbOk = await testDatabaseConnection(db);
      const devices = getBaileysGatewayManager().listDevices();
      const statusCode = dbOk ? 200 : 503;
      return reply.code(statusCode).send({
        status: dbOk ? 'ready' : 'unavailable',
        database: dbOk ? 'connected' : 'disconnected',
        driver: config.driver,
        devices: devices.length,
        timestamp: new Date().toISOString(),
      });
    }
  );

  app.get(
    '/api/v1/overview',
    { schema: { tags: v1Tag, summary: 'Service topology and ORM telemetry overview' } },
    async () => {
      const manager = getBaileysGatewayManager();
      const counts = await queryOrmOverview(db);
      return {
        success: true,
        data: {
          service: '@moonwitness/whatsapp',
          driver: config.driver,
          topology: {
            board: 'apps/board',
            api: 'apps/api',
            whatsapp: 'apps/whatsapp',
          },
          public_url: config.publicUrl,
          webhook_configured: Boolean(config.webhookUrl && config.webhookSecret),
          counts,
          devices: manager.listDevices(),
        },
      };
    }
  );

  app.get(
    '/api/v1/devices',
    { schema: { tags: v1Tag, summary: 'List Baileys devices and synced ORM accounts' } },
    async () => {
      const manager = getBaileysGatewayManager();
      const accounts = await WhatsappAccount.query(db).orderBy('id', 'asc');
      const devices = manager.listDevices();
      return {
        success: true,
        data: devices,
        accounts: accounts.map(serializeAccountSummary),
      };
    }
  );

  app.post<{ Body: { device_id?: string; phone_number?: string } }>(
    '/api/v1/devices',
    { schema: { tags: v1Tag, summary: 'Connect or register a Baileys device' } },
    async (req, reply) => {
      try {
        const deviceId = req.body?.device_id?.trim() || 'default';
        const phoneNumber = req.body?.phone_number?.trim() || undefined;
        const manager = getBaileysGatewayManager();
        const device = await manager.connect(deviceId, phoneNumber ? { phoneNumber } : {});
        const account = await syncDeviceStatusToOrm(db, device);
        return reply.code(201).send({
          success: true,
          data: { device, account: serializeAccountSummary(account) },
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Params: { deviceId: string }; Body: { phone?: string } }>(
    '/api/v1/devices/:deviceId/pairing-code',
    { schema: { tags: v1Tag, summary: 'Request a WhatsApp pairing code' } },
    async (req, reply) => {
      try {
        const phone = req.body?.phone?.trim() ?? '';
        if (!phone) {
          return reply.code(400).send({
            success: false,
            error: 'phone is required',
            code: 'INVALID_PHONE',
          });
        }
        const manager = getBaileysGatewayManager();
        const pairingCode = await manager.requestPairingCode(req.params.deviceId, phone);
        const device = manager.getDeviceStatus(req.params.deviceId);
        const account = await syncDeviceStatusToOrm(db, device);
        return {
          success: true,
          data: {
            device_id: device.deviceId,
            pairing_code: pairingCode,
            device,
            account: serializeAccountSummary(account),
          },
        };
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Params: { deviceId: string } }>(
    '/api/v1/devices/:deviceId/reconnect',
    { schema: { tags: v1Tag, summary: 'Reconnect a Baileys device' } },
    async (req, reply) => {
      try {
        const manager = getBaileysGatewayManager();
        const device = await manager.reconnect(req.params.deviceId);
        const account = await syncDeviceStatusToOrm(db, device);
        return {
          success: true,
          data: { device, account: serializeAccountSummary(account) },
        };
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Params: { deviceId: string } }>(
    '/api/v1/devices/:deviceId/logout',
    { schema: { tags: v1Tag, summary: 'Logout and clear auth state for a device' } },
    async (req, reply) => {
      try {
        const manager = getBaileysGatewayManager();
        await manager.logout(req.params.deviceId);
        const device = manager.getDeviceStatus(req.params.deviceId);
        const account = await syncDeviceStatusToOrm(db, device);
        return {
          success: true,
          data: { status: 'disconnected', device, account: serializeAccountSummary(account) },
        };
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get<{ Params: { deviceId: string } }>(
    '/api/v1/devices/:deviceId/qr',
    { schema: { tags: v1Tag, summary: 'Get device QR code payload and data URL' } },
    async (req, reply) => {
      try {
        const status = getBaileysGatewayManager().getDeviceStatus(req.params.deviceId);
        return {
          success: true,
          data: {
            device_id: status.deviceId,
            status: status.status,
            qr: status.qr,
            qr_data_url: status.qrDataUrl,
            pairing_code: status.pairingCode,
          },
        };
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get(
    '/api/v1/accounts',
    { schema: { tags: v1Tag, summary: 'List ORM whatsapp_accounts' } },
    async () => {
      const accounts = await WhatsappAccount.query(db).orderBy('id', 'asc');
      return { success: true, data: accounts.map(serializeAccountSummary) };
    }
  );

  app.get<{
    Querystring: { account_id?: string; search?: string; limit?: string; offset?: string };
  }>(
    '/api/v1/conversations',
    { schema: { tags: v1Tag, summary: 'List ORM whatsapp_conversations' } },
    async (req) => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
      const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      const query = WhatsappConversation.query(db);

      if (req.query.account_id) {
        const accountId = Number(req.query.account_id);
        if (Number.isInteger(accountId) && accountId > 0) {
          query.where('account_id', accountId);
        }
      }
      const search = req.query.search?.trim().toLowerCase();
      if (search) {
        const pattern = `%${search}%`;
        query.where((builder) =>
          builder
            .whereRaw('LOWER(name) LIKE ?', [pattern])
            .orWhereRaw('LOWER(jid) LIKE ?', [pattern])
        );
      }

      const conversations = await query
        .orderBy('is_pinned', 'desc')
        .orderBy('last_message_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .offset(offset);

      return { success: true, data: conversations };
    }
  );

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string };
  }>(
    '/api/v1/conversations/:id/messages',
    { schema: { tags: v1Tag, summary: 'List ORM whatsapp_messages for a conversation' } },
    async (req, reply) => {
      const conversationId = Number(req.params.id);
      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      }
      const conversation = await WhatsappConversation.query(db).findById(conversationId);
      if (!conversation) {
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      }

      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100) || 100));
      const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      const messages = await WhatsappMessage.query(db)
        .where({ conversation_id: conversationId })
        .orderBy('create_date', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        success: true,
        conversation,
        data: messages,
      };
    }
  );

  app.post<{
    Body: {
      device_id?: string;
      to?: string;
      phone?: string;
      conversation_id?: number;
      message?: string;
      reply_to_message_id?: string;
    };
  }>(
    '/api/v1/messages/send',
    { schema: { tags: v1Tag, summary: 'Send text message via Baileys and persist to ORM' } },
    async (req, reply) => {
      try {
        const messageText = req.body?.message?.trim() ?? '';
        if (!messageText) {
          return reply.code(400).send({
            success: false,
            error: 'message is required',
            code: 'INVALID_MESSAGE',
          });
        }

        let deviceId = req.body?.device_id?.trim() || '';
        let recipient = req.body?.to?.trim() || req.body?.phone?.trim() || '';

        if (!recipient && req.body?.conversation_id) {
          const conversation = await WhatsappConversation.query(db).findById(
            req.body.conversation_id
          );
          if (!conversation) {
            return reply.code(404).send({ success: false, error: 'Conversation not found' });
          }
          recipient = conversation.jid;
          if (!deviceId) {
            const account = await WhatsappAccount.query(db).findById(conversation.account_id);
            if (account?.gateway_device_id) {
              deviceId = account.gateway_device_id;
            }
          }
        }

        if (!recipient) {
          return reply.code(400).send({
            success: false,
            error: 'to, phone, or conversation_id is required',
            code: 'INVALID_RECIPIENT',
          });
        }

        if (!deviceId) {
          const devices = getBaileysGatewayManager().listDevices();
          deviceId = devices[0]?.deviceId || 'default';
        }

        const gatewayResult = await whatsappGatewayRequest<{ message_id: string; id: string }>(
          '/send/message',
          {
            method: 'POST',
            deviceId,
            contentType: 'application/json',
            body: JSON.stringify({
              phone: recipient,
              message: messageText,
              ...(req.body?.reply_to_message_id
                ? { reply_message_id: req.body.reply_to_message_id }
                : {}),
            }),
          }
        );

        const synced = await syncOutboundMessageToOrm(db, {
          deviceId,
          recipient,
          externalId: gatewayResult.message_id,
          content: messageText,
          messageType: 'text',
          replyToExternalId: req.body?.reply_to_message_id ?? null,
          status: 'sent',
        });

        return reply.code(201).send({
          success: true,
          data: {
            message_id: gatewayResult.message_id,
            conversation: synced.conversation,
            message: synced.message,
          },
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get(
    '/api/v1/statuses',
    { schema: { tags: v1Tag, summary: 'List ORM whatsapp_statuses' } },
    async () => {
      const statuses = await WhatsappStatus.query(db).orderBy('id', 'desc').limit(50);
      return { success: true, data: statuses };
    }
  );

  app.post<{ Body: { device_id?: string; text?: string; content?: string } }>(
    '/api/v1/statuses',
    { schema: { tags: v1Tag, summary: 'Publish a WhatsApp status broadcast and persist to ORM' } },
    async (req, reply) => {
      try {
        const text = (req.body?.text ?? req.body?.content ?? '').trim();
        if (!text) {
          return reply.code(400).send({
            success: false,
            error: 'text is required',
            code: 'INVALID_STATUS',
          });
        }
        const deviceId =
          req.body?.device_id?.trim() ||
          getBaileysGatewayManager().listDevices()[0]?.deviceId ||
          'default';

        const gatewayResult = await whatsappGatewayRequest<{ message_id: string; id: string }>(
          '/send/message',
          {
            method: 'POST',
            deviceId,
            contentType: 'application/json',
            body: JSON.stringify({
              phone: 'status@broadcast',
              message: text,
            }),
          }
        );

        const statusRecord = await syncStatusBroadcastToOrm(db, {
          deviceId,
          externalId: gatewayResult.message_id,
          statusType: 'text',
          content: text,
          status: 'sent',
        });

        return reply.code(201).send({
          success: true,
          data: statusRecord,
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get(
    '/api/v1/webhook/config',
    { schema: { tags: v1Tag, summary: 'Get outbound webhook configuration status' } },
    async () => ({
      success: true,
      data: {
        configured: Boolean(config.webhookUrl && config.webhookSecret),
        webhook_url: config.webhookUrl,
        has_secret: Boolean(config.webhookSecret),
      },
    })
  );
}
