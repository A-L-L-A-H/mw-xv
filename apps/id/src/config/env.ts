export type IdentityNodeEnv = 'development' | 'production' | 'test';
export type IdentityKeyProviderMode = 'local-development' | 'external';

export interface IdentityEnvironment {
  readonly databaseUrl: string;
  readonly issuerUrl: string;
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: IdentityNodeEnv;
  readonly keyProviderMode: IdentityKeyProviderMode;
  readonly keyProviderConfig?: string;
}

export class IdentityConfigError extends Error {
  override readonly name = 'IdentityConfigError';
}

const PLACEHOLDER_CREDENTIAL = '<redacted>';

export function redactIdentityConfigValue(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = PLACEHOLDER_CREDENTIAL;
      url.password = PLACEHOLDER_CREDENTIAL;
    }
    if (url.search) url.search = PLACEHOLDER_CREDENTIAL;
    return url.toString();
  } catch {
    return PLACEHOLDER_CREDENTIAL;
  }
}

function requireValue(name: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new IdentityConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new IdentityConfigError('IDENTITY_PORT must be an integer');
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new IdentityConfigError('IDENTITY_PORT must be in range 1..65535');
  }
  return port;
}

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new IdentityConfigError(`${name} must be a valid absolute URL (${redactIdentityConfigValue(value)})`);
  }
}

function parseNodeEnv(value: string): IdentityNodeEnv {
  if (value === 'development' || value === 'production' || value === 'test') return value;
  throw new IdentityConfigError('NODE_ENV must be development, production or test');
}

function parseKeyProviderMode(value: string): IdentityKeyProviderMode {
  if (value === 'local-development' || value === 'external') return value;
  throw new IdentityConfigError('IDENTITY_KEY_PROVIDER_MODE must be local-development or external');
}

function parseDatabaseUrl(value: string, environment: NodeJS.ProcessEnv): string {
  const url = parseUrl('IDENTITY_DATABASE_URL', value);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new IdentityConfigError(
      `IDENTITY_DATABASE_URL must use PostgreSQL (${redactIdentityConfigValue(value)})`
    );
  }
  const businessUrl = environment.DATABASE_URL;
  if (businessUrl && businessUrl === value) {
    throw new IdentityConfigError('IDENTITY_DATABASE_URL must not equal DATABASE_URL');
  }
  return value;
}

function parseIssuerUrl(value: string, nodeEnv: IdentityNodeEnv): string {
  const url = parseUrl('IDENTITY_ISSUER_URL', value);
  const localIssuer =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (nodeEnv === 'production') {
    if (url.protocol !== 'https:' || localIssuer) {
      throw new IdentityConfigError('IDENTITY_ISSUER_URL must be a non-local HTTPS URL in production');
    }
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new IdentityConfigError('IDENTITY_ISSUER_URL must use HTTP or HTTPS');
  }
  return value.replace(/\/$/, '');
}

export function parseIdentityEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): IdentityEnvironment {
  const nodeEnv = parseNodeEnv(requireValue('NODE_ENV', environment));
  const databaseUrl = parseDatabaseUrl(requireValue('IDENTITY_DATABASE_URL', environment), environment);
  const issuerUrl = parseIssuerUrl(requireValue('IDENTITY_ISSUER_URL', environment), nodeEnv);
  const port = parsePort(requireValue('IDENTITY_PORT', environment));
  const keyProviderMode = parseKeyProviderMode(
    environment.IDENTITY_KEY_PROVIDER_MODE ??
      (nodeEnv === 'production' ? '' : 'local-development')
  );
  if (nodeEnv === 'production' && keyProviderMode === 'local-development') {
    throw new IdentityConfigError('Production must use an external key provider');
  }
  if (keyProviderMode === 'external' && !environment.IDENTITY_KEY_PROVIDER_CONFIG) {
    throw new IdentityConfigError('IDENTITY_KEY_PROVIDER_CONFIG is required for external key provider mode');
  }

  return Object.freeze({
    databaseUrl,
    issuerUrl,
    port,
    host: environment.IDENTITY_HOST ?? '127.0.0.1',
    nodeEnv,
    keyProviderMode,
    ...(environment.IDENTITY_KEY_PROVIDER_CONFIG
      ? { keyProviderConfig: environment.IDENTITY_KEY_PROVIDER_CONFIG }
      : {}),
  });
}
