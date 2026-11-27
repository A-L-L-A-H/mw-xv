import { createHash } from 'node:crypto';
import type { BaileysGatewayManager } from './baileys-client.js';
import { handleGroupRoute } from './baileys-group-routes.js';
import {
  decodeSegment,
  formatDeviceSummary,
  formatLoginResponse,
  parseJsonBody,
  requireDeviceId,
  resolveAppDeviceId,
  type GatewayRequestOptions,
} from './gateway-helpers.js';
import { GowaError } from './gowa-client.js';

async function handleAppRoute(
  manager: BaileysGatewayManager,
  method: string,
  url: URL,
  options: GatewayRequestOptions
): Promise<unknown> {
  const p = url.pathname;
  if (method === 'GET' && p === '/health') return 'OK';
  if (method === 'GET' && (p === '/devices' || p === '/app/devices')) {
    return manager.listDevices().map(formatDeviceSummary);
  }
  if (method === 'POST' && p === '/devices') {
    const payload = parseJsonBody(options.body);
    const s = await manager.connect(typeof payload.device_id === 'string' ? payload.device_id : '');
    return { device_id: s.deviceId, status: s.status };
  }
  if (method === 'GET' && p === '/app/login') {
    return formatLoginResponse(await manager.connect(resolveAppDeviceId(options, url)));
  }
  if (method === 'GET' && p === '/app/login-with-code') {
    const code = await manager.requestPairingCode(
      resolveAppDeviceId(options, url),
      url.searchParams.get('phone') ?? ''
    );
    return { pair_code: code, pairing_code: code };
  }
  if ((method === 'GET' || method === 'POST') && p === '/app/logout') {
    await manager.logout(resolveAppDeviceId(options, url));
    return { status: 'disconnected' };
  }
  if ((method === 'GET' || method === 'POST') && p === '/app/reconnect') {
    return formatDeviceSummary(await manager.reconnect(resolveAppDeviceId(options, url)));
  }
  return undefined;
}

async function handleDeviceActionRoute(
  manager: BaileysGatewayManager,
  method: string,
  pathname: string
): Promise<unknown> {
  const m = pathname.match(/^\/devices\/([^/]+)(?:\/(status|login|logout|reconnect|webhook))?$/u);
  if (!m) return undefined;
  const deviceId = decodeSegment(m[1]!);
  const action = m[2];
  if (method === 'GET' && !action) return formatDeviceSummary(manager.getDeviceStatus(deviceId));
  if (method === 'GET' && action === 'status') {
    const s = manager.getDeviceStatus(deviceId);
    return {
      status: s.status,
      is_connected: s.isConnected,
      is_logged_in: s.isLoggedIn,
      jid: s.jid,
      ...(s.qr
        ? { qr_link: `/statics/qr/${encodeURIComponent(s.deviceId)}.png`, qr_data_url: s.qrDataUrl }
        : {}),
    };
  }
  if (method === 'GET' && action === 'login')
    return formatLoginResponse(await manager.connect(deviceId));
  if (method === 'POST' && action === 'logout') {
    await manager.logout(deviceId);
    return { status: 'disconnected' };
  }
  if ((method === 'POST' || method === 'GET') && action === 'reconnect') {
    return formatDeviceSummary(await manager.reconnect(deviceId));
  }
  if (method === 'PATCH' && action === 'webhook') return { ok: true };
  return undefined;
}

async function handleMediaSend(
  manager: BaileysGatewayManager,
  deviceId: string,
  kind: string,
  form: FormData
): Promise<unknown> {
  const mediaType = kind === 'file' ? 'document' : (kind as 'image' | 'video' | 'audio');
  const phone = String(form.get('phone') ?? '');
  const capVal = form.get('caption');
  const caption = typeof capVal === 'string' && capVal ? capVal : undefined;
  const replyVal = form.get('reply_message_id');
  const replyToMessageId =
    typeof replyVal === 'string' && replyVal.trim() ? replyVal.trim() : undefined;
  const mentions = form
    .getAll('mentions')
    .filter((e): e is string => typeof e === 'string' && e.length > 0);
  const entry = form.get(kind);
  if (!(entry instanceof Blob)) {
    throw new GowaError(`Missing ${kind} attachment in FormData`, 400, 'INVALID_MEDIA');
  }
  const buffer = Buffer.from(await entry.arrayBuffer());
  const mimeType = entry.type || 'application/octet-stream';
  const fileName = 'name' in entry && typeof entry.name === 'string' ? entry.name : undefined;
  const isBroadcast =
    phone === 'status@broadcast' && (mediaType === 'image' || mediaType === 'video');
  const result = isBroadcast
    ? await manager.sendStatus(deviceId, {
        media: { type: mediaType, buffer, mimeType, fileName, caption },
      })
    : await manager.sendMedia(deviceId, phone, {
        type: mediaType,
        buffer,
        mimeType,
        fileName,
        caption,
        ptt: form.get('ptt') === 'true',
        mentions: mentions.length > 0 ? mentions : undefined,
        replyToMessageId,
      });
  return { message_id: result.messageId, id: result.messageId };
}

async function handleSendAndMessageRoute(
  manager: BaileysGatewayManager,
  method: string,
  pathname: string,
  options: GatewayRequestOptions
): Promise<unknown> {
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
      ? payload.mentions.filter((e): e is string => typeof e === 'string')
      : undefined;
    const res =
      phone === 'status@broadcast'
        ? await manager.sendStatus(deviceId, { text: message })
        : await manager.sendText(deviceId, phone, message, { replyToMessageId, mentions });
    return { message_id: res.messageId, id: res.messageId };
  }
  const mediaMatch = pathname.match(/^\/send\/(image|video|audio|file)$/u);
  if (method === 'POST' && mediaMatch && options.body instanceof FormData) {
    return handleMediaSend(manager, requireDeviceId(options), mediaMatch[1]!, options.body);
  }
  if (method === 'POST' && pathname === '/send/presence') {
    const payload = parseJsonBody(options.body);
    const pType =
      typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : 'available';
    const phone = typeof payload.phone === 'string' ? payload.phone : undefined;
    await manager.sendPresence(requireDeviceId(options), pType, phone);
    return { ok: true };
  }
  return handleMessageActionRoute(manager, method, pathname, options);
}

