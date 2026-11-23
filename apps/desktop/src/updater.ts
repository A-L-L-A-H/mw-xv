export const DEFAULT_DESKTOP_UPDATE_ENDPOINT =
  'https://github.com/A-L-L-A-H/mw-xv/releases/latest/download/latest.json';

export const DEFAULT_CURRENT_DESKTOP_VERSION = '1.0.0-rc.1';

const ALLOWED_UPDATE_HOSTS = new Set(['github.com']);
const SHA256_HEX_REGEX = /^[a-fA-F0-9]{64}$/u;

export interface DesktopUpdatePlatformAsset {
  readonly url: string;
  readonly signature: string;
  readonly sha256?: string;
}

export interface DesktopUpdateManifest {
  readonly version: string;
  readonly notes?: string;
  readonly pub_date?: string;
  readonly releaseUrl?: string;
  readonly signature?: string;
  readonly sha256?: string;
  readonly platforms?: Readonly<Record<string, DesktopUpdatePlatformAsset>>;
}

export type DesktopUpdateCheckStatus =
  | 'up-to-date'
  | 'available'
  | 'offline'
  | 'invalid-manifest'
  | 'invalid-endpoint';

export interface DesktopUpdateCheckResult {
  readonly status: DesktopUpdateCheckStatus;
  readonly updateAvailable: boolean;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly releaseNotes?: string;
  readonly releaseUrl?: string;
  readonly publishedAt?: string;
  readonly signaturePresent: boolean;
  readonly sha256Valid: boolean;
  readonly error?: string;
}

