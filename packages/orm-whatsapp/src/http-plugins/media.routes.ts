import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { MAX_ATTACHMENT_BYTES } from '@moonwitness/types';
import { WhatsappAccount, WhatsappConversation, WhatsappMessage } from '../models.js';
import { safeMime, sniffMime } from '../runtime/media.js';
import {
  whatsappGatewayBinary,
  whatsappGatewayOriginPath,
  whatsappGatewayRequest,
} from '../runtime/gateway.js';
import { whatsappLogErrorContext } from '../runtime/log-redaction.js';
import {
  MalwareScannerUnavailableError,
  type AttachmentScanner,
} from '../runtime/clamav-scanner.js';
import {
  createImageThumbnail,
  createVideoPoster,
  type MediaThumbnail,
} from '../runtime/media-thumbnail.js';
import { recordWhatsAppMediaTransfer } from '../runtime/metrics.js';
import {
  GOWA_MEDIA_TYPES,
  id,
  limitReadable,
  MediaEmptyError,
  MediaIncompleteError,
  MediaTooLargeError,
  peekReadable,
  readLimitedMedia,
  recordWhatsAppAudit,
  requireCompany,
  safeFileName,
  scanStoredAttachment,
  streamResponseToStorage,
  type WhatsappRouteOptions,
  type WhatsappRouteParams,
} from '../runtime/route-helpers.js';

