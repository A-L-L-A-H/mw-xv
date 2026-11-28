import type { BaileysGatewayManager } from './baileys-client.js';
import { GowaError } from './gowa-client.js';

export type GatewayRequestOptions = {
  method?: string;
  deviceId?: string;
  body?: string | FormData;
  contentType?: string;
  timeoutMs?: number;
};

export function parseJsonBody(body: string | FormData | undefined): Record<string, unknown> {
  if (typeof body !== 'string' || !body.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new GowaError('Invalid JSON request payload', 400, 'INVALID_JSON');
  }
}

export function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveAppDeviceId(options: GatewayRequestOptions, url: URL): string {
  return options.deviceId?.trim() || url.searchParams.get('device_id')?.trim() || 'default';
}

export function requireDeviceId(options: GatewayRequestOptions): string {
  const deviceId = options.deviceId?.trim();
  if (!deviceId) throw new GowaError('Device ID is required', 400, 'MISSING_DEVICE_ID');
  return deviceId;
}

export function formatDeviceSummary(status: ReturnType<BaileysGatewayManager['getDeviceStatus']>) {
  return {
    device_id: status.deviceId,
    status: status.status,
    is_connected: status.isConnected,
    is_logged_in: status.isLoggedIn,
    jid: status.jid,
  };
}

export function formatLoginResponse(status: ReturnType<BaileysGatewayManager['getDeviceStatus']>) {
  return {
    qr_link: status.qr ? `/statics/qr/${encodeURIComponent(status.deviceId)}.png` : undefined,
    qr: status.qr,
    qr_data_url: status.qrDataUrl,
    pairing_code: status.pairingCode,
  };
}
