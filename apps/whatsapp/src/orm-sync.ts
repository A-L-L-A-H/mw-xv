import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Knex } from 'knex';
import { Company } from '@moonwitness/orm-base';
import {
  WhatsappAccount,
  WhatsappConversation,
  WhatsappMessage,
  WhatsappStatus,
  type BaileysDeviceStatus,
  type BaileysGatewayManager,
  type BaileysInboundMessageEvent,
  type BaileysSessionConnectionEvent,
  type BaileysUpsertMessage,
  type WHATSAPP_ACCOUNT_STATUSES,
} from '@moonwitness/orm-whatsapp';
import type { WhatsappServiceConfig } from './config.js';

export type WhatsappAccountStatus = (typeof WHATSAPP_ACCOUNT_STATUSES)[number];
export type WhatsappAccountRecord = InstanceType<typeof WhatsappAccount>;
export type WhatsappConversationRecord = InstanceType<typeof WhatsappConversation>;
export type WhatsappMessageRecord = InstanceType<typeof WhatsappMessage>;
export type WhatsappStatusRecord = InstanceType<typeof WhatsappStatus>;
export type WhatsappMessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface SyncOutboundMessageInput {
  deviceId: string;
  recipient: string;
  externalId: string;
  content: string;
  messageType?: WhatsappMessageType;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  idempotencyKey?: string | null;
  replyToExternalId?: string | null;
  status?: 'sent' | 'queued' | 'failed';
}

export interface SyncStatusBroadcastInput {
  deviceId: string;
  externalId: string;
  statusType: 'text' | 'image' | 'video';
  content: string | null;
  status?: 'sent' | 'queued' | 'failed';
  idempotencyKey?: string;
}

export function normalizeJid(recipient: string): string {
  const trimmed = recipient.trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/\D/gu, '');
  return digits ? `${digits}@s.whatsapp.net` : trimmed;
}

export function extractPhoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const user = jid.split('@')[0] ?? '';
  const base = user.split(':')[0] ?? '';
  return base || null;
}

function mapAccountStatus(
  status: BaileysDeviceStatus['status'] | BaileysSessionConnectionEvent['status']
): WhatsappAccountStatus {
  switch (status) {
    case 'connected':
    case 'connecting':
    case 'qr':
    case 'reconnecting':
    case 'disconnected':
      return status;
    default:
      return 'disconnected';
  }
}

function normalizeTimestamp(value: BaileysUpsertMessage['messageTimestamp']): string {
  let seconds: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    seconds = value;
  } else if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) seconds = parsed;
  } else if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
    const parsed = value.toNumber();
    if (Number.isFinite(parsed)) seconds = parsed;
  }
  if (seconds === null) return new Date().toISOString();
  const millis = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(millis).toISOString();
}

