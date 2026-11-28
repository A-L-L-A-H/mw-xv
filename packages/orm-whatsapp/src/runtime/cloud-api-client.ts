import { readWhatsAppCloudApiConfig } from './config.js';
import type { GatewayRequestOptions } from './gateway-helpers.js';
import { GowaError } from './gowa-client.js';

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinCustomerServiceWindow(
  lastInboundAt: string | Date | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!lastInboundAt) return false;
  const timestampMs =
    lastInboundAt instanceof Date ? lastInboundAt.getTime() : Date.parse(String(lastInboundAt));
  if (!Number.isFinite(timestampMs)) return false;
  const ageMs = nowMs - timestampMs;
  return ageMs >= 0 && ageMs <= CUSTOMER_SERVICE_WINDOW_MS;
}

function parseJsonPayload(body: string | FormData | undefined): Record<string, unknown> {
  if (typeof body !== 'string' || !body.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new GowaError('Invalid JSON payload for Cloud API request', 400, 'INVALID_JSON');
  }
}

function normalizeRecipientPhone(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const digits = value.replace(/@s\.whatsapp\.net$/u, '').replace(/[^0-9]/gu, '');
  if (!digits) {
    throw new GowaError('Recipient phone number is required', 400, 'MISSING_RECIPIENT');
  }
  return digits;
}

function buildGraphMessageBody(
  pathname: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const to = normalizeRecipientPhone(payload.phone ?? payload.to);
  if (pathname === '/send/template') {
    const templateName =
      typeof payload.template_name === 'string' ? payload.template_name.trim() : '';
    if (!templateName) {
      throw new GowaError(
        'template_name is required for template messages',
        400,
        'MISSING_TEMPLATE'
      );
    }
    const languageCode =
      typeof payload.language_code === 'string' ? payload.language_code.trim() : 'id';
    const components = Array.isArray(payload.components) ? payload.components : undefined;
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components ? { components } : {}),
      },
    };
  }
  const hasInboundGuard = payload.last_inbound_at !== undefined && payload.last_inbound_at !== null;
  if (hasInboundGuard && !isWithinCustomerServiceWindow(String(payload.last_inbound_at))) {
    throw new GowaError(
      'Outside 24h customer service window; approved template message is required',
      400,
      'TEMPLATE_REQUIRED_OUTSIDE_24H_WINDOW'
    );
  }
  const message = typeof payload.message === 'string' ? payload.message : '';
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: message },
  };
}

export async function cloudApiRequest<T>(
  path: string,
  options: GatewayRequestOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const pathname = new URL(path, 'https://graph.facebook.com').pathname;
  if (method === 'GET' && pathname === '/health') {
    return 'OK' as T;
  }
  const payload = parseJsonPayload(options.body);
  if (method === 'POST' && pathname === '/handoff/human') {
    return {
      escalated: true,
      channel: 'in_chat_human_agent',
      phone: normalizeRecipientPhone(payload.phone ?? payload.to),
    } as T;
  }
  if (method === 'POST' && (pathname === '/send/message' || pathname === '/send/template')) {
    const config = readWhatsAppCloudApiConfig(env);
    const graphBody = buildGraphMessageBody(pathname, payload);
    const endpoint = `${config.baseUrl}/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(graphBody),
      signal: AbortSignal.timeout(options.timeoutMs ?? config.timeoutMs),
    });
    if (!response.ok) {
      throw new GowaError(
        `WhatsApp Cloud API request failed (${response.status})`,
        response.status
      );
    }
    const result = (await response.json()) as { messages?: Array<{ id?: string }> };
    return {
      message_id: result.messages?.[0]?.id ?? null,
      provider: 'cloud-api',
    } as T;
  }
  throw new GowaError(
    `Cloud API driver does not support route: ${method} ${pathname}`,
    501,
    'NOT_IMPLEMENTED'
  );
}
