import { randomBytes } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export type CoolifyMagicVarType = 'PASSWORD' | 'USER' | 'HEX' | 'BASE64';

export interface ComposeSecurityResult {
  valid: boolean;
  errors: string[];
}

export interface ResolveCoolifyMagicVariablesInput {
  slug: string;
  composeYaml: string;
  doc: Record<string, unknown>;
  defaultPort?: number;
  primaryDomain?: string;
  wildcardDomain?: string;
  publicIpv4?: string;
  previewPort?: number;
  existingEnv?: Record<string, string>;
  userEnv?: Record<string, string>;
}

export interface ResolveCoolifyMagicVariablesResult {
  env: Record<string, string>;
  secrets: Record<string, string>;
}

const MAGIC_SECRET_KEY_REGEX = /^SERVICE_(PASSWORD|USER|HEX|BASE64)(_64)?_[A-Z0-9_]+$/;
const INGRESS_DECL_REGEX = /^SERVICE_(FQDN|URL)_([A-Z0-9_]+)(_(\d{1,5}))?$/;
const DANGEROUS_CAPS = new Set(['SYS_ADMIN', 'ALL', 'SYS_PTRACE', 'SYS_MODULE']);
const HOST_NAMESPACE_KEYS = ['network_mode', 'pid', 'ipc', 'uts'] as const;

function safeServiceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'svc';
}

function generateMagicSecret(type: CoolifyMagicVarType): string {
  switch (type) {
    case 'PASSWORD':
    case 'USER':
      return randomBytes(32).toString('hex').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
    case 'HEX':
      return randomBytes(32).toString('hex');
    case 'BASE64':
      return randomBytes(32).toString('base64url');
    default:
      return randomBytes(16).toString('hex');
  }
}

function isDockerSockSource(source: string): boolean {
  return source.includes('docker.sock');
}

function isUnsafeHostBindSource(source: string): boolean {
  return source.startsWith('/') || source.startsWith('~') || source.startsWith('..');
}

function parseVolumeEntry(vol: unknown): { source?: string; content?: string; type?: string } {
  if (typeof vol === 'string') {
    const colonIdx = vol.indexOf(':');
    const source = colonIdx >= 0 ? vol.slice(0, colonIdx).trim() : vol.trim();
    return { source };
  }
  if (vol && typeof vol === 'object' && !Array.isArray(vol)) {
    const obj = vol as Record<string, unknown>;
    return {
      source: typeof obj.source === 'string' ? obj.source.trim() : undefined,
      content: typeof obj.content === 'string' ? obj.content : undefined,
      type: typeof obj.type === 'string' ? obj.type.trim() : undefined,
    };
  }
  return {};
}

function validateServiceSecurity(
  svcName: string,
  svc: Record<string, unknown>,
  errors: string[],
): void {
  if (svc.privileged === true) {
    errors.push(`${svcName}: privileged: true`);
  }

  for (const nsKey of HOST_NAMESPACE_KEYS) {
    const val = svc[nsKey];
    if (typeof val === 'string' && val.trim().toLowerCase() === 'host') {
      errors.push(`${svcName}: ${nsKey}: host`);
    }
  }

  if (Array.isArray(svc.cap_add)) {
    for (const cap of svc.cap_add) {
      const capNorm = String(cap ?? '').trim().toUpperCase();
      if (DANGEROUS_CAPS.has(capNorm)) {
        errors.push(`${svcName}: cap_add ${capNorm}`);
      }
    }
  }

  if (Array.isArray(svc.volumes)) {
    for (const vol of svc.volumes) {
      const parsed = parseVolumeEntry(vol);
      const source = parsed.source ?? '';
      if (!source) {
        continue;
      }
      if (isDockerSockSource(source)) {
        errors.push(`${svcName}: mounts docker.sock`);
      }
      if (
        parsed.type === 'bind' &&
        parsed.content === undefined &&
        isUnsafeHostBindSource(source)
      ) {
        errors.push(`${svcName}: host bind ${source}`);
      }
      if (
        typeof vol === 'string' &&
        !parsed.content &&
        isUnsafeHostBindSource(source)
      ) {
        errors.push(`${svcName}: host bind ${source}`);
      }
    }
  }
}