function extractUpsertDetails(message: Record<string, unknown> | null | undefined): {
  content: string;
  messageType: WhatsappMessageType;
  mediaMimeType: string | null;
  mediaFileName: string | null;
} {
  if (!message) {
    return { content: '', messageType: 'text', mediaMimeType: null, mediaFileName: null };
  }
  if (typeof message.conversation === 'string') {
    return {
      content: message.conversation.slice(0, 8000),
      messageType: 'text',
      mediaMimeType: null,
      mediaFileName: null,
    };
  }
  const extended = message.extendedTextMessage as { text?: unknown } | undefined;
  if (extended && typeof extended.text === 'string') {
    return {
      content: extended.text.slice(0, 8000),
      messageType: 'text',
      mediaMimeType: null,
      mediaFileName: null,
    };
  }
  const imageMsg = message.imageMessage as { caption?: unknown; mimetype?: unknown } | undefined;
  if (imageMsg && typeof imageMsg === 'object') {
    return {
      content: typeof imageMsg.caption === 'string' ? imageMsg.caption.slice(0, 8000) : '',
      messageType: 'image',
      mediaMimeType: typeof imageMsg.mimetype === 'string' ? imageMsg.mimetype : 'image/jpeg',
      mediaFileName: null,
    };
  }
  const videoMsg = message.videoMessage as { caption?: unknown; mimetype?: unknown } | undefined;
  if (videoMsg && typeof videoMsg === 'object') {
    return {
      content: typeof videoMsg.caption === 'string' ? videoMsg.caption.slice(0, 8000) : '',
      messageType: 'video',
      mediaMimeType: typeof videoMsg.mimetype === 'string' ? videoMsg.mimetype : 'video/mp4',
      mediaFileName: null,
    };
  }
  const audioMsg = message.audioMessage as { mimetype?: unknown } | undefined;
  if (audioMsg && typeof audioMsg === 'object') {
    return {
      content: '',
      messageType: 'audio',
      mediaMimeType: typeof audioMsg.mimetype === 'string' ? audioMsg.mimetype : 'audio/ogg',
      mediaFileName: null,
    };
  }
  const docMsg = message.documentMessage as
    { caption?: unknown; fileName?: unknown; mimetype?: unknown } | undefined;
  if (docMsg && typeof docMsg === 'object') {
    const fileName = typeof docMsg.fileName === 'string' ? docMsg.fileName.slice(0, 255) : null;
    return {
      content:
        typeof docMsg.caption === 'string' ? docMsg.caption.slice(0, 8000) : (fileName ?? ''),
      messageType: 'document',
      mediaMimeType:
        typeof docMsg.mimetype === 'string' ? docMsg.mimetype : 'application/octet-stream',
      mediaFileName: fileName,
    };
  }
  const stickerMsg = message.stickerMessage as { mimetype?: unknown } | undefined;
  if (stickerMsg && typeof stickerMsg === 'object') {
    return {
      content: '',
      messageType: 'sticker',
      mediaMimeType: typeof stickerMsg.mimetype === 'string' ? stickerMsg.mimetype : 'image/webp',
      mediaFileName: null,
    };
  }
  return { content: '', messageType: 'text', mediaMimeType: null, mediaFileName: null };
}

async function resolveDefaultCompanyId(db: Knex): Promise<number> {
  const existing = await Company.query(db).orderBy('id', 'asc').first();
  if (existing) return Number(existing.id);
  const created = await Company.query(db).insertAndFetch({
    name: 'MoonWitness',
    timezone: 'UTC',
  });
  return Number(created.id);
}

/**
 * Ensures a WhatsappAccount row exists for the given gateway device ID.
 * Because `whatsapp_accounts` enforces `unique(company_id)`, the primary device reuses
 * the default company row when unassigned, while additional devices receive dedicated
 * company rows so multi-device tracking works cleanly in the shared ORM schema.
 */
