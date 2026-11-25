import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Knex } from 'knex';
import {
  GowaError,
  getBaileysGatewayManager,
  whatsappGatewayBinary,
  whatsappGatewayRequest,
} from '@moonwitness/orm-whatsapp';
import type { WhatsappServiceConfig } from '../config.js';
import {
  syncDeviceStatusToOrm,
  syncOutboundMessageToOrm,
  syncStatusBroadcastToOrm,
  type WhatsappMessageType,
} from '../orm-sync.js';

function resolveHeaderOrQueryDeviceId(req: FastifyRequest, fallbackToSingle = true): string {
  const headerVal = req.headers['x-device-id'];
  const headerDevice =
    typeof headerVal === 'string'
      ? headerVal.trim()
      : Array.isArray(headerVal)
        ? (headerVal[0]?.trim() ?? '')
        : '';
  if (headerDevice) return headerDevice;

  const query = req.query as Record<string, unknown> | undefined;
  const queryDevice = typeof query?.device_id === 'string' ? query.device_id.trim() : '';
  if (queryDevice) return queryDevice;

  if (fallbackToSingle) {
    const devices = getBaileysGatewayManager().listDevices();
    if (devices.length === 1 && devices[0]?.deviceId) {
      return devices[0].deviceId;
    }
  }
  return 'default';
}

function sendGowaError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof GowaError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: error.message,
      code: error.upstreamCode ?? 'GATEWAY_ERROR',
    });
  }
  const message = error instanceof Error ? error.message : 'WhatsApp gateway request failed';
  return reply.code(500).send({
    success: false,
    error: message,
    code: 'INTERNAL_ERROR',
  });
}

async function sendBinaryResponse(reply: FastifyReply, upstreamPath: string, deviceId?: string) {
  const response = await whatsappGatewayBinary(upstreamPath, deviceId);
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const bytes = Buffer.from(await response.arrayBuffer());
  return reply.code(response.status).header('content-type', contentType).send(bytes);
}

function fullRequestPath(req: FastifyRequest): string {
  return req.url;
}

