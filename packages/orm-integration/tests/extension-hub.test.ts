import { describe, expect, it } from 'vitest';
import {
  ExtensionHubRegistry,
  computeArtifactSha256,
  detectExtensionDependencyCycles,
  verifyExtensionManifest,
  type ExtensionManifest,
} from '../src/extension-hub.js';

const SAMPLE_ARTIFACT = Buffer.from('export const extension = "orm-ledger";', 'utf8');
const SAMPLE_DIGEST = computeArtifactSha256(SAMPLE_ARTIFACT);

const VALID_MANIFEST: ExtensionManifest = {
  id: 'orm-ledger',
  version: '1.2.0',
  spdxLicense: 'MIT',
  artifactSha256: SAMPLE_DIGEST,
  capabilities: ['orm:models', 'http:routes'],
  permissions: ['db:read', 'db:write', 'http:register'],
  dependencies: [],
};

describe('extension-hub (Wave F.34)', () => {
  it('verifies a valid extension manifest and artifact SHA-256 digest', () => {
    const result = verifyExtensionManifest(VALID_MANIFEST, SAMPLE_ARTIFACT);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects AGPL/GPL copyleft licenses, tampered artifacts, bad SemVer, and disallowed capabilities', () => {
    const result = verifyExtensionManifest(
      {
        ...VALID_MANIFEST,
        id: 'bad-prefix',
        version: 'v1.2',
        spdxLicense: 'AGPL-3.0-only',
        capabilities: ['kernel:root'],
        permissions: ['process:exec'],
      },
      Buffer.from('tampered-bytes', 'utf8')
    );

    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('INVALID_EXTENSION_ID');
    expect(codes).toContain('INVALID_SEMVER');
    expect(codes).toContain('FORBIDDEN_COPYLEFT_LICENSE');
    expect(codes).toContain('ARTIFACT_DIGEST_MISMATCH');
    expect(codes).toContain('DISALLOWED_CAPABILITY');
    expect(codes).toContain('PERMISSION_BOUNDARY_VIOLATION');
  });

  it('detects dependency DAG cycles and rejects cyclic registrations', () => {
    const extA: ExtensionManifest = {
      ...VALID_MANIFEST,
      id: 'orm-alpha',
      dependencies: [{ id: 'orm-beta', versionRange: '^1.0.0' }],
    };
    const extB: ExtensionManifest = {
      ...VALID_MANIFEST,
      id: 'orm-beta',
      dependencies: [{ id: 'orm-alpha', versionRange: '^1.0.0' }],
    };

    const cycle = detectExtensionDependencyCycles([extA, extB]);
    expect(cycle.acyclic).toBe(false);
    expect(cycle.cyclePath.length).toBeGreaterThanOrEqual(3);

    const registry = new ExtensionHubRegistry();
    expect(registry.register(extA, SAMPLE_ARTIFACT).ok).toBe(true);
    const second = registry.register(extB, SAMPLE_ARTIFACT);
    expect(second.ok).toBe(false);
    expect(second.issues.some((i) => i.code === 'DEPENDENCY_CYCLE_DETECTED')).toBe(true);
    expect(registry.list().map((e) => e.id)).toEqual(['orm-alpha']);
  });
});
