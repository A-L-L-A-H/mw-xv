import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { WhatsappAccount, WhatsappStatus } from '../models.js';
import { isRecord } from '@moonwitness/types';
import { mediaType } from '../runtime/media.js';
import { OutboxEvent } from '@moonwitness/jobs';
import { WHATSAPP_STATUS_PUBLISH_EVENT } from '../runtime/events.js';
import { recordWhatsAppMediaTransfer } from '../runtime/metrics.js';
import {
  parseOutgoingUpload,
  recordWhatsAppAudit,
  requireCompany,
  requireWhatsAppAction,
  whatsappRateLimit,
  type OutgoingUpload,
  type WhatsappRouteOptions,
} from '../runtime/route-helpers.js';
import type { AttachmentScanner } from '../runtime/clamav-scanner.js';

export function registerWhatsAppStatusRoutes(
  app: FastifyInstance,
  options: WhatsappRouteOptions,
  attachmentScanner: AttachmentScanner | null
): void {
  app.get('/whatsapp/statuses', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const rows = await WhatsappStatus.query()
      .where({ company_id: companyId })
      .select(
        'id',
        'status_type',
        'content',
        'media_mime_type',
        'media_file_name',
        'media_size_bytes',
        'allow_reshare',
        'external_id',
        'status',
        'attempt_count',
        'retryable',
        'last_error',
        'published_at',
        'create_date'
      )
      .limit(50);
    return { success: true, data: rows };
  });

  app.post('/whatsapp/statuses', whatsappRateLimit(5), async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    if (!requireWhatsAppAction(req, reply, 'whatsapp.message', 'create')) return;
    const idempotencyKey = req.headers['idempotency-key'];
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/u.test(idempotencyKey)
    ) {
      return reply.code(400).send({ success: false, error: 'A valid Idempotency-Key is required' });
    }
    let upload: OutgoingUpload;
    try {
      upload = await parseOutgoingUpload(req, options.attachmentStorage, attachmentScanner, [
        'allow_reshare',
      ]);
    } catch (error) {
      const statusCode =
        isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : 400;
      const message = error instanceof Error ? error.message : 'Invalid WhatsApp Status upload';
      return reply.code(statusCode).send({ success: false, error: message });
    }
    const content = upload.fields.content?.trim() ?? '';
    const allowReshareValue = upload.fields.allow_reshare ?? 'false';
    if (
      !['true', 'false'].includes(allowReshareValue) ||
      [...content].length > 700 ||
      (!content && !upload.mediaKey)
    ) {
      if (upload.mediaKey)
        await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
      return reply.code(400).send({ success: false, error: 'Invalid WhatsApp Status content' });
    }
    const allowReshare = allowReshareValue === 'true';
    let statusType: 'text' | 'image' | 'video' = 'text';
    if (upload.mediaKey) {
      const detectedType = mediaType(upload.mediaMime);
      if (detectedType !== 'image' && detectedType !== 'video') {
        await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
        return reply
          .code(400)
          .send({ success: false, error: 'Status media must be an image or video' });
      }
      statusType = detectedType;
    }
    if (!content && !upload.mediaKey) {
      if (upload.mediaKey)
        await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
      return reply.code(400).send({ success: false, error: 'Status must contain text or media' });
    }
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          status_type: statusType,
          content,
          allow_reshare: allowReshare,
          media_mime_type: upload.mediaMime,
          media_file_name: upload.mediaFileName,
        })
      )
      .update(upload.mediaDigest)
      .digest('hex');
    const existing = await WhatsappStatus.query().findOne({
      company_id: companyId,
      idempotency_key: idempotencyKey,
    });
    if (existing) {
      if (upload.mediaKey)
        await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
      if (existing.request_hash !== requestHash)
        return reply
          .code(409)
          .send({ success: false, error: 'Idempotency key was used for another Status' });
      return reply.code(202).send({ success: true, data: existing });
    }
    const account = await WhatsappAccount.query().findOne({ company_id: companyId });
    if (!account?.gateway_device_id || account.status !== 'connected') {
      if (upload.mediaKey)
        await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
      return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
    }
    const result = await app.db
      .transaction(async (trx) => {
        const inserted = await trx('whatsapp_statuses')
          .insert({
            company_id: companyId,
            account_id: account.id,
            status_type: statusType,
            content: content || null,
            media_key: upload.mediaKey,
            media_mime_type: upload.mediaKey ? upload.mediaMime : null,
            media_file_name: upload.mediaKey ? upload.mediaFileName : null,
            media_size_bytes: upload.mediaKey ? upload.mediaSizeBytes : null,
            allow_reshare: allowReshare,
            idempotency_key: idempotencyKey,
            request_hash: requestHash,
            external_id: `pending:${idempotencyKey}`.slice(0, 255),
            status: 'queued',
            attempt_count: 0,
            retryable: false,
          })
          .onConflict(['company_id', 'idempotency_key'])
          .ignore()
          .returning(['id']);
        const id = inserted[0]?.id;
        if (!id) {
          const existing = await trx('whatsapp_statuses')
            .where({ company_id: companyId, idempotency_key: idempotencyKey })
            .first('id', 'request_hash');
          if (existing?.request_hash !== requestHash)
            throw Object.assign(new Error('Idempotency key conflict'), { statusCode: 409 });
          return { id: Number(existing.id), created: false, conflict: false };
        }
        await OutboxEvent.query(trx).insert({
          event_type: WHATSAPP_STATUS_PUBLISH_EVENT,
          aggregate_model: 'whatsapp.status',
          aggregate_id: id,
          company_id: companyId,
          payload: JSON.stringify({ status_id: id }),
          status: 'pending',
          attempts: 0,
          max_attempts: 4,
          available_at: new Date().toISOString(),
        });
        await recordWhatsAppAudit(
          req,
          'whatsapp.status',
          'publish_queued',
          Number(id),
          companyId,
          trx
        );
        return { id: Number(id), created: true, conflict: false };
      })
      .catch((error: unknown) => {
        if (isRecord(error) && error.statusCode === 409)
          return { id: 0, created: false, conflict: true };
        throw error;
      });
    if (!result.created && upload.mediaKey)
      await options.attachmentStorage.delete(upload.mediaKey).catch(() => undefined);
    if (result.created && upload.mediaSizeBytes !== null)
      recordWhatsAppMediaTransfer('outbound', upload.mediaSizeBytes);
    if (result.conflict)
      return reply
        .code(409)
        .send({ success: false, error: 'Idempotency key was used for another Status' });
    const status = await WhatsappStatus.query()
      .where({ id: result.id, company_id: companyId })
      .select(
        'id',
        'status_type',
        'content',
        'media_mime_type',
        'media_file_name',
        'media_size_bytes',
        'allow_reshare',
        'status',
        'last_error',
        'create_date'
      )
      .first();
    return reply.code(202).send({ success: true, data: status });
  });
}
