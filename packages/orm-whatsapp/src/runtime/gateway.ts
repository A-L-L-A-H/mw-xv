import { createHash } from 'node:crypto';
import { BaileysGatewayManager } from './baileys-client.js';
import { whatsappDriver } from './config.js';
import { GowaError, gowaBinary, gowaOriginPath, gowaRequest } from './gowa-client.js';

export type GatewayRequestOptions = {
  method?: string;
  deviceId?: string;
  body?: string | FormData;
  contentType?: string;
  timeoutMs?: number;
};

let defaultBaileysManager: BaileysGatewayManager | null = null;

export function getBaileysGatewayManager(): BaileysGatewayManager {
  if (!defaultBaileysManager) {
    defaultBaileysManager = new BaileysGatewayManager();
  }
  return defaultBaileysManager;
}

export function setBaileysGatewayManager(manager: BaileysGatewayManager | null): void {
  defaultBaileysManager = manager;
}

export function whatsappGatewayOriginPath(value: string): string {
  if (whatsappDriver() === 'gowa') {
    return gowaOriginPath(value);
  }
  const requested = new URL(value, 'http://baileys.local');
  const validBaileysPath =
    requested.pathname.startsWith('/statics/') ||
    /^\/devices\/[^/]+\/qr$/u.test(requested.pathname) ||
    requested.pathname === '/app/qr';
  if (!['http:', 'https:'].includes(requested.protocol) || !validBaileysPath) {
    throw new GowaError('WhatsApp gateway returned an invalid media URL', 502);
  }
  return `${requested.pathname}${requested.search}`;
}

