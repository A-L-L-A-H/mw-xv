import { isIP } from 'node:net';
import { defineModel, fields } from '@moonwitness/orm';
import { trimTrailingSlashes } from '@moonwitness/types';
import { CloudApp } from './models/index.js';

/**
 * Canonical per-instance PaaS settings stored in the shared PostgreSQL
 * `base_config_parameters` table. Rows are global (`company_id IS NULL`) so
 * every tenant/control-plane instance reads the same PaaS topology.
 */
export const ConfigParameter = defineModel('config.parameter', {
  table: 'base_config_parameters',
  order: 'id desc',
  fields: {
    key: fields.string({ required: true, label: 'Key' }),
    value: fields.string({ label: 'Value' }),
    company_id: fields.integer({ label: 'Company ID' }),
    created_at: fields.string({ label: 'Created At' }),
    updated_at: fields.string({ label: 'Updated At' }),
  },
});

export interface PaasInstanceSettings {
  instanceDomain: string;
  wildcardDomain: string;
  whatsappDomain: string;
  publicPort: number;
  publicPortEnabled: boolean;
  publicIpv4: string;
  accessMode: string;
}

const PAAS_KEY = {
  instanceDomain: 'paas.instance_domain',
  wildcardDomain: 'paas.wildcard_domain',
  whatsappDomain: 'paas.whatsapp_domain',
  publicPort: 'paas.public_port',
  publicPortEnabled: 'paas.public_port_enabled',
  publicIpv4: 'paas.public_ipv4',
} as const;

const DEFAULT_PUBLIC_PORT = 8000;

function caddyMetaChars(domain: string): boolean {
  return /[{}:;#"'`$\\/?@*\s]/.test(domain);
}

function isReservedPrivateSuffix(domain: string): boolean {
  return (
    domain === 'localhost' ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.local') ||
    domain.endsWith('.internal') ||
    domain.endsWith('.mesh') ||
    domain.endsWith('.easytier')
  );
}

/**
 * Validate a public PaaS domain: lowercase RFC-1123 FQDN with at least two
 * labels, rejecting IP literals, reserved private suffixes and Caddy meta
 * characters.
 */
export function isValidPublicDomain(domain: string): boolean {
  if (typeof domain !== 'string') {
    return false;
  }
  const trimmed = domain.trim();
  if (trimmed === '' || trimmed !== domain) {
    return false;
  }
  const d = trimmed.toLowerCase();
  if (d !== trimmed) {
    return false;
  }
  if (isIP(d) !== 0) {
    return false;
  }
  if (isReservedPrivateSuffix(d)) {
    return false;
  }
  if (caddyMetaChars(d)) {
    return false;
  }
  const labels = d.split('.');
  if (labels.length < 2) {
    return false;
  }
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63 || !labelPattern.test(label)) {
      return false;
    }
  }
  return true;
}

async function readParameter(key: string): Promise<string | undefined> {
  const row = await ConfigParameter.query()
    .where({ key })
    .whereNull('company_id')
    .orderBy('id', 'desc')
    .first();
  return row?.value ?? undefined;
}

/**
 * Read the canonical PaaS instance settings from PostgreSQL, falling back to
 * safe defaults when a row is absent.
 */
export async function readPaasInstanceSettings(): Promise<PaasInstanceSettings> {
  const publicPortRaw = await readParameter(PAAS_KEY.publicPort);
  const publicPort = publicPortRaw != null ? Number.parseInt(publicPortRaw, 10) : DEFAULT_PUBLIC_PORT;
  const publicPortEnabledRaw = await readParameter(PAAS_KEY.publicPortEnabled);
  const publicPortEnabled = publicPortEnabledRaw === undefined ? true : publicPortEnabledRaw !== 'false' && publicPortEnabledRaw !== '0';

  return {
    instanceDomain: (await readParameter(PAAS_KEY.instanceDomain)) ?? '',
    wildcardDomain: (await readParameter(PAAS_KEY.wildcardDomain)) ?? '',
    whatsappDomain: (await readParameter(PAAS_KEY.whatsappDomain)) ?? '',
    publicPort,
    publicPortEnabled,
    publicIpv4: (await readParameter(PAAS_KEY.publicIpv4)) ?? '',
    accessMode: 'public',
  };
}

async function upsertParameter(key: string, value: string | undefined): Promise<void> {
  if (value === undefined) {
    return;
  }
  const existing = await ConfigParameter.query()
    .where({ key })
    .whereNull('company_id')
    .orderBy('id', 'desc')
    .first();
  if (existing) {
    await ConfigParameter.query().findById(existing.id).patch({ value });
  } else {
    await ConfigParameter.query().insert({ key, value, company_id: null });
  }
}

export interface SavePaasInstanceSettingsInput {
  instanceDomain?: string;
  wildcardDomain?: string;
  whatsappDomain?: string;
  publicPort?: number;
  publicPortEnabled?: boolean;
  publicIpv4?: string;
}