export async function ensureAccountForDevice(
  db: Knex,
  deviceId: string,
  patch: Partial<{
    status: WhatsappAccountStatus;
    phone_number: string | null;
    qr_code: string | null;
    last_error: string | null;
  }> = {}
): Promise<WhatsappAccountRecord> {
  const normalizedDeviceId = deviceId.trim() || 'default';
  const now = new Date().toISOString();

  const existingByDevice = await WhatsappAccount.query(db).findOne({
    gateway_device_id: normalizedDeviceId,
  });
  if (existingByDevice) {
    if (Object.keys(patch).length === 0) return existingByDevice;
    return WhatsappAccount.query(db).patchAndFetchById(existingByDevice.id, {
      ...patch,
      write_date: now,
    });
  }

  const defaultCompanyId = await resolveDefaultCompanyId(db);
  const defaultAccount = await WhatsappAccount.query(db).findOne({
    company_id: defaultCompanyId,
  });

  if (!defaultAccount) {
    return WhatsappAccount.query(db).insertAndFetch({
      company_id: defaultCompanyId,
      gateway_device_id: normalizedDeviceId,
      status: patch.status ?? 'disconnected',
      phone_number: patch.phone_number ?? null,
      qr_code: patch.qr_code ?? null,
      last_error: patch.last_error ?? null,
    });
  }

  if (
    !defaultAccount.gateway_device_id ||
    defaultAccount.gateway_device_id === normalizedDeviceId
  ) {
    return WhatsappAccount.query(db).patchAndFetchById(defaultAccount.id, {
      gateway_device_id: normalizedDeviceId,
      ...patch,
      write_date: now,
    });
  }

  const companyName = `WhatsApp Device (${normalizedDeviceId})`.slice(0, 255);
  let deviceCompany = await Company.query(db).findOne({ name: companyName });
  if (!deviceCompany) {
    deviceCompany = await Company.query(db).insertAndFetch({
      name: companyName,
      timezone: 'UTC',
    });
  }
  const companyAccount = await WhatsappAccount.query(db).findOne({
    company_id: Number(deviceCompany.id),
  });
  if (companyAccount) {
    return WhatsappAccount.query(db).patchAndFetchById(companyAccount.id, {
      gateway_device_id: normalizedDeviceId,
      ...patch,
      write_date: now,
    });
  }
  return WhatsappAccount.query(db).insertAndFetch({
    company_id: Number(deviceCompany.id),
    gateway_device_id: normalizedDeviceId,
    status: patch.status ?? 'disconnected',
    phone_number: patch.phone_number ?? null,
    qr_code: patch.qr_code ?? null,
    last_error: patch.last_error ?? null,
  });
}

export async function syncDeviceStatusToOrm(
  db: Knex,
  status: Pick<BaileysDeviceStatus, 'deviceId' | 'status' | 'jid' | 'qr'> & {
    phoneNumber?: string | null;
    lastError?: string | null;
  }
): Promise<WhatsappAccountRecord> {
  const mappedStatus = mapAccountStatus(status.status);
  const phoneNumber = status.phoneNumber ?? extractPhoneFromJid(status.jid);
  const qrCode =
    mappedStatus === 'qr'
      ? (status.qr ?? `/statics/qr/${encodeURIComponent(status.deviceId)}.png`)
      : null;

  return ensureAccountForDevice(db, status.deviceId, {
    status: mappedStatus,
    phone_number: phoneNumber,
    qr_code: qrCode,
    last_error: status.lastError ?? null,
  });
}

async function upsertConversation(
  db: Knex,
  input: {
    companyId: number;
    accountId: number;
    jid: string;
    name?: string | null;
    lastMessage?: string | null;
    lastMessageAt?: string | null;
    incrementUnread?: boolean;
  }
): Promise<WhatsappConversationRecord> {
  const now = new Date().toISOString();
  const isGroup = input.jid.endsWith('@g.us');
  const displayName = (input.name?.trim() || input.jid).slice(0, 255);

  const existing = await WhatsappConversation.query(db).findOne({
    company_id: input.companyId,
    jid: input.jid,
  });

  if (existing) {
    const patch: Record<string, unknown> = {
      account_id: input.accountId,
      is_group: isGroup,
      write_date: now,
    };
    if (input.name?.trim() && (existing.name === existing.jid || !existing.name)) {
      patch.name = displayName;
    }
    if (input.lastMessage !== undefined) {
      patch.last_message = input.lastMessage;
    }
    if (input.lastMessageAt !== undefined) {
      patch.last_message_at = input.lastMessageAt;
    }
    if (input.incrementUnread) {
      patch.unread_count = Number(existing.unread_count ?? 0) + 1;
    }
    return WhatsappConversation.query(db).patchAndFetchById(existing.id, patch);
  }

  return WhatsappConversation.query(db).insertAndFetch({
    company_id: input.companyId,
    account_id: input.accountId,
    jid: input.jid,
    name: displayName,
    is_group: isGroup,
    unread_count: input.incrementUnread ? 1 : 0,
    last_message: input.lastMessage ?? null,
    last_message_at: input.lastMessageAt ?? now,
  });
}

