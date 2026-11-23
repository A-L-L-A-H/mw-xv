import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildChunkManifest,
  decryptArtifactEnvelope,
  encryptArtifactEnvelope,
  reassembleChunkManifest,
  verifyChunkManifest,
} from '../src/encrypted-vault.js';

describe('AES-256-GCM Encrypted Artifact Vault & Content-Addressable Chunks', () => {
  const masterKey = randomBytes(32);

  it('encrypts and decrypts an artifact envelope with random 96-bit IVs and AAD tenant binding', () => {
    const plaintext = Buffer.from('confidential-evidence-payload-12345', 'utf8');

    const env1 = encryptArtifactEnvelope(plaintext, {
      keyId: 'kek-2026-01',
      tenantId: 'tenant-alpha',
      artifactId: 'art-001',
      masterKey,
    });
    const env2 = encryptArtifactEnvelope(plaintext, {
      keyId: 'kek-2026-01',
      tenantId: 'tenant-alpha',
      artifactId: 'art-001',
      masterKey,
    });

    // Random 96-bit IVs must differ across encryptions
    expect(Buffer.from(env1.ivBase64, 'base64').byteLength).toBe(12);
    expect(env1.ivBase64).not.toBe(env2.ivBase64);
    expect(env1.ciphertextBase64).not.toBe(env2.ciphertextBase64);

    const decrypted = decryptArtifactEnvelope(env1, {
      expectedTenantId: 'tenant-alpha',
      expectedArtifactId: 'art-001',
      masterKey,
    });
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('rejects tampered ciphertext, tampered authTag, and mismatched tenant AAD', () => {
    const plaintext = Buffer.from('immutable-audit-record', 'utf8');
    const envelope = encryptArtifactEnvelope(plaintext, {
      keyId: 'kek-2026-01',
      tenantId: 'tenant-alpha',
      masterKey,
    });

    // Tampered ciphertext
    const rawCt = Buffer.from(envelope.ciphertextBase64, 'base64');
    rawCt[0] = rawCt[0]! ^ 0xff;
    expect(() =>
      decryptArtifactEnvelope(
        { ...envelope, ciphertextBase64: rawCt.toString('base64') },
        { expectedTenantId: 'tenant-alpha', masterKey }
      )
    ).toThrow();

    // Tampered auth tag
    const rawTag = Buffer.from(envelope.authTagBase64, 'base64');
    rawTag[0] = rawTag[0]! ^ 0x01;
    expect(() =>
      decryptArtifactEnvelope(
        { ...envelope, authTagBase64: rawTag.toString('base64') },
        { expectedTenantId: 'tenant-alpha', masterKey }
      )
    ).toThrow();

    // Cross-tenant AAD mismatch
    expect(() =>
      decryptArtifactEnvelope(
        { ...envelope, tenantId: 'tenant-beta' },
        { expectedTenantId: 'tenant-beta', masterKey }
      )
    ).toThrow();
  });

  it('builds content-addressable SHA-256 chunk manifests, deduplicates chunks, and verifies integrity', async () => {
    const repeatedBlock = Buffer.alloc(1024, 0xab);
    const uniqueBlock = Buffer.from('trailing-unique-bytes', 'utf8');
    const payload = Buffer.concat([repeatedBlock, repeatedBlock, uniqueBlock]);

    const { manifest, chunkStore } = buildChunkManifest(payload, {
      tenantId: 'tenant-alpha',
      chunkSize: 1024,
      contentType: 'application/octet-stream',
    });

    expect(manifest.chunks.length).toBe(3);
    // First two chunks are identical -> deduplicated in chunkStore
    expect(chunkStore.size).toBe(2);
    expect(manifest.totalBytes).toBe(payload.byteLength);

    const verification = await verifyChunkManifest(manifest, (sha) => chunkStore.get(sha));
    expect(verification.valid).toBe(true);
    expect(verification.verifiedChunks).toBe(3);
    expect(verification.totalBytes).toBe(payload.byteLength);

    const reassembled = await reassembleChunkManifest(manifest, (sha) => chunkStore.get(sha));
    expect(reassembled.equals(payload)).toBe(true);
  });

  it('detects corrupted chunks and missing chunks during manifest verification', async () => {
    const payload = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
    const { manifest, chunkStore } = buildChunkManifest(payload, {
      tenantId: 'tenant-alpha',
      chunkSize: 16,
    });

    // Corrupt first chunk
    const corruptedStore = new Map(chunkStore);
    const firstSha = manifest.chunks[0]!.sha256;
    corruptedStore.set(firstSha, Buffer.from('XXXXXXXXXXXXXXXX', 'utf8'));

    const corruptResult = await verifyChunkManifest(manifest, (sha) => corruptedStore.get(sha));
    expect(corruptResult.valid).toBe(false);
    expect(corruptResult.errors.some((e) => e.includes('digest mismatch'))).toBe(true);

    // Missing chunk
    const missingStore = new Map(chunkStore);
    missingStore.delete(firstSha);
    const missingResult = await verifyChunkManifest(manifest, (sha) => missingStore.get(sha));
    expect(missingResult.valid).toBe(false);
    expect(missingResult.errors.some((e) => e.includes('Missing chunk'))).toBe(true);
  });
});
