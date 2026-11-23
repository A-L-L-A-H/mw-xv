import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const AES_256_KEY_BYTES = 32;
const GCM_IV_BYTES = 12; // 96-bit IV
const GCM_TAG_BYTES = 16; // 128-bit auth tag
const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64 KiB

export interface EncryptedEnvelope {
  readonly version: 1;
  readonly alg: 'aes-256-gcm';
  readonly keyId: string;
  readonly tenantId: string;
  readonly artifactId?: string;
  readonly ivBase64: string;
  readonly authTagBase64: string;
  readonly ciphertextBase64: string;
  /** Envelope-encrypted DEK fields (present when using KEK envelope encryption). */
  readonly encryptedDekBase64?: string;
  readonly dekIvBase64?: string;
  readonly dekAuthTagBase64?: string;
}

export interface EncryptEnvelopeOptions {
  readonly keyId: string;
  readonly tenantId: string;
  readonly artifactId?: string;
  /** Master Key Encryption Key (32 bytes). A fresh random 256-bit DEK is generated per artifact. */
  readonly masterKey: Uint8Array;
}

export interface DecryptEnvelopeOptions {
  readonly expectedTenantId: string;
  readonly expectedArtifactId?: string;
  readonly masterKey: Uint8Array;
}

export interface ChunkManifestEntry {
  readonly index: number;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ChunkManifest {
  readonly version: 1;
  readonly tenantId: string;
  readonly contentType?: string;
  readonly chunkSize: number;
  readonly totalBytes: number;
  readonly rootSha256: string;
  readonly chunks: readonly ChunkManifestEntry[];
}

export interface BuiltChunkArtifact {
  readonly manifest: ChunkManifest;
  /** Content-addressable map from chunk SHA-256 hex digest -> raw chunk bytes. */
  readonly chunkStore: ReadonlyMap<string, Buffer>;
}

export interface ChunkVerificationResult {
  readonly valid: boolean;
  readonly verifiedChunks: number;
  readonly totalBytes: number;
  readonly errors: readonly string[];
}

function assertAes256Key(key: Uint8Array, label: string): Buffer {
  const buf = Buffer.from(key);
  if (buf.byteLength !== AES_256_KEY_BYTES) {
    throw new Error(`${label} must be exactly ${AES_256_KEY_BYTES} bytes (256 bits)`);
  }
  return buf;
}

function buildTenantAad(tenantId: string, keyId: string, artifactId?: string): Buffer {
  if (!tenantId.trim()) {
    throw new Error('tenantId must be non-empty for AAD binding');
  }
  if (!keyId.trim()) {
    throw new Error('keyId must be non-empty for AAD binding');
  }
  return Buffer.from(
    `mw-vault:v1|tenant=${tenantId}|key=${keyId}|artifact=${artifactId ?? ''}`,
    'utf8'
  );
}

function gcmEncrypt(
  key: Buffer,
  plaintext: Uint8Array,
  aad: Buffer
): {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
} {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, authTag, ciphertext };
}