export function validateComposeSecurity(doc: unknown): ComposeSecurityResult {
  const errors: string[] = [];

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['compose document must be a mapping'] };
  }

  const docObj = doc as Record<string, unknown>;
  const servicesRaw = docObj.services;
  if (!servicesRaw || typeof servicesRaw !== 'object' || Array.isArray(servicesRaw)) {
    return { valid: true, errors: [] };
  }

  const services = servicesRaw as Record<string, unknown>;
  for (const [svcName, svcVal] of Object.entries(services)) {
    if (!svcVal || typeof svcVal !== 'object' || Array.isArray(svcVal)) {
      continue;
    }
    validateServiceSecurity(svcName, svcVal as Record<string, unknown>, errors);
  }

  return { valid: errors.length === 0, errors };
}

function readEnvironmentEntries(
  envVal: unknown,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];

  if (Array.isArray(envVal)) {
    for (const entry of envVal) {
      if (typeof entry !== 'string') {
        continue;
      }
      const idx = entry.indexOf('=');
      if (idx < 0) {
        out.push({ key: entry.trim(), value: '' });
      } else {
        out.push({ key: entry.slice(0, idx).trim(), value: entry.slice(idx + 1) });
      }
    }
    return out;
  }

  if (envVal && typeof envVal === 'object' && !Array.isArray(envVal)) {
    const map = envVal as Record<string, unknown>;
    for (const [key, val] of Object.entries(map)) {
      out.push({ key, value: val == null ? '' : String(val) });
    }
    return out;
  }

  return out;
}

export function resolveCoolifyMagicVariables(input: ResolveCoolifyMagicVariablesInput): ResolveCoolifyMagicVariablesResult {
  const {
    slug,
    doc,
    defaultPort,
    primaryDomain,
    wildcardDomain,
    publicIpv4,
    previewPort,
    existingEnv = {},
    userEnv = {},
  } = input;

  const env: Record<string, string> = { ...userEnv };
  const secrets: Record<string, string> = {};

  const servicesRaw = doc.services;
  if (!servicesRaw || typeof servicesRaw !== 'object' || Array.isArray(servicesRaw)) {
    return { env, secrets };
  }
  const services = servicesRaw as Record<string, unknown>;

  const serviceOrder: string[] = Object.keys(services);
  const serviceDeclaredPorts = new Map<string, number>();
  const serviceIngressDecls = new Map<string, Array<{ type: 'FQDN' | 'URL'; token: string; port?: number }>>();

  // First pass: collect magic secrets and ingress declarations per service.
  for (const svcName of serviceOrder) {
    const svcVal = services[svcName];
    if (!svcVal || typeof svcVal !== 'object' || Array.isArray(svcVal)) {
      continue;
    }
    const svc = svcVal as Record<string, unknown>;
    const envEntries = readEnvironmentEntries(svc.environment);

    const decls: Array<{ type: 'FQDN' | 'URL'; token: string; port?: number }> = [];
    for (const { key, value } of envEntries) {
      const magicMatch = key.match(MAGIC_SECRET_KEY_REGEX);
      if (magicMatch) {
        const type = magicMatch[1] as CoolifyMagicVarType;
        const existing = existingEnv[key];
        const resolved = existing !== undefined ? existing : generateMagicSecret(type);
        env[key] = resolved;
        secrets[key] = resolved;
        continue;
      }

      const ingressMatch = key.match(INGRESS_DECL_REGEX);
      if (ingressMatch) {
        const type: 'FQDN' | 'URL' = ingressMatch[1] === 'FQDN' ? 'FQDN' : 'URL';
        const token = ingressMatch[2];
        const portRaw = ingressMatch[4];
        const port = portRaw ? Number.parseInt(portRaw, 10) : undefined;
        decls.push({ type, token, port });
        if (port) {
          serviceDeclaredPorts.set(svcName, port);
        }
      }

      // Carry through any pre-existing non-magic env values.
      if (existingEnv[key] !== undefined && env[key] === undefined) {
        env[key] = value;
      }
    }
    if (decls.length > 0) {
      serviceIngressDecls.set(svcName, decls);
    }
  }

  // Determine the primary ingress service: one whose declaration port matches
  // defaultPort, else the first service with ingress declarations.
  let primarySvc: string | undefined;
  if (typeof defaultPort === 'number' && defaultPort > 0) {
    for (const svcName of serviceOrder) {
      if (serviceDeclaredPorts.get(svcName) === defaultPort && serviceIngressDecls.has(svcName)) {
        primarySvc = svcName;
        break;
      }
    }
  }
  if (!primarySvc) {
    for (const svcName of serviceOrder) {
      if (serviceIngressDecls.has(svcName)) {
        primarySvc = svcName;
        break;
      }
    }
  }

  const fallbackInternal = `http://mw-paas-${slug}:${defaultPort ?? 8080}`;
  const primaryUrl =
    primaryDomain
      ? `https://${primaryDomain}`
      : publicIpv4 && typeof previewPort === 'number'
        ? `http://${publicIpv4}:${previewPort}`
        : fallbackInternal;

  // Second pass: resolve ingress declarations into SERVICE_FQDN_* / SERVICE_URL_*.
  for (const svcName of serviceOrder) {
    const decls = serviceIngressDecls.get(svcName);
    if (!decls) {
      continue;
    }
    const isPrimary = svcName === primarySvc;
    const safeSvc = safeServiceName(svcName);
    for (const decl of decls) {
      let url: string;
      if (isPrimary) {
        url = primaryUrl;
      } else if (wildcardDomain) {
        url = `https://${safeSvc}-${slug}.${wildcardDomain}`;
      } else {
        const port = decl.port ?? defaultPort ?? 8080;
        url = `http://mw-paas-${slug}-${safeSvc}:${port}`;
      }

      const baseKeyFqdn = `SERVICE_FQDN_${decl.token}`;
      const baseKeyUrl = `SERVICE_URL_${decl.token}`;
      env[baseKeyFqdn] = url;
      env[baseKeyUrl] = url;
      if (decl.port) {
        env[`SERVICE_FQDN_${decl.token}_${decl.port}`] = url;
        env[`SERVICE_URL_${decl.token}_${decl.port}`] = url;
      }
    }
  }

  return { env, secrets };
}