export interface CheckForDesktopUpdateOptions {
  readonly currentVersion?: string;
  readonly endpoint?: string;
  readonly platformKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

export function validateUpdateEndpoint(endpoint: string): {
  readonly valid: boolean;
  readonly reason?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { valid: false, reason: 'Malformed update endpoint URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Update endpoint must use HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_UPDATE_HOSTS.has(hostname)) {
    return {
      valid: false,
      reason: `Update endpoint host "${hostname}" is not allowed (expected github.com)`,
    };
  }

  return { valid: true };
}

export function parseSemver(version: string): ParsedSemver | null {
  const cleaned = version.trim().replace(/^v/u, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(cleaned);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prereleaseRaw = match[4];
  const prerelease = prereleaseRaw
    ? prereleaseRaw.split('.').map((part) => (/^\d+$/u.test(part) ? Number(part) : part))
    : [];

  return { major, minor, patch, prerelease };
}

/**
 * Compares two semver strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) {
    throw new Error(`Invalid semver comparison: "${a}" vs "${b}"`);
  }

  if (parsedA.major !== parsedB.major) return parsedA.major > parsedB.major ? 1 : -1;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor > parsedB.minor ? 1 : -1;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch > parsedB.patch ? 1 : -1;

  const aPre = parsedA.prerelease;
  const bPre = parsedB.prerelease;

  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const maxLen = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < maxLen; i += 1) {
    const aPart = aPre[i];
    const bPart = bPre[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;

    const aIsNum = typeof aPart === 'number';
    const bIsNum = typeof bPart === 'number';
    if (aIsNum && bIsNum) return aPart > bPart ? 1 : -1;
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return aPart > bPart ? 1 : -1;
  }

  return 0;
}

export function isValidSha256Hex(value: string | undefined): boolean {
  return typeof value === 'string' && SHA256_HEX_REGEX.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseManifest(raw: unknown): DesktopUpdateManifest | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['version'] !== 'string' || !parseSemver(raw['version'])) return null;

  let platforms: Record<string, DesktopUpdatePlatformAsset> | undefined;
  if (raw['platforms'] !== undefined) {
    if (!isRecord(raw['platforms'])) return null;
    platforms = {};
    for (const [key, entry] of Object.entries(raw['platforms'])) {
      if (!isRecord(entry)) continue;
      if (typeof entry['url'] !== 'string' || typeof entry['signature'] !== 'string') continue;
      platforms[key] = {
        url: entry['url'],
        signature: entry['signature'],
        sha256: typeof entry['sha256'] === 'string' ? entry['sha256'] : undefined,
      };
    }
  }

  return {
    version: raw['version'],
    notes: typeof raw['notes'] === 'string' ? raw['notes'] : undefined,
    pub_date: typeof raw['pub_date'] === 'string' ? raw['pub_date'] : undefined,
    releaseUrl: typeof raw['releaseUrl'] === 'string' ? raw['releaseUrl'] : undefined,
    signature: typeof raw['signature'] === 'string' ? raw['signature'] : undefined,
    sha256: typeof raw['sha256'] === 'string' ? raw['sha256'] : undefined,
    platforms,
  };
}

function verifyManifestMetadata(
  manifest: DesktopUpdateManifest,
  platformKey?: string
): { readonly signaturePresent: boolean; readonly sha256Valid: boolean; readonly valid: boolean } {
  const platformEntry = platformKey && manifest.platforms ? manifest.platforms[platformKey] : undefined;
  const firstPlatformEntry = manifest.platforms ? Object.values(manifest.platforms)[0] : undefined;
  const activeEntry = platformEntry ?? firstPlatformEntry;

  const signature = activeEntry?.signature ?? manifest.signature;
  const sha256 = activeEntry?.sha256 ?? manifest.sha256;

  const signaturePresent = typeof signature === 'string' && signature.trim().length > 0;
  const sha256Valid = sha256 !== undefined ? isValidSha256Hex(sha256) : false;

  // Require at least a non-empty signature or a valid 64-char SHA-256 digest;
  // if sha256 is provided, it must be well-formed.
  const sha256Malformed = sha256 !== undefined && !sha256Valid;
  const valid = !sha256Malformed && (signaturePresent || sha256Valid);

  return { signaturePresent, sha256Valid, valid };
}

export async function checkForDesktopUpdate(
  options: CheckForDesktopUpdateOptions = {}
): Promise<DesktopUpdateCheckResult> {
  const currentVersion = options.currentVersion ?? DEFAULT_CURRENT_DESKTOP_VERSION;
  const endpoint = options.endpoint ?? DEFAULT_DESKTOP_UPDATE_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? 8000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const endpointCheck = validateUpdateEndpoint(endpoint);
  if (!endpointCheck.valid) {
    return {
      status: 'invalid-endpoint',
      updateAvailable: false,
      currentVersion,
      signaturePresent: false,
      sha256Valid: false,
      error: endpointCheck.reason,
    };
  }

  if (!parseSemver(currentVersion)) {
    return {
      status: 'invalid-manifest',
      updateAvailable: false,
      currentVersion,
      signaturePresent: false,
      sha256Valid: false,
      error: `Invalid currentVersion semver: "${currentVersion}"`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    return {
      status: 'offline',
      updateAvailable: false,
      currentVersion,
      signaturePresent: false,
      sha256Valid: false,
      error: err instanceof Error ? err.message : 'Network unreachable',
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return {
      status: 'offline',
      updateAvailable: false,
      currentVersion,
      signaturePresent: false,
      sha256Valid: false,
      error: `Update server returned HTTP ${response.status}`,
    };
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch {
    return {
      status: 'invalid-manifest',
      updateAvailable: false,
      currentVersion,
      signaturePresent: false,
      sha256Valid: false,
      error: 'Update manifest is not valid JSON',
    };
  }

  const manifest = parseManifest(rawJson);
  if (!manifest) {
    return {
      status: 'invalid-manifest',
      updateAvailable: false,
      currentVersion,
      signaturePresent: false,
      sha256Valid: false,
      error: 'Update manifest is missing a valid semver version',
    };
  }

  const metadata = verifyManifestMetadata(manifest, options.platformKey);
  if (!metadata.valid) {
    return {
      status: 'invalid-manifest',
      updateAvailable: false,
      currentVersion,
      latestVersion: manifest.version,
      signaturePresent: metadata.signaturePresent,
      sha256Valid: metadata.sha256Valid,
      error: 'Update manifest failed signature/SHA-256 metadata validation',
    };
  }

  const isNewer = compareSemver(manifest.version, currentVersion) > 0;
  return {
    status: isNewer ? 'available' : 'up-to-date',
    updateAvailable: isNewer,
    currentVersion,
    latestVersion: manifest.version,
    releaseNotes: manifest.notes,
    releaseUrl:
      manifest.releaseUrl ??
      `https://github.com/A-L-L-A-H/mw-xv/releases/tag/v${manifest.version.replace(/^v/u, '')}`,
    publishedAt: manifest.pub_date,
    signaturePresent: metadata.signaturePresent,
    sha256Valid: metadata.sha256Valid,
  };
}
