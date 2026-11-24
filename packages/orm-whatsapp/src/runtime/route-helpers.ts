import type { Multipart } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Knex } from 'knex';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { S3AttachmentStorage, AttachmentStorage } from '@moonwitness/orm-storage';
import { isRecord, MAX_ATTACHMENT_BYTES } from '@moonwitness/types';
import { mimeMatchesSignature, safeMime, sniffMime } from './media.js';
import { MalwareScannerUnavailableError, type AttachmentScanner } from './clamav-scanner.js';
import type { createVideoPoster } from './media-thumbnail.js';

export type WhatsappRouteOptions = {
  attachmentStorage: AttachmentStorage;
  attachmentScanner?: AttachmentScanner | null;
  createVideoPoster?: typeof createVideoPoster;
  fetchContactAvatar?: typeof fetch;
};

export type WhatsappRouteParams = { id: string };
export const MAX_CONTACT_AVATAR_BYTES = 2 * 1024 * 1024;
export const INBOX_SYNC_PAGE_SIZE = 100;
export const INBOX_SYNC_MAX_MESSAGES_PER_POLL = 500;

export type DirectUploadStorage = AttachmentStorage &
  Pick<S3AttachmentStorage, 'createPresignedUpload' | 'head'>;

export function supportsDirectUploads(storage: AttachmentStorage): storage is DirectUploadStorage {
  return (
    typeof (storage as Partial<DirectUploadStorage>).createPresignedUpload === 'function' &&
    typeof (storage as Partial<DirectUploadStorage>).head === 'function'
  );
}

export function whatsappRateLimit(max: number) {
  return {
    config: {
      rateLimit: {
        max,
        timeWindow: '1 minute',
        keyGenerator: (request: {
          auth: { companyId?: number; userId?: number } | null;
          ip: string;
        }) =>
          request.auth?.companyId && request.auth.userId
            ? `whatsapp:${request.auth.companyId}:${request.auth.userId}`
            : request.ip,
      },
    },
  };
}

export class MediaTooLargeError extends Error {
  readonly statusCode = 413;
}
export class MediaStorageError extends Error {
  readonly statusCode = 503;
}
export class MediaIncompleteError extends Error {}
export class MediaEmptyError extends Error {}
export class MediaScanInfectedError extends Error {
  readonly statusCode = 422;
}
export class UploadTicketConsumedError extends Error {
  readonly statusCode = 409;
}

export type OutgoingUpload = {
  fields: Record<string, string>;
  mediaKey: string | null;
  mediaMime: string;
  mediaFileName: string | null;
  mediaDigest: string;
  mediaSizeBytes: number | null;
};

type MultipartCapableRequest = FastifyRequest & {
  isMultipart?: () => boolean;
  parts?: (options?: {
    limits?: { fileSize?: number; files?: number };
  }) => AsyncIterableIterator<Multipart>;
};