/**
 * Persist PaaS instance settings with fail-closed guards:
 *  - self-lockout: disabling the public port without an instance domain is rejected.
 *  - collision: whatsappDomain must not equal instanceDomain nor an active
 *    CloudApp (`managed_by = 'paas'`) domain.
 */
export async function savePaasInstanceSettings(input: SavePaasInstanceSettingsInput): Promise<void> {
  if (input.publicPortEnabled === false && !input.instanceDomain) {
    throw new Error('self-lockout: cannot disable the public port without an instance domain');
  }

  if (
    input.whatsappDomain &&
    input.instanceDomain &&
    input.whatsappDomain.toLowerCase() === input.instanceDomain.toLowerCase()
  ) {
    throw new Error('collision: whatsappDomain equals instanceDomain');
  }

  if (input.whatsappDomain) {
    const colliding = await CloudApp.query()
      .where({ managed_by: 'paas', is_active: true })
      .where('domain', input.whatsappDomain)
      .first();
    if (colliding) {
      throw new Error('collision: whatsappDomain is already used by an active PaaS app');
    }
  }

  await upsertParameter(PAAS_KEY.instanceDomain, input.instanceDomain);
  await upsertParameter(PAAS_KEY.wildcardDomain, input.wildcardDomain);
  await upsertParameter(PAAS_KEY.whatsappDomain, input.whatsappDomain);
  if (input.publicPort !== undefined) {
    await upsertParameter(PAAS_KEY.publicPort, String(input.publicPort));
  }
  await upsertParameter(PAAS_KEY.publicPortEnabled, String(input.publicPortEnabled ?? true));
  if (input.publicIpv4 !== undefined) {
    await upsertParameter(PAAS_KEY.publicIpv4, input.publicIpv4);
  }
}

interface PaasAppRecord {
  id: number;
  name: string;
  slug?: string;
  domain?: string | null;
  port?: number | null;
  host_port?: number | null;
  env_vars?: Record<string, unknown> | null;
  ingress_routes?: Array<{ domain?: string; upstream?: string }> | null;
  deploy_mode?: string;
  tenant_id?: string;
}

export interface CaddySpecRoute {
  domain: string;
  upstream: string;
  /** App slug used by the stateless agent CaddyRoute contract. */
  slug?: string;
  /** Tenant id used by the stateless agent CaddyRoute contract. */
  tenantId?: string;
  /** Port used by the stateless agent CaddyRoute contract. */
  port?: number;
}

export interface CaddyPreviewListener {
  slug: string;
  port: number;
  upstream: string;
}

export interface CaddyDeclarativeSpec {
  routes: CaddySpecRoute[];
  previewListeners: CaddyPreviewListener[];
}

export interface BuildDeclarativeCaddySpecOptions {
  includeInstance?: boolean;
  includeWhatsapp?: boolean;
}

const PREVIEW_PORT_FLOOR = 8001;
const PREVIEW_PORT_CEIL = 8010;

/**
 * Allocate the lowest free preview port in 8001..8010 not already used by an
 * active CloudApp (managed_by = 'paas').
 */
export async function allocatePreviewPort(): Promise<number | null> {
  const apps = await CloudApp.query().where({ managed_by: 'paas', is_active: true });
  const used = new Set<number>();
  for (const app of apps) {
    const hostPort = (app as unknown as PaasAppRecord).host_port;
    if (typeof hostPort === 'number' && hostPort >= PREVIEW_PORT_FLOOR && hostPort <= PREVIEW_PORT_CEIL) {
      used.add(hostPort);
    }
  }
  for (let port = PREVIEW_PORT_FLOOR; port <= PREVIEW_PORT_CEIL; port++) {
    if (!used.has(port)) {
      return port;
    }
  }
  return null;
}

export async function buildDeclarativeCaddySpec(options: BuildDeclarativeCaddySpecOptions = {}): Promise<CaddyDeclarativeSpec> {
  const settings = await readPaasInstanceSettings();
  const apps = await CloudApp.query().where({ managed_by: 'paas', is_active: true });
  const routes: CaddySpecRoute[] = [];
  const seenDomains = new Set<string>();

  const addRoute = (
    domain: string,
    upstream: string,
    meta: { slug?: string; tenantId?: string; port?: number } = {}
  ): void => {
    if (!domain || !isValidPublicDomain(domain) || seenDomains.has(domain)) {
      return;
    }
    seenDomains.add(domain);
    routes.push({ domain, upstream, ...meta });
  };

  if (options.includeInstance !== false && settings.instanceDomain) {
    addRoute(settings.instanceDomain, 'moonwitness_board:8080', {
      slug: 'board',
      tenantId: 'default',
      port: 8080,
    });
  }
  if (options.includeWhatsapp !== false && settings.whatsappDomain) {
    addRoute(settings.whatsappDomain, 'moonwitness_whatsapp:3000', {
      slug: 'whatsapp',
      tenantId: 'default',
      port: 3000,
    });
  }

  for (const app of apps) {
    const a = app as unknown as PaasAppRecord;
    const slug = a.slug ?? a.name;
    const port = typeof a.port === 'number' ? a.port : 8080;
    const upstream = `mw-paas-${slug}:${port}`;
    const meta = { slug, tenantId: a.tenant_id ?? 'default', port };
    if (a.domain && isValidPublicDomain(a.domain)) {
      addRoute(a.domain, upstream, meta);
    }
    if (Array.isArray(a.ingress_routes)) {
      for (const ir of a.ingress_routes) {
        const d = ir?.domain;
        const u = ir?.upstream ?? upstream;
        if (d && isValidPublicDomain(d)) {
          addRoute(d, u, meta);
        }
      }
    }
  }

  const previewListeners: CaddyPreviewListener[] = [];
  if (settings.publicPortEnabled) {
    const allocated = await allocatePreviewPort();
    previewListeners.push({
      slug: 'preview',
      port: allocated ?? settings.publicPort ?? PREVIEW_PORT_FLOOR,
      upstream: 'moonwitness_board:8080',
    });
  }

  return { routes, previewListeners };
}

