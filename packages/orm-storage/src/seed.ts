import { MAX_ATTACHMENT_BYTES, type EnvConfig } from '@moonwitness/types';

export const STORAGE_SEED_VERSION = '1.0.0';

export type StorageSeedProvider = EnvConfig['attachmentStorageDriver'];
export type StorageSeedClassification = 'internal' | 'confidential' | 'restricted';

export interface StorageBucketSeed {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly provider: StorageSeedProvider;
  readonly bucketName: string;
  readonly keyPrefix: string;
  readonly classification: StorageSeedClassification;
  readonly encryptionAtRest: boolean;
  readonly versioningEnabled: boolean;
  readonly publicReadAllowed: boolean;
}

export interface StoragePolicySeed {
  readonly code: string;
  readonly bucketCode: string;
  readonly name: string;
  readonly description: string;
  readonly maxObjectBytes: number;
  readonly allowedMimeTypes: readonly string[];
  readonly retentionDays: number;
  readonly auditEveryAccess: boolean;
  readonly requiresChecksum: boolean;
  readonly allowsPublicRead: boolean;
}

export interface StorageInitialSeedBundle {
  readonly version: string;
  readonly buckets: readonly StorageBucketSeed[];
  readonly policies: readonly StoragePolicySeed[];
}

const BUCKET_CODE_PATTERN = /^seed\.storage\.[a-z][a-z0-9_]*$/u;
const POLICY_CODE_PATTERN = /^seed\.storage\.policy\.[a-z][a-z0-9_]*$/u;
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const KEY_PREFIX_PATTERN = /^[a-z0-9][a-z0-9/_-]*\/$/u;
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

const BUCKETS: readonly StorageBucketSeed[] = [
  {
    code: 'seed.storage.company_attachments',
    name: 'Company document attachments',
    description: 'Stores business documents attached to company operational records.',
    provider: 'local',
    bucketName: 'mw-company-attachments',
    keyPrefix: 'company/attachments/',
    classification: 'internal',
    encryptionAtRest: true,
    versioningEnabled: false,
    publicReadAllowed: false,
  },
  {
    code: 'seed.storage.whatsapp_inbound_media',
    name: 'WhatsApp inbound media',
    description: 'Stores media received by the verified WhatsApp business inbox.',
    provider: 's3',
    bucketName: 'mw-whatsapp-inbound',
    keyPrefix: 'whatsapp/inbound/',
    classification: 'confidential',
    encryptionAtRest: true,
    versioningEnabled: true,
    publicReadAllowed: false,
  },
  {
    code: 'seed.storage.encrypted_vault_artifacts',
    name: 'Encrypted vault artifacts',
    description: 'Stores encrypted chunk envelopes and vault manifests for sensitive exports.',
    provider: 's3',
    bucketName: 'mw-encrypted-vault',
    keyPrefix: 'vault/artifacts/',
    classification: 'restricted',
    encryptionAtRest: true,
    versioningEnabled: true,
    publicReadAllowed: false,
  },
  {
    code: 'seed.storage.audit_exports',
    name: 'Audit evidence exports',
    description: 'Stores immutable audit evidence packages generated for governance review.',
    provider: 's3',
    bucketName: 'mw-audit-exports',
    keyPrefix: 'audit/exports/',
    classification: 'restricted',
    encryptionAtRest: true,
    versioningEnabled: true,
    publicReadAllowed: false,
  },
  {
    code: 'seed.storage.operations_backup',
    name: 'Operational recovery artifacts',
    description: 'Stores verified recovery artifacts used by operational restore procedures.',
    provider: 's3',
    bucketName: 'mw-operations-backup',
    keyPrefix: 'operations/backup/',
    classification: 'restricted',
    encryptionAtRest: true,
    versioningEnabled: true,
    publicReadAllowed: false,
  },
  {
    code: 'seed.storage.quarantine_objects',
    name: 'Quarantined object store',
    description: 'Isolates rejected uploads and objects flagged by storage reconciliation.',
    provider: 'local',
    bucketName: 'mw-quarantine-objects',
    keyPrefix: 'quarantine/objects/',
    classification: 'restricted',
    encryptionAtRest: true,
    versioningEnabled: false,
    publicReadAllowed: false,
  },
];