export async function parseOutgoingUpload(
  req: FastifyRequest,
  storage: AttachmentStorage,
  scanner: AttachmentScanner | null,
  extraFields: string[] = []
): Promise<OutgoingUpload> {
  const multipartReq = req as MultipartCapableRequest;
  const fields: Record<string, string> = {};
  if (
    multipartReq.isMultipart?.() === false &&
    req.headers['content-type']?.includes('application/json')
  ) {
    const body = isRecord(req.body) ? req.body : null;
    if (
      !body ||
      Object.keys(body).some(
        (key) =>
          !['content', 'reply_to_message_id', 'upload_ticket_id', ...extraFields].includes(key)
      ) ||
      typeof body.content !== 'string' ||
      body.content.length > 8000 ||
      (body.reply_to_message_id !== undefined &&
        (!Number.isSafeInteger(body.reply_to_message_id) ||
          Number(body.reply_to_message_id) < 1)) ||
      (body.upload_ticket_id !== undefined &&
        (!Number.isSafeInteger(body.upload_ticket_id) || Number(body.upload_ticket_id) < 1))
    )
      throw Object.assign(new Error('Invalid message payload'), { statusCode: 400 });
    if (body.content) fields.content = body.content;
    if (body.reply_to_message_id !== undefined)
      fields.reply_to_message_id = String(body.reply_to_message_id);
    if (body.upload_ticket_id !== undefined)
      fields.upload_ticket_id = String(body.upload_ticket_id);
    for (const field of extraFields) {
      const value = body[field];
      if (value !== undefined) {
        if (typeof value !== 'boolean' && typeof value !== 'string')
          throw Object.assign(new Error('Invalid message payload'), { statusCode: 400 });
        fields[field] = String(value);
      }
    }
    return {
      fields,
      mediaKey: null,
      mediaMime: 'application/octet-stream',
      mediaFileName: null,
      mediaDigest: '',
      mediaSizeBytes: null,
    };
  }
  let mediaKey: string | null = null;
  let mediaMime = 'application/octet-stream';
  let mediaFileName: string | null = null;
  let mediaDigest = '';
  let mediaSizeBytes = 0;
  let fileCount = 0;
  try {
    if (!multipartReq.parts) {
      throw Object.assign(new Error('Multipart parser is not registered'), { statusCode: 500 });
    }
    for await (const part of multipartReq.parts({
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    })) {
      if (part.type === 'field') {
        if (
          !['content', 'reply_to_message_id', ...extraFields].includes(part.fieldname) ||
          typeof part.value !== 'string' ||
          part.value.length > 8000
        ) {
          throw Object.assign(new Error('Invalid message payload'), { statusCode: 400 });
        }
        fields[part.fieldname] = part.value;
        continue;
      }
      fileCount++;
      if (part.fieldname !== 'media' || fileCount !== 1)
        throw Object.assign(new Error('Invalid media upload'), { statusCode: 400 });
      mediaKey = randomUUID();
      mediaFileName = safeFileName(part.filename);
      mediaMime = safeMime(part.mimetype);
      const digest = createHash('sha256');
      const prefix: Buffer[] = [];
      let prefixLength = 0;
      const inspector = new Transform({
        transform(chunk: Buffer | Uint8Array, _encoding, callback) {
          const bytes = Buffer.from(chunk);
          mediaSizeBytes += bytes.byteLength;
          digest.update(bytes);
          if (prefixLength < 64 * 1024) {
            const sample = bytes.subarray(0, 64 * 1024 - prefixLength);
            prefix.push(sample);
            prefixLength += sample.length;
          }
          callback(null, bytes);
        },
      });
      const passThrough = new PassThrough();
      if (!storage.putStream)
        throw new MediaStorageError('Attachment storage does not support streamed uploads');
      const transfer = pipeline(part.file, inspector, passThrough);
      const [transferred, stored] = await Promise.allSettled([
        transfer,
        storage.putStream(mediaKey, passThrough, MAX_ATTACHMENT_BYTES),
      ]);
      if (stored.status === 'rejected')
        throw new MediaStorageError('Attachment storage write failed', { cause: stored.reason });
      if (transferred.status === 'rejected') throw transferred.reason;
      if (part.file.truncated) throw new MediaTooLargeError('Media exceeds the 10 MiB limit');
      if (prefixLength === 0)
        throw Object.assign(new Error('Media file is empty'), { statusCode: 400 });
      const detectedMime = sniffMime(Buffer.concat(prefix, prefixLength));
      if (!mimeMatchesSignature(mediaMime, detectedMime))
        throw Object.assign(new Error('Media content does not match its declared file type'), {
          statusCode: 400,
        });
      if (mediaMime === 'application/octet-stream' && detectedMime) mediaMime = detectedMime;
      mediaDigest = digest.digest('hex');
      if (!scanner) throw new MalwareScannerUnavailableError();
      const scanResult = await scanStoredAttachment(storage, mediaKey, scanner);
      if (scanResult.status === 'infected')
        throw new MediaScanInfectedError('Attachment was blocked by the malware scanner');
    }
    if (fileCount === 0) mediaKey = null;
    return {
      fields,
      mediaKey,
      mediaMime,
      mediaFileName,
      mediaDigest,
      mediaSizeBytes: mediaKey ? mediaSizeBytes : null,
    };
  } catch (error) {
    if (mediaKey) await storage.delete(mediaKey).catch(() => undefined);
    throw error;
  }
}