export function registerGowaCompatRoutes(
  app: FastifyInstance,
  db: Knex,
  _config: WhatsappServiceConfig
): void {
  const tag = ['GoWA Compatibility'];

  app.get(
    '/health',
    { schema: { tags: tag, summary: 'GoWA-compatible health probe' } },
    async () => ({
      status: 'ok',
      service: '@moonwitness/whatsapp',
      driver: 'baileys',
      version: 'v9.6.0',
      timestamp: new Date().toISOString(),
    })
  );

  app.get(
    '/app/info',
    { schema: { tags: tag, summary: 'GoWA-compatible version probe' } },
    async () => ({
      version: 'v9.6.0',
      driver: 'baileys',
      service: '@moonwitness/whatsapp',
    })
  );

  const listDevicesHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await whatsappGatewayRequest('/devices');
    } catch (error) {
      return sendGowaError(reply, error);
    }
  };

  app.get(
    '/devices',
    { schema: { tags: tag, summary: 'List Baileys devices' } },
    listDevicesHandler
  );
  app.get(
    '/app/devices',
    { schema: { tags: tag, summary: 'List Baileys devices (GoWA alias)' } },
    listDevicesHandler
  );

  app.post(
    '/devices',
    { schema: { tags: tag, summary: 'Create or connect a device' } },
    async (req, reply) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await whatsappGatewayRequest<{ device_id: string; status: string }>(
          '/devices',
          {
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify(body),
          }
        );
        await syncDeviceStatusToOrm(
          db,
          getBaileysGatewayManager().getDeviceStatus(result.device_id)
        );
        return result;
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/app/login',
    { schema: { tags: tag, summary: 'Start QR login on default/query device' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        const result = await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
        await syncDeviceStatusToOrm(db, getBaileysGatewayManager().getDeviceStatus(deviceId));
        return result;
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/app/login-with-code',
    { schema: { tags: tag, summary: 'Request pairing code on default/query device' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        const result = await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
        await syncDeviceStatusToOrm(db, getBaileysGatewayManager().getDeviceStatus(deviceId));
        return result;
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  const appLogoutHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const deviceId = resolveHeaderOrQueryDeviceId(req);
      const result = await whatsappGatewayRequest(fullRequestPath(req), {
        method: req.method,
        deviceId,
      });
      await syncDeviceStatusToOrm(db, getBaileysGatewayManager().getDeviceStatus(deviceId));
      return result;
    } catch (error) {
      return sendGowaError(reply, error);
    }
  };

  app.get(
    '/app/logout',
    { schema: { tags: tag, summary: 'Logout default/query device' } },
    appLogoutHandler
  );
  app.post(
    '/app/logout',
    { schema: { tags: tag, summary: 'Logout default/query device' } },
    appLogoutHandler
  );

  const appReconnectHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const deviceId = resolveHeaderOrQueryDeviceId(req);
      const result = await whatsappGatewayRequest(fullRequestPath(req), {
        method: req.method,
        deviceId,
      });
      await syncDeviceStatusToOrm(db, getBaileysGatewayManager().getDeviceStatus(deviceId));
      return result;
    } catch (error) {
      return sendGowaError(reply, error);
    }
  };

  app.get(
    '/app/reconnect',
    { schema: { tags: tag, summary: 'Reconnect default/query device' } },
    appReconnectHandler
  );
  app.post(
    '/app/reconnect',
    { schema: { tags: tag, summary: 'Reconnect default/query device' } },
    appReconnectHandler
  );

  app.get(
    '/app/qr',
    { schema: { tags: tag, summary: 'Get QR PNG for default/query device' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await sendBinaryResponse(reply, fullRequestPath(req), deviceId);
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/devices/:id',
    { schema: { tags: tag, summary: 'Get device summary' } },
    async (req, reply) => {
      try {
        return await whatsappGatewayRequest(`/devices/${encodeURIComponent(req.params.id)}`);
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/devices/:id/status',
    { schema: { tags: tag, summary: 'Get device status and QR metadata' } },
    async (req, reply) => {
      try {
        const result = await whatsappGatewayRequest(
          `/devices/${encodeURIComponent(req.params.id)}/status`
        );
        await syncDeviceStatusToOrm(db, getBaileysGatewayManager().getDeviceStatus(req.params.id));
        return result;
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/devices/:id/login',
    { schema: { tags: tag, summary: 'Start device login' } },
    async (req, reply) => {
      try {
        const result = await whatsappGatewayRequest(
          `/devices/${encodeURIComponent(req.params.id)}/login`
        );
        await syncDeviceStatusToOrm(db, getBaileysGatewayManager().getDeviceStatus(req.params.id));
        return result;
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/devices/:id/logout',
    { schema: { tags: tag, summary: 'Logout device' } },
    async (req, reply) => {
      try {
        const result = await whatsappGatewayRequest(
          `/devices/${encodeURIComponent(req.params.id)}/logout`,
          { method: 'POST' }
        );
        await syncDeviceStatusToOrm(db, getBaileysGatewayManager().getDeviceStatus(req.params.id));
        return result;
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  const deviceReconnectHandler = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const result = await whatsappGatewayRequest(
        `/devices/${encodeURIComponent(req.params.id)}/reconnect`,
        { method: req.method }
      );
      await syncDeviceStatusToOrm(db, getBaileysGatewayManager().getDeviceStatus(req.params.id));
      return result;
    } catch (error) {
      return sendGowaError(reply, error);
    }
  };

  app.get<{ Params: { id: string } }>(
    '/devices/:id/reconnect',
    { schema: { tags: tag, summary: 'Reconnect device' } },
    deviceReconnectHandler
  );
  app.post<{ Params: { id: string } }>(
    '/devices/:id/reconnect',
    { schema: { tags: tag, summary: 'Reconnect device' } },
    deviceReconnectHandler
  );

  app.patch<{ Params: { id: string } }>(
    '/devices/:id/webhook',
    { schema: { tags: tag, summary: 'Configure device webhook metadata' } },
    async (req, reply) => {
      try {
        return await whatsappGatewayRequest(
          `/devices/${encodeURIComponent(req.params.id)}/webhook`,
          {
            method: 'PATCH',
            contentType: 'application/json',
            body: JSON.stringify(req.body ?? {}),
          }
        );
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/devices/:id/qr',
    { schema: { tags: tag, summary: 'Get device QR PNG image' } },
    async (req, reply) => {
      try {
        return await sendBinaryResponse(
          reply,
          `/devices/${encodeURIComponent(req.params.id)}/qr`,
          req.params.id
        );
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/statics/qr/:id.png',
    { schema: { tags: tag, summary: 'Get static QR PNG image' } },
    async (req, reply) => {
      try {
        const cleanId = req.params.id.replace(/\.png$/u, '');
        return await sendBinaryResponse(
          reply,
          `/statics/qr/${encodeURIComponent(cleanId)}.png`,
          cleanId
        );
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post(
    '/send/message',
    { schema: { tags: tag, summary: 'Send WhatsApp text or status broadcast message' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const phone = typeof body.phone === 'string' ? body.phone : '';
        const messageText = typeof body.message === 'string' ? body.message : '';
        const result = await whatsappGatewayRequest<{ message_id: string; id: string }>(
          '/send/message',
          {
            method: 'POST',
            deviceId,
            contentType: 'application/json',
            body: JSON.stringify(body),
          }
        );

        if (phone === 'status@broadcast') {
          await syncStatusBroadcastToOrm(db, {
            deviceId,
            externalId: result.message_id,
            statusType: 'text',
            content: messageText,
            status: 'sent',
          });
        } else if (phone) {
          await syncOutboundMessageToOrm(db, {
            deviceId,
            recipient: phone,
            externalId: result.message_id,
            content: messageText,
            messageType: 'text',
            replyToExternalId:
              typeof body.reply_message_id === 'string' ? body.reply_message_id : null,
            status: 'sent',
          });
        }
        return result;
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post<{ Params: { mediaKind: string } }>(
    '/send/:mediaKind',
    {
      schema: { tags: tag, summary: 'Send WhatsApp media attachment (image, video, audio, file)' },
    },
    async (req, reply) => {
      const mediaKind = req.params.mediaKind;
      if (!['image', 'video', 'audio', 'file'].includes(mediaKind)) {
        return reply.code(404).send({ success: false, error: 'Unsupported media kind' });
      }
      if (!req.isMultipart()) {
        return reply.code(400).send({ success: false, error: 'Multipart FormData is required' });
      }

      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        const formData = new FormData();
        let phone = '';
        let caption = '';
        let fileName: string | null = null;
        let mimeType: string | null = null;

        for await (const part of req.parts()) {
          if (part.type === 'field') {
            const value = String(part.value ?? '');
            formData.append(part.fieldname, value);
            if (part.fieldname === 'phone') phone = value;
            if (part.fieldname === 'caption') caption = value;
          } else {
            const buffer = await part.toBuffer();
            mimeType = part.mimetype || 'application/octet-stream';
            fileName = part.filename || null;
            formData.append(
              part.fieldname,
              new Blob([new Uint8Array(buffer)], { type: mimeType }),
              part.filename || 'attachment'
            );
          }
        }

        const result = await whatsappGatewayRequest<{ message_id: string; id: string }>(
          `/send/${mediaKind}`,
          {
            method: 'POST',
            deviceId,
            body: formData,
          }
        );

        const ormMediaType: WhatsappMessageType =
          mediaKind === 'file' ? 'document' : (mediaKind as 'image' | 'video' | 'audio');

        if (
          phone === 'status@broadcast' &&
          (ormMediaType === 'image' || ormMediaType === 'video')
        ) {
          await syncStatusBroadcastToOrm(db, {
            deviceId,
            externalId: result.message_id,
            statusType: ormMediaType,
            content: caption || fileName || null,
            status: 'sent',
          });
        } else if (phone) {
          await syncOutboundMessageToOrm(db, {
            deviceId,
            recipient: phone,
            externalId: result.message_id,
            content: caption || fileName || '',
            messageType: ormMediaType,
            mediaMimeType: mimeType,
            mediaFileName: fileName,
            status: 'sent',
          });
        }
        return result;
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post(
    '/send/presence',
    { schema: { tags: tag, summary: 'Send presence update' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest('/send/presence', {
          method: 'POST',
          deviceId,
          contentType: 'application/json',
          body: JSON.stringify(req.body ?? {}),
        });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string; action: string } }>(
    '/message/:id/:action',
    { schema: { tags: tag, summary: 'Execute message action (read, reaction, update, revoke)' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(
          `/message/${encodeURIComponent(req.params.id)}/${encodeURIComponent(req.params.action)}`,
          {
            method: 'POST',
            deviceId,
            contentType: 'application/json',
            body: JSON.stringify(req.body ?? {}),
          }
        );
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string; action: string } }>(
    '/message/:id/:action',
    { schema: { tags: tag, summary: 'Download message media metadata' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(
          `/message/${encodeURIComponent(req.params.id)}/${encodeURIComponent(req.params.action)}`,
          { deviceId }
        );
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/chats',
    { schema: { tags: tag, summary: 'List cached Baileys chats' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get<{ Params: { jid: string } }>(
    '/chat/:jid/messages',
    { schema: { tags: tag, summary: 'List cached chat messages' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post<{ Params: { jid: string; action: string } }>(
    '/chat/:jid/:action',
    { schema: { tags: tag, summary: 'Archive or pin a chat' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(
          `/chat/${encodeURIComponent(req.params.jid)}/${encodeURIComponent(req.params.action)}`,
          {
            method: 'POST',
            deviceId,
            contentType: 'application/json',
            body: JSON.stringify(req.body ?? {}),
          }
        );
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/user/check',
    { schema: { tags: tag, summary: 'Verify WhatsApp phone number' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/user/info',
    { schema: { tags: tag, summary: 'Get WhatsApp user info' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/user/avatar',
    { schema: { tags: tag, summary: 'Get WhatsApp user avatar URL' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post(
    '/group',
    { schema: { tags: tag, summary: 'Create WhatsApp group' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest('/group', {
          method: 'POST',
          deviceId,
          contentType: 'application/json',
          body: JSON.stringify(req.body ?? {}),
        });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/group/info',
    { schema: { tags: tag, summary: 'Get WhatsApp group info' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/group/participants',
    { schema: { tags: tag, summary: 'Get group participants' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post(
    '/group/participants',
    { schema: { tags: tag, summary: 'Add group participants' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest('/group/participants', {
          method: 'POST',
          deviceId,
          contentType: 'application/json',
          body: JSON.stringify(req.body ?? {}),
        });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post<{ Params: { action: string } }>(
    '/group/participants/:action',
    { schema: { tags: tag, summary: 'Remove, promote, or demote group participants' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(
          `/group/participants/${encodeURIComponent(req.params.action)}`,
          {
            method: 'POST',
            deviceId,
            contentType: 'application/json',
            body: JSON.stringify(req.body ?? {}),
          }
        );
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post(
    '/group/locked',
    { schema: { tags: tag, summary: 'Toggle group locked setting' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest('/group/locked', {
          method: 'POST',
          deviceId,
          contentType: 'application/json',
          body: JSON.stringify(req.body ?? {}),
        });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post(
    '/group/announce',
    { schema: { tags: tag, summary: 'Toggle group announce setting' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest('/group/announce', {
          method: 'POST',
          deviceId,
          contentType: 'application/json',
          body: JSON.stringify(req.body ?? {}),
        });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/group/invite-link',
    { schema: { tags: tag, summary: 'Get or reset group invite link' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.get(
    '/group/info-from-link',
    { schema: { tags: tag, summary: 'Preview group info from invite link' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest(fullRequestPath(req), { deviceId });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post(
    '/group/join-with-link',
    { schema: { tags: tag, summary: 'Join group via invite link' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest('/group/join-with-link', {
          method: 'POST',
          deviceId,
          contentType: 'application/json',
          body: JSON.stringify(req.body ?? {}),
        });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );

  app.post(
    '/group/leave',
    { schema: { tags: tag, summary: 'Leave WhatsApp group' } },
    async (req, reply) => {
      try {
        const deviceId = resolveHeaderOrQueryDeviceId(req);
        return await whatsappGatewayRequest('/group/leave', {
          method: 'POST',
          deviceId,
          contentType: 'application/json',
          body: JSON.stringify(req.body ?? {}),
        });
      } catch (error) {
        return sendGowaError(reply, error);
      }
    }
  );
}