export interface CompileCoolifyComposeInput {
  slug: string;
  tenantId: string;
  composeYaml: string;
  defaultPort: number;
  primaryDomain?: string;
  wildcardDomain?: string;
  publicIpv4?: string;
  previewPort?: number;
  existingEnv?: Record<string, string>;
  userEnv?: Record<string, string>;
}

export interface ComposeIngressRoute {
  service: string;
  host: string;
  url: string;
  port: number;
}

export interface CompileCoolifyComposeResult {
  composeYaml: string;
  files: Record<string, string>;
  env: Record<string, string>;
  primaryService: string;
  primaryPort: number;
  ingressRoutes: ComposeIngressRoute[];
}

const PAAS_NETWORK = 'moonwitness-paas';
const INLINE_CONTENT_MAX_BYTES = 256 * 1024;

function normalizeLabels(labels: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(labels)) {
    for (const entry of labels) {
      if (typeof entry !== 'string') {
        continue;
      }
      const idx = entry.indexOf('=');
      if (idx < 0) {
        out[entry.trim()] = '';
      } else {
        out[entry.slice(0, idx).trim()] = entry.slice(idx + 1);
      }
    }
    return out;
  }
  if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
    for (const [key, value] of Object.entries(labels as Record<string, unknown>)) {
      out[key] = value == null ? '' : String(value);
    }
  }
  return out;
}

function isNamedVolumeSource(source: string): boolean {
  if (!source) {
    return false;
  }
  return !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('~') && !source.includes('\\');
}

function volumeTail(vol: string, source: string): string {
  const colonIdx = vol.indexOf(':');
  return colonIdx >= 0 ? vol.slice(source.length) : '';
}

