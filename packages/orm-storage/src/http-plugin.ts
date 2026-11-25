import {
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
  type AuthenticatedContext,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import { verifyChunkManifest, type ChunkManifest } from './encrypted-vault.js';

export const storageVaultHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/storage/vault/manifest/verify', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { manifest, chunks } = req.body;
    if (!isRecord(manifest)) {
      return reply.code(400).send({ success: false, error: 'manifest object is required' });
    }

    if (
      manifest.version !== 1 ||
      typeof manifest.tenantId !== 'string' ||
      typeof manifest.chunkSize !== 'number' ||
      typeof manifest.totalBytes !== 'number' ||
      typeof manifest.rootSha256 !== 'string' ||
      !Array.isArray(manifest.chunks)
    ) {
      return reply.code(400).send({ success: false, error: 'Invalid ChunkManifest structure' });
    }

    // Tenant check against company context: manifest.tenantId must match companyId or string representation
    if (
      manifest.tenantId !== String(auth.companyId) &&
      manifest.tenantId !== `tenant-${auth.companyId}`
    ) {
      // Allow tenantId matching if auth is superadmin/system or matches
      if (
        auth.role !== 'system' &&
        auth.role !== 'superadmin' &&
        manifest.tenantId !== String(auth.companyId)
      ) {
        return reply
          .code(403)
          .send({ success: false, error: 'Cross-tenant vault verification is forbidden' });
      }
    }

    // Chunks can be provided as a map of sha256 -> base64 or hex string
    const chunkMap = new Map<string, Buffer>();
    if (isRecord(chunks)) {
      for (const [hash, data] of Object.entries(chunks)) {
        if (typeof data === 'string') {
          // Assume base64 or utf8/hex
          const buf = Buffer.from(data, 'base64');
          chunkMap.set(hash, buf);
        }
      }
    }

    try {
      const verification = await verifyChunkManifest(
        manifest as unknown as ChunkManifest,
        (sha256: string) => chunkMap.get(sha256)
      );

      // Return verification result (verification-only, never leaks keys or plaintext)
      return reply.code(200).send({
        success: true,
        data: {
          valid: verification.valid,
          verifiedChunks: verification.verifiedChunks,
          totalBytes: verification.totalBytes,
          errors: verification.errors,
        },
      });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};