function parseJsonBody(body: string | FormData | undefined): Record<string, unknown> {
  if (typeof body !== 'string' || !body.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new GowaError('Invalid JSON request payload', 400, 'INVALID_JSON');
  }
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveAppDeviceId(options: GatewayRequestOptions, url: URL): string {
  return options.deviceId?.trim() || url.searchParams.get('device_id')?.trim() || 'default';
}

function requireDeviceId(options: GatewayRequestOptions): string {
  const deviceId = options.deviceId?.trim();
  if (!deviceId) {
    throw new GowaError('Device ID is required', 400, 'MISSING_DEVICE_ID');
  }
  return deviceId;
}

function formatDeviceSummary(status: ReturnType<BaileysGatewayManager['getDeviceStatus']>) {
  return {
    device_id: status.deviceId,
    status: status.status,
    is_connected: status.isConnected,
    is_logged_in: status.isLoggedIn,
    jid: status.jid,
  };
}

function formatLoginResponse(status: ReturnType<BaileysGatewayManager['getDeviceStatus']>) {
  return {
    qr_link: status.qr ? `/statics/qr/${encodeURIComponent(status.deviceId)}.png` : undefined,
    qr: status.qr,
    qr_data_url: status.qrDataUrl,
    pairing_code: status.pairingCode,
  };
}

async function handleBaileysRequest<T>(path: string, options: GatewayRequestOptions): Promise<T> {
  const manager = getBaileysGatewayManager();
  const method = (options.method ?? 'GET').toUpperCase();
  const url = new URL(path, 'http://baileys.local');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/health') {
    return 'OK' as T;
  }

  if (method === 'GET' && (pathname === '/devices' || pathname === '/app/devices')) {
    return manager.listDevices().map(formatDeviceSummary) as T;
  }

  if (method === 'POST' && pathname === '/devices') {
    const payload = parseJsonBody(options.body);
    const deviceId = typeof payload.device_id === 'string' ? payload.device_id : '';
    const status = await manager.connect(deviceId);
    return { device_id: status.deviceId, status: status.status } as T;
  }

  if (method === 'GET' && pathname === '/app/login') {
    const deviceId = resolveAppDeviceId(options, url);
    const status = await manager.connect(deviceId);
    return formatLoginResponse(status) as T;
  }

  if (method === 'GET' && pathname === '/app/login-with-code') {
    const deviceId = resolveAppDeviceId(options, url);
    const phone = url.searchParams.get('phone') ?? '';
    const pairCode = await manager.requestPairingCode(deviceId, phone);
    return { pair_code: pairCode, pairing_code: pairCode } as T;
  }

  if ((method === 'GET' || method === 'POST') && pathname === '/app/logout') {
    const deviceId = resolveAppDeviceId(options, url);
    await manager.logout(deviceId);
    return { status: 'disconnected' } as T;
  }

  if ((method === 'GET' || method === 'POST') && pathname === '/app/reconnect') {
    const deviceId = resolveAppDeviceId(options, url);
    const status = await manager.reconnect(deviceId);
    return formatDeviceSummary(status) as T;
  }

  const deviceMatch = pathname.match(
    /^\/devices\/([^/]+)(?:\/(status|login|logout|reconnect|webhook))?$/u
  );
  if (deviceMatch) {
    const deviceId = decodeSegment(deviceMatch[1]!);
    const action = deviceMatch[2];
    if (method === 'GET' && !action) {
      const status = manager.getDeviceStatus(deviceId);
      return formatDeviceSummary(status) as T;
    }
    if (method === 'GET' && action === 'status') {
      const status = manager.getDeviceStatus(deviceId);
      return {
        status: status.status,
        is_connected: status.isConnected,
        is_logged_in: status.isLoggedIn,
        jid: status.jid,
        ...(status.qr
          ? {
              qr_link: `/statics/qr/${encodeURIComponent(status.deviceId)}.png`,
              qr_data_url: status.qrDataUrl,
            }
          : {}),
      } as T;
    }
    if (method === 'GET' && action === 'login') {
      const status = await manager.connect(deviceId);
      return formatLoginResponse(status) as T;
    }
    if (method === 'POST' && action === 'logout') {
      await manager.logout(deviceId);
      return { status: 'disconnected' } as T;
    }
    if ((method === 'POST' || method === 'GET') && action === 'reconnect') {
      const status = await manager.reconnect(deviceId);
      return formatDeviceSummary(status) as T;
    }
    if (method === 'PATCH' && action === 'webhook') {
      return { ok: true } as T;
    }
  }

  if (method === 'POST' && pathname === '/send/message') {
    const deviceId = requireDeviceId(options);
    const payload = parseJsonBody(options.body);
    const phone = typeof payload.phone === 'string' ? payload.phone : '';
    const message = typeof payload.message === 'string' ? payload.message : '';
    const replyToMessageId =
      typeof payload.reply_message_id === 'string' && payload.reply_message_id.trim()
        ? payload.reply_message_id.trim()
        : undefined;
    const mentions = Array.isArray(payload.mentions)
      ? payload.mentions.filter((entry): entry is string => typeof entry === 'string')
      : undefined;
    const result =
      phone === 'status@broadcast'
        ? await manager.sendStatus(deviceId, { text: message })
        : await manager.sendText(deviceId, phone, message, { replyToMessageId, mentions });
    return { message_id: result.messageId, id: result.messageId } as T;
  }

  const mediaSendMatch = pathname.match(/^\/send\/(image|video|audio|file)$/u);
  if (method === 'POST' && mediaSendMatch && options.body instanceof FormData) {
    const deviceId = requireDeviceId(options);
    const kind = mediaSendMatch[1]!;
    const mediaType = kind === 'file' ? 'document' : (kind as 'image' | 'video' | 'audio');
    const phone = String(options.body.get('phone') ?? '');
    const captionValue = options.body.get('caption');
    const caption = typeof captionValue === 'string' && captionValue ? captionValue : undefined;
    const replyValue = options.body.get('reply_message_id');
    const replyToMessageId =
      typeof replyValue === 'string' && replyValue.trim() ? replyValue.trim() : undefined;
    const mentions = options.body
      .getAll('mentions')
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    const pttValue = options.body.get('ptt');
    const ptt = pttValue === 'true';
    const entry = options.body.get(kind);
    if (!(entry instanceof Blob)) {
      throw new GowaError(`Missing ${kind} attachment in FormData`, 400, 'INVALID_MEDIA');
    }
    const buffer = Buffer.from(await entry.arrayBuffer());
    const mimeType = entry.type || 'application/octet-stream';
    const fileName = 'name' in entry && typeof entry.name === 'string' ? entry.name : undefined;
    const result =
      phone === 'status@broadcast' && (mediaType === 'image' || mediaType === 'video')
        ? await manager.sendStatus(deviceId, {
            media: { type: mediaType, buffer, mimeType, fileName, caption },
          })
        : await manager.sendMedia(deviceId, phone, {
            type: mediaType,
            buffer,
            mimeType,
            fileName,
            caption,
            ptt,
            mentions: mentions.length > 0 ? mentions : undefined,
            replyToMessageId,
          });
    return { message_id: result.messageId, id: result.messageId } as T;
  }

  if (method === 'POST' && pathname === '/send/presence') {
    const deviceId = requireDeviceId(options);
    const payload = parseJsonBody(options.body);
    const presenceType =
      typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : 'available';
    const phone = typeof payload.phone === 'string' ? payload.phone : undefined;
    await manager.sendPresence(deviceId, presenceType, phone);
    return { ok: true } as T;
  }

  const messageActionMatch = pathname.match(
    /^\/message\/([^/]+)\/(read|reaction|update|revoke|download)$/u
  );
  if (messageActionMatch) {
    const deviceId = requireDeviceId(options);
    const messageId = decodeSegment(messageActionMatch[1]!);
    const action = messageActionMatch[2]!;
    if (method === 'POST' && action === 'read') {
      const payload = parseJsonBody(options.body);
      const phone = typeof payload.phone === 'string' ? payload.phone : undefined;
      await manager.markRead(deviceId, [{ id: messageId, remoteJid: phone }]);
      return { ok: true } as T;
    }
    if (method === 'POST' && action === 'reaction') {
      const payload = parseJsonBody(options.body);
      const phone = typeof payload.phone === 'string' ? payload.phone : '';
      const emoji = typeof payload.emoji === 'string' ? payload.emoji : '';
      await manager.sendReaction(deviceId, phone, messageId, emoji);
      return { ok: true } as T;
    }
    if (method === 'POST' && action === 'update') {
      const payload = parseJsonBody(options.body);
      const phone = typeof payload.phone === 'string' ? payload.phone : '';
      const updatedText = typeof payload.message === 'string' ? payload.message : '';
      await manager.editMessage(deviceId, phone, messageId, updatedText);
      return { ok: true } as T;
    }
    if (method === 'POST' && action === 'revoke') {
      const payload = parseJsonBody(options.body);
      const phone = typeof payload.phone === 'string' ? payload.phone : '';
      await manager.revokeMessage(deviceId, phone, messageId);
      return { ok: true } as T;
    }
    if (method === 'GET' && action === 'download') {
      return {} as T;
    }
  }

  if (method === 'GET' && pathname === '/chats') {
    const deviceId = requireDeviceId(options);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const archivedParam = url.searchParams.get('archived');
    const archived =
      archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined;
    const search = url.searchParams.get('search') ?? undefined;
    const chats = manager.listChats(deviceId, {
      limit: Number.isFinite(limit) ? limit : 100,
      offset: Number.isFinite(offset) ? offset : 0,
      archived,
      search,
    });
    return {
      data: chats.map((chat) => ({
        jid: chat.jid,
        name: chat.name,
        archived: chat.archived,
        last_message_time: chat.lastMessageTime,
      })),
    } as T;
  }

  const chatMessagesMatch = pathname.match(/^\/chat\/([^/]+)\/messages$/u);
  if (method === 'GET' && chatMessagesMatch) {
    const deviceId = requireDeviceId(options);
    const chatJid = decodeSegment(chatMessagesMatch[1]!);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const startTime = url.searchParams.get('start_time') ?? undefined;
    const messages = manager.listChatMessages(deviceId, chatJid, {
      limit: Number.isFinite(limit) ? limit : 100,
      offset: Number.isFinite(offset) ? offset : 0,
      startTime,
    });
    return {
      data: messages.map((entry) => ({
        id: entry.id,
        chat_jid: entry.chatJid,
        content: entry.content,
        timestamp: entry.timestamp,
        is_from_me: entry.isFromMe,
        media_type: entry.mediaType,
        sender: entry.sender,
        sender_display_name: entry.senderDisplayName,
      })),
    } as T;
  }

  const chatMutationMatch = pathname.match(/^\/chat\/([^/]+)\/(archive|pin)$/u);
  if (method === 'POST' && chatMutationMatch) {
    const deviceId = requireDeviceId(options);
    const chatJid = decodeSegment(chatMutationMatch[1]!);
    const action = chatMutationMatch[2]!;
    const payload = parseJsonBody(options.body);
    if (action === 'archive') {
      const archived = payload.archived === true;
      await manager.setChatArchived(deviceId, chatJid, archived);
      return { archived } as T;
    }
    const pinned = payload.pinned === true;
    await manager.setChatPinned(deviceId, chatJid, pinned);
    return { pinned } as T;
  }

  if (method === 'GET' && pathname === '/user/check') {
    const deviceId = requireDeviceId(options);
    const phone = url.searchParams.get('phone') ?? '';
    const exists = await manager.checkNumber(deviceId, phone);
    return { is_on_whatsapp: exists } as T;
  }

  if (method === 'GET' && pathname === '/user/info') {
    const deviceId = requireDeviceId(options);
    const phone = url.searchParams.get('phone') ?? '';
    const info = await manager.getUserInfo(deviceId, phone);
    return {
      jid: info.jid,
      verified_name: info.verifiedName,
      status: info.status,
    } as T;
  }

  if (method === 'GET' && pathname === '/user/avatar') {
    const deviceId = requireDeviceId(options);
    const phone = url.searchParams.get('phone') ?? '';
    const isPreview = url.searchParams.get('is_preview') !== 'false';
    const avatarUrl = await manager.getAvatarUrl(deviceId, phone, isPreview);
    return {
      url: avatarUrl,
      id: avatarUrl ? createHash('sha256').update(avatarUrl).digest('hex').slice(0, 16) : null,
    } as T;
  }

  if (method === 'POST' && pathname === '/group') {
    const deviceId = requireDeviceId(options);
    const payload = parseJsonBody(options.body);
    const title = typeof payload.title === 'string' ? payload.title : '';
    const participants = Array.isArray(payload.participants)
      ? payload.participants.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const groupId = await manager.createGroup(deviceId, title, participants);
    return { group_id: groupId } as T;
  }

  if (method === 'GET' && pathname === '/group/info') {
    const deviceId = requireDeviceId(options);
    const groupId = url.searchParams.get('group_id') ?? '';
    const metadata = await manager.getGroupMetadata(deviceId, groupId);
    return {
      group_id: metadata.id ?? groupId,
      name: metadata.subject ?? '',
      topic: metadata.desc ?? null,
      participant_count: metadata.size ?? metadata.participants?.length ?? 0,
      is_locked: typeof metadata.restrict === 'boolean' ? metadata.restrict : null,
      is_announce: typeof metadata.announce === 'boolean' ? metadata.announce : null,
      is_ephemeral:
        typeof metadata.ephemeralDuration === 'number' ? metadata.ephemeralDuration > 0 : null,
    } as T;
  }

  if (method === 'GET' && pathname === '/group/participants') {
    const deviceId = requireDeviceId(options);
    const groupId = url.searchParams.get('group_id') ?? '';
    const metadata = await manager.getGroupMetadata(deviceId, groupId);
    return {
      group_id: metadata.id ?? groupId,
      name: metadata.subject,
      participants: (metadata.participants ?? []).map((participant) => ({
        jid: participant.id,
        phone_number:
          participant.phoneNumber ??
          (participant.id.endsWith('@s.whatsapp.net') ? participant.id : null),
        display_name: null,
        is_admin: participant.admin === 'admin' || participant.admin === 'superadmin',
        is_super_admin: participant.admin === 'superadmin',
      })),
    } as T;
  }

  const groupParticipantActionMatch = pathname.match(
    /^\/group\/participants(?:\/(remove|promote|demote))?$/u
  );
  if (method === 'POST' && groupParticipantActionMatch) {
    const deviceId = requireDeviceId(options);
    const action = (groupParticipantActionMatch[1] ?? 'add') as
      'add' | 'remove' | 'promote' | 'demote';
    const payload = parseJsonBody(options.body);
    const groupId = typeof payload.group_id === 'string' ? payload.group_id : '';
    const participants = Array.isArray(payload.participants)
      ? payload.participants.filter((entry): entry is string => typeof entry === 'string')
      : [];
    return (await manager.updateGroupParticipants(deviceId, groupId, participants, action)) as T;
  }

  if (method === 'POST' && (pathname === '/group/locked' || pathname === '/group/announce')) {
    const deviceId = requireDeviceId(options);
    const setting = pathname === '/group/locked' ? 'locked' : 'announce';
    const payload = parseJsonBody(options.body);
    const groupId = typeof payload.group_id === 'string' ? payload.group_id : '';
    const enabled = payload[setting] === true;
    await manager.updateGroupSetting(deviceId, groupId, setting, enabled);
    return { ok: true } as T;
  }

  if (method === 'GET' && pathname === '/group/invite-link') {
    const deviceId = requireDeviceId(options);
    const groupId = url.searchParams.get('group_id') ?? '';
    const reset = url.searchParams.get('reset') === 'true';
    const inviteLink = await manager.getGroupInviteLink(deviceId, groupId, reset);
    return { invite_link: inviteLink } as T;
  }

  if (method === 'GET' && pathname === '/group/info-from-link') {
    const deviceId = requireDeviceId(options);
    const link = url.searchParams.get('link') ?? '';
    const metadata = await manager.getGroupInfoFromLink(deviceId, link);
    return {
      group_id: metadata.id ?? '',
      name: metadata.subject ?? '',
      topic: metadata.desc ?? null,
      participant_count: metadata.size ?? metadata.participants?.length ?? 0,
    } as T;
  }

  if (method === 'POST' && pathname === '/group/join-with-link') {
    const deviceId = requireDeviceId(options);
    const payload = parseJsonBody(options.body);
    const link = typeof payload.link === 'string' ? payload.link : '';
    const groupId = await manager.joinGroupWithLink(deviceId, link);
    return { group_id: groupId } as T;
  }

  if (method === 'POST' && pathname === '/group/leave') {
    const deviceId = requireDeviceId(options);
    const payload = parseJsonBody(options.body);
    const groupId = typeof payload.group_id === 'string' ? payload.group_id : '';
    await manager.leaveGroup(deviceId, groupId);
    return { left: true } as T;
  }

  throw new GowaError(
    `Baileys gateway does not support route: ${method} ${pathname}`,
    501,
    'NOT_IMPLEMENTED'
  );
}

