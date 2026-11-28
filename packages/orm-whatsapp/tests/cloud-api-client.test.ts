import { describe, expect, it, vi } from 'vitest';
import {
  allowUnofficialWhatsAppInProd,
  readWhatsAppCloudApiConfig,
  validateWhatsAppProductionConfig,
  whatsappDriver,
} from '../src/runtime/config.js';
import { cloudApiRequest, isWithinCustomerServiceWindow } from '../src/runtime/cloud-api-client.js';

describe('WhatsApp Cloud API driver and policy flags', () => {
  it('defaults WHATSAPP_ALLOW_UNOFFICIAL_IN_PROD to true and honors explicit false', () => {
    expect(allowUnofficialWhatsAppInProd({})).toBe(true);
    expect(allowUnofficialWhatsAppInProd({ WHATSAPP_ALLOW_UNOFFICIAL_IN_PROD: 'true' })).toBe(true);
    expect(allowUnofficialWhatsAppInProd({ WHATSAPP_ALLOW_UNOFFICIAL_IN_PROD: 'false' })).toBe(
      false
    );
  });

  it('rejects unofficial drivers in prod only when WHATSAPP_ALLOW_UNOFFICIAL_IN_PROD=false', () => {
    const prodUnofficial = {
      NODE_ENV: 'production',
      WHATSAPP_GATEWAY_USERNAME: 'tenant',
      WHATSAPP_GATEWAY_PASSWORD: 'strong-gateway-password',
    };
    expect(() => validateWhatsAppProductionConfig(prodUnofficial)).not.toThrow();
    expect(() =>
      validateWhatsAppProductionConfig({
        ...prodUnofficial,
        WHATSAPP_ALLOW_UNOFFICIAL_IN_PROD: 'false',
      })
    ).toThrow('Unofficial WhatsApp drivers are disabled');
  });

  it('selects and validates cloud-api config cleanly', () => {
    const env = {
      NODE_ENV: 'production',
      WHATSAPP_CLOUD_API_ACCESS_TOKEN: 'meta-system-user-token',
      WHATSAPP_CLOUD_API_PHONE_NUMBER_ID: '1234567890',
    };
    expect(whatsappDriver(env)).toBe('cloud-api');
    const cfg = readWhatsAppCloudApiConfig(env);
    expect(cfg.graphApiVersion).toBe('v21.0');
    expect(() => validateWhatsAppProductionConfig(env)).not.toThrow();
  });

  it('enforces 24h customer service window and dispatches Cloud API payloads', async () => {
    const now = Date.parse('2026-11-28T06:00:00Z');
    expect(isWithinCustomerServiceWindow('2026-11-27T12:00:00Z', now)).toBe(true);
    expect(isWithinCustomerServiceWindow('2026-11-26T00:00:00Z', now)).toBe(false);

    const env = {
      WHATSAPP_CLOUD_API_ACCESS_TOKEN: 'token-123',
      WHATSAPP_CLOUD_API_PHONE_NUMBER_ID: '999888',
    };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.abc' }] }), { status: 200 })
    );

    await expect(
      cloudApiRequest(
        '/send/message',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: '6281234567890',
            message: 'hi',
            last_inbound_at: '2020-01-01T00:00:00Z',
          }),
        },
        env,
        fetchMock as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ upstreamCode: 'TEMPLATE_REQUIRED_OUTSIDE_24H_WINDOW' });

    const sent = await cloudApiRequest<{ message_id: string; provider: string }>(
      '/send/template',
      {
        method: 'POST',
        body: JSON.stringify({ phone: '+6281234567890', template_name: 'order_update' }),
      },
      env,
      fetchMock as unknown as typeof fetch
    );
    expect(sent).toEqual({ message_id: 'wamid.abc', provider: 'cloud-api' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
