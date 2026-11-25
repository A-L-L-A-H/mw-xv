import { BaileysGatewayManager } from './baileys-client.js';
import { whatsappDriver } from './config.js';
import { GowaError, gowaBinary, gowaRequest } from './gowa-client.js';

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

async function handleBaileysRequest<T>(path: string, options: GatewayRequestOptions): Promise<T> {
  const manager = getBaileysGatewayManager();
  const method = (options.method ?? 'GET').toUpperCase();
  const url = new URL(path, 'http://baileys.local');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/devices') {
    return manager.listDevices().map((device) => ({
      device_id: device.deviceId,
      status: device.status,
      is_connected: device.isConnected,
      is_logged_in: device.isLoggedIn,
      jid: device.jid,
    })) as T;
  }

  if (method === 'POST' && pathname === '/devices') {
    const payload = parseJsonBody(options.body);
    const deviceId = typeof payload.device_id === 'string' ? payload.device_id : '';
    const status = await manager.connect(deviceId);
    return { device_id: status.deviceId, status: status.status } as T;
  }

  const deviceMatch = pathname.match(/^\/devices\/([^/]+)(?:\/(status|login|logout|webhook))?$/u);
  if (deviceMatch) {
    const deviceId = decodeSegment(deviceMatch[1]!);
    const action = deviceMatch[2];
    if (method === 'GET' && !action) {
      const status = manager.getDeviceStatus(deviceId);
      return {
        device_id: status.deviceId,
        status: status.status,
        is_connected: status.isConnected,
        is_logged_in: status.isLoggedIn,
        jid: status.jid,
      } as T;
    }
    if (method === 'GET' && action === 'status') {
      const status = manager.getDeviceStatus(deviceId);
      return {
        is_connected: status.isConnected,
        is_logged_in: status.isLoggedIn,
        jid: status.jid,
      } as T;
    }
    if (method === 'GET' && action === 'login') {
      const status = await manager.connect(deviceId);
      return {
        qr_link: status.qr ? `/statics/qr/${encodeURIComponent(status.deviceId)}.png` : undefined,
        qr: status.qr,
        qr_data_url: status.qrDataUrl,
        pairing_code: status.pairingCode,
      } as T;
    }
    if (method === 'POST' && action === 'logout') {
      await manager.logout(deviceId);
      return { status: 'disconnected' } as T;
    }
    if (method === 'PATCH' && action === 'webhook') {
      return { ok: true } as T;
    }
  }

  if (method === 'POST' && pathname === '/send/message') {
    const deviceId = options.deviceId;
    if (!deviceId) throw new GowaError('Device ID is required', 400, 'MISSING_DEVICE_ID');
    const payload = parseJsonBody(options.body);
    const phone = typeof payload.phone === 'string' ? payload.phone : '';
    const message = typeof payload.message === 'string' ? payload.message : '';
    const result =
      phone === 'status@broadcast'
        ? await manager.sendStatus(deviceId, { text: message })
        : await manager.sendText(deviceId, phone, message);
    return { message_id: result.messageId, id: result.messageId } as T;
  }

  const mediaSendMatch = pathname.match(/^\/send\/(image|video|audio|file)$/u);
  if (method === 'POST' && mediaSendMatch && options.body instanceof FormData) {
    const deviceId = options.deviceId;
    if (!deviceId) throw new GowaError('Device ID is required', 400, 'MISSING_DEVICE_ID');
    const kind = mediaSendMatch[1]!;
    const mediaType = kind === 'file' ? 'document' : (kind as 'image' | 'video' | 'audio');
    const phone = String(options.body.get('phone') ?? '');
    const captionValue = options.body.get('caption');
    const caption = typeof captionValue === 'string' && captionValue ? captionValue : undefined;
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
          });
    return { message_id: result.messageId, id: result.messageId } as T;
  }

  const readMatch = pathname.match(/^\/message\/([^/]+)\/read$/u);
  if (method === 'POST' && readMatch) {
    const deviceId = options.deviceId;
    if (!deviceId) throw new GowaError('Device ID is required', 400, 'MISSING_DEVICE_ID');
    const payload = parseJsonBody(options.body);
    const phone = typeof payload.phone === 'string' ? payload.phone : undefined;
    await manager.markRead(deviceId, [{ id: decodeSegment(readMatch[1]!), remoteJid: phone }]);
    return { ok: true } as T;
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
  if (qrMatch) {
    const targetDeviceId = decodeSegment(qrMatch[1]!);
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
