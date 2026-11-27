import path from 'node:path';

export type WhatsAppDriver = 'cloud-api' | 'baileys' | 'gowa';

export interface WhatsAppGatewayConfig {
  url: string;
  username: string;
  password: string;
  timeoutMs: number;
}

export interface WhatsAppCloudApiConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId?: string;
  graphApiVersion: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEV_USERNAME = 'moonwitness';
const DEV_PASSWORD = 'moonwitness';
const DEFAULT_GRAPH_VERSION = 'v21.0';
const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';

export function allowUnofficialWhatsAppInProd(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WHATSAPP_ALLOW_UNOFFICIAL_IN_PROD?.trim().toLowerCase() !== 'false';
}

export function whatsappDriver(env: NodeJS.ProcessEnv = process.env): WhatsAppDriver {
  const explicit = env.WHATSAPP_DRIVER?.trim().toLowerCase();
  if (explicit === 'cloud-api' || explicit === 'baileys' || explicit === 'gowa') {
    return explicit;
  }
  if (
    env.WHATSAPP_CLOUD_API_ACCESS_TOKEN?.trim() &&
    env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID?.trim()
  ) {
    return 'cloud-api';
  }
  return env.WHATSAPP_GOWA_BASE_URL?.trim() || env.WHATSAPP_GATEWAY_URL?.trim()
    ? 'gowa'
    : 'baileys';
}

export function baileysAuthDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.WHATSAPP_BAILEYS_AUTH_DIR?.trim();
  return path.resolve(configured || '.moonwitness/whatsapp-baileys-auth');
}

function parseTimeout(value: string | undefined): number {
  if (!value) return 20_000;
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 500 || timeout > 120_000) {
    throw new Error('WHATSAPP_GATEWAY_TIMEOUT_MS must be an integer between 500 and 120000');
  }
  return timeout;
}

export function readWhatsAppCloudApiConfig(
  env: NodeJS.ProcessEnv = process.env
): WhatsAppCloudApiConfig {
  const accessToken = env.WHATSAPP_CLOUD_API_ACCESS_TOKEN?.trim() ?? '';
  const phoneNumberId = env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID?.trim() ?? '';
  if (!accessToken || !phoneNumberId) {
    throw new Error(
      'WHATSAPP_CLOUD_API_ACCESS_TOKEN and WHATSAPP_CLOUD_API_PHONE_NUMBER_ID are required for cloud-api driver'
    );
  }
  const rawBaseUrl = env.WHATSAPP_CLOUD_API_BASE_URL?.trim() || DEFAULT_GRAPH_BASE_URL;
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error('WHATSAPP_CLOUD_API_BASE_URL must be a valid http or https URL');
  }
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    (env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:')
  ) {
    throw new Error(
      'WHATSAPP_CLOUD_API_BASE_URL must be https in production without embedded creds'
    );
  }
  const graphApiVersion = env.WHATSAPP_CLOUD_API_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  return {
    accessToken,
    phoneNumberId,
    wabaId: env.WHATSAPP_CLOUD_API_WABA_ID?.trim() || undefined,
    graphApiVersion,
    baseUrl: baseUrl.toString().replace(/\/$/u, ''),
    timeoutMs: parseTimeout(env.WHATSAPP_GATEWAY_TIMEOUT_MS),
  };
}

export function readWhatsAppGatewayConfig(
  env: NodeJS.ProcessEnv = process.env
): WhatsAppGatewayConfig {
  const production = env.NODE_ENV === 'production';
  const username = env.WHATSAPP_GATEWAY_USERNAME || (production ? '' : DEV_USERNAME);
  const password = env.WHATSAPP_GATEWAY_PASSWORD || (production ? '' : DEV_PASSWORD);

  if (
    production &&
    (!username || !password || username === DEV_USERNAME || password === DEV_PASSWORD)
  ) {
    throw new Error(
      'Production requires non-default WHATSAPP_GATEWAY_USERNAME and WHATSAPP_GATEWAY_PASSWORD'
    );
  }

  const rawUrl = env.WHATSAPP_GATEWAY_URL || 'https://wa.moonwitness.biz.id';
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('WHATSAPP_GATEWAY_URL must be a valid http or https URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('WHATSAPP_GATEWAY_URL must be a valid http or https URL');
  }
  if (url.username || url.password) {
    throw new Error('WHATSAPP_GATEWAY_URL must not contain embedded credentials');
  }

  return {
    url: url.toString().replace(/\/$/u, ''),
    username,
    password,
    timeoutMs: parseTimeout(env.WHATSAPP_GATEWAY_TIMEOUT_MS),
  };
}

function assertWebhookOrigin(rawUrl: string, isProd: boolean): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('WHATSAPP_WEBHOOK_URL must be a valid public http or https origin');
  }
  const hasCredsOrQuery =
    Boolean(url.username) || Boolean(url.password) || Boolean(url.search) || Boolean(url.hash);
  const badProto =
    !['http:', 'https:'].includes(url.protocol) || (isProd && url.protocol !== 'https:');
  if (badProto || hasCredsOrQuery || url.pathname !== '/') {
    throw new Error('WHATSAPP_WEBHOOK_URL must be an origin; production requires https');
  }
}

function validateWebhookUrlConfig(env: NodeJS.ProcessEnv): void {
  const webhookUrl = env.WHATSAPP_WEBHOOK_URL;
  const webhookSecret = env.WHATSAPP_WEBHOOK_SECRET;
  if (Boolean(webhookUrl) !== Boolean(webhookSecret)) {
    throw new Error('WHATSAPP_WEBHOOK_URL and WHATSAPP_WEBHOOK_SECRET must be configured together');
  }
  if (!webhookUrl || !webhookSecret) return;
  if (webhookSecret.length < 32) {
    throw new Error('WHATSAPP_WEBHOOK_SECRET must contain at least 32 characters');
  }
  assertWebhookOrigin(webhookUrl, env.NODE_ENV === 'production');
}

export function validateWhatsAppProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    const driver = whatsappDriver(env);
    if (driver === 'cloud-api') {
      readWhatsAppCloudApiConfig(env);
    } else if (!allowUnofficialWhatsAppInProd(env)) {
      throw new Error(
        'Unofficial WhatsApp drivers are disabled in production (set WHATSAPP_DRIVER=cloud-api)'
      );
    } else {
      readWhatsAppGatewayConfig(env);
    }
  }
  validateWebhookUrlConfig(env);
}
