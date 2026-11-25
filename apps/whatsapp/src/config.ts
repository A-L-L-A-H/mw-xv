import path from 'node:path';
import { baileysAuthDir } from '@moonwitness/orm-whatsapp';

export interface WhatsappServiceConfig {
  readonly nodeEnv: string;
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string | null;
  readonly sqlitePath: string;
  readonly baileysAuthDir: string;
  readonly gatewayUsername: string;
  readonly gatewayPassword: string;
  readonly apiKey: string | null;
  readonly webhookUrl: string | null;
  readonly webhookSecret: string | null;
  readonly publicUrl: string;
  readonly corsOrigins: boolean | string[];
  readonly driver: 'baileys';
}

const DEV_DEFAULT_USERNAME = 'moonwitness';
const DEV_DEFAULT_PASSWORD = 'moonwitness';

export function forceBaileysDriver(env: NodeJS.ProcessEnv = process.env): void {
  env.WHATSAPP_DRIVER = 'baileys';
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT || env.WHATSAPP_SERVICE_PORT || '3000';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid WhatsApp service port: ${raw}`);
  }
  return port;
}

function resolveCorsOrigins(env: NodeJS.ProcessEnv, nodeEnv: string): boolean | string[] {
  const raw = env.CORS_ORIGINS?.trim();
  if (!raw) {
    return nodeEnv === 'production' ? false : true;
  }
  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(`CORS_ORIGINS entry must be an http/https origin: ${origin}`);
    }
  }
  return origins;
}

function resolvePublicUrl(env: NodeJS.ProcessEnv, port: number): string {
  const raw = env.WHATSAPP_PUBLIC_URL?.trim();
  if (!raw) {
    return `http://localhost:${port}`;
  }
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('WHATSAPP_PUBLIC_URL must use http or https');
  }
  return parsed.toString().replace(/\/$/u, '');
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return null;
  if (!raw.startsWith('postgres://') && !raw.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
  }
  return raw;
}

function resolveWebhookConfig(env: NodeJS.ProcessEnv): {
  webhookUrl: string | null;
  webhookSecret: string | null;
} {
  const webhookUrl = env.WHATSAPP_WEBHOOK_URL?.trim() || null;
  const webhookSecret = env.WHATSAPP_WEBHOOK_SECRET?.trim() || null;
  if (webhookUrl) {
    const parsed = new URL(webhookUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('WHATSAPP_WEBHOOK_URL must be a valid http or https URL without credentials');
    }
  }
  return { webhookUrl, webhookSecret };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WhatsappServiceConfig {
  forceBaileysDriver(env);
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const isProduction = nodeEnv === 'production';
  const host = env.WHATSAPP_SERVICE_HOST?.trim() || '0.0.0.0';
  const port = resolvePort(env);
  const databaseUrl = resolveDatabaseUrl(env);
  const sqlitePath = env.WHATSAPP_SQLITE_PATH?.trim() || ':memory:';
  const authDir = path.resolve(baileysAuthDir(env));

  const apiKey = env.WHATSAPP_API_KEY?.trim() || null;
  const gatewayUsername =
    env.WHATSAPP_GATEWAY_USERNAME?.trim() || (isProduction ? '' : DEV_DEFAULT_USERNAME);
  const gatewayPassword =
    env.WHATSAPP_GATEWAY_PASSWORD?.trim() || (isProduction ? '' : DEV_DEFAULT_PASSWORD);

  if (isProduction && !apiKey && (!gatewayUsername || !gatewayPassword)) {
    throw new Error(
      'Production requires WHATSAPP_API_KEY or both WHATSAPP_GATEWAY_USERNAME and WHATSAPP_GATEWAY_PASSWORD'
    );
  }

  const { webhookUrl, webhookSecret } = resolveWebhookConfig(env);

  return {
    nodeEnv,
    host,
    port,
    databaseUrl,
    sqlitePath,
    baileysAuthDir: authDir,
    gatewayUsername,
    gatewayPassword,
    apiKey,
    webhookUrl,
    webhookSecret,
    publicUrl: resolvePublicUrl(env, port),
    corsOrigins: resolveCorsOrigins(env, nodeEnv),
    driver: 'baileys',
  };
}