export interface ReconcileCaddyWithAgentParams {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  bootstrap?: { enabled: boolean; port: number; upstream: string };
  previews?: CaddyPreviewListener[];
  routes?: CaddySpecRoute[];
  token?: string;
}

/**
 * Builds the declarative Caddy spec and POSTs it to the stateless
 * control-plane agent `/agent/caddy/reconcile` endpoint.
 */
export async function reconcileCaddyWithAgent(params: ReconcileCaddyWithAgentParams = {}): Promise<void> {
  try {
    const spec = await buildDeclarativeCaddySpec();
    // Map to the stateless agent's CaddyRoute contract (slug/tenantId/domain/port/upstreamHost).
    const agentRoutes = (params.routes ?? spec.routes).map((route) => {
      const separator = route.upstream.lastIndexOf(':');
      const upstreamHost = separator > 0 ? route.upstream.slice(0, separator) : route.upstream;
      const parsedPort = separator > 0 ? Number(route.upstream.slice(separator + 1)) : NaN;
      return {
        slug: route.slug ?? 'app',
        tenantId: route.tenantId ?? 'default',
        domain: route.domain,
        port: route.port ?? (Number.isFinite(parsedPort) ? parsedPort : 8080),
        upstreamHost,
      };
    });
    const body = {
      publicPort: params.bootstrap?.port ?? 8000,
      publicPortEnabled: params.bootstrap?.enabled ?? true,
      bootstrapUpstream: params.bootstrap?.upstream ?? 'moonwitness_board:8080',
      previewListeners: params.previews ?? spec.previewListeners,
      routes: agentRoutes,
    };
    const endpoint = trimTrailingSlashes(
      params.endpoint ??
      process.env.MW_CONTROL_PLANE_URL ??
      'http://127.0.0.1:3003'
    );
    const fetchFn = params.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn === 'function') {
      await fetchFn(`${endpoint}/agent/caddy/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${params.token ?? ''}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {
        // Agent reconciliation is best-effort
      });
    }
  } catch {
    // Best-effort; do not fail deployment if agent or caddy is unreachable
  }
}

export interface PromotePreviewAppsToWildcardParams {
  wildcardDomain: string;
  upAgentCompose?: (slug: string, env: Record<string, string>) => Promise<void>;
  agentBaseUrl?: string;
}

/**
 * Promote every active `managed_by = 'paas'` app without a domain to
 * `${app.name}.${wildcardDomain}`, recompile compose env preserving existing
 * secrets (zero rotation), swap the container via the agent, update Postgres
 * and reconcile Caddy.
 */
export async function promotePreviewAppsToWildcard(params: PromotePreviewAppsToWildcardParams): Promise<void> {
  if (!params.wildcardDomain || !isValidPublicDomain(params.wildcardDomain)) {
    throw new Error('wildcardDomain is required and must be a valid public domain');
  }

  const apps = await CloudApp.query().where({ managed_by: 'paas', is_active: true });
  for (const app of apps) {
    const a = app as unknown as PaasAppRecord;
    if (a.domain) {
      continue;
    }
    const newDomain = `${a.name}.${params.wildcardDomain}`;
    if (!isValidPublicDomain(newDomain)) {
      continue;
    }
    const existingEnv: Record<string, string> =
      a.env_vars && typeof a.env_vars === 'object'
        ? (Object.fromEntries(
            Object.entries(a.env_vars).map(([k, v]) => [k, String(v)])
          ) as Record<string, string>)
        : {};
    await CloudApp.query().findById(a.id).patch({ domain: newDomain, host_port: null });
    if (a.deploy_mode === 'compose' && params.upAgentCompose) {
      await params.upAgentCompose(a.slug ?? a.name, existingEnv);
    }
  }
  await reconcileCaddyWithAgent({});
}