const POLICIES: readonly StoragePolicySeed[] = [
  {
    code: 'seed.storage.policy.company_attachments',
    bucketCode: 'seed.storage.company_attachments',
    name: 'Company attachment handling',
    description:
      'Limits business attachments to verified document formats and checksum-backed lifecycle checks.',
    maxObjectBytes: MAX_ATTACHMENT_BYTES,
    allowedMimeTypes: [
      'application/pdf',
      'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
      'text/plain',
      'image/jpeg',
      'image/png',
    ],
    retentionDays: 1825,
    auditEveryAccess: true,
    requiresChecksum: true,
    allowsPublicRead: false,
  },
  {
    code: 'seed.storage.policy.whatsapp_inbound_media',
    bucketCode: 'seed.storage.whatsapp_inbound_media',
    name: 'WhatsApp inbound media handling',
    description:
      'Retains inbound WhatsApp media for dispute review while blocking public delivery.',
    maxObjectBytes: MAX_ATTACHMENT_BYTES,
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'video/mp4',
    ],
    retentionDays: 90,
    auditEveryAccess: true,
    requiresChecksum: true,
    allowsPublicRead: false,
  },
  {
    code: 'seed.storage.policy.encrypted_vault_artifacts',
    bucketCode: 'seed.storage.encrypted_vault_artifacts',
    name: 'Encrypted vault artifact handling',
    description:
      'Applies long-lived retention to authenticated encrypted envelopes and signed manifests.',
    maxObjectBytes: MAX_ATTACHMENT_BYTES,
    allowedMimeTypes: ['application/octet-stream', 'application/json', 'application/gzip'],
    retentionDays: 2555,
    auditEveryAccess: true,
    requiresChecksum: true,
    allowsPublicRead: false,
  },
  {
    code: 'seed.storage.policy.audit_exports',
    bucketCode: 'seed.storage.audit_exports',
    name: 'Audit evidence export handling',
    description: 'Preserves audit package integrity for governance and regulatory examination.',
    maxObjectBytes: MAX_ATTACHMENT_BYTES,
    allowedMimeTypes: ['application/json', 'application/x-ndjson', 'application/zip', 'text/csv'],
    retentionDays: 2555,
    auditEveryAccess: true,
    requiresChecksum: true,
    allowsPublicRead: false,
  },
  {
    code: 'seed.storage.policy.operations_backup',
    bucketCode: 'seed.storage.operations_backup',
    name: 'Operational recovery artifact handling',
    description:
      'Controls short-lived recovery packages with checksum verification on every restore path.',
    maxObjectBytes: MAX_ATTACHMENT_BYTES,
    allowedMimeTypes: ['application/octet-stream', 'application/gzip', 'application/zip'],
    retentionDays: 120,
    auditEveryAccess: true,
    requiresChecksum: true,
    allowsPublicRead: false,
  },
  {
    code: 'seed.storage.policy.quarantine_objects',
    bucketCode: 'seed.storage.quarantine_objects',
    name: 'Quarantined object handling',
    description:
      'Holds rejected or orphaned objects for bounded investigation without public exposure.',
    maxObjectBytes: MAX_ATTACHMENT_BYTES,
    allowedMimeTypes: ['application/octet-stream'],
    retentionDays: 30,
    auditEveryAccess: true,
    requiresChecksum: true,
    allowsPublicRead: false,
  },
];

