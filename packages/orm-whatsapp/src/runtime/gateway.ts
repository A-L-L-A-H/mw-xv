import { BaileysGatewayManager } from './baileys-client.js';
import { handleBaileysRequest } from './baileys-router.js';
import { cloudApiRequest } from './cloud-api-client.js';
import { whatsappDriver } from './config.js';
import { decodeSegment, type GatewayRequestOptions } from './gateway-helpers.js';
import { GowaError, gowaBinary, gowaOriginPath, gowaRequest } from './gowa-client.js';

export type { GatewayRequestOptions } from './gateway-helpers.js';

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

export async function whatsappGatewayRequest<T>(
  path: string,
  options: GatewayRequestOptions = {}
): Promise<T> {
  const driver = whatsappDriver();
  if (driver === 'cloud-api') {
    return cloudApiRequest<T>(path, options);
  }
  if (driver === 'gowa') {
    return gowaRequest<T>(path, options);
  }
  return handleBaileysRequest<T>(getBaileysGatewayManager(), path, options);
}

export async function whatsappGatewayBinary(path: string, deviceId?: string): Promise<Response> {
  if (whatsappDriver() === 'gowa') {
    return gowaBinary(path, deviceId);
  }
  const url = new URL(path, 'http://baileys.local');
  const qrMatch =
    url.pathname.match(/^\/statics\/qr\/([^/]+)\.png$/u) ??
    url.pathname.match(/^\/devices\/([^/]+)\/qr$/u);
  const queryDevice = url.pathname === '/app/qr' ? deviceId?.trim() || 'default' : null;
  const targetDeviceId = qrMatch ? decodeSegment(qrMatch[1]!) : queryDevice;
  if (!targetDeviceId) {
    throw new GowaError(
      `Baileys gateway does not support binary path: ${url.pathname}`,
      501,
      'NOT_IMPLEMENTED'
    );
  }
  const png = await getBaileysGatewayManager().getQrPng(targetDeviceId);
  if (!png) {
    throw new GowaError('WhatsApp QR code not found', 404, 'QR_NOT_FOUND');
  }
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}
