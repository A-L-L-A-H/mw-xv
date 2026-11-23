import { createHash, randomUUID } from 'node:crypto';
import type { AddonHttpPlugin } from '@moonwitness/orm';
import { OutboxEvent } from '@moonwitness/jobs';
import { AuditLog } from '@moonwitness/orm-base';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import {
  AcceptanceCriterion,
  Agent,
  AgentRun,
  ArtifactManifest,
  CapabilityGrant,
  ExecutionPolicy,
  ModelProfile,
  Obligation,
  ProviderProfile,
  WorkContract,
  type ArtifactKind,
  type DataClassification,
  type RunStatus,
} from './models.js';
import {
  isActiveCapabilityGrant,
  isValidAiMutation,
  isValidSha256,
  isValidStorageKey,
} from './validation.js';
import { evaluateProofGateV2, isRecord, requireAiCompanyContext } from './ai-http-helpers.js';

export const AI_DESKTOP_SYNC_ROUTE_PREFIXES = ['/api/ai', '/ai'] as const;

interface SyncArtifactInput {
  readonly storageKey: string;
  readonly artifactKind: ArtifactKind;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly dataClassification: DataClassification;
  readonly sourceSha?: string;
  readonly relativePath?: string;
  readonly content?: string;
  readonly encoding?: 'utf8' | 'base64';
  readonly verificationStatus?: string;
}