function gcmDecrypt(
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
  ciphertext: Buffer,
  aad: Buffer
): Buffer {
  if (iv.byteLength !== GCM_IV_BYTES) {
    throw new Error(`Invalid GCM IV length: expected ${GCM_IV_BYTES} bytes`);
  }
  if (authTag.byteLength !== GCM_TAG_BYTES) {
    throw new Error(`Invalid GCM auth tag length: expected ${GCM_TAG_BYTES} bytes`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypts plaintext using AES-256-GCM envelope encryption:
 * - Generates a fresh random 256-bit DEK and 96-bit IV for the payload.
 * - Wraps the DEK with the caller's 256-bit master KEK using AES-256-GCM.
 * - Binds `tenantId`, `keyId`, and optional `artifactId` into GCM AAD for both layers.
 */
export function encryptArtifactEnvelope(
  plaintext: Uint8Array,
  options: EncryptEnvelopeOptions
): EncryptedEnvelope {
  const kek = assertAes256Key(options.masterKey, 'masterKey');
  const dek = randomBytes(AES_256_KEY_BYTES);
  const aad = buildTenantAad(options.tenantId, options.keyId, options.artifactId);

  const wrappedDek = gcmEncrypt(kek, dek, aad);
  const encryptedPayload = gcmEncrypt(dek, plaintext, aad);

  return {
    version: 1,
    alg: 'aes-256-gcm',
    keyId: options.keyId,
    tenantId: options.tenantId,
    ...(options.artifactId !== undefined ? { artifactId: options.artifactId } : {}),
    ivBase64: encryptedPayload.iv.toString('base64'),
    authTagBase64: encryptedPayload.authTag.toString('base64'),
    ciphertextBase64: encryptedPayload.ciphertext.toString('base64'),
    encryptedDekBase64: wrappedDek.ciphertext.toString('base64'),
    dekIvBase64: wrappedDek.iv.toString('base64'),
    dekAuthTagBase64: wrappedDek.authTag.toString('base64'),
  };
}

/**
 * Decrypts and authenticates an AES-256-GCM envelope.
 * Rejects any tampered ciphertext, tampered auth tag, tampered IV, or mismatched tenant/artifact AAD.
 */
export function decryptArtifactEnvelope(
  envelope: EncryptedEnvelope,
  options: DecryptEnvelopeOptions
): Buffer {
  if (envelope.version !== 1 || envelope.alg !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted envelope version or algorithm');
  }
  if (envelope.tenantId !== options.expectedTenantId) {
    throw new Error('Envelope tenantId does not match expectedTenantId');
  }
  if (
    options.expectedArtifactId !== undefined &&
    envelope.artifactId !== options.expectedArtifactId
  ) {
    throw new Error('Envelope artifactId does not match expectedArtifactId');
  }
  if (!envelope.encryptedDekBase64 || !envelope.dekIvBase64 || !envelope.dekAuthTagBase64) {
    throw new Error('Envelope is missing wrapped DEK fields');
  }

  const kek = assertAes256Key(options.masterKey, 'masterKey');
  const aad = buildTenantAad(options.expectedTenantId, envelope.keyId, envelope.artifactId);

  const dek = gcmDecrypt(
    kek,
    Buffer.from(envelope.dekIvBase64, 'base64'),
    Buffer.from(envelope.dekAuthTagBase64, 'base64'),
    Buffer.from(envelope.encryptedDekBase64, 'base64'),
    aad
  );

  return gcmDecrypt(
    dek,
    Buffer.from(envelope.ivBase64, 'base64'),
    Buffer.from(envelope.authTagBase64, 'base64'),
    Buffer.from(envelope.ciphertextBase64, 'base64'),
    aad
  );
}

function computeRootSha256(entries: readonly ChunkManifestEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(`${entry.index}:${entry.sha256}:${entry.sizeBytes}\n`, 'utf8');
  }
  return hash.digest('hex');
}

/**
 * Splits binary payload into content-addressable SHA-256 chunks and builds an integrity manifest.
 * Identical chunks are deduplicated in `chunkStore`.
 */
export function buildChunkManifest(
  payload: Uint8Array,
  options: { readonly tenantId: string; readonly chunkSize?: number; readonly contentType?: string }
): BuiltChunkArtifact {
  if (!options.tenantId.trim()) {
    throw new Error('tenantId must be non-empty');
  }
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error('chunkSize must be a positive safe integer');
  }

  const buffer = Buffer.from(payload);
  const chunks: ChunkManifestEntry[] = [];
  const chunkStore = new Map<string, Buffer>();

  for (let offset = 0, index = 0; offset < buffer.byteLength; offset += chunkSize, index += 1) {
    const slice = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.byteLength));
    const copy = Buffer.from(slice);
    const sha256 = createHash('sha256').update(copy).digest('hex');
    chunks.push({ index, sha256, sizeBytes: copy.byteLength });
    if (!chunkStore.has(sha256)) {
      chunkStore.set(sha256, copy);
    }
  }

  const manifest: ChunkManifest = {
    version: 1,
    tenantId: options.tenantId,
    ...(options.contentType !== undefined ? { contentType: options.contentType } : {}),
    chunkSize,
    totalBytes: buffer.byteLength,
    rootSha256: computeRootSha256(chunks),
    chunks,
  };

  return { manifest, chunkStore };
}

export type ChunkResolver = (
  sha256: string
) => Buffer | Uint8Array | undefined | Promise<Buffer | Uint8Array | undefined>;

/**
 * Verifies chunk manifest integrity:
 * - Validates root SHA-256 over the ordered chunk descriptors.
 * - Resolves every chunk and verifies its SHA-256 digest and byte length.
 * - Verifies total byte sum matches `manifest.totalBytes`.
 */
export async function verifyChunkManifest(
  manifest: ChunkManifest,
  resolveChunk: ChunkResolver
): Promise<ChunkVerificationResult> {
  const errors: string[] = [];

  const expectedRoot = computeRootSha256(manifest.chunks);
  if (expectedRoot !== manifest.rootSha256) {
    errors.push(`Root SHA-256 mismatch: expected ${expectedRoot}, got ${manifest.rootSha256}`);
  }

  let verifiedChunks = 0;
  let totalBytes = 0;

  for (let i = 0; i < manifest.chunks.length; i += 1) {
    const entry = manifest.chunks[i]!;
    if (entry.index !== i) {
      errors.push(`Chunk index out of order at position ${i}: got ${entry.index}`);
    }
    const raw = await resolveChunk(entry.sha256);
    if (!raw) {
      errors.push(`Missing chunk ${entry.index} (${entry.sha256})`);
      continue;
    }
    const buf = Buffer.from(raw);
    if (buf.byteLength !== entry.sizeBytes) {
      errors.push(
        `Chunk ${entry.index} size mismatch: expected ${entry.sizeBytes}, got ${buf.byteLength}`
      );
      continue;
    }
    const actualSha = createHash('sha256').update(buf).digest('hex');
    if (actualSha !== entry.sha256) {
      errors.push(
        `Chunk ${entry.index} digest mismatch: expected ${entry.sha256}, got ${actualSha}`
      );
      continue;
    }
    verifiedChunks += 1;
    totalBytes += buf.byteLength;
  }

  if (totalBytes !== manifest.totalBytes) {
    errors.push(`Total byte count mismatch: expected ${manifest.totalBytes}, got ${totalBytes}`);
  }

  return {
    valid: errors.length === 0,
    verifiedChunks,
    totalBytes,
    errors,
  };
}

/**
 * Verifies and reassembles the original artifact buffer from a chunk manifest.
 */
export async function reassembleChunkManifest(
  manifest: ChunkManifest,
  resolveChunk: ChunkResolver
): Promise<Buffer> {
  const verification = await verifyChunkManifest(manifest, resolveChunk);
  if (!verification.valid) {
    throw new Error(`Chunk manifest verification failed: ${verification.errors.join('; ')}`);
  }
  const parts: Buffer[] = [];
  for (const entry of manifest.chunks) {
    const chunk = await resolveChunk(entry.sha256);
    if (!chunk) {
      throw new Error(`Chunk ${entry.sha256} disappeared during reassembly`);
    }
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts, manifest.totalBytes);
}
