import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export type CoolifyCompatibility = 'ready' | 'inline_config' | 'restricted';

export interface CoolifyEditableEnvVar {
  key: string;
  defaultValue: string;
}

export interface CoolifyTemplateSummary {
  id: string;
  name: string;
  slogan: string;
  category: string;
  tags: string[];
  documentation?: string;
  logo?: string;
  port?: number;
  outdated: boolean;
  amdOnly: boolean;
  compatibility: CoolifyCompatibility;
  compatibilityReasons: string[];
  serviceCount: number;
  services: string[];
  magicSecrets: string[];
  editableEnv: CoolifyEditableEnvVar[];
}

export interface CoolifyTemplateEntry extends CoolifyTemplateSummary {
  composeYaml: string;
  composeDoc: Record<string, unknown>;
}

interface RawCoolifyTemplate {
  documentation?: string;
  slogan?: string;
  compose?: string;
  tags?: string[];
  category?: string;
  logo?: string;
  minversion?: string;
  template_last_updated_at?: string;
  port?: string | number;
  outdated?: boolean;
  amd_only?: boolean;
}

const MAGIC_SECRET_REGEX = /SERVICE_(?:PASSWORD|USER|HEX|BASE64)(?:_64)?_[A-Z0-9_]+/g;
const EDITABLE_ENV_DEFAULT_REGEX = /\$\{([A-Z0-9_]+):?-([^}]*)\}/g;
const DANGEROUS_CAPS = new Set(['SYS_ADMIN', 'ALL', 'SYS_PTRACE', 'SYS_MODULE']);
const HOST_NAMESPACE_KEYS = ['network_mode', 'pid', 'ipc', 'uts'] as const;

const catalogCache = new Map<string, Map<string, CoolifyTemplateEntry>>();