function assertSeed(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateStorageSeedBundle(bundle: StorageInitialSeedBundle): void {
  assertSeed(bundle.version === STORAGE_SEED_VERSION, 'Storage seed version is not supported');
  assertSeed(Array.isArray(bundle.buckets), 'Storage seed buckets must be an array');
  assertSeed(Array.isArray(bundle.policies), 'Storage seed policies must be an array');

  const bucketCodes = new Set<string>();
  for (const bucket of bundle.buckets) {
    assertSeed(
      BUCKET_CODE_PATTERN.test(bucket.code),
      `Invalid storage seed bucket code: ${bucket.code}`
    );
    assertSeed(!bucketCodes.has(bucket.code), `Duplicate storage seed bucket code: ${bucket.code}`);
    bucketCodes.add(bucket.code);

    assertSeed(bucket.name.length > 0, `Storage seed bucket ${bucket.code} has no name`);
    assertSeed(
      bucket.description.length > 0,
      `Storage seed bucket ${bucket.code} has no description`
    );
    assertSeed(
      bucket.provider === 'local' || bucket.provider === 's3',
      `Unsupported storage seed provider for ${bucket.code}: ${bucket.provider}`
    );
    assertSeed(
      bucket.classification === 'internal' ||
        bucket.classification === 'confidential' ||
        bucket.classification === 'restricted',
      `Unsupported storage seed classification for ${bucket.code}: ${bucket.classification}`
    );
    assertSeed(
      BUCKET_NAME_PATTERN.test(bucket.bucketName),
      `Invalid logical bucket name for ${bucket.code}: ${bucket.bucketName}`
    );
    assertSeed(
      KEY_PREFIX_PATTERN.test(bucket.keyPrefix) &&
        !bucket.keyPrefix.includes('//') &&
        !bucket.keyPrefix.includes('..'),
      `Invalid key prefix for ${bucket.code}: ${bucket.keyPrefix}`
    );
    assertSeed(
      bucket.encryptionAtRest === true,
      `Storage seed bucket ${bucket.code} must encrypt data at rest`
    );
    assertSeed(
      bucket.publicReadAllowed === false,
      `Storage seed bucket ${bucket.code} must not allow public reads`
    );
  }

  const policyCodes = new Set<string>();
  for (const policy of bundle.policies) {
    assertSeed(
      POLICY_CODE_PATTERN.test(policy.code),
      `Invalid storage seed policy code: ${policy.code}`
    );
    assertSeed(!policyCodes.has(policy.code), `Duplicate storage seed policy code: ${policy.code}`);
    policyCodes.add(policy.code);

    assertSeed(
      bucketCodes.has(policy.bucketCode),
      `Storage seed policy ${policy.code} references an unknown bucket`
    );
    assertSeed(policy.name.length > 0, `Storage seed policy ${policy.code} has no name`);
    assertSeed(
      policy.description.length > 0,
      `Storage seed policy ${policy.code} has no description`
    );
    assertSeed(
      Number.isSafeInteger(policy.maxObjectBytes) &&
        policy.maxObjectBytes > 0 &&
        policy.maxObjectBytes <= MAX_ATTACHMENT_BYTES,
      `Storage seed policy ${policy.code} has an invalid object size limit`
    );
    assertSeed(
      Array.isArray(policy.allowedMimeTypes) && policy.allowedMimeTypes.length > 0,
      `Storage seed policy ${policy.code} has no allowed MIME types`
    );
    const mimeTypes = new Set<string>();
    for (const mimeType of policy.allowedMimeTypes) {
      assertSeed(
        MIME_TYPE_PATTERN.test(mimeType),
        `Invalid MIME type in storage seed policy ${policy.code}: ${mimeType}`
      );
      assertSeed(
        !mimeTypes.has(mimeType),
        `Duplicate MIME type in storage seed policy ${policy.code}: ${mimeType}`
      );
      mimeTypes.add(mimeType);
    }
    assertSeed(
      Number.isSafeInteger(policy.retentionDays) &&
        policy.retentionDays > 0 &&
        policy.retentionDays <= 3650,
      `Storage seed policy ${policy.code} has an invalid retention period`
    );
    assertSeed(
      policy.auditEveryAccess === true,
      `Storage seed policy ${policy.code} must audit every access`
    );
    assertSeed(
      policy.requiresChecksum === true,
      `Storage seed policy ${policy.code} must require checksums`
    );
    assertSeed(
      policy.allowsPublicRead === false,
      `Storage seed policy ${policy.code} must not allow public reads`
    );
  }
}

function cloneBucket(bucket: StorageBucketSeed): StorageBucketSeed {
  return { ...bucket };
}

function clonePolicy(policy: StoragePolicySeed): StoragePolicySeed {
  return { ...policy, allowedMimeTypes: [...policy.allowedMimeTypes] };
}

export function buildStorageInitialSeed(): StorageInitialSeedBundle {
  const bundle: StorageInitialSeedBundle = {
    version: STORAGE_SEED_VERSION,
    buckets: BUCKETS.map(cloneBucket),
    policies: POLICIES.map(clonePolicy),
  };
  validateStorageSeedBundle(bundle);
  return bundle;
}
