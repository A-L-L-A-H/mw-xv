import type { MoonWitnessMeshDeployParams } from './providers/moonwitness-mesh.js';
import type { TenantPaasQuotaInput } from './quota.js';

export type PaasTemplateId =
  'postgres-16' | 'redis-7' | 'ollama-local' | 'static-site' | 'node-api' | 'moonwitness-tenant';

export type PaasTemplateCategory = 'database' | 'cache' | 'ai' | 'web' | 'api' | 'platform';

export interface PaasTemplateDefinition {
  readonly id: PaasTemplateId;
  readonly name: string;
  readonly category: PaasTemplateCategory;
  readonly description: string;
  readonly image: string;
  readonly defaultPort: number;
  readonly defaultEnv: Readonly<Record<string, string>>;
  readonly requiredEnvKeys: readonly string[];
}

export interface BuildTemplateDeployInput {
  readonly endpoint: string;
  readonly slug: string;
  readonly tenant?: string;
  readonly domain?: string;
  readonly port?: number;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string>>;
  readonly quotaCheck?: TenantPaasQuotaInput;
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;

export const PAAS_TEMPLATE_CATALOG: readonly PaasTemplateDefinition[] = Object.freeze([
  Object.freeze({
    id: 'postgres-16',
    name: 'PostgreSQL 16',
    category: 'database',
    description: 'Production PostgreSQL 16 relational database on Alpine Linux.',
    image: 'postgres:16-alpine',
    defaultPort: 5432,
    defaultEnv: Object.freeze({
      POSTGRES_USER: 'postgres',
      POSTGRES_DB: 'app_db',
    }),
    requiredEnvKeys: Object.freeze(['POSTGRES_PASSWORD']),
  }),
  Object.freeze({
    id: 'redis-7',
    name: 'Redis 7',
    category: 'cache',
    description: 'In-memory Redis 7 cache and message broker on Alpine Linux.',
    image: 'redis:7-alpine',
    defaultPort: 6379,
    defaultEnv: Object.freeze({
      REDIS_APPENDONLY: 'yes',
    }),
    requiredEnvKeys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'ollama-local',
    name: 'Ollama Local LLM',
    category: 'ai',
    description: 'Self-hosted Ollama inference server for local open-weight LLMs.',
    image: 'ollama/ollama:0.6.5',
    defaultPort: 11434,
    defaultEnv: Object.freeze({
      OLLAMA_HOST: '0.0.0.0:11434',
    }),
    requiredEnvKeys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'static-site',
    name: 'Static Site (Caddy)',
    category: 'web',
    description: 'Lightweight Caddy static file server with automatic HTTPS.',
    image: 'caddy:2-alpine',
    defaultPort: 80,
    defaultEnv: Object.freeze({}),
    requiredEnvKeys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'node-api',
    name: 'Node.js 22 API',
    category: 'api',
    description: 'Production Node.js 22 LTS runtime for TypeScript/JavaScript APIs.',
    image: 'node:22-alpine',
    defaultPort: 3000,
    defaultEnv: Object.freeze({
      NODE_ENV: 'production',
      PORT: '3000',
    }),
    requiredEnvKeys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'moonwitness-tenant',
    name: 'MoonWitness Tenant Stack',
    category: 'platform',
    description: 'Isolated MoonWitness sovereign tenant control-plane and board instance.',
    image: 'ghcr.io/moonwitness/tenant-runtime:latest',
    defaultPort: 3000,
    defaultEnv: Object.freeze({
      NODE_ENV: 'production',
      MW_TENANT_MODE: 'isolated',
    }),
    requiredEnvKeys: Object.freeze(['MW_INTERNAL_SECRET', 'DATABASE_URL']),
  }),
]);

const TEMPLATE_BY_ID: ReadonlyMap<string, PaasTemplateDefinition> = new Map(
  PAAS_TEMPLATE_CATALOG.map((template) => [template.id, template])
);

export function getPaasTemplateById(templateId: string): PaasTemplateDefinition | undefined {
  return TEMPLATE_BY_ID.get(templateId);
}

export function buildDeployParamsFromTemplate(
  templateId: PaasTemplateId | string,
  input: BuildTemplateDeployInput
): MoonWitnessMeshDeployParams {
  const template = TEMPLATE_BY_ID.get(templateId);
  if (!template) {
    throw new Error(`Unknown PaaS template: "${templateId}"`);
  }

  const slug = input.slug.trim();
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid PaaS app slug: "${input.slug}"`);
  }

  const endpoint = input.endpoint.trim();
  if (endpoint.length === 0) {
    throw new Error('MoonWitness Mesh endpoint is required');
  }

  const port = input.port ?? template.defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${String(port)}`);
  }

  const mergedEnv: Record<string, string> = {
    ...template.defaultEnv,
  };

  if (input.env) {
    for (const [key, value] of Object.entries(input.env)) {
      if (!ENV_KEY_PATTERN.test(key)) {
        throw new Error(`Invalid environment variable key: "${key}"`);
      }
      if (value.includes('\0')) {
        throw new Error(`Environment variable "${key}" must not contain NUL bytes`);
      }
      mergedEnv[key] = value;
    }
  }

  for (const requiredKey of template.requiredEnvKeys) {
    const val = mergedEnv[requiredKey];
    if (typeof val !== 'string' || val.trim().length === 0) {
      throw new Error(
        `Template "${template.id}" requires non-empty environment variable "${requiredKey}"`
      );
    }
  }

  return {
    endpoint,
    slug,
    image: template.image,
    port,
    ...(input.domain !== undefined ? { domain: input.domain } : {}),
    ...(input.tenant !== undefined ? { tenant: input.tenant } : {}),
    ...(input.token !== undefined ? { token: input.token } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.quotaCheck !== undefined ? { quotaCheck: input.quotaCheck } : {}),
    env: mergedEnv,
  };
}