function computeCanonicalEnvelopeSha256(payload: {
  readonly envelopeId: string;
  readonly companyId: number;
  readonly workContractId: number;
  readonly agentRunId: string;
  readonly agentId: number;
  readonly correlationId: string;
  readonly modelName: string;
  readonly fencingToken: number;
  readonly runStatus: string;
  readonly artifacts: readonly SyncArtifactInput[];
}): string {
  const canonical = JSON.stringify({
    envelopeId: payload.envelopeId,
    companyId: payload.companyId,
    workContractId: payload.workContractId,
    agentRunId: payload.agentRunId,
    agentId: payload.agentId,
    correlationId: payload.correlationId,
    modelName: payload.modelName,
    fencingToken: payload.fencingToken,
    runStatus: payload.runStatus,
    artifacts: payload.artifacts.map((artifact) => ({
      storageKey: artifact.storageKey,
      artifactKind: artifact.artifactKind,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      mimeType: artifact.mimeType,
      dataClassification: artifact.dataClassification,
      sourceSha: artifact.sourceSha ?? null,
      relativePath: artifact.relativePath ?? null,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export const aiDesktopSyncHttpPlugin: AddonHttpPlugin = async (app, options) => {
  const attachmentStorage = options?.attachmentStorage as AttachmentStorage | undefined;

  for (const prefix of AI_DESKTOP_SYNC_ROUTE_PREFIXES) {
    // =========================================================================
    // 1. POST /api/ai/desktop/lease — Claim or renew monotonic fencing token lease
    // =========================================================================
    app.post(`${prefix}/desktop/lease`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const body = isRecord(req.body) ? req.body : {};
      const contractId = Number(body.workContractId ?? body.work_contract_id);
      const agentId = Number(body.agentId ?? body.agent_id);
      const grantId = Number(body.capabilityGrantId ?? body.capability_grant_id);

      const [contract, agent, grant] = await Promise.all([
        WorkContract.query().findOne({ id: contractId, company_id: ctx.companyId, active: true }),
        Agent.query().findOne({ id: agentId, company_id: ctx.companyId, active: true }),
        CapabilityGrant.query().findOne({ id: grantId, company_id: ctx.companyId, active: true }),
      ]);
      if (!contract || !agent || !grant) {
        return reply.code(404).send({
          success: false,
          error: 'Work contract, agent, or capability grant not found in company',
        });
      }
      if (agent.is_emergency_stopped || agent.status !== 'active') {
        return reply.code(403).send({
          success: false,
          error: 'Agent is not active or has been emergency-stopped',
        });
      }
      const policy = await ExecutionPolicy.query().findOne({
        id: grant.execution_policy_id,
        company_id: ctx.companyId,
      });
      if (
        !policy ||
        !isActiveCapabilityGrant(grant, {
          companyId: ctx.companyId,
          agentId: agent.id,
          workContractId: contract.id,
          capability: grant.capability,
          expectedPolicyVersion: policy.policy_version,
        })
      ) {
        return reply.code(403).send({
          success: false,
          error: 'Capability grant is expired, revoked, or invalid for this lease',
        });
      }

      let provider = await ProviderProfile.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('id', 'asc')
        .first();
      if (!provider) {
        provider = await ProviderProfile.query().insertAndFetch({
          company_id: ctx.companyId,
          code: 'desktop_local_provider',
          name: 'Desktop Local Provider',
          kind: 'mock',
          secret_ref: 'MW_AI_MOCK_UNUSED',
          data_classification: 'local_only',
          enabled: true,
        });
      }
      let modelProfile = await ModelProfile.query()
        .where({ company_id: ctx.companyId, provider_profile_id: provider.id, active: true })
        .orderBy('id', 'asc')
        .first();
      if (!modelProfile) {
        modelProfile = await ModelProfile.query().insertAndFetch({
          company_id: ctx.companyId,
          provider_profile_id: provider.id,
          code: 'desktop_local_model',
          name: 'Desktop Local Model',
          model_id: 'mock-deterministic-v1',
          enabled: true,
        });
      }

      const idempotencyKey =
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim()
          : typeof body.agentRunId === 'string' && body.agentRunId.trim()
            ? body.agentRunId.trim()
            : `desktop-lease-${randomUUID()}`;
      const correlationId =
        typeof body.correlationId === 'string' && body.correlationId.trim()
          ? body.correlationId.trim()
          : `corr-${randomUUID()}`;

      const existingRun = await AgentRun.query().findOne({
        company_id: ctx.companyId,
        idempotency_key: idempotencyKey,
      });

      const nowIso = new Date().toISOString();
      const run = existingRun
        ? await AgentRun.query().patchAndFetchById(existingRun.id, {
            fencing_token: (existingRun.fencing_token ?? 0) + 1,
            status: 'running',
            started_at: existingRun.started_at ?? nowIso,
          })
        : await AgentRun.query().insertAndFetch({
            company_id: ctx.companyId,
            work_contract_id: contract.id,
            agent_id: agent.id,
            capability_grant_id: grant.id,
            provider_profile_id: provider.id,
            model_profile_id: modelProfile.id,
            execution_policy_id: policy.id,
            idempotency_key: idempotencyKey,
            correlation_id: correlationId,
            status: 'running',
            fencing_token: 1,
            started_at: nowIso,
          });

      return {
        success: true,
        data: {
          agentRunId: run.id,
          idempotencyKey: run.idempotency_key ?? idempotencyKey,
          companyId: ctx.companyId,
          workContractId: contract.id,
          agentId: agent.id,
          fencingToken: run.fencing_token,
          leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      };
    });

    // =========================================================================
    // 2. GET /api/ai/desktop/pull — Pull company-scoped policies, grants & work
    // =========================================================================
    app.get(`${prefix}/desktop/pull`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;

      const [
        agents,
        workContracts,
        acceptanceCriteria,
        capabilityGrants,
        executionPolicies,
        providerProfiles,
        modelProfiles,
        obligations,
      ] = await Promise.all([
        Agent.query().where({ company_id: ctx.companyId, active: true }),
        WorkContract.query().where({ company_id: ctx.companyId, active: true }),
        AcceptanceCriterion.query().where({ company_id: ctx.companyId, active: true }),
        CapabilityGrant.query().where({ company_id: ctx.companyId, active: true }),
        ExecutionPolicy.query().where({ company_id: ctx.companyId, active: true }),
        ProviderProfile.query().where({ company_id: ctx.companyId, active: true }),
        ModelProfile.query().where({ company_id: ctx.companyId, active: true }),
        Obligation.query().where({ company_id: ctx.companyId, active: true }),
      ]);

      return {
        success: true,
        data: {
          companyId: ctx.companyId,
          pulledAt: new Date().toISOString(),
          agents,
          workContracts,
          acceptanceCriteria,
          capabilityGrants,
          executionPolicies,
          providerProfiles,
          modelProfiles,
          obligations,
        },
      };
    });

    // =========================================================================
    // 3. POST /api/ai/desktop/artifacts/upload — Upload & recompute SHA-256
    // =========================================================================
    app.post(`${prefix}/desktop/artifacts/upload`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const body = isRecord(req.body) ? req.body : {};
      const nestedArtifact = isRecord(body.artifact) ? body.artifact : {};

      if (
        body.verification_status === 'accepted' ||
        body.verificationStatus === 'accepted' ||
        nestedArtifact.verification_status === 'accepted' ||
        nestedArtifact.verificationStatus === 'accepted'
      ) {
        return reply.code(403).send({
          success: false,
          error:
            'Desktop sidecar cannot mark artifacts as accepted; independent verification required',
        });
      }

      const workContractId = Number(
        body.workContractId ??
          body.work_contract_id ??
          nestedArtifact.workContractId ??
          nestedArtifact.work_contract_id
      );
      const contract = await WorkContract.query().findOne({
        id: workContractId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!contract) {
        return reply.code(404).send({
          success: false,
          error: 'Work contract not found in active company',
        });
      }

      const rawStorageKey =
        body.storageKey ??
        body.storage_key ??
        nestedArtifact.storageKey ??
        nestedArtifact.storage_key;
      const storageKey =
        typeof rawStorageKey === 'string' && rawStorageKey.trim()
          ? rawStorageKey.trim().toLowerCase()
          : randomUUID();
      if (!isValidStorageKey(storageKey)) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid artifact storageKey UUID',
        });
      }

      const hasBase64Field = typeof body.contentBase64 === 'string';
      const rawContent = hasBase64Field ? body.contentBase64 : body.content;
      if (typeof rawContent !== 'string') {
        return reply.code(400).send({
          success: false,
          error: 'Artifact content string is required for upload verification',
        });
      }
      const encoding = hasBase64Field || body.encoding === 'base64' ? 'base64' : 'utf8';
      const bytes = Buffer.from(rawContent, encoding);
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');

      const expectedSha256 = String(
        body.expectedSha256 ??
          body.sha256 ??
          nestedArtifact.expectedSha256 ??
          nestedArtifact.sha256 ??
          ''
      ).toLowerCase();
      if (!isValidSha256(expectedSha256)) {
        return reply.code(400).send({
          success: false,
          error: 'Valid 64-character hex expectedSha256 / sha256 is required',
        });
      }
      if (actualSha256 !== expectedSha256) {
        return reply.code(409).send({
          success: false,
          code: 'SHA256_MISMATCH',
          error: `Recomputed artifact SHA-256 (${actualSha256}) does not match expected digest (${expectedSha256})`,
          expectedSha256,
          actualSha256,
        });
      }

      const declaredSizeBytes = body.sizeBytes ?? nestedArtifact.sizeBytes;
      if (
        typeof declaredSizeBytes === 'number' &&
        Number.isSafeInteger(declaredSizeBytes) &&
        declaredSizeBytes !== bytes.byteLength
      ) {
        return reply.code(409).send({
          success: false,
          code: 'SIZE_MISMATCH',
          error: `Artifact byte length (${bytes.byteLength}) does not match declared sizeBytes (${declaredSizeBytes})`,
        });
      }

      if (attachmentStorage) {
        await attachmentStorage.put(storageKey, bytes);
      }

      const rawKind =
        body.artifactKind ??
        body.artifact_kind ??
        nestedArtifact.artifactKind ??
        nestedArtifact.artifact_kind;
      const artifactKind = (
        typeof rawKind === 'string' ? rawKind : 'evidence_bundle'
      ) as ArtifactKind;
      const rawClassification =
        body.dataClassification ??
        body.data_classification ??
        nestedArtifact.dataClassification ??
        nestedArtifact.data_classification;
      const dataClassification = (
        typeof rawClassification === 'string' ? rawClassification : contract.data_classification
      ) as DataClassification;

      const existing = await ArtifactManifest.query().findOne({
        company_id: ctx.companyId,
        storage_key: storageKey,
      });
      if (existing) {
        if (existing.sha256.toLowerCase() !== actualSha256) {
          return reply.code(409).send({
            success: false,
            code: 'IMMUTABLE_ARTIFACT_CONFLICT',
            error: 'Existing artifact storage_key already exists with a different SHA-256 digest',
          });
        }
        return reply.code(200).send({
          success: true,
          storageKey: existing.storage_key,
          sha256: existing.sha256,
          sizeBytes: existing.size_bytes,
          data: existing,
        });
      }

      const rawMimeType =
        body.mimeType ?? body.mime_type ?? nestedArtifact.mimeType ?? nestedArtifact.mime_type;
      const mutation = {
        company_id: ctx.companyId,
        work_contract_id: contract.id,
        ...(typeof body.acceptanceCriterionId === 'number'
          ? { acceptance_criterion_id: body.acceptanceCriterionId }
          : {}),
        ...(typeof body.agentRunId === 'number' ? { agent_run_id: body.agentRunId } : {}),
        ...(typeof body.producerAgentId === 'number'
          ? { producer_agent_id: body.producerAgentId }
          : {}),
        artifact_kind: artifactKind,
        storage_key: storageKey,
        sha256: actualSha256,
        size_bytes: bytes.byteLength,
        mime_type: typeof rawMimeType === 'string' ? rawMimeType : 'application/json',
        data_classification: dataClassification,
        verification_status: 'produced' as const,
        ...(typeof body.sourceSha === 'string' ? { source_sha: body.sourceSha } : {}),
      };

      if (!(await isValidAiMutation(ArtifactManifest.modelName, mutation))) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid artifact manifest metadata',
        });
      }

      const created = await ArtifactManifest.query().insertAndFetch(mutation);
      return reply.code(201).send({
        success: true,
        storageKey: created.storage_key,
        sha256: created.sha256,
        sizeBytes: created.size_bytes,
        data: created,
      });
    });

    // =========================================================================
    // 4. POST /api/ai/desktop/pcw-sync — Reconcile PCW envelope & fencing token
    // =========================================================================
    app.post(`${prefix}/desktop/pcw-sync`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      const body = isRecord(req.body) ? req.body : {};

      const nestedProof = isRecord(body.proof)
        ? body.proof
        : isRecord(body.proofGate)
          ? body.proofGate
          : null;
      if (
        body.runStatus === 'accepted' ||
        body.contractStatus === 'accepted' ||
        body.requestedContractStatus === 'accepted' ||
        body.verificationStatus === 'accepted' ||
        body.status === 'accepted' ||
        nestedProof?.status === 'accepted' ||
        nestedProof?.verificationStatus === 'accepted'
      ) {
        return reply.code(403).send({
          success: false,
          error:
            'Desktop sidecar cannot transition work contracts or runs directly to accepted (DSK-3.8)',
        });
      }

      const workContractId = Number(body.workContractId ?? body.work_contract_id);
      const agentId = Number(body.agentId ?? body.agent_id);
      const fencingToken = Number(body.fencingToken ?? body.fencing_token);
      if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
        return reply.code(400).send({
          success: false,
          error: 'Positive integer fencingToken is required',
        });
      }

      const [contract, agent] = await Promise.all([
        WorkContract.query().findOne({
          id: workContractId,
          company_id: ctx.companyId,
          active: true,
        }),
        Agent.query().findOne({ id: agentId, company_id: ctx.companyId, active: true }),
      ]);
      if (!contract || !agent) {
        return reply.code(404).send({
          success: false,
          error: 'Work contract or agent not found in active company',
        });
      }
      if (agent.is_emergency_stopped) {
        return reply.code(409).send({
          success: false,
          outcome: 'conflict',
          error: 'Agent is emergency-stopped; PCW sync rejected',
        });
      }

      const desktopProofError = evaluateProofGateV2(body, contract.scope_json, 'sync');
      if (desktopProofError) {
        return reply.code(desktopProofError.statusCode).send({
          success: false,
          outcome: 'rejected',
          code: desktopProofError.code,
          error: desktopProofError.error,
          ...(desktopProofError.details ? desktopProofError.details : {}),
        });
      }

      const rawArtifacts = Array.isArray(body.artifacts) ? body.artifacts : [];
      if (rawArtifacts.length === 0) {
        return reply.code(400).send({
          success: false,
          error: 'PCW sync envelope must include at least one artifact digest',
        });
      }

      const artifacts: SyncArtifactInput[] = [];
      for (const item of rawArtifacts) {
        if (!isRecord(item)) {
          return reply.code(400).send({ success: false, error: 'Malformed artifact in envelope' });
        }
        if (item.verificationStatus === 'accepted' || item.verification_status === 'accepted') {
          return reply.code(403).send({
            success: false,
            error: 'Desktop sidecar cannot self-approve artifact verification_status to accepted',
          });
        }
        const storageKey = String(item.storageKey ?? item.storage_key ?? '').toLowerCase();
        const sha256 = String(item.sha256 ?? '').toLowerCase();
        const sizeBytes = Number(item.sizeBytes ?? item.size_bytes ?? -1);
        if (!isValidStorageKey(storageKey) || !isValidSha256(sha256) || sizeBytes < 0) {
          return reply.code(400).send({
            success: false,
            error: `Invalid artifact digest or storageKey for '${storageKey}'`,
          });
        }
        artifacts.push({
          storageKey,
          artifactKind: (typeof item.artifactKind === 'string'
            ? item.artifactKind
            : 'evidence_bundle') as ArtifactKind,
          sha256,
          sizeBytes,
          mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'application/json',
          dataClassification: (typeof item.dataClassification === 'string'
            ? item.dataClassification
            : contract.data_classification) as DataClassification,
          ...(typeof item.sourceSha === 'string' ? { sourceSha: item.sourceSha } : {}),
          ...(typeof item.relativePath === 'string' ? { relativePath: item.relativePath } : {}),
          ...(typeof item.content === 'string' ? { content: item.content } : {}),
          ...(item.encoding === 'base64' || item.encoding === 'utf8'
            ? { encoding: item.encoding }
            : {}),
        });
      }

      const envelopeId =
        typeof body.envelopeId === 'string' && body.envelopeId.trim()
          ? body.envelopeId.trim()
          : randomUUID();
      const agentRunKey = String(body.agentRunId ?? body.agent_run_id ?? envelopeId);
      const correlationId =
        typeof body.correlationId === 'string' && body.correlationId.trim()
          ? body.correlationId.trim()
          : `corr-${envelopeId}`;
      const modelName = typeof body.modelName === 'string' ? body.modelName : 'ai.agent_run';
      const allowedRunStatuses = new Set([
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
      ]);
      const runStatus = (
        typeof body.runStatus === 'string' && allowedRunStatuses.has(body.runStatus)
          ? body.runStatus
          : 'completed'
      ) as RunStatus;

      if (typeof body.envelopeSha256 === 'string' && body.envelopeSha256.trim()) {
        const expectedEnvelopeSha = computeCanonicalEnvelopeSha256({
          envelopeId,
          companyId: ctx.companyId,
          workContractId: contract.id,
          agentRunId: agentRunKey,
          agentId: agent.id,
          correlationId,
          modelName,
          fencingToken,
          runStatus,
          artifacts,
        });
        if (expectedEnvelopeSha !== body.envelopeSha256.toLowerCase()) {
          return reply.code(409).send({
            success: false,
            outcome: 'conflict',
            code: 'ENVELOPE_SHA256_MISMATCH',
            error: 'PCW envelope SHA-256 integrity check failed',
          });
        }
      }

      const inlineMap = isRecord(body.artifactContents) ? body.artifactContents : null;
      for (const artifact of artifacts) {
        const inlineContent =
          artifact.content ??
          (inlineMap && typeof inlineMap[artifact.storageKey] === 'string'
            ? (inlineMap[artifact.storageKey] as string)
            : undefined);

        if (inlineContent !== undefined) {
          const bytes = Buffer.from(inlineContent, artifact.encoding ?? 'utf8');
          const recomputedSha = createHash('sha256').update(bytes).digest('hex');
          if (recomputedSha !== artifact.sha256 || bytes.byteLength !== artifact.sizeBytes) {
            return reply.code(409).send({
              success: false,
              outcome: 'conflict',
              code: 'ARTIFACT_DIGEST_MISMATCH',
              error: `Artifact '${artifact.storageKey}' SHA-256 or byte size mismatch`,
            });
          }
          if (attachmentStorage) {
            await attachmentStorage.put(artifact.storageKey, bytes);
          }
        } else if (attachmentStorage) {
          const storedBytes = await attachmentStorage.get(artifact.storageKey);
          if (storedBytes) {
            const recomputedSha = createHash('sha256').update(storedBytes).digest('hex');
            if (
              recomputedSha !== artifact.sha256 ||
              storedBytes.byteLength !== artifact.sizeBytes
            ) {
              return reply.code(409).send({
                success: false,
                outcome: 'conflict',
                code: 'ARTIFACT_DIGEST_MISMATCH',
                error: `Stored artifact '${artifact.storageKey}' SHA-256 or byte size mismatch`,
              });
            }
          } else if (body.requireUploadedBlobs === true) {
            return reply.code(409).send({
              success: false,
              outcome: 'conflict',
              code: 'ARTIFACT_BLOB_MISSING',
              error: `Artifact '${artifact.storageKey}' has not been uploaded to storage`,
            });
          }
        }
      }

      const numericRunId = /^\d+$/u.test(agentRunKey) ? Number(agentRunKey) : null;
      let existingRun =
        numericRunId !== null
          ? await AgentRun.query().findOne({ id: numericRunId, company_id: ctx.companyId })
          : undefined;
      if (!existingRun) {
        existingRun = await AgentRun.query().findOne({
          company_id: ctx.companyId,
          idempotency_key: agentRunKey,
        });
      }

      if (existingRun && existingRun.fencing_token > fencingToken) {
        return reply.code(409).send({
          success: false,
          outcome: 'conflict',
          code: 'STALE_FENCING_TOKEN',
          error: `Stale fencing token ${fencingToken} < current ${existingRun.fencing_token}`,
          currentFencingToken: existingRun.fencing_token,
        });
      }

      const nowIso = new Date().toISOString();
      let run = existingRun;
      if (run) {
        run = await AgentRun.query().patchAndFetchById(run.id, {
          fencing_token: fencingToken,
          status: runStatus,
          finished_at:
            runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled'
              ? nowIso
              : run.finished_at,
        });
      } else {
        const grant =
          (await CapabilityGrant.query()
            .where({ company_id: ctx.companyId, agent_id: agent.id, active: true })
            .orderBy('id', 'desc')
            .first()) ??
          (await CapabilityGrant.query().insertAndFetch({
            company_id: ctx.companyId,
            agent_id: agent.id,
            work_contract_id: contract.id,
            execution_policy_id: contract.execution_policy_id,
            capability: 'repo.read@v1',
            policy_version: 1,
            issued_by_id: ctx.userId,
            issued_at: nowIso,
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            status: 'active',
          }));
        let provider = await ProviderProfile.query()
          .where({ company_id: ctx.companyId, active: true })
          .first();
        if (!provider) {
          provider = await ProviderProfile.query().insertAndFetch({
            company_id: ctx.companyId,
            code: 'desktop_sync_provider',
            name: 'Desktop Sync Provider',
            kind: 'mock',
            secret_ref: 'MW_AI_MOCK_UNUSED',
            data_classification: 'local_only',
            enabled: true,
          });
        }
        let modelProfile = await ModelProfile.query()
          .where({ company_id: ctx.companyId, provider_profile_id: provider.id, active: true })
          .first();
        if (!modelProfile) {
          modelProfile = await ModelProfile.query().insertAndFetch({
            company_id: ctx.companyId,
            provider_profile_id: provider.id,
            code: 'desktop_sync_model',
            name: 'Desktop Sync Model',
            model_id: 'mock-deterministic-v1',
            enabled: true,
          });
        }
        run = await AgentRun.query().insertAndFetch({
          company_id: ctx.companyId,
          work_contract_id: contract.id,
          agent_id: agent.id,
          capability_grant_id: grant.id,
          provider_profile_id: provider.id,
          model_profile_id: modelProfile.id,
          execution_policy_id: contract.execution_policy_id,
          idempotency_key: agentRunKey,
          correlation_id: correlationId,
          status: runStatus,
          fencing_token: fencingToken,
          started_at: nowIso,
          ...(runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled'
            ? { finished_at: nowIso }
            : {}),
        });
      }

      const persistedArtifacts = [];
      for (const artifact of artifacts) {
        const existingArtifact = await ArtifactManifest.query().findOne({
          company_id: ctx.companyId,
          storage_key: artifact.storageKey,
        });
        if (existingArtifact) {
          if (existingArtifact.sha256.toLowerCase() !== artifact.sha256) {
            return reply.code(409).send({
              success: false,
              outcome: 'conflict',
              code: 'IMMUTABLE_ARTIFACT_CONFLICT',
              error: `Artifact '${artifact.storageKey}' already exists with a different SHA-256 digest`,
            });
          }
          persistedArtifacts.push(existingArtifact);
        } else {
          const createdArtifact = await ArtifactManifest.query().insertAndFetch({
            company_id: ctx.companyId,
            work_contract_id: contract.id,
            agent_run_id: run.id,
            producer_agent_id: agent.id,
            artifact_kind: artifact.artifactKind,
            storage_key: artifact.storageKey,
            sha256: artifact.sha256,
            size_bytes: artifact.sizeBytes,
            mime_type: artifact.mimeType,
            data_classification: artifact.dataClassification,
            verification_status: 'produced',
            ...(artifact.sourceSha ? { source_sha: artifact.sourceSha } : {}),
          });
          persistedArtifacts.push(createdArtifact);
        }
      }

      if (
        contract.status === 'draft' ||
        contract.status === 'queued' ||
        contract.status === 'running'
      ) {
        const nextContractStatus = runStatus === 'completed' ? 'in_review' : 'running';
        await WorkContract.query().findById(contract.id).patch({
          status: nextContractStatus,
        });
      }

      await OutboxEvent.query().insert({
        event_type: 'ai.desktop.pcw_synced',
        aggregate_model: AgentRun.modelName,
        aggregate_id: run.id,
        company_id: ctx.companyId,
        actor_id: ctx.userId,
        payload: JSON.stringify({
          envelopeId,
          workContractId: contract.id,
          agentRunId: run.id,
          fencingToken: run.fencing_token,
          artifactCount: persistedArtifacts.length,
        }),
        status: 'pending',
        available_at: nowIso,
        created_at: nowIso,
      });

      await AuditLog.query().insert({
        model: AgentRun.modelName,
        record_id: run.id,
        operation: 'desktop_pcw_sync',
        actor_id: ctx.userId,
        changes: JSON.stringify({
          envelopeId,
          fencingToken: run.fencing_token,
          runStatus: run.status,
          artifactCount: persistedArtifacts.length,
        }),
      });

      return {
        success: true,
        outcome: 'synced' as const,
        envelopeId,
        upstreamRecordId: run.id,
        fencingToken: run.fencing_token,
        runStatus: run.status,
        artifactCount: persistedArtifacts.length,
        data: {
          outcome: 'synced' as const,
          envelopeId,
          upstreamRecordId: run.id,
          fencingToken: run.fencing_token,
          runStatus: run.status,
          artifactCount: persistedArtifacts.length,
        },
      };
    });
  }
};