export async function scanStoredAttachment(
  storage: AttachmentStorage,
  key: string,
  scanner: AttachmentScanner
) {
  const stream = await storage.getStream?.(key);
  if (stream) return scanner.scan(stream);
  const bytes = await storage.get(key);
  if (!bytes) throw new MediaStorageError('Attachment was not found in storage');
  return scanner.scan(Readable.from([bytes]));
}

export async function readStoredAttachmentBounded(
  storage: AttachmentStorage,
  key: string,
  maxBytes: number
): Promise<Buffer | null> {
  const stream = await storage.getStream?.(key);
  if (!stream) {
    const bytes = await storage.get(key);
    if (bytes && bytes.byteLength > maxBytes)
      throw new MediaTooLargeError('Media exceeds the 10 MiB limit');
    return bytes;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk as Uint8Array);
    total += bytes.byteLength;
    if (total > maxBytes) {
      stream.destroy();
      throw new MediaTooLargeError('Media exceeds the 10 MiB limit');
    }
    chunks.push(bytes);
  }
  return total === 0 ? null : Buffer.concat(chunks, total);
}

export const rawWebhookBodies = new WeakMap<FastifyRequest, Buffer>();
export const MAX_GOWA_WEBHOOK_BYTES = 256 * 1024;

export function captureGowaWebhookBody() {
  return async function captureRawBody(
    request: FastifyRequest,
    _reply: unknown,
    payload: Readable
  ): Promise<Readable> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of payload) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += bytes.length;
      if (total > MAX_GOWA_WEBHOOK_BYTES) {
        const error = new Error('GoWA webhook payload too large') as Error & { statusCode: number };
        error.statusCode = 413;
        throw error;
      }
      chunks.push(bytes);
    }
    const raw = Buffer.concat(chunks, total);
    rawWebhookBodies.set(request, raw);
    return Readable.from([raw]);
  };
}

export function validGowaWebhookSignature(raw: Buffer, signature: unknown): boolean {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/iu.test(signature))
    return false;
  const supplied = Buffer.from(signature.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function safeFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const sanitized = value.replace(/[\\/"\p{Cc}]/gu, '_').slice(0, 255);
  return sanitized || null;
}

export async function readLimitedMedia(response: Response): Promise<Buffer> {
  const rawDeclaredLength = response.headers.get('content-length');
  const declaredLength = rawDeclaredLength === null ? NaN : Number(rawDeclaredLength);
  const canVerifyLength =
    Number.isSafeInteger(declaredLength) &&
    declaredLength >= 0 &&
    (!response.headers.has('content-encoding') ||
      response.headers.get('content-encoding') === 'identity');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
    await response.body?.cancel();
    throw new MediaTooLargeError('Media exceeds the 10 MiB limit');
  }
  if (!response.body) throw new Error('WhatsApp gateway returned an empty media body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ATTACHMENT_BYTES) {
        await reader.cancel();
        throw new MediaTooLargeError('Media exceeds the 10 MiB limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (canVerifyLength && totalBytes !== declaredLength)
    throw new MediaIncompleteError('WhatsApp gateway returned incomplete media');
  return Buffer.concat(chunks, totalBytes);
}

function createMediaInspector(headers: Headers) {
  const rawDeclaredLength = headers.get('content-length');
  const declaredLength = rawDeclaredLength === null ? NaN : Number(rawDeclaredLength);
  const canVerifyLength =
    Number.isSafeInteger(declaredLength) &&
    declaredLength >= 0 &&
    (!headers.has('content-encoding') || headers.get('content-encoding') === 'identity');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES)
    throw new MediaTooLargeError('Media exceeds the 10 MiB limit');

  let totalBytes = 0;
  let prefixBytes = 0;
  const prefix: Buffer[] = [];
  const transform = new Transform({
    transform(chunk: Buffer | Uint8Array, _encoding, callback) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_ATTACHMENT_BYTES) {
        callback(new MediaTooLargeError('Media exceeds the 10 MiB limit'));
        return;
      }
      if (prefixBytes < 64 * 1024) {
        const sample = bytes.subarray(0, 64 * 1024 - prefixBytes);
        prefix.push(sample);
        prefixBytes += sample.byteLength;
      }
      callback(null, bytes);
    },
    flush(callback) {
      if (canVerifyLength && totalBytes !== declaredLength) {
        callback(new MediaIncompleteError('WhatsApp gateway returned incomplete media'));
        return;
      }
      callback();
    },
  });
  return {
    transform,
    getPrefix: () => Buffer.concat(prefix, prefixBytes),
    getSize: () => totalBytes,
  };
}