async function handleMessageActionRoute(
  manager: BaileysGatewayManager,
  method: string,
  pathname: string,
  options: GatewayRequestOptions
): Promise<unknown> {
  const m = pathname.match(/^\/message\/([^/]+)\/(read|reaction|update|revoke|download)$/u);
  if (!m) return undefined;
  const deviceId = requireDeviceId(options);
  const messageId = decodeSegment(m[1]!);
  const action = m[2]!;
  if (method === 'GET' && action === 'download') return {};
  if (method !== 'POST') return undefined;
  const p = parseJsonBody(options.body);
  const phone = typeof p.phone === 'string' ? p.phone : '';
  if (action === 'read')
    await manager.markRead(deviceId, [{ id: messageId, remoteJid: phone || undefined }]);
  else if (action === 'reaction')
    await manager.sendReaction(deviceId, phone, messageId, String(p.emoji ?? ''));
  else if (action === 'update')
    await manager.editMessage(deviceId, phone, messageId, String(p.message ?? ''));
  else if (action === 'revoke') await manager.revokeMessage(deviceId, phone, messageId);
  return { ok: true };
}

async function handleChatAndUserRoute(
  manager: BaileysGatewayManager,
  method: string,
  url: URL,
  options: GatewayRequestOptions
): Promise<unknown> {
  const pathname = url.pathname;
  if (method === 'GET' && pathname === '/chats') {
    const archivedParam = url.searchParams.get('archived');
    const archived =
      archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined;
    const chats = manager.listChats(requireDeviceId(options), {
      limit: Number(url.searchParams.get('limit') ?? 100) || 100,
      offset: Number(url.searchParams.get('offset') ?? 0) || 0,
      archived,
      search: url.searchParams.get('search') ?? undefined,
    });
    return {
      data: chats.map((c) => ({
        jid: c.jid,
        name: c.name,
        archived: c.archived,
        last_message_time: c.lastMessageTime,
      })),
    };
  }
  const msgMatch = pathname.match(/^\/chat\/([^/]+)\/messages$/u);
  if (method === 'GET' && msgMatch) {
    const msgs = manager.listChatMessages(requireDeviceId(options), decodeSegment(msgMatch[1]!), {
      limit: Number(url.searchParams.get('limit') ?? 100) || 100,
      offset: Number(url.searchParams.get('offset') ?? 0) || 0,
      startTime: url.searchParams.get('start_time') ?? undefined,
    });
    return {
      data: msgs.map((e) => ({
        id: e.id,
        chat_jid: e.chatJid,
        content: e.content,
        timestamp: e.timestamp,
        is_from_me: e.isFromMe,
        media_type: e.mediaType,
        sender: e.sender,
        sender_display_name: e.senderDisplayName,
      })),
    };
  }
  const chatMut = pathname.match(/^\/chat\/([^/]+)\/(archive|pin)$/u);
  if (method === 'POST' && chatMut) {
    const payload = parseJsonBody(options.body);
    const val = payload[chatMut[2]!] === true;
    const dev = requireDeviceId(options);
    const jid = decodeSegment(chatMut[1]!);
    if (chatMut[2] === 'archive') await manager.setChatArchived(dev, jid, val);
    else await manager.setChatPinned(dev, jid, val);
    return { [chatMut[2]!]: val };
  }
  return handleUserLookupRoute(manager, method, url, options);
}

async function handleUserLookupRoute(
  manager: BaileysGatewayManager,
  method: string,
  url: URL,
  options: GatewayRequestOptions
): Promise<unknown> {
  if (method !== 'GET') return undefined;
  const phone = url.searchParams.get('phone') ?? '';
  if (url.pathname === '/user/check') {
    return { is_on_whatsapp: await manager.checkNumber(requireDeviceId(options), phone) };
  }
  if (url.pathname === '/user/info') {
    const info = await manager.getUserInfo(requireDeviceId(options), phone);
    return { jid: info.jid, verified_name: info.verifiedName, status: info.status };
  }
  if (url.pathname === '/user/avatar') {
    const isPreview = url.searchParams.get('is_preview') !== 'false';
    const avatarUrl = await manager.getAvatarUrl(requireDeviceId(options), phone, isPreview);
    const id = avatarUrl ? createHash('sha256').update(avatarUrl).digest('hex').slice(0, 16) : null;
    return { url: avatarUrl, id };
  }
  return undefined;
}

export async function handleBaileysRequest<T>(
  manager: BaileysGatewayManager,
  path: string,
  options: GatewayRequestOptions
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const url = new URL(path, 'http://baileys.local');
  const resolved =
    (await handleAppRoute(manager, method, url, options)) ??
    (await handleDeviceActionRoute(manager, method, url.pathname)) ??
    (await handleSendAndMessageRoute(manager, method, url.pathname, options)) ??
    (await handleChatAndUserRoute(manager, method, url, options)) ??
    (await handleGroupRoute(manager, method, url, options));
  if (resolved !== undefined) return resolved as T;
  throw new GowaError(
    `Baileys gateway does not support route: ${method} ${url.pathname}`,
    501,
    'NOT_IMPLEMENTED'
  );
}
