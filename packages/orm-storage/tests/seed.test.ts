import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '@moonwitness/types';
import {
  buildStorageInitialSeed,
  STORAGE_SEED_VERSION,
  validateStorageSeedBundle,
  type StorageInitialSeedBundle,
} from '../src/index.js';

function cloneSeed<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mutateSeed(bundle: StorageInitialSeedBundle): void {
  const mutableBundle = bundle as unknown as {
    buckets: Array<{ code: string; keyPrefix: string }>;
    policies: Array<{ maxObjectBytes: number; allowedMimeTypes: string[] }>;
  };
  mutableBundle.buckets[0]!.code = 'mutated_bucket';
  mutableBundle.buckets[0]!.keyPrefix = 'mutated/';
  mutableBundle.policies[0]!.maxObjectBytes = 1;
  mutableBundle.policies[0]!.allowedMimeTypes.push('application/x-msdownload');
}

describe('@moonwitness/orm-storage initial seed module', () => {
  it('builds a deterministic, schema-valid storage bucket and policy bundle', () => {
    const firstBundle = buildStorageInitialSeed();
    const secondBundle = buildStorageInitialSeed();

    expect(firstBundle).toEqual(secondBundle);
    expect(firstBundle.version).toBe(STORAGE_SEED_VERSION);
    expect(firstBundle.buckets).toHaveLength(6);
    expect(firstBundle.policies).toHaveLength(6);
    expect(() => validateStorageSeedBundle(firstBundle)).not.toThrow();

    const bucketCodes = firstBundle.buckets.map((bucket) => bucket.code);
    expect(new Set(bucketCodes).size).toBe(bucketCodes.length);
    expect(bucketCodes).toContain('seed.storage.company_attachments');
    expect(bucketCodes).toContain('seed.storage.whatsapp_inbound_media');
    expect(bucketCodes).toContain('seed.storage.encrypted_vault_artifacts');
    expect(bucketCodes).toContain('seed.storage.audit_exports');
    expect(bucketCodes).toContain('seed.storage.operations_backup');
    expect(bucketCodes).toContain('seed.storage.quarantine_objects');

    const bucketCodeSet = new Set(bucketCodes);
    for (const bucket of firstBundle.buckets) {
      expect(bucket.code).toMatch(/^seed\.storage\.[a-z][a-z0-9_]*$/u);
      expect(bucket.name.length).toBeGreaterThan(0);
      expect(bucket.description.length).toBeGreaterThan(0);
      expect(bucket.provider === 'local' || bucket.provider === 's3').toBe(true);
      expect(['internal', 'confidential', 'restricted']).toContain(bucket.classification);
      expect(bucket.bucketName).toMatch(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u);
      expect(bucket.keyPrefix).toMatch(/^[a-z0-9][a-z0-9/_-]*\/$/u);
      expect(bucket.encryptionAtRest).toBe(true);
      expect(bucket.publicReadAllowed).toBe(false);
    }

    const policyCodes = firstBundle.policies.map((policy) => policy.code);
    expect(new Set(policyCodes).size).toBe(policyCodes.length);
    for (const policy of firstBundle.policies) {
      expect(policy.code).toMatch(/^seed\.storage\.policy\.[a-z][a-z0-9_]*$/u);
      expect(bucketCodeSet.has(policy.bucketCode)).toBe(true);
      expect(policy.name.length).toBeGreaterThan(0);
      expect(policy.description.length).toBeGreaterThan(0);
      expect(policy.maxObjectBytes).toBeGreaterThan(0);
      expect(policy.maxObjectBytes).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES);
      expect(policy.allowedMimeTypes.length).toBeGreaterThan(0);
      expect(new Set(policy.allowedMimeTypes).size).toBe(policy.allowedMimeTypes.length);
      expect(
        policy.allowedMimeTypes.every((mimeType) =>
          /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mimeType)
        )
      ).toBe(true);
      expect(policy.retentionDays).toBeGreaterThan(0);
      expect(policy.retentionDays).toBeLessThanOrEqual(3650);
      expect(policy.auditEveryAccess).toBe(true);
      expect(policy.requiresChecksum).toBe(true);
      expect(policy.allowsPublicRead).toBe(false);
    }

    const declaredCodes = new Set(firstBundle.buckets.map((bucket) => bucket.code));
    expect(firstBundle.policies.every((policy) => declaredCodes.has(policy.bucketCode))).toBe(true);
  });

  it('returns a mutable deep copy so callers cannot mutate subsequent bundles', () => {
    const firstBundle = buildStorageInitialSeed();
    const untouchedBundle = cloneSeed(firstBundle);
    mutateSeed(firstBundle);

    expect(buildStorageInitialSeed()).toEqual(untouchedBundle);
  });

  it('rejects unsafe or malformed storage seed bundles', () => {
    const baseBundle = buildStorageInitialSeed();

    const publicBucket = cloneSeed(baseBundle);
    (
      publicBucket as unknown as { buckets: Array<{ publicReadAllowed: boolean }> }
    ).buckets[0]!.publicReadAllowed = true;
    expect(() => validateStorageSeedBundle(publicBucket)).toThrow(/must not allow public reads/u);

    const oversizedPolicy = cloneSeed(baseBundle);
    (
      oversizedPolicy as unknown as { policies: Array<{ maxObjectBytes: number }> }
    ).policies[0]!.maxObjectBytes = MAX_ATTACHMENT_BYTES + 1;
    expect(() => validateStorageSeedBundle(oversizedPolicy)).toThrow(/invalid object size limit/u);

    const brokenReference = cloneSeed(baseBundle);
    (
      brokenReference as unknown as { policies: Array<{ bucketCode: string }> }
    ).policies[0]!.bucketCode = 'seed.storage.undefined';
    expect(() => validateStorageSeedBundle(brokenReference)).toThrow(/unknown bucket/u);

    const unsupportedProvider = cloneSeed(baseBundle);
    const mutableProvider = unsupportedProvider.buckets[0] as { provider: string };
    mutableProvider.provider = 'gcs';
    expect(() => validateStorageSeedBundle(unsupportedProvider)).toThrow(
      /Unsupported storage seed provider/u
    );
  });
});