export async function streamResponseToStorage(
  response: Response,
  storage: AttachmentStorage,
  key: string
): Promise<{ mime: string; size: number }> {
  if (!response.body) throw new Error('WhatsApp gateway returned an empty media body');
  const readable = Readable.fromWeb(response.body as NodeWebReadableStream<Uint8Array>);
  let inspector: ReturnType<typeof createMediaInspector>;
  try {
    inspector = createMediaInspector(response.headers);
  } catch (error) {
    await response.body.cancel().catch(() => undefined);
    throw error;
  }
  const passThrough = new PassThrough();
  const transfer = pipeline(readable, inspector.transform, passThrough);
  const storing = storage.putStream!(key, passThrough, MAX_ATTACHMENT_BYTES);
  try {
    await Promise.all([transfer, storing]);
  } catch (error) {
    readable.destroy(error instanceof Error ? error : undefined);
    passThrough.destroy(error instanceof Error ? error : undefined);
    await Promise.allSettled([transfer, storing]);
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
  if (inspector.getPrefix().length === 0) {
    await storage.delete(key).catch(() => undefined);
    throw new MediaEmptyError('WhatsApp gateway returned empty media');
  }
  return {
    mime: sniffMime(inspector.getPrefix()) ?? 'application/octet-stream',
    size: inspector.getSize(),
  };
}

export async function peekReadable(
  source: Readable,
  maxPrefixBytes = 64 * 1024
): Promise<{ prefix: Buffer; stream: Readable }> {
  const iterator = source[Symbol.asyncIterator]();
  const prefix: Buffer[] = [];
  let prefixBytes = 0;
  let remainder: Buffer | null = null;
  while (prefixBytes < maxPrefixBytes) {
    const next = await iterator.next();
    if (next.done) break;
    const chunk = Buffer.from(next.value);
    const length = Math.min(chunk.byteLength, maxPrefixBytes - prefixBytes);
    prefix.push(chunk.subarray(0, length));
    prefixBytes += length;
    if (length < chunk.byteLength) {
      remainder = chunk.subarray(length);
      break;
    }
  }
  const head = Buffer.concat(prefix, prefixBytes);
  const stream = Readable.from(
    (async function* () {
      if (head.length) yield head;
      if (remainder?.length) yield remainder;
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    })()
  );
  return { prefix: head, stream };
}

export function limitReadable(source: Readable, maxBytes: number): Readable {
  return Readable.from(
    (async function* () {
      let totalBytes = 0;
      for await (const chunk of source) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) throw new MediaTooLargeError('Media exceeds the 10 MiB limit');
        yield chunk;
      }
    })()
  );
}

export function id(value: string): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function providerTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export function trustedWhatsAppAvatarUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hostname !== 'pps.whatsapp.net'
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export async function readBoundedAvatar(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTACT_AVATAR_BYTES) {
    await response.body?.cancel();
    throw new Error('Contact avatar exceeds the allowed size');
  }
  if (!response.body) throw new Error('Contact avatar response is empty');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CONTACT_AVATAR_BYTES) {
        await reader.cancel();
        throw new Error('Contact avatar exceeds the allowed size');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export function providerReplyId(value: unknown): string | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const replyId = value.replied_to_id;
  return typeof replyId === 'string' && replyId.length > 0 && replyId.length <= 255
    ? replyId
    : null;
}

export const WHATSAPP_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'] as const;
export type WhatsAppReaction = {
  emoji: string;
  sender_jid: string | null;
  sender_display_name?: string | null;
  is_from_me: boolean;
  timestamp?: string | null;
};

