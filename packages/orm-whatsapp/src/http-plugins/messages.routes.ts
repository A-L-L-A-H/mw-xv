import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  WhatsappAccount,
  WhatsappConversation,
  WhatsappMessage,
  WhatsappUploadTicket,
} from '../models.js';
import { isRecord, MAX_ATTACHMENT_BYTES } from '@moonwitness/types';
import { mediaType, mimeMatchesSignature, safeMime, sniffMime } from '../runtime/media.js';
import { whatsappGatewayRequest } from '../runtime/gateway.js';
import { whatsappLogErrorContext } from '../runtime/log-redaction.js';
import { OutboxEvent } from '@moonwitness/jobs';
import { WHATSAPP_SEND_EVENT } from '../runtime/events.js';
import { MalwareScannerUnavailableError } from '../runtime/clamav-scanner.js';
import { recordWhatsAppMediaTransfer } from '../runtime/metrics.js';
import {
  classifyGoWaMessageType,
  GOWA_MEDIA_TYPES,
  id,
  mediaDefaultMime,
  MediaScanInfectedError,
  MediaStorageError,
  MediaTooLargeError,
  normalizedReactions,
  parseOutgoingUpload,
  providerReplyId,
  providerTimestamp,
  readStoredAttachmentBounded,
  reconcileAmbiguousOutboundMessage,
  recordWhatsAppAudit,
  requireCompany,
  requireWhatsAppAction,
  safeFileName,
  supportsDirectUploads,
  UploadTicketConsumedError,
  whatsappRateLimit,
  type OutgoingUpload,
  type WhatsappRouteParams,
} from '../runtime/route-helpers.js';
import type { WhatsappRouteOptions } from '../runtime/route-helpers.js';
import type { AttachmentScanner } from '../runtime/clamav-scanner.js';

type Params = WhatsappRouteParams;