export function compileCoolifyCompose(input: CompileCoolifyComposeInput): CompileCoolifyComposeResult {
  const {
    slug,
    tenantId,
    composeYaml,
    defaultPort,
    primaryDomain,
    wildcardDomain,
    publicIpv4,
    previewPort,
    existingEnv = {},
    userEnv = {},
  } = input;

  if (!slug || typeof slug !== 'string') {
    throw new Error('slug is required');
  }
  if (typeof defaultPort !== 'number' || defaultPort < 1 || defaultPort > 65535) {
    throw new Error('defaultPort must be a valid port');
  }

  const doc = parseYaml(composeYaml);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('composeYaml must parse to a mapping');
  }
  const docObj = doc as Record<string, unknown>;
  const servicesRaw = docObj.services;
  if (!servicesRaw || typeof servicesRaw !== 'object' || Array.isArray(servicesRaw)) {
    throw new Error('composeYaml must declare a services mapping');
  }
  const services = servicesRaw as Record<string, unknown>;
  const serviceOrder = Object.keys(services);

  type IngressDecl = { type: 'FQDN' | 'URL'; token: string; port?: number };
  const serviceDecls = new Map<string, IngressDecl[]>();
  for (const svcName of serviceOrder) {
    const svcVal = services[svcName];
    if (!svcVal || typeof svcVal !== 'object' || Array.isArray(svcVal)) {
      continue;
    }
    const entries = readEnvironmentEntries((svcVal as Record<string, unknown>).environment);
    const decls: IngressDecl[] = [];
    for (const { key } of entries) {
      const m = key.match(INGRESS_DECL_REGEX);
      if (m) {
        decls.push({ type: (m[1] === 'FQDN' ? 'FQDN' : 'URL'), token: m[2], port: m[4] ? Number.parseInt(m[4], 10) : undefined });
      }
    }
    if (decls.length > 0) {
      serviceDecls.set(svcName, decls);
    }
  }

  let primaryService = serviceOrder[0] ?? slug;
  if (typeof defaultPort === 'number' && defaultPort > 0) {
    for (const svcName of serviceOrder) {
      const decls = serviceDecls.get(svcName);
      if (decls && decls.some((d) => d.port === defaultPort)) {
        primaryService = svcName;
        break;
      }
    }
  } else {
    for (const svcName of serviceOrder) {
      if (serviceDecls.has(svcName)) {
        primaryService = svcName;
        break;
      }
    }
  }

  const files: Record<string, string> = {};
  const ingressRoutes: ComposeIngressRoute[] = [];

  // Resolve magic variables + ingress URLs from the declarations present in doc.
  const resolved = resolveCoolifyMagicVariables({
    slug,
    composeYaml,
    doc,
    defaultPort,
    primaryDomain,
    wildcardDomain,
    publicIpv4,
    previewPort,
    existingEnv,
    userEnv,
  });
  const env = resolved.env;

  for (const svcName of serviceOrder) {
    const decls = serviceDecls.get(svcName);
    if (!decls) {
      continue;
    }
    const isPrimary = svcName === primaryService;
    const safeSvc = safeServiceName(svcName);
    for (const decl of decls) {
      let url: string;
      let host: string;
      if (isPrimary) {
        url = primaryDomain ? `https://${primaryDomain}` : publicIpv4 && typeof previewPort === 'number' ? `http://${publicIpv4}:${previewPort}` : `http://mw-paas-${slug}:${defaultPort}`;
        host = primaryDomain ?? (publicIpv4 ?? `mw-paas-${slug}`);
      } else if (wildcardDomain) {
        host = `${safeSvc}-${slug}.${wildcardDomain}`;
        url = `https://${host}`;
      } else {
        const port = decl.port ?? defaultPort;
        host = `mw-paas-${slug}-${safeSvc}`;
        url = `http://${host}:${port}`;
      }
      ingressRoutes.push({ service: svcName, host, url, port: decl.port ?? defaultPort });
      if (decl.port) {
        ingressRoutes.push({ service: svcName, host, url, port: decl.port });
      }
    }
  }

  const topLevelVolumes = new Set<string>();

  for (const svcName of serviceOrder) {
    const svc = services[svcName] as Record<string, unknown>;

    // 1. Delete Coolify-only exclude_from_hc per service.
    delete svc.exclude_from_hc;

    // 2. Set restart: 'unless-stopped' if unset (preserve on-failure / no).
    if (!('restart' in svc) || svc.restart == null || svc.restart === '') {
      svc.restart = 'unless-stopped';
    }

    // 3. Add labels mw.paas.managed, mw.paas.app, mw.paas.service, mw.paas.tenant.
    const labels = normalizeLabels(svc.labels);
    labels['mw.paas.managed'] = 'true';
    labels['mw.paas.app'] = slug;
    labels['mw.paas.service'] = svcName;
    labels['mw.paas.tenant'] = tenantId;
    svc.labels = labels;

    // 4. Prefix named volumes and populate top-level doc.volumes.
    if (Array.isArray(svc.volumes)) {
      const rewritten: unknown[] = [];
      for (const vol of svc.volumes) {
        const parsed = parseVolumeEntry(vol);
        const source = parsed.source ?? '';
        if (source && isNamedVolumeSource(source)) {
          const prefixed = `mw-${slug}-${source}`;
          topLevelVolumes.add(prefixed);
          if (typeof vol === 'string') {
            rewritten.push(`${prefixed}${volumeTail(vol, source)}`);
          } else if (vol && typeof vol === 'object' && !Array.isArray(vol)) {
            rewritten.push({ ...(vol as Record<string, unknown>), source: prefixed });
          } else {
            rewritten.push(vol);
          }
        } else {
          rewritten.push(vol);
        }
      }
      svc.volumes = rewritten;
    }

    // 5. Extract inline content: bind mounts into files, delete .content key.
    if (Array.isArray(svc.volumes)) {
      for (const vol of svc.volumes) {
        const parsed = parseVolumeEntry(vol);
        if (parsed.type === 'bind' && typeof parsed.content === 'string' && parsed.source) {
          const src = parsed.source;
          if (src.includes('..') || src.startsWith('/') || src.startsWith('~') || src.includes('\\')) {
            throw new Error(`inline bind mount escapes stack directory: ${src}`);
          }
          if (Buffer.byteLength(parsed.content, 'utf8') > INLINE_CONTENT_MAX_BYTES) {
            throw new Error(`inline file exceeds ${INLINE_CONTENT_MAX_BYTES} bytes: ${src}`);
          }
          files[src.replace(/^\.\//, '')] = parsed.content;
          if (vol && typeof vol === 'object' && !Array.isArray(vol)) {
            delete (vol as Record<string, unknown>).content;
          }
        }
      }
    }

    // 6. Strip bare marker-only SERVICE_FQDN_* / SERVICE_URL_* entries without '='.
    if (Array.isArray(svc.environment)) {
      svc.environment = (svc.environment as unknown[]).filter((e) => {
        if (typeof e !== 'string') {
          return true;
        }
        const eqIdx = e.indexOf('=');
        const key = eqIdx < 0 ? e.trim() : e.slice(0, eqIdx).trim();
        return !(INGRESS_DECL_REGEX.test(key) && eqIdx < 0);
      });
    } else if (svc.environment && typeof svc.environment === 'object' && !Array.isArray(svc.environment)) {
      const envMap = svc.environment as Record<string, unknown>;
      for (const key of Object.keys(envMap)) {
        if (INGRESS_DECL_REGEX.test(key) && envMap[key] == null) {
          delete envMap[key];
        }
      }
    }
  }

  // 7. Networks: every service to default; primary + declaring services to moonwitness-paas with alias.
  const networks: Record<string, unknown> = { default: {}, [PAAS_NETWORK]: { external: true } };
  for (const svcName of serviceOrder) {
    const svc = services[svcName] as Record<string, unknown>;
    const svcNetworks: Record<string, unknown> = { default: {} };
    if (svcName === primaryService || serviceDecls.has(svcName)) {
      const alias = svcName === primaryService ? `mw-paas-${slug}` : `mw-paas-${slug}-${safeServiceName(svcName)}`;
      svcNetworks[PAAS_NETWORK] = { aliases: [alias] };
    }
    svc.networks = svcNetworks;
  }
  docObj.networks = networks;

  // 7b. Declare every prefixed named volume at the top level so Docker Compose
  //     accepts the rewritten service volume references.
  if (topLevelVolumes.size > 0) {
    const existingVolumes =
      docObj.volumes && typeof docObj.volumes === 'object' && !Array.isArray(docObj.volumes)
        ? { ...(docObj.volumes as Record<string, unknown>) }
        : {};
    for (const name of topLevelVolumes) existingVolumes[name] = {};
    docObj.volumes = existingVolumes;
  }

  // 8. Stringify via yaml.
  const finalYaml = stringifyYaml(docObj);

  const primaryPort = defaultPort;
  return { composeYaml: finalYaml, files, env, primaryService, primaryPort, ingressRoutes };
}

