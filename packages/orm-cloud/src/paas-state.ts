import { isIP } from 'node:net';
import { defineModel, fields } from '@moonwitness/orm';
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