export function registerWhatsAppMediaRoutes(
  app: FastifyInstance,
  options: WhatsappRouteOptions,
  attachmentScanner: AttachmentScanner | null
): void {
  app.get<{ Params: WhatsappRouteParams }>('/whatsapp/media/:id/thumbnail', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const messageId = id(req.params.id);
    if (!messageId) return reply.code(400).send({ success: false, error: 'Invalid message ID' });
    let message = await WhatsappMessage.query().findOne({
      id: messageId,
      company_id: companyId,
    });
    if (
      !message ||
      message.provider_type ||
      message.is_deleted ||
      !['image', 'video'].includes(message.message_type)
    )
      return reply.code(404).send({ success: false, error: 'Media preview not found' });
    if (message.media_scan_status === 'infected')
      return reply.code(410).send({ success: false, error: 'Attachment blocked by malware scan' });

    if (message.media_thumbnail_key) {
      try {
        const cached = await options.attachmentStorage.get(message.media_thumbnail_key);
        if (cached?.length) {
          const cachedReply = reply
            .header('Cache-Control', 'private, max-age=3600')
            .header('Vary', 'Authorization, X-Company-Id')
            .header('X-Original-Content-Type', safeMime(message.media_mime_type))
            .header('X-Content-Type-Options', 'nosniff')
            .header('Content-Security-Policy', "default-src 'none'; sandbox; base-uri 'none'");
          if (message.media_size_bytes !== null && message.media_size_bytes !== undefined)
            cachedReply.header('X-Original-Content-Length', String(message.media_size_bytes));
          return cachedReply
            .type(message.message_type === 'image' ? 'image/webp' : 'image/jpeg')
            .send(cached);
        }
        await WhatsappMessage.query()
          .where({ id: message.id, company_id: companyId })
          .patch({ media_thumbnail_key: null });
        message.media_thumbnail_key = null;
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp thumbnail cache lookup failed'
        );
      }
    }

    const original = await app.inject({
      method: 'GET',
      url: `/whatsapp/media/${messageId}`,
      headers: {
        authorization: req.headers.authorization,
        'x-company-id': String(companyId),
      },
    });
    if (original.statusCode !== 200)
      return reply
        .code(original.statusCode)
        .type(original.headers['content-type'] ?? 'application/json')
        .send(original.rawPayload);

    const originalMime = original.headers['content-type']?.split(';', 1)[0]?.toLowerCase() ?? '';
    if (!originalMime.startsWith('image/') && !originalMime.startsWith('video/'))
      return reply.code(415).send({ success: false, error: 'This media type cannot be previewed' });

    let thumbnail: MediaThumbnail;
    try {
      thumbnail = originalMime.startsWith('video/')
        ? await (options.createVideoPoster ?? createVideoPoster)(original.rawPayload)
        : await createImageThumbnail(original.rawPayload);
    } catch (error) {
      req.log.warn(
        { error: whatsappLogErrorContext(error) },
        'WhatsApp thumbnail generation failed'
      );
      return reply.code(415).send({ success: false, error: 'Media preview is unavailable' });
    }

    message =
      (await WhatsappMessage.query().findOne({ id: messageId, company_id: companyId })) ?? message;
    if (message.media_scan_status !== 'clean' || !message.media_key)
      return reply.code(503).send({ success: false, error: 'Media is not ready for preview' });
    await WhatsappMessage.query()
      .where({ id: messageId, company_id: companyId })
      .patch({ media_size_bytes: original.rawPayload.length });
    message.media_size_bytes = original.rawPayload.length;
    const thumbnailKey = randomUUID();
    try {
      await options.attachmentStorage.put(thumbnailKey, thumbnail.bytes);
      const updated = await WhatsappMessage.query()
        .where({ id: messageId, company_id: companyId, media_key: message.media_key })
        .patch({ media_thumbnail_key: thumbnailKey });
      if (!updated) {
        await options.attachmentStorage.delete(thumbnailKey).catch(() => undefined);
        return reply.code(404).send({ success: false, error: 'Media preview not found' });
      }
    } catch (error) {
      await options.attachmentStorage.delete(thumbnailKey).catch(() => undefined);
      req.log.warn(
        { error: whatsappLogErrorContext(error) },
        'WhatsApp thumbnail cache write failed'
      );
    }

    return reply
      .header('Cache-Control', 'private, max-age=3600')
      .header('Vary', 'Authorization, X-Company-Id')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox; base-uri 'none'")
      .header('X-Original-Content-Type', originalMime)
      .header('X-Original-Content-Length', String(original.rawPayload.length))
      .type(thumbnail.contentType)
      .send(thumbnail.bytes);
  });

  app.get<{ Params: WhatsappRouteParams }>('/whatsapp/media/:id', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const messageId = id(req.params.id);
    if (!messageId) return reply.code(400).send({ success: false, error: 'Invalid message ID' });
    const message = await WhatsappMessage.query().findOne({
      id: messageId,
      company_id: companyId,
    });
    if (
      !message ||
      message.provider_type ||
      !GOWA_MEDIA_TYPES.has(message.message_type) ||
      message.is_deleted
    )
      return reply.code(404).send({ success: false, error: 'Media not found' });
    if (message.media_scan_status === 'infected')
      return reply.code(410).send({ success: false, error: 'Attachment blocked by malware scan' });
    if (!attachmentScanner)
      return reply
        .code(503)
        .send({ success: false, error: 'Attachment malware scanning is temporarily unavailable' });

    if (message.media_key && message.media_scan_status !== 'clean') {
      try {
        const scanResult = await scanStoredAttachment(
          options.attachmentStorage,
          message.media_key,
          attachmentScanner
        );
        if (scanResult.status === 'infected') {
          await options.attachmentStorage.delete(message.media_key).catch((error: unknown) => {
            req.log.warn(
              { error: whatsappLogErrorContext(error) },
              'WhatsApp quarantined attachment cleanup failed'
            );
          });
          if (message.media_thumbnail_key)
            await options.attachmentStorage
              .delete(message.media_thumbnail_key)
              .catch(() => undefined);
          await WhatsappMessage.query().where({ id: message.id, company_id: companyId }).patch({
            media_key: null,
            media_thumbnail_key: null,
            media_mime_type: null,
            media_scan_status: 'infected',
          });
          message.media_key = null;
          message.media_mime_type = null;
          message.media_scan_status = 'infected';
          return reply
            .code(410)
            .send({ success: false, error: 'Attachment blocked by malware scan' });
        }
        await WhatsappMessage.query()
          .where({ id: message.id, company_id: companyId })
          .patch({ media_scan_status: 'clean' });
        message.media_scan_status = 'clean';
      } catch (error) {
        req.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp malware scan failed');
        return reply.code(503).send({
          success: false,
          error: 'Attachment malware scanning is temporarily unavailable',
        });
      }
    }
    let content: Buffer | null = null;
    let mediaStream: Readable | null = null;
    let verifiedMime: string | null = null;
    let verifiedSize: number | null = null;
    let downloadedFromGateway = false;
    try {
      if (message.media_key && options.attachmentStorage.getStream) {
        const cachedStream = await options.attachmentStorage.getStream(message.media_key);
        if (cachedStream) {
          const inspected = await peekReadable(cachedStream);
          if (!inspected.prefix.length)
            return reply.code(404).send({ success: false, error: 'Media not found' });
          verifiedMime = sniffMime(inspected.prefix) ?? 'application/octet-stream';
          mediaStream = limitReadable(inspected.stream, MAX_ATTACHMENT_BYTES);
        }
      }
      if (!mediaStream && message.media_key)
        content = await options.attachmentStorage.get(message.media_key);
      if (content) verifiedSize = content.length;
    } catch (error) {
      req.log.error(
        { error: whatsappLogErrorContext(error) },
        'WhatsApp attachment storage read failed'
      );
      return reply
        .code(503)
        .send({ success: false, error: 'Media storage is temporarily unavailable' });
    }
    if (!content && !mediaStream) {
      const conversation = await WhatsappConversation.query().findOne({
        id: message.conversation_id,
        company_id: companyId,
      });
      const account = await WhatsappAccount.query().findOne({
        id: message.account_id,
        company_id: companyId,
      });
      if (!conversation || !account?.gateway_device_id)
        return reply.code(404).send({ success: false, error: 'Media not found' });
      const metadata = await whatsappGatewayRequest<{
        file_url?: string;
        file_path?: string;
        filename?: string;
      }>(
        `/message/${encodeURIComponent(message.external_id)}/download?phone=${encodeURIComponent(conversation.jid)}`,
        { deviceId: account.gateway_device_id }
      );
      const mediaPath = metadata.file_url ?? metadata.file_path;
      if (!mediaPath) return reply.code(404).send({ success: false, error: 'Media not found' });
      const downloaded = await whatsappGatewayBinary(
        whatsappGatewayOriginPath(mediaPath),
        account.gateway_device_id
      );
      if (options.attachmentStorage.putStream && options.attachmentStorage.getStream) {
        const mediaKey = randomUUID();
        try {
          const streamed = await streamResponseToStorage(
            downloaded,
            options.attachmentStorage,
            mediaKey
          );
          verifiedMime = streamed.mime;
          verifiedSize = streamed.size;
          const scanResult = await scanStoredAttachment(
            options.attachmentStorage,
            mediaKey,
            attachmentScanner
          );
          if (scanResult.status === 'infected') {
            await options.attachmentStorage.delete(mediaKey).catch(() => undefined);
            await WhatsappMessage.query()
              .where({ id: message.id, company_id: companyId })
              .patch({ media_scan_status: 'infected' });
            message.media_scan_status = 'infected';
            return reply
              .code(410)
              .send({ success: false, error: 'Attachment blocked by malware scan' });
          }
        } catch (error) {
          await options.attachmentStorage.delete(mediaKey).catch(() => undefined);
          if (error instanceof MalwareScannerUnavailableError) {
            req.log.error(
              { error: whatsappLogErrorContext(error) },
              'WhatsApp malware scan failed'
            );
            return reply.code(503).send({
              success: false,
              error: 'Attachment malware scanning is temporarily unavailable',
            });
          }
          if (error instanceof MediaTooLargeError) {
            return reply
              .code(413)
              .send({ success: false, error: 'Media exceeds the 10 MiB limit' });
          }
          if (error instanceof MediaIncompleteError) {
            return reply
              .code(502)
              .send({ success: false, error: 'WhatsApp gateway returned incomplete media' });
          }
          if (error instanceof MediaEmptyError) {
            return reply.code(404).send({ success: false, error: 'Media not found' });
          }
          throw error;
        }
        const storedStream = await options.attachmentStorage.getStream(mediaKey);
        if (!storedStream) {
          await options.attachmentStorage.delete(mediaKey).catch(() => undefined);
          return reply
            .code(503)
            .send({ success: false, error: 'Media storage is temporarily unavailable' });
        }
        mediaStream = limitReadable(storedStream, MAX_ATTACHMENT_BYTES);
        await WhatsappMessage.query()
          .where({ id: message.id, company_id: companyId })
          .patch({
            media_key: mediaKey,
            media_thumbnail_key: null,
            media_mime_type: verifiedMime,
            media_size_bytes: verifiedSize,
            media_scan_status: 'clean',
            media_file_name: safeFileName(metadata.filename) ?? message.media_file_name,
          });
        message.media_key = mediaKey;
        message.media_mime_type = verifiedMime;
        message.media_file_name = safeFileName(metadata.filename) ?? message.media_file_name;
        downloadedFromGateway = true;
      } else {
        try {
          content = await readLimitedMedia(downloaded);
        } catch (error) {
          if (error instanceof MediaTooLargeError) {
            return reply
              .code(413)
              .send({ success: false, error: 'Media exceeds the 10 MiB limit' });
          }
          if (error instanceof MediaIncompleteError) {
            return reply
              .code(502)
              .send({ success: false, error: 'WhatsApp gateway returned incomplete media' });
          }
          throw error;
        }
        if (!content.length)
          return reply.code(404).send({ success: false, error: 'Media not found' });
        verifiedMime = sniffMime(content) ?? 'application/octet-stream';
        verifiedSize = content.length;
        let scanResult;
        try {
          scanResult = await attachmentScanner.scan(Readable.from([content]));
        } catch (error) {
          req.log.error({ error: whatsappLogErrorContext(error) }, 'WhatsApp malware scan failed');
          return reply.code(503).send({
            success: false,
            error: 'Attachment malware scanning is temporarily unavailable',
          });
        }
        if (scanResult.status === 'infected') {
          await WhatsappMessage.query()
            .where({ id: message.id, company_id: companyId })
            .patch({ media_scan_status: 'infected' });
          message.media_scan_status = 'infected';
          return reply
            .code(410)
            .send({ success: false, error: 'Attachment blocked by malware scan' });
        }
        const mediaKey = randomUUID();
        await options.attachmentStorage.put(mediaKey, content);
        await WhatsappMessage.query()
          .where({ id: message.id, company_id: companyId })
          .patch({
            media_key: mediaKey,
            media_thumbnail_key: null,
            media_mime_type: verifiedMime,
            media_size_bytes: verifiedSize,
            media_scan_status: 'clean',
            media_file_name: safeFileName(metadata.filename) ?? message.media_file_name,
          });
        message.media_key = mediaKey;
        message.media_mime_type = verifiedMime;
        message.media_file_name = safeFileName(metadata.filename) ?? message.media_file_name;
        downloadedFromGateway = true;
      }
    }
    if (downloadedFromGateway && verifiedSize !== null)
      recordWhatsAppMediaTransfer('inbound', verifiedSize);
    verifiedMime ??= content ? (sniffMime(content) ?? 'application/octet-stream') : null;
    if (!content && !mediaStream)
      return reply.code(404).send({ success: false, error: 'Media not found' });
    if (message.media_mime_type !== verifiedMime) {
      await WhatsappMessage.query()
        .where({ id: message.id, company_id: companyId })
        .patch({ media_mime_type: verifiedMime });
      message.media_mime_type = verifiedMime;
    }
    if (verifiedSize !== null && message.media_size_bytes !== verifiedSize) {
      await WhatsappMessage.query()
        .where({ id: message.id, company_id: companyId })
        .patch({ media_size_bytes: verifiedSize });
      message.media_size_bytes = verifiedSize;
    }
    await recordWhatsAppAudit(req, 'whatsapp.message', 'media_access', message.id, companyId);
    const mime = safeMime(message.media_mime_type);
    const disposition =
      mime.startsWith('image/') ||
      mime.startsWith('audio/') ||
      mime.startsWith('video/') ||
      mime === 'application/pdf'
        ? 'inline'
        : 'attachment';
    return reply
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Security-Policy',
        "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'"
      )
      .header(
        'content-disposition',
        `${disposition}; filename="${safeFileName(message.media_file_name) ?? 'attachment'}"`
      )
      .type(mime)
      .send(mediaStream ?? content);
  });
}