export async function syncOutboundMessageToOrm(
  db: Knex,
  input: SyncOutboundMessageInput
): Promise<{
  account: WhatsappAccountRecord;
  conversation: WhatsappConversationRecord;
  message: WhatsappMessageRecord;
}> {
  const jid = normalizeJid(input.recipient);
  const now = new Date().toISOString();
  const messageType = input.messageType ?? 'text';
  const preview = input.content.trim() ? input.content.trim().slice(0, 8000) : `[${messageType}]`;

  const account = await ensureAccountForDevice(db, input.deviceId);
  const conversation = await upsertConversation(db, {
    companyId: Number(account.company_id),
    accountId: Number(account.id),
    jid,
    lastMessage: preview,
    lastMessageAt: now,
  });

  const existing = await WhatsappMessage.query(db).findOne({
    company_id: Number(account.company_id),
    external_id: input.externalId.slice(0, 255),
  });

  const message = existing
    ? await WhatsappMessage.query(db).patchAndFetchById(existing.id, {
        content: input.content.slice(0, 8000),
        status: input.status ?? 'sent',
        write_date: now,
      })
    : await WhatsappMessage.query(db).insertAndFetch({
        company_id: Number(account.company_id),
        account_id: Number(account.id),
        conversation_id: Number(conversation.id),
        external_id: input.externalId.slice(0, 255),
        idempotency_key: input.idempotencyKey ?? null,
        direction: 'outbound',
        message_type: messageType,
        content: input.content.slice(0, 8000),
        status: input.status ?? 'sent',
        media_mime_type: input.mediaMimeType ?? null,
        media_file_name: input.mediaFileName ?? null,
        media_scan_status: 'not_applicable',
        reply_to_external_id: input.replyToExternalId ?? null,
      });

  return { account, conversation, message };
}

export async function syncStatusBroadcastToOrm(
  db: Knex,
  input: SyncStatusBroadcastInput
): Promise<WhatsappStatusRecord> {
  const account = await ensureAccountForDevice(db, input.deviceId);
  const now = new Date().toISOString();
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        deviceId: input.deviceId,
        statusType: input.statusType,
        content: input.content,
        externalId: input.externalId,
      })
    )
    .digest('hex');

  return WhatsappStatus.query(db).insertAndFetch({
    company_id: Number(account.company_id),
    account_id: Number(account.id),
    status_type: input.statusType,
    content: input.content,
    allow_reshare: false,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    external_id: input.externalId.slice(0, 255),
    status: input.status ?? 'sent',
    published_at: now,
  });
}

function buildWebhookTargetUrl(baseOrFullUrl: string, deviceId: string): string {
  const parsed = new URL(baseOrFullUrl);
  if (parsed.pathname === '' || parsed.pathname === '/') {
    return new URL(`/whatsapp/gowa/webhook/${encodeURIComponent(deviceId)}`, parsed).toString();
  }
  return parsed.toString();
}

export async function dispatchSignedWebhook(
  config: Pick<WhatsappServiceConfig, 'webhookUrl' | 'webhookSecret'>,
  deviceId: string,
  event: string,
  payload: Record<string, unknown>,
  logger?: FastifyBaseLogger
): Promise<boolean> {
  if (!config.webhookUrl || !config.webhookSecret) return false;
  const targetUrl = buildWebhookTargetUrl(config.webhookUrl, deviceId);
  const body = JSON.stringify({
    event,
    session_id: deviceId,
    timestamp: new Date().toISOString(),
    payload,
  });
  const signature = createHmac('sha256', config.webhookSecret).update(body, 'utf8').digest('hex');

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
        'x-device-id': deviceId,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger?.warn(
        { status: response.status, deviceId, event },
        'WhatsApp webhook target returned non-2xx status'
      );
      return false;
    }
    return true;
  } catch (error) {
    logger?.warn(
      { err: error instanceof Error ? error.message : String(error), deviceId, event },
      'WhatsApp webhook delivery failed'
    );
    return false;
  }
}