export function registerWhatsAppMessageRoutes(
  app: FastifyInstance,
  options: WhatsappRouteOptions,
  attachmentScanner: AttachmentScanner | null
): void {
  app.get<{
    Params: Params;
    Querystring: { limit?: string; offset?: string };
  }>('/whatsapp/conversations/:id/messages', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const conversationId = id(req.params.id);
    if (!conversationId)
      return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
    const conversation = await WhatsappConversation.query().findOne({
      id: conversationId,
      company_id: companyId,
    });
    if (!conversation)
      return reply.code(404).send({ success: false, error: 'Conversation not found' });
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return reply.code(400).send({ success: false, error: 'Limit must be between 1 and 100' });
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5_000) {
      return reply.code(400).send({ success: false, error: 'Offset must be between 0 and 5000' });
    }
    const account = await WhatsappAccount.query().findOne({ company_id: companyId });
    if (!account?.gateway_device_id) return { success: true, data: [] };
    const latestCached = (await app
      .db('whatsapp_messages')
      .where({ conversation_id: conversationId, company_id: companyId })
      .max({ latest: 'create_date' })
      .first()) as { latest?: string | null } | undefined;
    const latestCachedAt = latestCached?.latest ? Date.parse(String(latestCached.latest)) : NaN;
    const incrementalStart =
      offset === 0 && Number.isFinite(latestCachedAt)
        ? `&start_time=${encodeURIComponent(new Date(latestCachedAt - 10 * 60_000).toISOString())}`
        : '';
    const providerLimit = offset === 0 ? Math.max(100, limit) : limit;
    const upstream = await whatsappGatewayRequest<{ data?: Array<Record<string, unknown>> }>(
      `/chat/${encodeURIComponent(conversation.jid)}/messages?limit=${providerLimit}&offset=${offset}${incrementalStart}`,
      { deviceId: account.gateway_device_id }
    );
    for (const item of upstream.data ?? []) {
      if (typeof item.id !== 'string' || !item.id) continue;
      const tombstone = await app
        .db('whatsapp_messages')
        .select('id')
        .where({ company_id: companyId, external_id: item.id, is_deleted: true })
        .first();
      if (tombstone) continue;
      const fromMe = item.is_from_me === true;
      const typeInfo = classifyGoWaMessageType(
        item.media_type,
        item.view_once === true || item.is_view_once === true
      );
      const messageType = typeInfo.messageType;
      const timestamp = providerTimestamp(item.timestamp);
      if (!timestamp) continue;
      const content =
        typeInfo.providerType === 'view_once'
          ? 'View-once media'
          : typeof item.content === 'string'
            ? item.content.slice(0, 8000)
            : '';
      const externalId = item.id.slice(0, 255);
      const replyToExternalId = providerReplyId(item.context_metadata);
      if (fromMe) {
        await reconcileAmbiguousOutboundMessage({
          db: app.db,
          companyId,
          conversationId,
          externalId,
          content,
          messageType,
          timestamp,
        });
      }
      const reactions = Array.isArray(item.reactions)
        ? JSON.stringify(normalizedReactions(item.reactions))
        : null;
      const importedMessage = {
        company_id: companyId,
        account_id: account.id,
        conversation_id: conversationId,
        external_id: externalId,
        direction: fromMe ? 'outbound' : 'inbound',
        message_type: messageType,
        provider_type: typeInfo.providerType,
        content,
        status: fromMe ? 'sent' : 'received',
        media_mime_type:
          !typeInfo.providerType && item.mime_type !== undefined
            ? safeMime(item.mime_type)
            : typeInfo.providerType
              ? null
              : mediaDefaultMime(messageType),
        media_scan_status:
          !typeInfo.providerType && GOWA_MEDIA_TYPES.has(messageType)
            ? 'pending'
            : 'not_applicable',
        media_file_name:
          !typeInfo.providerType && typeof item.filename === 'string'
            ? item.filename.slice(0, 255)
            : !typeInfo.providerType && typeof item.file_name === 'string'
              ? item.file_name.slice(0, 255)
              : null,
        sender_display_name:
          typeof item.sender_display_name === 'string'
            ? item.sender_display_name.trim().slice(0, 255)
            : typeof item.from_name === 'string'
              ? item.from_name.trim().slice(0, 255)
              : null,
        sender_jid:
          typeof item.sender === 'string'
            ? item.sender.slice(0, 255)
            : typeof item.sender_jid === 'string'
              ? item.sender_jid.slice(0, 255)
              : null,
        reply_to_external_id: replyToExternalId,
        reactions,
        create_date: timestamp,
      };
      const importedMessagePatch = {
        content,
        provider_type: typeInfo.providerType,
        status: fromMe ? 'sent' : 'received',
        sender_display_name:
          typeof item.sender_display_name === 'string'
            ? item.sender_display_name.trim().slice(0, 255)
            : typeof item.from_name === 'string'
              ? item.from_name.trim().slice(0, 255)
              : null,
        reply_to_external_id: replyToExternalId,
        ...(Array.isArray(item.reactions) ? { reactions } : {}),
        write_date: new Date().toISOString(),
      };
      await app
        .db('whatsapp_messages')
        .insert(importedMessage)
        .onConflict(['company_id', 'external_id'])
        .merge(importedMessagePatch);
    }
    const messages = await WhatsappMessage.query()
      .select(
        'id',
        'direction',
        'content',
        'status',
        'retryable',
        'last_error',
        'message_type',
        'provider_type',
        'media_mime_type',
        'media_file_name',
        'media_scan_status',
        'sender_jid',
        'sender_display_name',
        'reply_to_message_id',
        'reply_to_external_id',
        'is_forwarded',
        'reactions',
        'is_edited',
        'is_deleted',
        'create_date'
      )
      .where({ conversation_id: conversationId, company_id: companyId })
      .orderBy('create_date', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset);
    for (const deletedMedia of await app
      .db('whatsapp_messages')
      .select('id', 'media_key', 'media_thumbnail_key')
      .where({ company_id: companyId, conversation_id: conversationId, is_deleted: true })
      .whereNotNull('media_key')) {
      try {
        if (typeof deletedMedia.media_key === 'string')
          await options.attachmentStorage.delete(deletedMedia.media_key);
        if (typeof deletedMedia.media_thumbnail_key === 'string')
          await options.attachmentStorage.delete(deletedMedia.media_thumbnail_key);
        await app
          .db('whatsapp_messages')
          .where({ id: deletedMedia.id, company_id: companyId, is_deleted: true })
          .update({
            media_key: null,
            media_thumbnail_key: null,
            write_date: new Date().toISOString(),
          });
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp deleted media cleanup retry failed'
        );
      }
    }
    const quotedInternalIds = messages
      .map((message) => Number(message.reply_to_message_id))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
    const quotedExternalIds = messages
      .map((message) => message.reply_to_external_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const quotedRows =
      quotedInternalIds.length || quotedExternalIds.length
        ? await app
            .db('whatsapp_messages')
            .select(
              'id',
              'external_id',
              'direction',
              'content',
              'message_type',
              'provider_type',
              'media_file_name'
            )
            .where({ company_id: companyId, conversation_id: conversationId })
            .andWhere((query) => {
              if (quotedInternalIds.length) query.whereIn('id', quotedInternalIds);
              if (quotedExternalIds.length) {
                if (quotedInternalIds.length) query.orWhereIn('external_id', quotedExternalIds);
                else query.whereIn('external_id', quotedExternalIds);
              }
            })
        : [];
    const quoteById = new Map(quotedRows.map((row) => [String(row.id), row]));
    const quoteByExternalId = new Map(quotedRows.map((row) => [String(row.external_id), row]));
    const readCursor = (await app
      .db('whatsapp_conversation_reads')
      .select('last_read_message_id', 'last_read_at')
      .where({ company_id: companyId, conversation_id: conversationId, user_id: req.auth!.userId })
      .first()) as
      { last_read_message_id?: number | string; last_read_at?: string | Date } | undefined;
    const lastReadMessageId = Number(readCursor?.last_read_message_id);
    const lastReadAt = Date.parse(String(readCursor?.last_read_at ?? ''));
    const latestProviderMessage = (upstream.data ?? []).reduce<Record<string, unknown> | null>(
      (latest, item) => {
        const timestamp = providerTimestamp(item.timestamp);
        const latestTimestamp = providerTimestamp(latest?.timestamp);
        return timestamp &&
          (!latestTimestamp || Date.parse(timestamp) > Date.parse(latestTimestamp))
          ? item
          : latest;
      },
      null
    );
    const latestTime = providerTimestamp(latestProviderMessage?.timestamp);
    const shouldUpdateLatest =
      latestTime !== null &&
      (!conversation.last_message_at ||
        !Number.isFinite(Date.parse(conversation.last_message_at)) ||
        Date.parse(latestTime) > Date.parse(conversation.last_message_at));
    const latestProviderId =
      typeof latestProviderMessage?.id === 'string' ? latestProviderMessage.id : null;
    const latestIsTombstoned = latestProviderId
      ? Boolean(
          await app
            .db('whatsapp_messages')
            .select('id')
            .where({ company_id: companyId, external_id: latestProviderId, is_deleted: true })
            .first()
        )
      : false;
    const latestTypeInfo = classifyGoWaMessageType(
      latestProviderMessage?.media_type,
      latestProviderMessage?.view_once === true || latestProviderMessage?.is_view_once === true
    );
    const latestContent = latestIsTombstoned
      ? 'This message was deleted'
      : latestProviderMessage
        ? latestTypeInfo.providerType === 'view_once'
          ? '[View-once media]'
          : typeof latestProviderMessage.content === 'string' && latestProviderMessage.content
            ? latestProviderMessage.content.slice(0, 2000)
            : `[${latestTypeInfo.providerType ?? String(latestProviderMessage.media_type ?? 'message')}]`
        : null;
    if (offset === 0) {
      await WhatsappConversation.query()
        .where({ id: conversationId, company_id: companyId })
        .patch({
          ...(shouldUpdateLatest && latestContent !== null ? { last_message: latestContent } : {}),
          ...(shouldUpdateLatest && latestTime !== null ? { last_message_at: latestTime } : {}),
          write_date: new Date().toISOString(),
        });
    }
    return {
      success: true,
      data: messages.map((message) => {
        const quoted =
          (message.reply_to_message_id != null
            ? quoteById.get(String(message.reply_to_message_id))
            : undefined) ??
          (message.reply_to_external_id
            ? quoteByExternalId.get(String(message.reply_to_external_id))
            : undefined);
        const messageAt = Date.parse(String(message.create_date));
        const afterReadCursor =
          !Number.isFinite(lastReadAt) ||
          messageAt > lastReadAt ||
          (messageAt === lastReadAt && Number(message.id) > lastReadMessageId);
        const {
          reply_to_external_id: _replyToExternalId,
          reactions: storedReactions,
          ...publicMessage
        } = message;
        return {
          ...publicMessage,
          reactions: normalizedReactions(storedReactions),
          is_last_read: Number.isFinite(lastReadAt) && Number(message.id) === lastReadMessageId,
          is_unread: message.direction === 'inbound' && afterReadCursor,
          reply_to: quoted
            ? {
                id: quoted.id,
                direction: quoted.direction,
                content: quoted.content,
                message_type: quoted.message_type,
                provider_type: quoted.provider_type,
                media_file_name: quoted.media_file_name,
              }
            : message.reply_to_message_id || message.reply_to_external_id
              ? { unavailable: true }
              : null,
        };
      }),
    };
  });

  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/uploads',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'create')) return;
      if (!supportsDirectUploads(options.attachmentStorage))
        return reply.code(409).send({ success: false, error: 'Direct uploads require S3 storage' });
      const conversationId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      if (
        !conversationId ||
        !body ||
        Object.keys(body).some(
          (key) => !['file_name', 'content_type', 'size_bytes'].includes(key)
        ) ||
        typeof body.file_name !== 'string' ||
        !safeFileName(body.file_name) ||
        typeof body.content_type !== 'string' ||
        body.content_type.length > 128 ||
        !Number.isSafeInteger(body.size_bytes) ||
        Number(body.size_bytes) < 1 ||
        Number(body.size_bytes) > MAX_ATTACHMENT_BYTES
      )
        return reply.code(400).send({ success: false, error: 'Invalid upload request' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      const storageKey = randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      const contentType = safeMime(body.content_type);
      try {
        const upload = await options.attachmentStorage.createPresignedUpload(
          storageKey,
          contentType,
          Number(body.size_bytes),
          300
        );
        const ticket = await WhatsappUploadTicket.query().insertAndFetch({
          company_id: companyId,
          conversation_id: conversationId,
          user_id: req.auth!.userId,
          storage_key: storageKey,
          file_name: safeFileName(body.file_name)!,
          content_type: contentType,
          size_bytes: Number(body.size_bytes),
          expires_at: expiresAt,
          consumed_message_id: null,
        } as never);
        return reply.code(201).send({
          success: true,
          data: {
            upload_id: ticket.id,
            url: upload.url,
            method: upload.method,
            fields: upload.fields,
            expires_at: expiresAt,
            size_bytes: Number(body.size_bytes),
          },
        });
      } catch (error) {
        req.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp upload ticket failed');
        return reply.code(503).send({ success: false, error: 'Could not prepare media upload' });
      }
    }
  );

  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/messages',
    { bodyLimit: MAX_ATTACHMENT_BYTES + 64 * 1024, ...whatsappRateLimit(20) },
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'create')) return;
      const conversationId = id(req.params.id);
      let upload: OutgoingUpload;
      try {
        if (!attachmentScanner) throw new MalwareScannerUnavailableError();
        upload = await parseOutgoingUpload(req, options.attachmentStorage, attachmentScanner, [
          'mentions',
        ]);
      } catch (error) {
        if (error instanceof MediaScanInfectedError)
          return reply
            .code(422)
            .send({ success: false, error: 'Attachment blocked by malware scan' });
        if (error instanceof MalwareScannerUnavailableError)
          return reply.code(503).send({
            success: false,
            error: 'Attachment malware scanning is temporarily unavailable',
          });
        const status =
          isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : 400;
        return reply.code(status).send({
          success: false,
          error:
            status >= 500
              ? 'Media storage is unavailable. Try again.'
              : error instanceof Error
                ? error.message
                : 'Invalid media upload',
        });
      }
      let directUploadTicketId: number | null = null;
      let directUploadSourceKey: string | null = null;
      let directUploadBytes: Buffer | null = null;
      const uploadTicketId = upload.fields.upload_ticket_id
        ? Number(upload.fields.upload_ticket_id)
        : null;
      if (uploadTicketId !== null) {
        const ticket = await WhatsappUploadTicket.query().findOne({
          id: uploadTicketId,
          company_id: companyId,
          conversation_id: conversationId,
          user_id: req.auth!.userId,
        });
        if (!ticket)
          return reply.code(404).send({ success: false, error: 'Upload ticket not found' });
        const expired = new Date(String(ticket.expires_at)).getTime() <= Date.now();
        if (expired && !ticket.consumed_message_id) {
          await options.attachmentStorage.delete(ticket.storage_key).catch(() => undefined);
          await WhatsappUploadTicket.query().deleteById(ticket.id);
          return reply.code(410).send({ success: false, error: 'Upload ticket expired' });
        }
        if (!supportsDirectUploads(options.attachmentStorage))
          return reply
            .code(409)
            .send({ success: false, error: 'Direct uploads require S3 storage' });
        try {
          const metadata = await options.attachmentStorage.head(ticket.storage_key);
          if (
            !metadata ||
            metadata.sizeBytes !== ticket.size_bytes ||
            metadata.sizeBytes < 1 ||
            metadata.sizeBytes > MAX_ATTACHMENT_BYTES ||
            metadata.contentType !== ticket.content_type
          ) {
            await options.attachmentStorage.delete(ticket.storage_key).catch(() => undefined);
            await WhatsappUploadTicket.query().deleteById(ticket.id);
            return reply
              .code(422)
              .send({ success: false, error: 'Uploaded media did not match its ticket' });
          }
          const bytes = await readStoredAttachmentBounded(
            options.attachmentStorage,
            ticket.storage_key,
            MAX_ATTACHMENT_BYTES
          );
          if (!bytes || bytes.byteLength !== ticket.size_bytes) {
            await options.attachmentStorage.delete(ticket.storage_key).catch(() => undefined);
            await WhatsappUploadTicket.query().deleteById(ticket.id);
            return reply.code(422).send({ success: false, error: 'Uploaded media is incomplete' });
          }
          const detectedMime = sniffMime(bytes.subarray(0, 64 * 1024));
          if (!mimeMatchesSignature(ticket.content_type, detectedMime)) {
            await options.attachmentStorage.delete(ticket.storage_key).catch(() => undefined);
            await WhatsappUploadTicket.query().deleteById(ticket.id);
            return reply
              .code(422)
              .send({ success: false, error: 'Media type does not match its contents' });
          }
          const scanResult = await attachmentScanner!.scan(Readable.from([bytes]));
          if (scanResult.status === 'infected') {
            await options.attachmentStorage.delete(ticket.storage_key).catch(() => undefined);
            await WhatsappUploadTicket.query().deleteById(ticket.id);
            return reply
              .code(422)
              .send({ success: false, error: 'Attachment blocked by malware scan' });
          }
          upload = {
            fields: Object.fromEntries(
              Object.entries(upload.fields).filter(([field]) => field !== 'upload_ticket_id')
            ),
            mediaKey: ticket.storage_key,
            mediaMime:
              ticket.content_type === 'application/octet-stream' && detectedMime
                ? detectedMime
                : ticket.content_type,
            mediaFileName: ticket.file_name,
            mediaDigest: createHash('sha256').update(bytes).digest('hex'),
            mediaSizeBytes: ticket.size_bytes,
          };
          directUploadTicketId = ticket.id;
          directUploadSourceKey = ticket.storage_key;
          directUploadBytes = bytes;
        } catch (error) {
          if (error instanceof MediaTooLargeError) {
            await options.attachmentStorage.delete(ticket.storage_key).catch(() => undefined);
            await WhatsappUploadTicket.query().deleteById(ticket.id);
            return reply
              .code(413)
              .send({ success: false, error: 'Media exceeds the 10 MiB limit' });
          }
          if (error instanceof MalwareScannerUnavailableError)
            return reply.code(503).send({
              success: false,
              error: 'Attachment malware scanning is temporarily unavailable',
            });
          req.log.error(
            { error: whatsappLogErrorContext(error) },
            'WhatsApp direct upload check failed'
          );
          return reply.code(503).send({ success: false, error: 'Could not verify uploaded media' });
        }
      }
      const body = {
        ...upload.fields,
        content: upload.fields.content ?? '',
        mentions: upload.fields.mentions ?? '[]',
        ...(upload.fields.reply_to_message_id
          ? { reply_to_message_id: Number(upload.fields.reply_to_message_id) }
          : {}),
      };
      if (
        !conversationId ||
        typeof body.content !== 'string' ||
        body.content.length > 8000 ||
        (body.reply_to_message_id !== undefined &&
          (!Number.isSafeInteger(Number(body.reply_to_message_id)) ||
            Number(body.reply_to_message_id) < 1))
      ) {
        if (upload.mediaKey && !directUploadTicketId)
          await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
        return reply.code(400).send({ success: false, error: 'Invalid message payload' });
      }
      let mentions: string[];
      try {
        const parsed: unknown = JSON.parse(String(body.mentions));
        if (
          !Array.isArray(parsed) ||
          parsed.length > 100 ||
          parsed.some(
            (mention) =>
              typeof mention !== 'string' ||
              (mention !== '@everyone' && !/^\d{7,15}$/u.test(mention))
          )
        )
          throw new Error('invalid mention list');
        mentions = [...new Set(parsed as string[])];
      } catch {
        if (upload.mediaKey && !directUploadTicketId)
          await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
        return reply.code(400).send({ success: false, error: 'Invalid group mentions' });
      }
      const idempotencyKey = req.headers['idempotency-key'];
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128 ||
        !/^[A-Za-z0-9._:-]+$/u.test(idempotencyKey)
      ) {
        if (upload.mediaKey && !directUploadTicketId)
          await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
        return reply
          .code(400)
          .send({ success: false, error: 'A valid Idempotency-Key is required' });
      }
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation) {
        if (upload.mediaKey && !directUploadTicketId)
          await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      }
      if (mentions.length) {
        const allowedPhones = new Set<string>();
        const snapshotAt = Date.parse(String(conversation.group_metadata_synced_at ?? ''));
        const snapshotAgeMs = Date.now() - snapshotAt;
        const participantSnapshotFresh =
          Number.isFinite(snapshotAt) && snapshotAgeMs >= 0 && snapshotAgeMs <= 5 * 60_000;
        if (
          conversation.is_group &&
          participantSnapshotFresh &&
          typeof conversation.group_participants_json === 'string'
        ) {
          try {
            const participants: unknown = JSON.parse(conversation.group_participants_json);
            if (Array.isArray(participants)) {
              for (const participant of participants) {
                if (!isRecord(participant)) continue;
                for (const candidate of [participant.jid, participant.phone_number]) {
                  if (
                    typeof candidate === 'string' &&
                    /^(\+?\d{7,15})@s\.whatsapp\.net$/u.test(candidate)
                  )
                    allowedPhones.add(candidate.replace(/\D/gu, ''));
                  else if (typeof candidate === 'string' && /^\+?\d{7,15}$/u.test(candidate))
                    allowedPhones.add(candidate.replace(/\D/gu, ''));
                }
              }
            }
          } catch {
            // A malformed participant snapshot cannot authorize a mention.
          }
        }
        const validTargets =
          conversation.is_group &&
          participantSnapshotFresh &&
          (mentions.includes('@everyone')
            ? mentions.length === 1 && Number(conversation.group_participant_count ?? 0) > 0
            : mentions.every((mention) => allowedPhones.has(mention)));
        const messageType = upload.mediaKey ? mediaType(upload.mediaMime) : 'text';
        const mentionError = !conversation.is_group
          ? 'Mentions can only be used in group conversations'
          : !participantSnapshotFresh
            ? 'Refresh group details before mentioning participants'
            : !validTargets
              ? 'Select a current group participant or @everyone'
              : !['text', 'image', 'video', 'document'].includes(messageType)
                ? 'This media type does not support mentions'
                : null;
        if (mentionError) {
          if (upload.mediaKey && !directUploadTicketId)
            await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
          return reply.code(400).send({ success: false, error: mentionError });
        }
      }
      let quotedMessage: { id: number; external_id: string } | undefined;
      if (body.reply_to_message_id !== undefined) {
        quotedMessage = await WhatsappMessage.query().findOne({
          id: Number(body.reply_to_message_id),
          company_id: companyId,
          conversation_id: conversationId,
        });
        if (!quotedMessage) {
          if (upload.mediaKey && !directUploadTicketId)
            await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
          return reply.code(404).send({ success: false, error: 'Quoted message not found' });
        }
        if (!quotedMessage.external_id || quotedMessage.external_id.startsWith('pending:')) {
          if (upload.mediaKey && !directUploadTicketId)
            await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
          return reply.code(409).send({
            success: false,
            error: 'Quoted message is not available on WhatsApp yet',
          });
        }
      }
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!body.content.trim() && !upload.mediaKey) {
        return reply
          .code(400)
          .send({ success: false, error: 'Message must contain text or media' });
      }
      const mediaMime = upload.mediaMime;
      const fileName = upload.mediaFileName;
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            conversation_id: conversationId,
            content: body.content,
            reply_to_message_id: quotedMessage?.id ?? null,
            reply_to_external_id: quotedMessage?.external_id ?? null,
            mentions,
            media_mime_type: mediaMime,
            media_file_name: fileName,
          })
        )
        .update(upload.mediaDigest)
        .digest('hex');
      const existing = await WhatsappMessage.query().findOne({
        company_id: companyId,
        idempotency_key: idempotencyKey,
      });
      if (existing) {
        if (upload.mediaKey && !directUploadTicketId)
          await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
        if (directUploadTicketId && existing.media_key !== upload.mediaKey) {
          await options.attachmentStorage.delete(upload.mediaKey!).catch(() => undefined);
          await WhatsappUploadTicket.query().deleteById(directUploadTicketId);
        }
        if (existing.request_hash !== requestHash)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency key was used for another message' });
        return reply.code(202).send({ success: true, data: existing });
      }
      if (!account || !account.gateway_device_id || account.status !== 'connected') {
        if (upload.mediaKey && !directUploadTicketId)
          await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      }
      let mediaKey = upload.mediaKey;
      try {
        if (directUploadTicketId && directUploadSourceKey && mediaKey) {
          const finalMediaKey = randomUUID();
          if (!directUploadBytes)
            throw new MediaStorageError('Uploaded media is no longer available');
          await options.attachmentStorage.put(finalMediaKey, directUploadBytes);
          mediaKey = finalMediaKey;
        }
        const message = await app.db.transaction(async (trx) => {
          const inserted = await WhatsappMessage.query(trx).insertAndFetch({
            company_id: companyId,
            account_id: account.id,
            conversation_id: conversationId,
            external_id: `pending:${idempotencyKey}`.slice(0, 255),
            idempotency_key: idempotencyKey,
            request_hash: requestHash,
            direction: 'outbound',
            message_type: mediaKey ? mediaType(mediaMime) : 'text',
            content: body.content,
            status: 'queued',
            attempt_count: 0,
            retryable: false,
            media_key: mediaKey,
            media_thumbnail_key: null,
            media_mime_type: mediaKey ? mediaMime : null,
            media_size_bytes: upload.mediaSizeBytes,
            media_file_name: fileName,
            media_scan_status: mediaKey ? 'clean' : 'not_applicable',
            reply_to_message_id: quotedMessage?.id ?? null,
            reply_to_external_id: quotedMessage?.external_id ?? null,
          } as never);
          await OutboxEvent.query(trx).insert({
            event_type: WHATSAPP_SEND_EVENT,
            aggregate_model: 'whatsapp.message',
            aggregate_id: inserted.id,
            company_id: companyId,
            payload: JSON.stringify({ message_id: inserted.id, mentions }),
            status: 'pending',
            attempts: 0,
            max_attempts: 4,
            available_at: new Date().toISOString(),
          });
          await WhatsappConversation.query(trx)
            .where({ id: conversationId, company_id: companyId })
            .patch({
              last_message: (body.content as string) || (fileName ?? '[media]'),
              last_message_at: new Date().toISOString(),
            });
          await recordWhatsAppAudit(
            req,
            'whatsapp.message',
            'send_queued',
            inserted.id,
            companyId,
            trx
          );
          if (directUploadTicketId) {
            const consumed = await trx('whatsapp_upload_tickets')
              .where({
                id: directUploadTicketId,
                company_id: companyId,
                conversation_id: conversationId,
                user_id: req.auth!.userId,
              })
              .whereNull('consumed_message_id')
              .update({ consumed_message_id: inserted.id, write_date: new Date().toISOString() });
            if (consumed !== 1) throw new UploadTicketConsumedError();
          }
          return inserted;
        });
        if (upload.mediaSizeBytes !== null)
          recordWhatsAppMediaTransfer('outbound', upload.mediaSizeBytes);
        return reply.code(202).send({ success: true, data: message });
      } catch (error) {
        req.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp message queue failed');
        const raced = await WhatsappMessage.query().findOne({
          company_id: companyId,
          idempotency_key: idempotencyKey,
        });
        if (mediaKey && (directUploadTicketId ? mediaKey !== upload.mediaKey : true))
          await options.attachmentStorage.delete(mediaKey).catch(() => {});
        if (raced) {
          if (raced.request_hash === requestHash)
            return reply.code(202).send({ success: true, data: raced });
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency key was used for another message' });
        }
        if (error instanceof UploadTicketConsumedError)
          return reply.code(409).send({ success: false, error: 'Upload ticket was already used' });
        return reply.code(mediaKey ? 503 : 500).send({
          success: false,
          error: mediaKey
            ? 'Media storage or queue is unavailable. Try again.'
            : 'Message could not be queued. Try again.',
        });
      }
    }
  );
}
