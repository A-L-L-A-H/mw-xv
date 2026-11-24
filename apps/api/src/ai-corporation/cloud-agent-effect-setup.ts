import { createWorkspaceHttpClient } from '@moonwitness/ai-runtime';
import {
  createCloudAgentEffect,
  createTrustedProviderBinding,
  persistEvidenceBundle,
  setCloudAgentEffect,
  setupCloudAgentSandbox,
} from '@moonwitness/orm-ai';
import { cloudAgentConfig } from '../config/env.js';
import { createAttachmentStorage } from '../storage/attachment-storage.js';

/**
 * Install the real cloud coding-agent effect in the hosting process (API and
 * worker). The sandbox token is read from the configured secret-reference name
 * at bootstrap and lives only in memory: it is never written to ORM, a queue
 * payload, an artifact or a Board DTO.
 *
 * Returns false when the gateway/sandbox is not configured; in that case the
 * historical no-op stub remains in the durable job handler.
 */
export function installCloudAgentEffect(): boolean {
  const sandboxToken = process.env[cloudAgentConfig.sandboxTokenRef];
  const { sandboxImageRef, sandboxSnapshotId, sandboxBaseCommit } = cloudAgentConfig;
  if (
    !sandboxToken ||
    sandboxToken.trim().length === 0 ||
    !sandboxImageRef ||
    !sandboxSnapshotId ||
    !sandboxBaseCommit
  ) {
    console.warn(
      'cloud coding-agent effect disabled: sandbox token, pinned image, snapshot id and base commit are all required'
    );
    return false;
  }

  const storage = createAttachmentStorage();
  const sandboxClient = createWorkspaceHttpClient({
    origin: cloudAgentConfig.sandboxOrigin,
    token: sandboxToken,
  });

  setCloudAgentEffect(
    createCloudAgentEffect({
      sandboxRefs: {
        snapshotId: sandboxSnapshotId,
        baseCommit: sandboxBaseCommit,
        imageRef: sandboxImageRef,
      },
      createProvider: async (snapshot) =>
        createTrustedProviderBinding({
          snapshot,
          gatewayOrigin: cloudAgentConfig.origin,
          approvedOrigins: [cloudAgentConfig.origin],
        }),
      createSandbox: async (params) =>
        setupCloudAgentSandbox({
          ...params,
          client: sandboxClient,
        }),
      persistEvidence: async (bundle, context) =>
        persistEvidenceBundle({
          storage,
          companyId: context.companyId,
          workContractId: context.workContractId,
          agentRunId: context.agentRunId,
          bundle,
          dataClassification: context.dataClassification,
        }),
    })
  );
  return true;
}
