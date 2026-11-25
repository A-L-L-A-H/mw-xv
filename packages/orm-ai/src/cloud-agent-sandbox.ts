import { randomUUID } from 'node:crypto';
import {
  WORKSPACE_LIMITS,
  buildEphemeralSandboxManifest,
  buildWorkspaceEvidence,
  registerWorkspaceTools,
  type CapabilityGateway,
  type EphemeralSandboxManifest,
  type WorkspaceCheckKind,
  type WorkspaceEvidenceBundle,
  type WorkspaceInfo,
  type WorkspaceSandboxClient,
} from '@moonwitness/ai-runtime';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import { sha256Canonical, toCanonicalJson } from '@moonwitness/ai-runtime/canonical-json.js';
import {
  EVIDENCE_VERIFICATION_STATUS as CLOUD_AGENT_EVIDENCE_VERIFICATION_STATUS,
  CLOUD_AGENT_MANIFEST_COMMAND,
  DEFAULT_SANDBOX_CPU_CORES,
  DEFAULT_SANDBOX_MAX_OUTPUT_BYTES,
  DEFAULT_SANDBOX_MEMORY_MB,
  DEFAULT_SANDBOX_PIDS_LIMIT,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from './cloud-agent-defaults.js';
import type { DataClassification } from './models/constants.js';
import { ArtifactManifest } from './models/runs.js';

/** Registry references must be pinned to a sha256 digest before a sandbox is created. */
const PINNED_IMAGE_REF = /@sha256:[a-f0-9]{64}$/iu;

export interface CloudAgentSandboxSetup {
  readonly client: WorkspaceSandboxClient;
  readonly manifest: EphemeralSandboxManifest;
  readonly workspace: WorkspaceInfo;
  readonly tools: readonly string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export async function setupCloudAgentSandbox(options: {
  readonly client: WorkspaceSandboxClient;
  readonly gateway: CapabilityGateway;
  readonly runId: string;
  readonly allowedPaths: readonly string[];
  readonly baseCommit: string;
  readonly snapshotId: string;
  readonly imageRef: string;
  readonly limits?: {
    readonly cpuCores?: number;
    readonly memoryMb?: number;
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
  };
  readonly ownerAddon?: string;
}): Promise<CloudAgentSandboxSetup> {
  if (typeof options.imageRef !== 'string' || !PINNED_IMAGE_REF.test(options.imageRef)) {
    throw new Error('Cloud agent sandbox imageRef must be pinned to a @sha256 digest');
  }
  if (
    options.allowedPaths.length === 0 ||
    options.allowedPaths.length > WORKSPACE_LIMITS.allowedPaths
  ) {
    throw new Error('Cloud agent sandbox requires a bounded non-empty allowedPaths list');
  }

  const requested = options.limits ?? {};
  const cpuCores = clamp(
    requested.cpuCores ?? DEFAULT_SANDBOX_CPU_CORES,
    WORKSPACE_LIMITS.cpuCores.min,
    WORKSPACE_LIMITS.cpuCores.max
  );
  const memoryMb = Math.floor(
    clamp(
      requested.memoryMb ?? DEFAULT_SANDBOX_MEMORY_MB,
      WORKSPACE_LIMITS.memoryMb.min,
      WORKSPACE_LIMITS.memoryMb.max
    )
  );
  const timeoutMs = Math.floor(
    clamp(
      requested.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
      WORKSPACE_LIMITS.timeoutMs.min,
      WORKSPACE_LIMITS.timeoutMs.max
    )
  );
  const maxOutputBytes = Math.floor(
    clamp(
      requested.maxOutputBytes ?? DEFAULT_SANDBOX_MAX_OUTPUT_BYTES,
      WORKSPACE_LIMITS.outputBytes.min,
      WORKSPACE_LIMITS.outputBytes.max
    )
  );
  const pidsLimit = Math.floor(
    clamp(
      DEFAULT_SANDBOX_PIDS_LIMIT,
      WORKSPACE_LIMITS.pidsLimit.min,
      WORKSPACE_LIMITS.pidsLimit.max
    )
  );

  const workspace = await options.client.createWorkspace({
    runId: options.runId,
    snapshotId: options.snapshotId,
    imageRef: options.imageRef,
    baseCommit: options.baseCommit,
    allowedPaths: [...options.allowedPaths],
    cpuCores,
    memoryMb,
    pidsLimit,
    timeoutMs,
    maxOutputBytes,
  });

  const manifest = buildEphemeralSandboxManifest({
    runId: options.runId,
    imageRef: options.imageRef,
    command: CLOUD_AGENT_MANIFEST_COMMAND,
    cpuCores,
    memoryMb,
    timeoutMs,
  });

  const tools = registerWorkspaceTools({
    gateway: options.gateway,
    client: options.client,
    allowedPaths: options.allowedPaths,
    ...(options.ownerAddon ? { ownerAddon: options.ownerAddon } : {}),
  });

  return { client: options.client, manifest, workspace, tools };
}

export async function persistEvidenceBundle(options: {
  readonly storage: AttachmentStorage;
  readonly companyId: number;
  readonly workContractId: number;
  readonly agentRunId: number;
  readonly bundle: WorkspaceEvidenceBundle;
  readonly dataClassification: DataClassification;
}): Promise<{ readonly storageKey: string; readonly sha256: string }> {
  const bytes = Buffer.from(toCanonicalJson(options.bundle), 'utf8');
  const sha256 = sha256Canonical(options.bundle);
  const storageKey = randomUUID();

  await options.storage.put(storageKey, bytes);
  await ArtifactManifest.query().insert({
    company_id: options.companyId,
    work_contract_id: options.workContractId,
    agent_run_id: options.agentRunId,
    artifact_kind: 'evidence_bundle',
    storage_key: storageKey,
    sha256,
    size_bytes: bytes.byteLength,
    mime_type: 'application/json',
    data_classification: options.dataClassification,
    verification_status: CLOUD_AGENT_EVIDENCE_VERIFICATION_STATUS,
  });

  return { storageKey, sha256 };
}

/**
 * Thin compatibility wrapper around the ai-runtime evidence builder, retained
 * for callers and tests that build and verify evidence in a single step. All
 * verification semantics live in `buildWorkspaceEvidence`.
 */
export async function buildAndVerifyWorkspaceEvidence(params: {
  readonly client: WorkspaceSandboxClient;
  readonly manifest: EphemeralSandboxManifest;
  readonly runId: string;
  readonly check: WorkspaceCheckKind;
}): Promise<WorkspaceEvidenceBundle> {
  return buildWorkspaceEvidence(params);
}