export function normalizedReactions(value: unknown): WhatsAppReaction[] {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .flatMap((reaction) => {
      if (
        typeof reaction.emoji !== 'string' ||
        reaction.emoji.length > 32 ||
        reaction.emoji.trim() === '' ||
        /\p{Cc}/u.test(reaction.emoji)
      )
        return [];
      return [
        {
          emoji: reaction.emoji,
          sender_jid:
            typeof reaction.sender_jid === 'string' ? reaction.sender_jid.slice(0, 255) : null,
          ...(typeof reaction.sender_display_name === 'string'
            ? { sender_display_name: reaction.sender_display_name.slice(0, 255) }
            : {}),
          is_from_me: reaction.is_from_me === true,
          timestamp: providerTimestamp(reaction.timestamp),
        },
      ];
    })
    .slice(-100);
}

const AMBIGUOUS_SEND_MATCH_WINDOW_MS = 2 * 60 * 1_000;

export async function reconcileAmbiguousOutboundMessage(input: {
  db: Knex;
  companyId: number;
  conversationId: number;
  externalId: string;
  content: string;
  messageType: string;
  timestamp: string;
}): Promise<boolean> {
  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  const existing = await input
    .db('whatsapp_messages')
    .where({ company_id: input.companyId, external_id: input.externalId })
    .first();
  const pending = await input
    .db('whatsapp_messages')
    .where({
      company_id: input.companyId,
      conversation_id: input.conversationId,
      direction: 'outbound',
      message_type: input.messageType,
    })
    .where((builder: Knex.QueryBuilder) =>
      input.content
        ? builder.where('content', input.content)
        : builder.where('content', '').orWhereNull('content')
    )
    .whereIn('status', ['unknown', 'sending'])
    .where('external_id', 'like', 'pending:%');
  const candidates = pending.filter((message) => {
    const createdAt = Date.parse(String(message.create_date ?? ''));
    return (
      Number.isFinite(createdAt) &&
      Math.abs(createdAt - timestampMs) <= AMBIGUOUS_SEND_MATCH_WINDOW_MS
    );
  });
  if (candidates.length !== 1) return false;
  const candidate = candidates[0]!;
  const updateCandidate = async (db: Knex): Promise<number> =>
    Number(
      await db('whatsapp_messages')
        .where({
          id: candidate.id,
          company_id: input.companyId,
          status: candidate.status,
          external_id: candidate.external_id,
        })
        .update({
          external_id: input.externalId.slice(0, 255),
          status: 'sent',
          retryable: false,
          last_error: null,
          write_date: new Date().toISOString(),
        })
    );
  if (!existing) return (await updateCandidate(input.db)) === 1;

  const existingTime = Date.parse(String(existing.create_date ?? ''));
  const duplicateMatches =
    existing.id !== candidate.id &&
    existing.company_id === input.companyId &&
    existing.conversation_id === input.conversationId &&
    existing.direction === 'outbound' &&
    existing.message_type === input.messageType &&
    (existing.content ?? '') === input.content &&
    Number.isFinite(existingTime) &&
    Math.abs(existingTime - timestampMs) <= AMBIGUOUS_SEND_MATCH_WINDOW_MS;
  if (!duplicateMatches) return false;
  return input.db.transaction(async (trx) => {
    const deleted = await trx('whatsapp_messages')
      .where({
        id: existing.id,
        company_id: input.companyId,
        external_id: input.externalId,
      })
      .delete();
    if (Number(deleted) !== 1) return false;
    const updated = await updateCandidate(trx);
    if (updated !== 1) throw new Error('Ambiguous WhatsApp message changed during reconciliation');
    return true;
  });
}

export function mediaDefaultMime(type: string): string | null {
  switch (type) {
    case 'image':
      return 'image/jpeg';
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/ogg';
    case 'document':
      return 'application/octet-stream';
    default:
      return null;
  }
}

export const GOWA_MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const GOWA_KNOWN_NON_MEDIA_TYPES = new Set([
  'text',
  'contact',
  'location',
  'live_location',
  'poll',
  'call',
  'event',
  'protocol',
  'view_once',
]);