export function resolveCoolifyServiceTemplatesPath(): string {
  const envDir = process.env.MW_COOLIFY_TEMPLATE_PACK_DIR?.trim();
  if (envDir) {
    const candidate = path.resolve(envDir, 'service-templates.json');
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const req = createRequire(import.meta.url);
    const resolved = req.resolve('paas-template-pack-coolify/service-templates.json');
    if (existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Fall through to relative monorepo path resolution.
  }

  const baseDir =
    (import.meta as { dirname?: string }).dirname ?? path.dirname(fileURLToPath(import.meta.url));
  const fallback = path.resolve(baseDir, '../../paas-template-pack-coolify/service-templates.json');
  if (existsSync(fallback)) {
    return fallback;
  }

  // Also check from source tree if running compiled dist vs src
  const distFallback = path.resolve(baseDir, '../../../paas-template-pack-coolify/service-templates.json');
  if (existsSync(distFallback)) {
    return distFallback;
  }

  throw new Error('Unable to locate paas-template-pack-coolify/service-templates.json');
}

function formatTemplateName(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function classifyComposeDocument(doc: Record<string, unknown>): {
  compatibility: CoolifyCompatibility;
  reasons: string[];
  serviceNames: string[];
} {
  const servicesRaw = doc.services;
  if (!servicesRaw || typeof servicesRaw !== 'object' || Array.isArray(servicesRaw)) {
    return { compatibility: 'restricted', reasons: ['missing services map'], serviceNames: [] };
  }

  const services = servicesRaw as Record<string, unknown>;
  const serviceNames = Object.keys(services);
  const reasons: string[] = [];
  let hasInlineConfig = false;

  for (const [svcName, svcVal] of Object.entries(services)) {
    if (!svcVal || typeof svcVal !== 'object' || Array.isArray(svcVal)) {
      continue;
    }
    const svc = svcVal as Record<string, unknown>;

    if (svc.privileged === true) {
      reasons.push(`${svcName}: privileged: true`);
    }

    for (const nsKey of HOST_NAMESPACE_KEYS) {
      if (typeof svc[nsKey] === 'string' && svc[nsKey].trim().toLowerCase() === 'host') {
        reasons.push(`${svcName}: ${nsKey}: host`);
      }
    }

    if (Array.isArray(svc.cap_add)) {
      for (const cap of svc.cap_add) {
        const capNorm = String(cap ?? '').trim().toUpperCase();
        if (DANGEROUS_CAPS.has(capNorm)) {
          reasons.push(`${svcName}: cap_add ${capNorm}`);
        }
      }
    }

    if (Array.isArray(svc.volumes)) {
      for (const vol of svc.volumes) {
        if (typeof vol === 'string') {
          if (vol.includes('docker.sock')) {
            reasons.push(`${svcName}: mounts docker.sock`);
          }
          const colonIdx = vol.indexOf(':');
          const source = (colonIdx >= 0 ? vol.slice(0, colonIdx) : vol).trim();
          if (source.startsWith('/') || source.startsWith('~') || source.startsWith('..')) {
            reasons.push(`${svcName}: host bind ${source}`);
          }
        } else if (vol && typeof vol === 'object' && !Array.isArray(vol)) {
          const vObj = vol as Record<string, unknown>;
          const source = typeof vObj.source === 'string' ? vObj.source.trim() : '';
          const type = typeof vObj.type === 'string' ? vObj.type.trim().toLowerCase() : '';
          const hasContent = typeof vObj.content === 'string';

          if (source.includes('docker.sock')) {
            reasons.push(`${svcName}: mounts docker.sock`);
          }
          if (type === 'bind') {
            if (hasContent && source.startsWith('./') && !source.includes('..')) {
              hasInlineConfig = true;
            } else {
              reasons.push(`${svcName}: host bind ${source || '(unspecified)'}`);
            }
          } else if (
            (source.startsWith('/') || source.startsWith('~') || source.startsWith('..')) &&
            !hasContent
          ) {
            reasons.push(`${svcName}: host bind ${source}`);
          }
        }
      }
    }
  }

  if (reasons.length > 0) {
    return { compatibility: 'restricted', reasons, serviceNames };
  }
  if (hasInlineConfig) {
    return { compatibility: 'inline_config', reasons: [], serviceNames };
  }
  return { compatibility: 'ready', reasons: [], serviceNames };
}

function extractMagicSecrets(composeYaml: string): string[] {
  const seen = new Set<string>();
  for (const match of composeYaml.matchAll(MAGIC_SECRET_REGEX)) {
    if (match[0]) {
      seen.add(match[0]);
    }
  }
  return [...seen];
}

function extractEditableEnv(composeYaml: string): CoolifyEditableEnvVar[] {
  const map = new Map<string, string>();
  for (const match of composeYaml.matchAll(EDITABLE_ENV_DEFAULT_REGEX)) {
    const key = match[1];
    const defaultValue = match[2] ?? '';
    if (!key || key.startsWith('SERVICE_')) {
      continue;
    }
    if (!map.has(key)) {
      map.set(key, defaultValue);
    }
  }
  return [...map.entries()].map(([key, defaultValue]) => ({ key, defaultValue }));
}

function parsePort(rawPort: string | number | undefined, composeYaml: string): number | undefined {
  if (typeof rawPort === 'number' && Number.isFinite(rawPort) && rawPort > 0) {
    return Math.trunc(rawPort);
  }
  if (typeof rawPort === 'string' && /^\d+$/.test(rawPort.trim())) {
    const parsed = Number.parseInt(rawPort.trim(), 10);
    if (parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  const ingressMatch = /SERVICE_(?:FQDN|URL)_[A-Z0-9_]+_(\d{2,5})\b/.exec(composeYaml);
  if (ingressMatch?.[1]) {
    const parsed = Number.parseInt(ingressMatch[1], 10);
    if (parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return undefined;
}

export function loadCoolifyTemplateCatalog(): Map<string, CoolifyTemplateEntry> {
  const filePath = resolveCoolifyServiceTemplatesPath();
  const cached = catalogCache.get(filePath);
  if (cached) {
    return cached;
  }

  const rawJson = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, RawCoolifyTemplate>;
  const catalog = new Map<string, CoolifyTemplateEntry>();

  for (const [id, raw] of Object.entries(rawJson)) {
    if (!raw || typeof raw.compose !== 'string' || !raw.compose.trim()) {
      continue;
    }
    try {
      const composeYaml = Buffer.from(raw.compose, 'base64').toString('utf8');
      const parsed = parseYaml(composeYaml);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const composeDoc = parsed as Record<string, unknown>;
      const { compatibility, reasons, serviceNames } = classifyComposeDocument(composeDoc);
      const magicSecrets = extractMagicSecrets(composeYaml);
      const editableEnv = extractEditableEnv(composeYaml);
      const port = parsePort(raw.port, composeYaml);

      catalog.set(id, {
        id,
        name: formatTemplateName(id),
        slogan: typeof raw.slogan === 'string' ? raw.slogan : '',
        category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim().toLowerCase() : 'other',
        tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
        documentation: typeof raw.documentation === 'string' ? raw.documentation : undefined,
        logo: typeof raw.logo === 'string' ? raw.logo : undefined,
        port,
        outdated: raw.outdated === true,
        amdOnly: raw.amd_only === true,
        compatibility,
        compatibilityReasons: reasons,
        serviceCount: serviceNames.length,
        services: serviceNames,
        magicSecrets,
        editableEnv,
        composeYaml,
        composeDoc,
      });
    } catch {
      // Skip malformed entry so one broken YAML never breaks the catalog.
    }
  }

  catalogCache.set(filePath, catalog);
  return catalog;
}

export function clearCoolifyTemplateCatalogCache(): void {
  catalogCache.clear();
}
