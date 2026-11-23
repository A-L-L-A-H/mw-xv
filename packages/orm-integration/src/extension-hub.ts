import { createHash } from 'node:crypto';

export type ExtensionCapability =
  | 'orm:models'
  | 'orm:migrations'
  | 'http:routes'
  | 'jobs:cron'
  | 'webhook:outbound'
  | 'webhook:inbound'
  | 'ui:widgets';

export const ALLOWED_EXTENSION_CAPABILITIES: ReadonlySet<ExtensionCapability> = new Set([
  'orm:models',
  'orm:migrations',
  'http:routes',
  'jobs:cron',
  'webhook:outbound',
  'webhook:inbound',
  'ui:widgets',
]);

export type ExtensionPermission =
  | 'db:read'
  | 'db:write'
  | 'http:register'
  | 'jobs:schedule'
  | 'network:egress'
  | 'secrets:read'
  | 'fs:read'
  | 'fs:write'
  | 'process:exec';

const HIGH_PRIVILEGE_PERMISSIONS: ReadonlySet<string> = new Set([
  'secrets:read',
  'fs:write',
  'process:exec',
]);

const FORBIDDEN_SPDX_PATTERNS: readonly RegExp[] = [
  /\bAGPL\b/iu,
  /\bGPL\b/iu,
  /\bSSPL\b/iu,
  /\bEUPL\b/iu,
];

const ALLOWED_SPDX_LICENSES: ReadonlySet<string> = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'Unlicense',
  '0BSD',
]);

const EXTENSION_ID_RE = /^orm-[a-z0-9][a-z0-9-]{1,48}$/u;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/u;

export interface ExtensionDependencySpec {
  readonly id: string;
  readonly versionRange: string;
}

export interface ExtensionManifest {
  readonly id: string;
  readonly version: string;
  readonly spdxLicense: string;
  readonly artifactSha256: string;
  readonly capabilities: readonly string[];
  readonly permissions: readonly string[];
  readonly dependencies: readonly ExtensionDependencySpec[];
  readonly allowHighPrivilege?: boolean;
}

export interface ExtensionVerificationIssue {
  readonly code:
    | 'INVALID_EXTENSION_ID'
    | 'INVALID_SEMVER'
    | 'FORBIDDEN_COPYLEFT_LICENSE'
    | 'UNSUPPORTED_LICENSE'
    | 'INVALID_ARTIFACT_DIGEST'
    | 'ARTIFACT_DIGEST_MISMATCH'
    | 'DISALLOWED_CAPABILITY'
    | 'PERMISSION_BOUNDARY_VIOLATION'
    | 'DEPENDENCY_CYCLE_DETECTED';
  readonly message: string;
}

export interface ExtensionVerificationResult {
  readonly ok: boolean;
  readonly extensionId: string;
  readonly version: string;
  readonly issues: readonly ExtensionVerificationIssue[];
  readonly manifestSha256: string;
}

export function computeArtifactSha256(artifactBytes: string | Buffer): string {
  return createHash('sha256').update(artifactBytes).digest('hex');
}

