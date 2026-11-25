import { describe, expect, it } from 'vitest';
import type { A2aPeerIdentityRegistry, A2aPeerKeyRegistration } from '../src/index.js';
import {
  MAX_PEER_KEY_GRACE_WINDOW_MS,
  createA2aPeerIdentityRegistry,
  createA2aPeerIdentityRegistryFromJson,
  fingerprintPeerKeySecret,
} from '../src/index.js';

const NOW = 1_763_865_600_000;
const SECRET_A = 'peer-key-alpha-0123456789abcdef0123456789';
const SECRET_B = 'peer-key-beta-0123456789abcdef01234567';

function registration(overrides: Partial<A2aPeerKeyRegistration> = {}): A2aPeerKeyRegistration {
  return {
    keyId: 'key-alpha-1',
    companyId: 7,
    agentCode: 'agent_source',
    secret: SECRET_A,
    activatedAt: NOW,
    ...overrides,
  };
}

function resolve(registry: A2aPeerIdentityRegistry, overrides: Record<string, unknown> = {}) {
  return registry.resolve({
    keyId: 'key-alpha-1',
    companyId: 7,
    agentCode: 'agent_source',
    nowMs: NOW + 1,
    ...overrides,
  });
}

describe('A2A peer identity registry (CF-017)', () => {
  it('resolves only explicitly registered agent/company keys', () => {
    const registry = createA2aPeerIdentityRegistry([registration()]);

    const resolved = resolve(registry);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.key).toMatchObject({
        keyId: 'key-alpha-1',
        companyId: 7,
        agentCode: 'agent_source',
        state: 'active',
        secret: SECRET_A,
      });
    }

    expect(resolve(registry, { keyId: undefined }).ok).toBe(false);
    expect(resolve(registry, { keyId: undefined })).toMatchObject({
      ok: false,
      reasonCode: 'PEER_KEY_ID_REQUIRED',
    });
    expect(resolve(registry, { keyId: 'key-ghost' })).toMatchObject({
      ok: false,
      reasonCode: 'PEER_KEY_UNKNOWN',
    });
    expect(resolve(registry, { companyId: 8 })).toMatchObject({
      ok: false,
      reasonCode: 'PEER_KEY_CROSS_COMPANY_REUSE',
    });
    expect(resolve(registry, { agentCode: 'agent_other' })).toMatchObject({
      ok: false,
      reasonCode: 'PEER_KEY_AGENT_MISMATCH',
    });
  });

  it('fails closed for revoked, expired and retired keys', () => {
    const registry = createA2aPeerIdentityRegistry([
      registration({ expiresAt: NOW + 5_000 }),
      registration({ keyId: 'key-revoked', secret: SECRET_B }),
    ]);
    registry.revoke('key-revoked', NOW + 1);

    expect(resolve(registry, { keyId: 'key-revoked' })).toMatchObject({
      ok: false,
      reasonCode: 'PEER_KEY_REVOKED',
    });
    expect(resolve(registry, { nowMs: NOW + 5_000 })).toMatchObject({
      ok: false,
      reasonCode: 'PEER_KEY_EXPIRED',
    });
    expect(
      registry.snapshot(NOW + 5_000).keys.find((key) => key.keyId === 'key-alpha-1')?.state
    ).toBe('retired');
    expect(resolve(registry, { nowMs: NOW + 5_001 })).toMatchObject({
      ok: false,
      reasonCode: 'PEER_KEY_RETIRED',
    });
  });

  it('supports bounded grace rotation with deterministic retirement', () => {
    const registry = createA2aPeerIdentityRegistry([registration()]);
    registry.rotate({
      previousKeyId: 'key-alpha-1',
      nextKeyId: 'key-alpha-2',
      nextSecret: SECRET_B,
      companyId: 7,
      agentCode: 'agent_source',
      rotatedAt: NOW,
      graceWindowMs: 10_000,
    });

    expect(resolve(registry)).toMatchObject({ ok: true });
    expect(resolve(registry, { keyId: 'key-alpha-2' })).toMatchObject({
      ok: true,
    });
    const snapshot = registry.snapshot();
    expect(snapshot.keys.find((key) => key.keyId === 'key-alpha-1')).toMatchObject({
      state: 'grace',
      graceUntilAt: NOW + 10_000,
    });
    expect(snapshot.keys.find((key) => key.keyId === 'key-alpha-2')).toMatchObject({
      state: 'active',
      rotationFromKeyId: 'key-alpha-1',
    });

    expect(registry.retireExpired(NOW + 9_999)).toEqual([]);
    expect(registry.retireExpired(NOW + 10_000)).toEqual(['key-alpha-1']);
    expect(resolve(registry, { nowMs: NOW + 10_001 })).toMatchObject({
      ok: false,
      reasonCode: 'PEER_KEY_RETIRED',
    });
    expect(resolve(registry, { keyId: 'key-alpha-2', nowMs: NOW + 10_001 })).toMatchObject({
      ok: true,
    });

    expect(() =>
      registry.rotate({
        previousKeyId: 'key-alpha-2',
        nextKeyId: 'key-alpha-3',
        nextSecret: 'peer-key-gamma-fixture',
        companyId: 7,
        agentCode: 'agent_source',
        rotatedAt: NOW,
        graceWindowMs: MAX_PEER_KEY_GRACE_WINDOW_MS + 1,
      })
    ).toThrow('graceWindowMs');
  });

  it('rejects cross-company/agent secret reuse and duplicate key IDs', () => {
    const registry = createA2aPeerIdentityRegistry([registration()]);
    expect(() => registry.register(registration())).toThrow('already registered');
    expect(() => registry.register(registration({ keyId: 'key-other', companyId: 8 }))).toThrow(
      'already bound to another key identity'
    );
    expect(() =>
      registry.register(registration({ keyId: 'key-other', agentCode: 'agent_other' }))
    ).toThrow('already bound to another key identity');
    expect(() => registry.register(registration({ keyId: 'short', secret: 'too-short' }))).toThrow(
      'at least 32 characters'
    );
    expect(fingerprintPeerKeySecret(SECRET_A)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('never stores or serializes secret material in snapshots or audit history', () => {
    const registry = createA2aPeerIdentityRegistry([registration()]);
    resolve(registry);
    registry.rotate({
      previousKeyId: 'key-alpha-1',
      nextKeyId: 'key-alpha-2',
      nextSecret: SECRET_B,
      companyId: 7,
      agentCode: 'agent_source',
      rotatedAt: NOW,
      graceWindowMs: 5_000,
    });
    registry.revoke('key-alpha-2', NOW + 2);

    const serialized = JSON.stringify({
      snapshot: registry.snapshot(NOW + 3),
      audit: registry.auditHistory(),
    });
    expect(serialized).not.toContain(SECRET_A);
    expect(serialized).not.toContain(SECRET_B);
    expect(serialized).toContain(fingerprintPeerKeySecret(SECRET_A));
    expect(serialized).toContain(fingerprintPeerKeySecret(SECRET_B));
    for (const event of registry.auditHistory()) {
      expect(event.eventId).toContain(event.keyId);
      expect(event).not.toHaveProperty('secret');
    }
  });

  it('loads key registrations and rotations from the env JSON document', () => {
    const registry = createA2aPeerIdentityRegistryFromJson(
      JSON.stringify({
        keys: [registration()],
        rotations: [
          {
            previousKeyId: 'key-alpha-1',
            nextKeyId: 'key-alpha-2',
            nextSecret: SECRET_B,
            companyId: 7,
            agentCode: 'agent_source',
            rotatedAt: NOW,
            graceWindowMs: 1_000,
          },
        ],
      })
    );
    expect(registry.snapshot().keys.map((key) => key.keyId)).toEqual([
      'key-alpha-1',
      'key-alpha-2',
    ]);
    expect(() => createA2aPeerIdentityRegistryFromJson('{"rotations":[]}')).toThrow('keys array');
  });
});
