import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { WhatsappAccount, WhatsappConversation } from '../models.js';
import { attachPrivateLidAlias } from '../runtime/conversation-identity.js';
import { isRecord } from '@moonwitness/types';
import { safeMime } from '../runtime/media.js';
import { whatsappLogErrorContext } from '../runtime/log-redaction.js';
import { enqueueNotification } from '@moonwitness/orm-notification';
import {
  captureGowaWebhookBody,
  classifyGoWaMessageType,
  MAX_GOWA_WEBHOOK_BYTES,
  mediaDefaultMime,
  providerReplyId,
  providerTimestamp,
  rawWebhookBodies,
  reconcileAmbiguousOutboundMessage,
  validGowaWebhookSignature,
} from '../runtime/route-helpers.js';
import type { WhatsappRouteOptions } from '../runtime/route-helpers.js';
import { defaultWebhookDeduplicator } from '../state-machine.js';

export function registerWhatsAppWebhookRoutes(
  app: FastifyInstance,
  options: WhatsappRouteOptions
): void {
  app.post<{ Params: { deviceId: string } }>(
    '/whatsapp/gowa/webhook/:deviceId',
    { bodyLimit: MAX_GOWA_WEBHOOK_BYTES, preParsing: captureGowaWebhookBody() },
    async (req, reply) => {
      const raw = rawWebhookBodies.get(req);
      if (!raw || !validGowaWebhookSignature(raw, req.headers['x-hub-signature-256']))
        return reply.code(401).send({ success: false, error: 'Invalid webhook signature' });
      const account = await WhatsappAccount.query().findOne({
        gateway_device_id: req.params.deviceId,
      });
      if (!account) return reply.code(404).send({ success: false, error: 'Unknown device' });
      const body = req.body as {
        event?: unknown;
        session_id?: unknown;
        payload?: Record<string, unknown>;
      } | null;
      if (body?.session_id !== account.gateway_device_id)
        return reply.code(403).send({ success: false, error: 'Webhook device mismatch' });
      if (body?.event === 'group.participants') {
        const payload = body.payload;
        const groupJid = typeof payload?.chat_id === 'string' ? payload.chat_id : '';
        const type = payload?.type;
        const jids = Array.isArray(payload?.jids) ? payload.jids : [];
        if (
          !/^[^\s@\p{Cc}\p{Cf}]{1,200}@g\.us$/u.test(groupJid) ||
          !['join', 'leave', 'promote', 'demote'].includes(String(type)) ||
          jids.length > 500 ||
          jids.some(
            (jid) =>
              typeof jid !== 'string' ||
              !/^[^\s@\p{Cc}\p{Cf}]{1,200}@(s\.whatsapp\.net|lid)$/u.test(jid)
          )
        )
          return reply.code(204).send();
        const conversation = await app
          .db('whatsapp_conversations')
          .where({
            company_id: account.company_id,
            account_id: account.id,
            jid: groupJid,
            is_group: true,
          })
          .first('id');
        if (conversation) {
          const eventTimestamp =
            typeof (body as { timestamp?: unknown }).timestamp === 'string' &&
            Number.isFinite(Date.parse((body as { timestamp: string }).timestamp))
              ? new Date((body as { timestamp: string }).timestamp).toISOString()
              : new Date().toISOString();
          const participants = [...new Set(jids as string[])].sort();
          const actionLabels: Record<string, string> = {
            join: 'joined the group',
            leave: 'left the group',
            promote: 'became an admin',
            demote: 'is no longer an admin',
          };
          const eventContent = `${participants.join(', ')} ${actionLabels[String(type)]}`.slice(
            0,
            8_000
          );
          const externalId = `group-event:${createHash('sha256')
            .update(`${groupJid}\n${String(type)}\n${eventTimestamp}\n${participants.join('\n')}`)
            .digest('hex')}`;
          await app.db.transaction(async (trx) => {
            await trx('whatsapp_conversations')
              .where({ id: conversation.id, company_id: account.company_id })
              .update({
                group_metadata_synced_at: null,
                write_date: new Date().toISOString(),
              });
            const inserted = await trx('whatsapp_messages')
              .insert({
                company_id: account.company_id,
                account_id: account.id,
                conversation_id: conversation.id,
                external_id: externalId,
                direction: 'inbound',
                message_type: 'text',
                provider_type: `group_event_${String(type)}`,
                content: eventContent,
                status: 'received',
                create_date: eventTimestamp,
                write_date: eventTimestamp,
              })
              .onConflict(['company_id', 'external_id'])
              .ignore()
              .returning(['id']);
            if (inserted.length) {
              await trx('whatsapp_conversations')
                .where({ id: conversation.id, company_id: account.company_id })
                .where((query) =>
                  query
                    .whereNull('last_message_at')
                    .orWhere('last_message_at', '<=', eventTimestamp)
                )
                .update({
                  last_message: eventContent,
                  last_message_at: eventTimestamp,
                  write_date: new Date().toISOString(),
                });
            }
          });
        }
        return reply.code(204).send();
      }
      if (body?.event === 'message.edited') {
        const payload = body.payload;
        const originalId =
          typeof payload?.original_message_id === 'string'
            ? payload.original_message_id.slice(0, 255)
            : '';
        const editedText = typeof payload?.body === 'string' ? payload.body.slice(0, 8000) : null;
        if (originalId && editedText !== null) {
          const target = (await app
            .db('whatsapp_messages')
            .select('id', 'conversation_id', 'content')
            .where({
              company_id: account.company_id,
              account_id: account.id,
              external_id: originalId,
            })
            .where({ message_type: 'text', is_deleted: false })
            .whereNull('provider_type')
            .first()) as
            { id: number; conversation_id: number; content: string | null } | undefined;
          if (target) {
            await app
              .db('whatsapp_messages')
              .where({ id: target.id, company_id: account.company_id })
              .update({
                content: editedText,
                is_edited: true,
                write_date: new Date().toISOString(),
              });
            await app
              .db('whatsapp_conversations')
              .where({
                id: target.conversation_id,
                company_id: account.company_id,
                last_message: target.content,
              })
              .update({ last_message: editedText, write_date: new Date().toISOString() });
          }
        }
        return reply.code(204).send();
      }
      if (body?.event === 'message.revoked' || body?.event === 'message.deleted') {
        const payload = body.payload;
        const targetId =
          typeof payload?.revoked_message_id === 'string'
            ? payload.revoked_message_id.slice(0, 255)
            : typeof payload?.deleted_message_id === 'string'
              ? payload.deleted_message_id.slice(0, 255)
              : '';
        if (targetId) {
          const target = (await app
            .db('whatsapp_messages')
            .select(
              'id',
              'media_key',
              'media_thumbnail_key',
              'conversation_id',
              'content',
              'media_file_name',
              'message_type'
            )
            .where({
              company_id: account.company_id,
              account_id: account.id,
              external_id: targetId,
            })
            .first()) as
            | {
                id: number;
                media_key: string | null;
                media_thumbnail_key: string | null;
                conversation_id: number;
                content: string | null;
                media_file_name: string | null;
                message_type: string;
              }
            | undefined;
          if (target) {
            await app
              .db('whatsapp_messages')
              .where({ id: target.id, company_id: account.company_id })
              .update({
                is_deleted: true,
                content: 'This message was deleted',
                media_mime_type: null,
                media_file_name: null,
                reactions: '[]',
                write_date: new Date().toISOString(),
              });
            await app
              .db('whatsapp_conversations')
              .where({ id: target.conversation_id, company_id: account.company_id })
              .whereIn('last_message', [
                ...new Set(
                  [target.content, target.media_file_name, `[${target.message_type}]`].filter(
                    (value): value is string => Boolean(value)
                  )
                ),
              ])
              .update({
                last_message: 'This message was deleted',
                write_date: new Date().toISOString(),
              });
            if (target.media_key) {
              await Promise.all(
                [target.media_key, target.media_thumbnail_key]
                  .filter((key): key is string => Boolean(key))
                  .map((key) => options.attachmentStorage.delete(key))
              )
                .then(async () => {
                  await app
                    .db('whatsapp_messages')
                    .where({ id: target.id, company_id: account.company_id, is_deleted: true })
                    .update({
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
            }
          }
        }
        return reply.code(204).send();
      }
      if (body?.event === 'message') {
        const payload = body.payload;
        const externalId = typeof payload?.id === 'string' ? payload.id.slice(0, 255) : '';
        const providerJid = typeof payload?.chat_id === 'string' ? payload.chat_id : '';
        const timestamp = providerTimestamp(payload?.timestamp);
        const fromMe = payload?.is_from_me === true;
        const senderJid = typeof payload?.from === 'string' ? payload.from.slice(0, 255) : null;
        const isGroup = providerJid.endsWith('@g.us');
        const jid =
          !isGroup &&
          !fromMe &&
          typeof senderJid === 'string' &&
          /^[^\s@]{1,200}@s\.whatsapp\.net$/u.test(senderJid) &&
          providerJid.endsWith('@lid')
            ? senderJid
            : providerJid;
        const fromLid =
          typeof payload?.from_lid === 'string' && /^[^\s@]{1,200}@lid$/u.test(payload.from_lid)
            ? payload.from_lid
            : null;
        const chatLid =
          typeof payload?.chat_lid === 'string' && /^[^\s@]{1,200}@lid$/u.test(payload.chat_lid)
            ? payload.chat_lid
            : null;
        const lidAliasJids =
          !isGroup && !fromMe && senderJid === jid
            ? [
                ...new Set(
                  [fromLid, chatLid, providerJid.endsWith('@lid') ? providerJid : null].filter(
                    (value): value is string => Boolean(value)
                  )
                ),
              ]
            : [];
        if (!externalId || !/^[^\s@]{1,200}@(s\.whatsapp\.net|g\.us|lid)$/u.test(jid) || !timestamp)
          return reply.code(204).send();
        if (!defaultWebhookDeduplicator.tryAcquire(account.company_id, externalId))
          return reply.code(204).send();
        const mediaField = ['image', 'video', 'video_note', 'audio', 'document', 'sticker'].find(
          (field) => {
            const value = payload?.[field];
            return (
              (typeof value === 'string' && value.length > 0) ||
              (value !== null && typeof value === 'object')
            );
          }
        );
        const structuredField = [
          'contact',
          'location',
          'live_location',
          'poll',
          'call',
          'event',
          'protocol',
        ].find((field) => payload?.[field] !== undefined && payload[field] !== null);
        const viewOnce = payload?.view_once === true || payload?.is_view_once === true;
        const typeInfo = classifyGoWaMessageType(
          viewOnce
            ? 'view_once'
            : mediaField === 'video_note'
              ? 'video'
              : (mediaField ?? payload?.media_type ?? structuredField),
          viewOnce
        );
        const messageType = typeInfo.messageType;
        const providerType = typeInfo.providerType;
        const mediaValue = mediaField ? payload?.[mediaField] : null;
        const mediaCaption =
          isRecord(mediaValue) && typeof mediaValue.caption === 'string'
            ? mediaValue.caption
            : typeof payload?.caption === 'string'
              ? payload.caption
              : '';
        const content =
          providerType === 'view_once'
            ? 'View-once media'
            : typeof payload?.body === 'string' && payload.body.length > 0
              ? payload.body.slice(0, 8000)
              : mediaCaption.slice(0, 8000);
        const messageSenderDisplayName =
          typeof payload?.sender_display_name === 'string' && payload.sender_display_name.trim()
            ? payload.sender_display_name.trim().slice(0, 255)
            : typeof payload?.from_name === 'string' && payload.from_name.trim()
              ? payload.from_name.trim().slice(0, 255)
              : null;
        const replyToExternalId = providerReplyId(payload?.context_metadata);
        const chatName = typeof payload?.chat_name === 'string' ? payload.chat_name.trim() : '';
        const senderDisplayName =
          typeof payload?.sender_display_name === 'string'
            ? payload.sender_display_name.trim()
            : '';
        const fromName = typeof payload?.from_name === 'string' ? payload.from_name.trim() : '';
        const preserveConversationName =
          isGroup || fromMe || (!chatName && !senderDisplayName && !fromName);
        const conversationName =
          chatName || (preserveConversationName ? jid : senderDisplayName || fromName || jid);
        await app.db.transaction(async (trx) => {
          let conversationJid = jid;
          if (!isGroup && jid.endsWith('@lid')) {
            const knownAlias = (await trx('whatsapp_conversation_aliases')
              .select('conversation_id')
              .where({ company_id: account.company_id, alias_jid: jid })
              .first()) as { conversation_id: number } | undefined;
            if (knownAlias) {
              const knownConversation = (await trx('whatsapp_conversations')
                .select('jid')
                .where({ company_id: account.company_id, id: knownAlias.conversation_id })
                .first()) as { jid: string } | undefined;
              if (
                knownConversation &&
                /^[^\s@]{1,200}@s\.whatsapp\.net$/u.test(knownConversation.jid)
              ) {
                conversationJid = knownConversation.jid;
              }
            }
          }
          const [conversation] = await trx('whatsapp_conversations')
            .insert({
              company_id: account.company_id,
              account_id: account.id,
              jid: conversationJid,
              name: conversationName.slice(0, 255),
              is_group: isGroup,
              unread_count: 0,
              last_message:
                content ||
                (providerType ? `[${providerType}]` : mediaField ? `[${mediaField}]` : ''),
              last_message_at: timestamp,
            })
            .onConflict(['company_id', 'jid'])
            .merge({
              account_id: account.id,
              name:
                preserveConversationName && !chatName
                  ? trx.raw('whatsapp_conversations.name')
                  : conversationName.slice(0, 255),
              is_group: isGroup,
              last_message: trx.raw(
                'CASE WHEN whatsapp_conversations.last_message_at IS NULL OR excluded.last_message_at > whatsapp_conversations.last_message_at THEN excluded.last_message ELSE whatsapp_conversations.last_message END'
              ),
              last_message_at: trx.raw(
                'CASE WHEN whatsapp_conversations.last_message_at IS NULL OR excluded.last_message_at > whatsapp_conversations.last_message_at THEN excluded.last_message_at ELSE whatsapp_conversations.last_message_at END'
              ),
              write_date: new Date().toISOString(),
            })
            .returning(['id']);
          const storedConversation =
            conversation ??
            (await trx('whatsapp_conversations')
              .where({ company_id: account.company_id, jid: conversationJid })
              .first('id'));
          if (!storedConversation) throw new Error('GoWA webhook conversation upsert failed');
          let conversationId = Number(storedConversation.id);
          for (const aliasJid of lidAliasJids) {
            conversationId = await attachPrivateLidAlias(
              trx,
              account.company_id,
              conversationId,
              conversationJid,
              aliasJid
            );
          }
          if (
            fromMe &&
            (await reconcileAmbiguousOutboundMessage({
              db: trx,
              companyId: account.company_id,
              conversationId,
              externalId,
              content,
              messageType,
              timestamp,
            }))
          )
            return;
          const inserted = await trx('whatsapp_messages')
            .insert({
              company_id: account.company_id,
              account_id: account.id,
              conversation_id: conversationId,
              external_id: externalId,
              direction: fromMe ? 'outbound' : 'inbound',
              message_type: messageType,
              provider_type: providerType,
              content,
              status: fromMe ? 'sent' : 'received',
              media_mime_type:
                mediaField && !providerType
                  ? typeof payload?.mime_type === 'string'
                    ? safeMime(payload.mime_type)
                    : mediaDefaultMime(messageType)
                  : null,
              media_file_name:
                !providerType && typeof payload?.filename === 'string'
                  ? payload.filename.slice(0, 255)
                  : !providerType &&
                      mediaValue &&
                      typeof mediaValue === 'object' &&
                      'filename' in mediaValue &&
                      typeof mediaValue.filename === 'string'
                    ? mediaValue.filename.slice(0, 255)
                    : null,
              sender_jid: senderJid,
              sender_display_name: messageSenderDisplayName,
              reply_to_external_id: replyToExternalId,
            })
            .onConflict(['company_id', 'external_id'])
            .ignore()
            .returning(['id']);
          if (inserted.length && !fromMe) {
            await trx('whatsapp_conversations')
              .where({ id: conversationId, company_id: account.company_id })
              .increment('unread_count', 1);
            const recipients = await trx('company_memberships as membership')
              .join('users', 'users.id', 'membership.user_id')
              .where('membership.company_id', account.company_id)
              .where('users.active', true)
              .select('membership.user_id');
            for (const recipient of recipients) {
              await enqueueNotification(
                {
                  recipientId: Number(recipient.user_id),
                  companyId: Number(account.company_id),
                  templateCode: 'whatsapp.inbound_message',
                  resource: {
                    model: WhatsappConversation.modelName,
                    id: Number(conversationId),
                  },
                },
                trx
              );
            }
          }
        });
        return reply.code(204).send();
      }
      if (body?.event !== 'message.ack') return reply.code(204).send();
      const receipt = body.payload;
      const status =
        receipt?.receipt_type === 'read'
          ? 'read'
          : receipt?.receipt_type === 'delivered'
            ? 'delivered'
            : null;
      const ids = Array.isArray(receipt?.ids)
        ? [
            ...new Set(
              receipt.ids.filter(
                (value): value is string => typeof value === 'string' && value.length > 0
              )
            ),
          ].slice(0, 100)
        : [];
      if (!status || ids.length === 0) return reply.code(204).send();
      const eligibleStatuses = status === 'read' ? ['sent', 'delivered'] : ['sent'];
      for (const externalId of ids) {
        await app
          .db('whatsapp_messages')
          .where({ company_id: account.company_id, external_id: externalId, direction: 'outbound' })
          .whereIn('status', eligibleStatuses)
          .update({ status, write_date: new Date().toISOString() });
      }
      return reply.code(204).send();
    }
  );
}