export function verifyExtensionManifest(
  manifest: ExtensionManifest,
  artifactBytes?: string | Buffer
): ExtensionVerificationResult {
  const issues: ExtensionVerificationIssue[] = [];

  if (!EXTENSION_ID_RE.test(manifest.id)) {
    issues.push({
      code: 'INVALID_EXTENSION_ID',
      message: `Extension id "${manifest.id}" must match orm-<slug>`,
    });
  }

  if (!SEMVER_RE.test(manifest.version)) {
    issues.push({
      code: 'INVALID_SEMVER',
      message: `Version "${manifest.version}" is not valid SemVer`,
    });
  }

  const normalizedLicense = manifest.spdxLicense.trim();
  if (FORBIDDEN_SPDX_PATTERNS.some((re) => re.test(normalizedLicense))) {
    issues.push({
      code: 'FORBIDDEN_COPYLEFT_LICENSE',
      message: `License "${manifest.spdxLicense}" is rejected due to strong copyleft contamination policy`,
    });
  } else if (!ALLOWED_SPDX_LICENSES.has(normalizedLicense)) {
    issues.push({
      code: 'UNSUPPORTED_LICENSE',
      message: `License "${manifest.spdxLicense}" is not on the approved permissive SPDX allowlist`,
    });
  }

  const normalizedDigest = manifest.artifactSha256.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(normalizedDigest)) {
    issues.push({
      code: 'INVALID_ARTIFACT_DIGEST',
      message: 'artifactSha256 must be a 64-character lowercase hexadecimal SHA-256 digest',
    });
  } else if (artifactBytes !== undefined) {
    const computed = computeArtifactSha256(artifactBytes);
    if (computed !== normalizedDigest) {
      issues.push({
        code: 'ARTIFACT_DIGEST_MISMATCH',
        message: `Artifact SHA-256 mismatch: expected ${normalizedDigest}, got ${computed}`,
      });
    }
  }

  for (const cap of manifest.capabilities) {
    if (!ALLOWED_EXTENSION_CAPABILITIES.has(cap as ExtensionCapability)) {
      issues.push({
        code: 'DISALLOWED_CAPABILITY',
        message: `Capability "${cap}" is not in the extension capability allowlist`,
      });
    }
  }

  for (const perm of manifest.permissions) {
    if (HIGH_PRIVILEGE_PERMISSIONS.has(perm) && !manifest.allowHighPrivilege) {
      issues.push({
        code: 'PERMISSION_BOUNDARY_VIOLATION',
        message: `High-privilege permission "${perm}" requires explicit allowHighPrivilege audit approval`,
      });
    }
  }

  const manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

  return {
    ok: issues.length === 0,
    extensionId: manifest.id,
    version: manifest.version,
    issues,
    manifestSha256,
  };
}

export interface DependencyCycleCheckResult {
  readonly acyclic: boolean;
  readonly cyclePath: readonly string[];
}

export function detectExtensionDependencyCycles(
  manifests: readonly ExtensionManifest[]
): DependencyCycleCheckResult {
  const adj = new Map<string, readonly string[]>();
  for (const manifest of manifests) {
    adj.set(
      manifest.id,
      manifest.dependencies.map((d) => d.id)
    );
  }

  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];

  const dfs = (node: string): readonly string[] | null => {
    state.set(node, 'visiting');
    stack.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      const neighborState = state.get(neighbor);
      if (neighborState === 'visiting') {
        const cycleStart = stack.indexOf(neighbor);
        return [...stack.slice(cycleStart), neighbor];
      }
      if (!neighborState && adj.has(neighbor)) {
        const cycle = dfs(neighbor);
        if (cycle) return cycle;
      }
    }

    stack.pop();
    state.set(node, 'visited');
    return null;
  };

  for (const id of Array.from(adj.keys()).sort((a, b) => a.localeCompare(b))) {
    if (!state.has(id)) {
      const cycle = dfs(id);
      if (cycle) {
        return { acyclic: false, cyclePath: cycle };
      }
    }
  }

  return { acyclic: true, cyclePath: [] };
}

export class ExtensionHubRegistry {
  private readonly entries = new Map<string, ExtensionManifest>();

  register(
    manifest: ExtensionManifest,
    artifactBytes?: string | Buffer
  ): ExtensionVerificationResult {
    const baseResult = verifyExtensionManifest(manifest, artifactBytes);
    if (!baseResult.ok) {
      return baseResult;
    }

    const candidateList = [
      ...Array.from(this.entries.values()).filter((e) => e.id !== manifest.id),
      manifest,
    ];
    const cycleCheck = detectExtensionDependencyCycles(candidateList);
    if (!cycleCheck.acyclic) {
      return {
        ...baseResult,
        ok: false,
        issues: [
          ...baseResult.issues,
          {
            code: 'DEPENDENCY_CYCLE_DETECTED',
            message: `Dependency cycle detected: ${cycleCheck.cyclePath.join(' -> ')}`,
          },
        ],
      };
    }

    this.entries.set(manifest.id, manifest);
    return baseResult;
  }

  get(extensionId: string): ExtensionManifest | undefined {
    return this.entries.get(extensionId);
  }

  list(): readonly ExtensionManifest[] {
    return Array.from(this.entries.values()).sort((a, b) => a.id.localeCompare(b.id));
  }
}