export function classifyGoWaMessageType(
  rawType: unknown,
  viewOnce = false
): {
  messageType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker';
  providerType: string | null;
} {
  const value = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
  if (viewOnce || value === 'view_once' || value.startsWith('view_once_')) {
    return { messageType: 'text', providerType: 'view_once' };
  }
  if (GOWA_MEDIA_TYPES.has(value)) {
    return {
      messageType: value as 'image' | 'video' | 'audio' | 'document' | 'sticker',
      providerType: null,
    };
  }
  if (!value || value === 'text') return { messageType: 'text', providerType: null };
  if (GOWA_KNOWN_NON_MEDIA_TYPES.has(value)) return { messageType: 'text', providerType: value };
  return {
    messageType: 'text',
    providerType: /^[a-z][a-z0-9_]{0,39}$/u.test(value) ? value : 'unsupported',
  };
}

export function requireCompany(
  req: { auth: { companyId?: number } | null },
  reply: { code: (n: number) => { send: (x: unknown) => unknown } }
): number | null {
  const companyId = req.auth?.companyId;
  if (!companyId) {
    reply.code(req.auth ? 403 : 401).send({ success: false, error: 'Active company is required' });
    return null;
  }
  return companyId;
}

export type WhatsappAction = 'create' | 'write';

export function parseGroupInviteLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'chat.whatsapp.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z0-9_-]{8,128}$/u.test(url.pathname)
    )
      return null;
    return `https://chat.whatsapp.com${url.pathname}`;
  } catch {
    return null;
  }
}

export type WhatsappModel =
  | 'whatsapp.account'
  | 'whatsapp.conversation'
  | 'whatsapp.internal_note'
  | 'whatsapp.label'
  | 'whatsapp.message'
  | 'whatsapp.status'
  | 'whatsapp.group.creation';

export function canPerformWhatsAppAction(
  auth: {
    role: string;
    groupPermissions: readonly { model_name: string; create: boolean; write: boolean }[];
  },
  model: WhatsappModel,
  action: WhatsappAction
): boolean {
  if (auth.role === 'system' || auth.role === 'superadmin') return true;
  return auth.groupPermissions.some((grant) => grant.model_name === model && grant[action]);
}

export function requireWhatsAppAction(
  req: {
    auth: {
      role: string;
      groupPermissions: readonly { model_name: string; create: boolean; write: boolean }[];
    } | null;
  },
  reply: { code: (n: number) => { send: (x: unknown) => unknown } },
  model: WhatsappModel,
  action: WhatsappAction
): boolean {
  if (req.auth && canPerformWhatsAppAction(req.auth, model, action)) return true;
  reply
    .code(403)
    .send({ success: false, error: 'You do not have permission to perform this WhatsApp action' });
  return false;
}

export function whatsappPermissions(auth: {
  role: string;
  groupPermissions: readonly { model_name: string; create: boolean; write: boolean }[];
}) {
  return {
    manage: canPerformWhatsAppAction(auth, 'whatsapp.account', 'write'),
    manageConversations: canPerformWhatsAppAction(auth, 'whatsapp.conversation', 'write'),
    createConversation: canPerformWhatsAppAction(auth, 'whatsapp.conversation', 'create'),
    send: canPerformWhatsAppAction(auth, 'whatsapp.message', 'create'),
    manageMessages: canPerformWhatsAppAction(auth, 'whatsapp.message', 'write'),
  };
}

export async function recordWhatsAppAudit(
  req: FastifyRequest,
  model: WhatsappModel,
  operation: string,
  recordId: number,
  companyId: number,
  trx?: Knex.Transaction
): Promise<void> {
  const audit = trx ? trx('audit_logs') : req.server.db('audit_logs');
  await audit.insert({
    model,
    record_id: recordId,
    operation,
    actor_id: req.auth?.userId ?? null,
    changes: JSON.stringify({ area: 'whatsapp', company_id: companyId }),
  });
}

/**
 * Strips C0/DEL control characters and Unicode bidi override marks without regex control escapes.
 */
export function stripControlAndBidiChars(
  value: string,
  preserveWhitespaceControls = false
): string {
  let sanitized = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    const isBidiMark =
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    if (isBidiMark || code === 0x7f) continue;
    if (code <= 0x1f) {
      if (preserveWhitespaceControls && (code === 0x09 || code === 0x0a || code === 0x0d)) {
        sanitized += ch;
      }
      continue;
    }
    sanitized += ch;
  }
  return sanitized;
}
