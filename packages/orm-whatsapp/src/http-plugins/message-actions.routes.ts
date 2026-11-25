import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { WhatsappAccount, WhatsappConversation, WhatsappMessage } from '../models.js';
import { isRecord } from '@moonwitness/types';
import { whatsappGatewayRequest } from '../runtime/gateway.js';
import { whatsappLogErrorContext } from '../runtime/log-redaction.js';
import { OutboxEvent } from '@moonwitness/jobs';
import { WHATSAPP_SEND_EVENT } from '../runtime/events.js';
import {
  id,
  normalizedReactions,
  recordWhatsAppAudit,
  requireCompany,
  requireWhatsAppAction,
  WHATSAPP_REACTION_EMOJIS,
  whatsappRateLimit,
  type WhatsappRouteParams,
  type WhatsAppReaction,
} from '../runtime/route-helpers.js';
import type { WhatsappRouteOptions } from '../runtime/route-helpers.js';

type Params = WhatsappRouteParams;

export function registerWhatsAppMessageActionRoutes(
  app: FastifyInstance,
  options: WhatsappRouteOptions
): void {
  app.post<{ Params: Params }>(
    '/whatsapp/messages/:id/reaction',
    whatsappRateLimit(20),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'create')) return;
      const messageId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      if (
        !messageId ||
        !body ||
        Object.keys(body).some((key) => key !== 'emoji') ||
        typeof body.emoji !== 'string' ||
        !WHATSAPP_REACTION_EMOJIS.includes(body.emoji as (typeof WHATSAPP_REACTION_EMOJIS)[number])
      ) {
        return reply.code(400).send({ success: false, error: 'Choose a supported reaction emoji' });
      }
      const message = await WhatsappMessage.query().findOne({
        id: messageId,
        company_id: companyId,
      });
      if (!message) return reply.code(404).send({ success: false, error: 'Message not found' });
      if (
        !message.external_id ||
        message.provider_type ||
        message.external_id.startsWith('pending:') ||
        message.external_id.startsWith('gowa-') ||
        !['received', 'sent', 'delivered', 'read'].includes(message.status)
      ) {
        return reply
          .code(409)
          .send({ success: false, error: 'Message is not available for reactions' });
      }
      const [conversation, account] = await Promise.all([
        WhatsappConversation.query().findOne({
          id: message.conversation_id,
          company_id: companyId,
        }),
        WhatsappAccount.query().findOne({ company_id: companyId }),
      ]);
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      if (!account?.gateway_device_id || account.status !== 'connected')
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        await whatsappGatewayRequest(
          `/message/${encodeURIComponent(message.external_id)}/reaction`,
          {
            method: 'POST',
            deviceId: account.gateway_device_id,
            contentType: 'application/json',
            body: JSON.stringify({ phone: conversation.jid, emoji: body.emoji }),
          }
        );
      } catch (error) {
        req.log.error(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp reaction request failed'
        );
        return reply.code(502).send({ success: false, error: 'Could not send reaction' });
      }
      const reactions = normalizedReactions(message.reactions);
      const ownReaction: WhatsAppReaction = {
        emoji: body.emoji,
        sender_jid: account.phone_number
          ? `${account.phone_number.replace(/\D/gu, '')}@s.whatsapp.net`
          : null,
        is_from_me: true,
        timestamp: new Date().toISOString(),
      };
      const ownReactionIndex = reactions.findIndex((reaction) => reaction.is_from_me);
      if (ownReactionIndex >= 0) reactions[ownReactionIndex] = ownReaction;
      else reactions.push(ownReaction);
      await WhatsappMessage.query()
        .where({ id: messageId, company_id: companyId })
        .patch({
          reactions: JSON.stringify(reactions),
          write_date: new Date().toISOString(),
        });
      await recordWhatsAppAudit(req, 'whatsapp.message', 'react', messageId, companyId);
      return reply.send({ success: true, data: { reactions } });
    }
  );

  app.post<{ Params: Params }>(
    '/whatsapp/messages/:id/edit',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'write')) return;
      const messageId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      const content = typeof body?.content === 'string' ? body.content.trim() : '';
      if (
        !messageId ||
        !body ||
        Object.keys(body).some((key) => key !== 'content') ||
        !content ||
        content.length > 8000
      )
        return reply.code(400).send({
          success: false,
          error: 'Message text is required and must be at most 8000 characters',
        });
      const message = await WhatsappMessage.query().findOne({
        id: messageId,
        company_id: companyId,
      });
      if (!message) return reply.code(404).send({ success: false, error: 'Message not found' });
      const messageAge = Date.now() - Date.parse(String(message.create_date));
      if (
        message.direction !== 'outbound' ||
        message.message_type !== 'text' ||
        message.provider_type ||
        message.is_deleted ||
        !message.external_id ||
        /^(pending:|gowa-)/u.test(message.external_id) ||
        !['sent', 'delivered', 'read'].includes(message.status) ||
        !Number.isFinite(messageAge) ||
        messageAge < 0 ||
        messageAge > 15 * 60_000
      )
        return reply
          .code(409)
          .send({ success: false, error: 'Only your recent sent text messages can be edited' });
      const [conversation, account] = await Promise.all([
        WhatsappConversation.query().findOne({
          id: message.conversation_id,
          company_id: companyId,
        }),
        WhatsappAccount.query().findOne({ company_id: companyId }),
      ]);
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      if (!account?.gateway_device_id || account.status !== 'connected')
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        await whatsappGatewayRequest(`/message/${encodeURIComponent(message.external_id)}/update`, {
          method: 'POST',
          deviceId: account.gateway_device_id,
          contentType: 'application/json',
          body: JSON.stringify({ phone: conversation.jid, message: content }),
        });
      } catch (error) {
        req.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp message edit failed');
        return reply.code(502).send({ success: false, error: 'Could not edit message' });
      }
      await WhatsappMessage.query().where({ id: messageId, company_id: companyId }).patch({
        content,
        is_edited: true,
        write_date: new Date().toISOString(),
      });
      await app
        .db('whatsapp_conversations')
        .where({ id: conversation.id, company_id: companyId, last_message: message.content })
        .update({ last_message: content, write_date: new Date().toISOString() });
      await recordWhatsAppAudit(req, 'whatsapp.message', 'edit', messageId, companyId);
      return reply.send({ success: true, data: { id: messageId, content, is_edited: true } });
    }
  );

  app.post<{ Params: Params }>(
    '/whatsapp/messages/:id/revoke',
    whatsappRateLimit(5),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'write')) return;
      const messageId = id(req.params.id);
      if (!messageId) return reply.code(400).send({ success: false, error: 'Invalid message ID' });
      const message = await WhatsappMessage.query().findOne({
        id: messageId,
        company_id: companyId,
      });
      if (!message) return reply.code(404).send({ success: false, error: 'Message not found' });
      if (
        message.direction !== 'outbound' ||
        message.provider_type ||
        message.is_deleted ||
        !message.external_id ||
        /^(pending:|gowa-)/u.test(message.external_id) ||
        !['sent', 'delivered', 'read'].includes(message.status)
      )
        return reply
          .code(409)
          .send({ success: false, error: 'Only your sent messages can be deleted for everyone' });
      const [conversation, account] = await Promise.all([
        WhatsappConversation.query().findOne({
          id: message.conversation_id,
          company_id: companyId,
        }),
        WhatsappAccount.query().findOne({ company_id: companyId }),
      ]);
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      if (!account?.gateway_device_id || account.status !== 'connected')
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        await whatsappGatewayRequest(`/message/${encodeURIComponent(message.external_id)}/revoke`, {
          method: 'POST',
          deviceId: account.gateway_device_id,
          contentType: 'application/json',
          body: JSON.stringify({ phone: conversation.jid }),
        });
      } catch (error) {
        req.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp message revoke failed');
        return reply
          .code(502)
          .send({ success: false, error: 'Could not delete message for everyone' });
      }
      await WhatsappMessage.query().where({ id: messageId, company_id: companyId }).patch({
        is_deleted: true,
        content: 'This message was deleted',
        media_mime_type: null,
        media_file_name: null,
        reactions: '[]',
        write_date: new Date().toISOString(),
      });
      if (message.media_key)
        await Promise.all(
          [message.media_key, message.media_thumbnail_key]
            .filter((key): key is string => Boolean(key))
            .map((key) => options.attachmentStorage.delete(key))
        )
          .then(async () => {
            await WhatsappMessage.query()
              .where({ id: messageId, company_id: companyId, is_deleted: true })
              .patch({
                media_key: null,
                media_thumbnail_key: null,
                write_date: new Date().toISOString(),
              });
          })
          .catch((error: unknown) => {
            req.log.warn(
              { error: whatsappLogErrorContext(error) },
              'WhatsApp revoked media cleanup failed'
            );
          });
      await app
        .db('whatsapp_conversations')
        .where({ id: conversation.id, company_id: companyId })
        .whereIn('last_message', [
          ...new Set(
            [message.content, message.media_file_name, `[${message.message_type}]`].filter(
              (value): value is string => Boolean(value)
            )
          ),
        ])
        .update({ last_message: 'This message was deleted', write_date: new Date().toISOString() });
      await recordWhatsAppAudit(req, 'whatsapp.message', 'revoke', messageId, companyId);
      return reply.send({ success: true, data: { id: messageId, is_deleted: true } });
    }
  );

  app.post<{ Params: Params }>(
    '/whatsapp/conversations/:id/read',
    whatsappRateLimit(30),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'create')) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account?.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      const latestInbound = await WhatsappMessage.query()
        .findOne({ conversation_id: conversationId, company_id: companyId, direction: 'inbound' })
        .orderBy('create_date', 'desc')
        .orderBy('id', 'desc');
      if (!latestInbound) {
        return { success: true, data: { marked: false } };
      }
      const latestInboundAt = new Date(String(latestInbound.create_date)).toISOString();
      try {
        await whatsappGatewayRequest(
          `/message/${encodeURIComponent(latestInbound.external_id)}/read`,
          {
            method: 'POST',
            deviceId: account.gateway_device_id,
            contentType: 'application/json',
            body: JSON.stringify({ phone: conversation.jid }),
          }
        );
      } catch (error) {
        req.log.error(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp mark-read request failed'
        );
        return reply
          .code(502)
          .send({ success: false, error: 'Could not mark conversation as read' });
      }
      await app.db.transaction(async (trx) => {
        await trx('whatsapp_conversation_reads')
          .insert({
            company_id: companyId,
            conversation_id: conversationId,
            user_id: req.auth!.userId,
            last_read_message_id: latestInbound.id,
            last_read_at: latestInboundAt,
          })
          .onConflict(['company_id', 'conversation_id', 'user_id'])
          .merge({
            last_read_message_id: trx.raw(
              'CASE WHEN excluded.last_read_at > whatsapp_conversation_reads.last_read_at OR (excluded.last_read_at = whatsapp_conversation_reads.last_read_at AND excluded.last_read_message_id > whatsapp_conversation_reads.last_read_message_id) THEN excluded.last_read_message_id ELSE whatsapp_conversation_reads.last_read_message_id END'
            ),
            last_read_at: trx.raw(
              'CASE WHEN excluded.last_read_at > whatsapp_conversation_reads.last_read_at OR (excluded.last_read_at = whatsapp_conversation_reads.last_read_at AND excluded.last_read_message_id > whatsapp_conversation_reads.last_read_message_id) THEN excluded.last_read_at ELSE whatsapp_conversation_reads.last_read_at END'
            ),
            write_date: new Date().toISOString(),
          });
        await recordWhatsAppAudit(
          req,
          'whatsapp.message',
          'mark_read',
          latestInbound.id,
          companyId,
          trx
        );
      });
      return { success: true, data: { marked: true, message_id: latestInbound.id } };
    }
  );

  app.post<{ Params: Params }>(
    '/whatsapp/messages/:id/forward',
    whatsappRateLimit(20),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'create')) return;
      const sourceId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      if (
        !sourceId ||
        !body ||
        Object.keys(body).some((key) => key !== 'conversation_id') ||
        !Number.isSafeInteger(body.conversation_id) ||
        Number(body.conversation_id) < 1
      )
        return reply.code(400).send({ success: false, error: 'Invalid forward request' });
      const idempotencyKey = req.headers['idempotency-key'];
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128 ||
        !/^[A-Za-z0-9._:-]+$/u.test(idempotencyKey)
      )
        return reply
          .code(400)
          .send({ success: false, error: 'A valid Idempotency-Key is required' });
      const [source, destination, account] = await Promise.all([
        WhatsappMessage.query().findOne({ id: sourceId, company_id: companyId }),
        WhatsappConversation.query().findOne({
          id: Number(body.conversation_id),
          company_id: companyId,
        }),
        WhatsappAccount.query().findOne({ company_id: companyId }),
      ]);
      if (!source)
        return reply.code(404).send({ success: false, error: 'Source message not found' });
      if (source.provider_type)
        return reply
          .code(409)
          .send({ success: false, error: 'This message type cannot be forwarded yet' });
      if (!destination)
        return reply
          .code(404)
          .send({ success: false, error: 'Destination conversation not found' });
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            source_message_id: source.id,
            destination_conversation_id: destination.id,
          })
        )
        .digest('hex');
      const existing = await WhatsappMessage.query().findOne({
        company_id: companyId,
        idempotency_key: idempotencyKey,
      });
      if (existing) {
        if (existing.request_hash !== requestHash)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency key was used for another message' });
        return reply.code(202).send({ success: true, data: existing });
      }
      if (
        !source.external_id ||
        source.external_id.startsWith('pending:') ||
        source.external_id.startsWith('gowa-')
      )
        return reply
          .code(409)
          .send({ success: false, error: 'Source message is not available to forward' });
      if (!['received', 'sent', 'delivered', 'read'].includes(source.status))
        return reply
          .code(409)
          .send({ success: false, error: 'Source message is not available to forward' });
      if (!account?.gateway_device_id || account.status !== 'connected')
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        const forwarded = await app.db.transaction(async (trx) => {
          const inserted = await WhatsappMessage.query(trx).insertAndFetch({
            company_id: companyId,
            account_id: account.id,
            conversation_id: destination.id,
            external_id: `pending:${idempotencyKey}`.slice(0, 255),
            idempotency_key: idempotencyKey,
            request_hash: requestHash,
            direction: 'outbound',
            message_type: source.message_type,
            content: source.content,
            status: 'queued',
            attempt_count: 0,
            retryable: false,
            media_mime_type: source.media_mime_type,
            media_file_name: source.media_file_name,
            is_forwarded: true,
            forward_from_external_id: source.external_id,
          } as never);
          await OutboxEvent.query(trx).insert({
            event_type: WHATSAPP_SEND_EVENT,
            aggregate_model: 'whatsapp.message',
            aggregate_id: inserted.id,
            company_id: companyId,
            payload: JSON.stringify({ message_id: inserted.id }),
            status: 'pending',
            attempts: 0,
            max_attempts: 4,
            available_at: new Date().toISOString(),
          });
          await WhatsappConversation.query(trx)
            .where({ id: destination.id, company_id: companyId })
            .patch({
              last_message: source.content || source.media_file_name || `[${source.message_type}]`,
              last_message_at: new Date().toISOString(),
            });
          await recordWhatsAppAudit(
            req,
            'whatsapp.message',
            'forward_queued',
            inserted.id,
            companyId,
            trx
          );
          return inserted;
        });
        return reply.code(202).send({ success: true, data: forwarded });
      } catch (error) {
        req.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp forward queue failed');
        const raced = await WhatsappMessage.query().findOne({
          company_id: companyId,
          idempotency_key: idempotencyKey,
        });
        if (raced?.request_hash === requestHash)
          return reply.code(202).send({ success: true, data: raced });
        if (raced)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency key was used for another message' });
        return reply
          .code(503)
          .send({ success: false, error: 'Message could not be queued. Try again.' });
      }
    }
  );

  app.post<{ Params: Params }>(
    '/whatsapp/messages/:id/retry',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'create')) return;
      const messageId = id(req.params.id);
      if (!messageId) return reply.code(400).send({ success: false, error: 'Invalid message ID' });
      const current = await WhatsappMessage.query().findOne({
        id: messageId,
        company_id: companyId,
        direction: 'outbound',
      });
      if (!current) return reply.code(404).send({ success: false, error: 'Message not found' });
      if (current.status === 'queued' || current.status === 'sending')
        return reply.code(202).send({ success: true, data: current });
      if (current.status !== 'failed' || !current.retryable)
        return reply.code(409).send({
          success: false,
          error:
            current.status === 'unknown'
              ? 'Delivery is uncertain. Verify the WhatsApp chat before trying again.'
              : 'This message cannot be retried.',
        });
      const message = await app.db.transaction(async (trx) => {
        const updated = await WhatsappMessage.query(trx)
          .where({ id: messageId, company_id: companyId, status: 'failed', retryable: true })
          .patch({ status: 'queued', retryable: false, last_error: null });
        if (updated !== 1) return null;
        await OutboxEvent.query(trx).insert({
          event_type: WHATSAPP_SEND_EVENT,
          aggregate_model: 'whatsapp.message',
          aggregate_id: messageId,
          company_id: companyId,
          payload: JSON.stringify({ message_id: messageId }),
          status: 'pending',
          attempts: 0,
          max_attempts: 4,
          available_at: new Date().toISOString(),
        });
        await recordWhatsAppAudit(
          req,
          'whatsapp.message',
          'retry_queued',
          messageId,
          companyId,
          trx
        );
        return WhatsappMessage.query(trx).findOne({ id: messageId, company_id: companyId });
      });
      if (!message) {
        const latest = await WhatsappMessage.query().findOne({
          id: messageId,
          company_id: companyId,
        });
        if (latest?.status === 'queued' || latest?.status === 'sending')
          return reply.code(202).send({ success: true, data: latest });
        return reply.code(409).send({ success: false, error: 'Message is no longer retryable' });
      }
      return reply.code(202).send({ success: true, data: message });
    }
  );
}