export async function processInboundUpsertEvent(
  db: Knex,
  event: BaileysInboundMessageEvent,
  config: Pick<WhatsappServiceConfig, 'webhookUrl' | 'webhookSecret'>,
  logger?: FastifyBaseLogger
): Promise<void> {
  const account = await ensureAccountForDevice(db, event.deviceId);
  const companyId = Number(account.company_id);

  for (const rawMsg of event.messages) {
    const remoteJid = rawMsg.key?.remoteJid;
    const messageId = rawMsg.key?.id;
    if (!remoteJid || !messageId || remoteJid === 'status@broadcast') continue;

    const fromMe = rawMsg.key?.fromMe === true;
    const timestamp = normalizeTimestamp(rawMsg.messageTimestamp);
    const details = extractUpsertDetails(rawMsg.message);
    const senderJid = rawMsg.key?.participant ?? remoteJid;
    const senderName =
      typeof rawMsg.pushName === 'string' && rawMsg.pushName.trim()
        ? rawMsg.pushName.trim().slice(0, 255)
        : null;
    const preview = details.content.trim()
      ? details.content.trim().slice(0, 8000)
      : `[${details.messageType}]`;

    const conversation = await upsertConversation(db, {
      companyId,
      accountId: Number(account.id),
      jid: remoteJid,
      name: !fromMe ? senderName : null,
      lastMessage: preview,
      lastMessageAt: timestamp,
      incrementUnread: !fromMe,
    });

    const existing = await WhatsappMessage.query(db).findOne({
      company_id: companyId,
      external_id: messageId.slice(0, 255),
    });
    if (!existing) {
      await WhatsappMessage.query(db).insert({
        company_id: companyId,
        account_id: Number(account.id),
        conversation_id: Number(conversation.id),
        external_id: messageId.slice(0, 255),
        direction: fromMe ? 'outbound' : 'inbound',
        message_type: details.messageType,
        content: details.content,
        status: fromMe ? 'sent' : 'received',
        media_mime_type: details.mediaMimeType,
        media_file_name: details.mediaFileName,
        media_scan_status: 'not_applicable',
        sender_jid: senderJid.slice(0, 255),
        sender_display_name: senderName,
        create_date: timestamp,
      });
    }

    await dispatchSignedWebhook(
      config,
      event.deviceId,
      'message',
      {
        id: messageId,
        chat_id: remoteJid,
        chat_name: conversation.name,
        from: senderJid,
        from_name: senderName,
        sender_display_name: senderName,
        body: details.content,
        media_type: details.messageType,
        is_from_me: fromMe,
        timestamp,
      },
      logger
    );
  }
}

export function attachBaileysOrmSync(
  manager: BaileysGatewayManager,
  db: Knex,
  config: Pick<WhatsappServiceConfig, 'webhookUrl' | 'webhookSecret'>,
  logger?: FastifyBaseLogger
): () => void {
  return manager.onInboundMessage(async (event) => {
    try {
      await processInboundUpsertEvent(db, event, config, logger);
    } catch (error) {
      logger?.warn(
        { err: error instanceof Error ? error.message : String(error), deviceId: event.deviceId },
        'Failed to sync inbound Baileys message to ORM'
      );
    }
  });
}

export async function queryOrmOverview(db: Knex): Promise<{
  accounts: number;
  conversations: number;
  messages: number;
  statuses: number;
}> {
  const [accountsRow, conversationsRow, messagesRow, statusesRow] = await Promise.all([
    db('whatsapp_accounts').count({ count: '*' }).first(),
    db('whatsapp_conversations').count({ count: '*' }).first(),
    db('whatsapp_messages').count({ count: '*' }).first(),
    db('whatsapp_statuses').count({ count: '*' }).first(),
  ]);
  return {
    accounts: Number(accountsRow?.count ?? 0),
    conversations: Number(conversationsRow?.count ?? 0),
    messages: Number(messagesRow?.count ?? 0),
    statuses: Number(statusesRow?.count ?? 0),
  };
}
