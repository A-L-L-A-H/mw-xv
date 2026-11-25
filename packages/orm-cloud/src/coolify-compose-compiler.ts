import { randomBytes } from 'node:crypto';

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
