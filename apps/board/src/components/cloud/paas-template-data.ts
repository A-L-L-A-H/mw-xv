export type PaasTemplateCategory =
  'Database' | 'Cache' | 'AI' | 'Frontend' | 'Backend' | 'Platform';

export interface PaasTemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: PaasTemplateCategory;
  readonly image: string;
  readonly defaultPort: number;
  readonly recommendedRamMb: number;
  readonly description: string;
}

export const PAAS_MARKETPLACE_TEMPLATES: readonly PaasTemplateDefinition[] = [
  {
    id: 'postgresql-16',
    name: 'PostgreSQL 16',
    category: 'Database',
    image: 'postgres:16-alpine',
    defaultPort: 5432,
    recommendedRamMb: 512,
    description: 'ACID relational database with private EasyTier mesh binding and WAL backups.',
  },
  {
    id: 'redis-7',
    name: 'Redis 7',
    category: 'Cache',
    image: 'redis:7-alpine',
    defaultPort: 6379,
    recommendedRamMb: 256,
    description: 'In-memory key-value store for session caching, queues, and rate limiting.',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'AI',
    image: 'ollama/ollama:latest',
    defaultPort: 11434,
    recommendedRamMb: 4096,
    description: 'Local LLM inference runtime over private mesh with zero public ingress.',
  },
  {
    id: 'static-site',
    name: 'Static Site',
    category: 'Frontend',
    image: 'caddy:2-alpine',
    defaultPort: 80,
    recommendedRamMb: 128,
    description: 'Zero-config static web hosting with automatic TLS via Caddy reverse proxy.',
  },
  {
    id: 'node-api',
    name: 'Node API',
    category: 'Backend',
    image: 'node:24-alpine',
    defaultPort: 3000,
    recommendedRamMb: 512,
    description: 'Containerized Node.js HTTP service with health probes and rolling restarts.',
  },
  {
    id: 'moonwitness-tenant',
    name: 'MoonWitness Tenant',
    category: 'Platform',
    image: 'ghcr.io/moonwitness/tenant:latest',
    defaultPort: 8080,
    recommendedRamMb: 1024,
    description: 'Isolated MoonWitness tenant control-plane instance with mesh HA failover.',
  },
] as const;