export async function whatsappGatewayRequest<T>(
  path: string,
  options: GatewayRequestOptions = {}
): Promise<T> {
  if (whatsappDriver() === 'gowa') {
    return gowaRequest<T>(path, options);
  }
  return handleBaileysRequest<T>(path, options);
}

export async function whatsappGatewayBinary(path: string, deviceId?: string): Promise<Response> {
  if (whatsappDriver() === 'gowa') {
    return gowaBinary(path, deviceId);
  }
  const url = new URL(path, 'http://baileys.local');
  const qrMatch =
    url.pathname.match(/^\/statics\/qr\/([^/]+)\.png$/u) ??
    url.pathname.match(/^\/devices\/([^/]+)\/qr$/u);
  const targetDeviceId = qrMatch
    ? decodeSegment(qrMatch[1]!)
    : url.pathname === '/app/qr'
      ? deviceId?.trim() || url.searchParams.get('device_id')?.trim() || 'default'
      : null;
  if (targetDeviceId) {
    const png = await getBaileysGatewayManager().getQrPng(targetDeviceId);
    if (!png) {
      throw new GowaError('WhatsApp QR code not found', 404, 'QR_NOT_FOUND');
    }
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  }
  throw new GowaError(
    `Baileys gateway does not support binary path: ${url.pathname}`,
    501,
    'NOT_IMPLEMENTED'
  );
}
