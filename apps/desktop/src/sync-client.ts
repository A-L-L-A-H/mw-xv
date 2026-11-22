import { createHash } from 'node:crypto';
import { AccessDeniedError, ValidationError } from '@moonwitness/types';
import type { LocalTodoTaskSnapshot } from '@moonwitness/orm-project';
import { redactSensitiveText } from './risk-gate.js';
import type {
  DesktopArtifactUploadRequest,
  DesktopArtifactUploadResponse,
  DesktopLeaseClaimRequest,
  DesktopLeaseClaimResponse,
  DesktopPullSyncRequest,
  DesktopPullSyncResponse,
  PcwSyncEnvelope,
  UpstreamPcwSyncResult,
  UpstreamPcwSyncTransport,
} from './types.js';

const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

export interface QuarantinedEnvelopeRecord {
  readonly envelopeId: string;
  readonly companyId: number;
  readonly agentRunId: string;
  readonly reason: string;
  readonly quarantinedAt: string;
}

export interface DesktopUpstreamSyncClientOptions {
  readonly apiBaseUrl: string;
  readonly authToken?: string | (() => string | null | undefined);
  readonly fetchImpl?: typeof fetch;
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly timeoutMs?: number;
  readonly knownSecrets?: readonly string[];
  readonly sleepImpl?: (delayMs: number) => Promise<void>;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function normalizeBaseUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError(`Invalid upstream apiBaseUrl: '${rawUrl}'`);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new AccessDeniedError(`Unsafe upstream apiBaseUrl rejected: '${rawUrl}'`);
  }
  return parsed.toString().replace(/\/+$/u, '');
}

/**
 * Upstream HTTP/JSON sync transport targeting central `apps/api` (`/api/ai/desktop/*`)
 * with exponential backoff retry and conflict quarantine state tracking (DSK-3.2–DSK-3.11).
 */
export class DesktopUpstreamSyncClient implements UpstreamPcwSyncTransport {
  readonly apiBaseUrl: string;
  private readonly authToken?: string | (() => string | null | undefined);
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly knownSecrets: readonly string[];
  private readonly sleepImpl: (delayMs: number) => Promise<void>;
  private readonly quarantined = new Map<string, QuarantinedEnvelopeRecord>();

  constructor(options: DesktopUpstreamSyncClientOptions) {
    this.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
    this.authToken = options.authToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = Math.max(0, Math.min(10, options.maxRetries ?? 3));
    this.baseDelayMs = Math.max(1, Math.min(30_000, options.baseDelayMs ?? 100));
    this.maxDelayMs = Math.max(this.baseDelayMs, Math.min(60_000, options.maxDelayMs ?? 5000));
    this.timeoutMs = Math.max(100, Math.min(120_000, options.timeoutMs ?? 15_000));
    this.knownSecrets = options.knownSecrets ?? [];
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  async claimWorkContractLease(
    request: DesktopLeaseClaimRequest
  ): Promise<DesktopLeaseClaimResponse> {
    if (!Number.isSafeInteger(request.companyId) || request.companyId <= 0) {
      throw new ValidationError('companyId must be a positive integer');
    }
    if (!Number.isSafeInteger(request.workContractId) || request.workContractId <= 0) {
      throw new ValidationError('workContractId must be a positive integer');
    }
    if (!request.hostId.trim()) {
      throw new ValidationError('hostId is required for lease claim');
    }

    const response = await this.requestWithRetry('/api/ai/desktop/lease', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const detail = await this.readSafeErrorText(response);
      throw new ValidationError(`Lease claim failed (${response.status}): ${detail}`);
    }
    return (await response.json()) as DesktopLeaseClaimResponse;
  }

  async pullCompanySnapshot(request: DesktopPullSyncRequest): Promise<DesktopPullSyncResponse> {
    if (!Number.isSafeInteger(request.companyId) || request.companyId <= 0) {
      throw new ValidationError('companyId must be a positive integer');
    }
    const query = new URLSearchParams({ companyId: String(request.companyId) });
    if (request.sinceCursor) {
      query.set('sinceCursor', request.sinceCursor);
    }

    const response = await this.requestWithRetry(`/api/ai/desktop/pull?${query.toString()}`, {
      method: 'GET',
    });
    if (!response.ok) {
      const detail = await this.readSafeErrorText(response);
      throw new ValidationError(`Desktop pull sync failed (${response.status}): ${detail}`);
    }
    return (await response.json()) as DesktopPullSyncResponse;
  }

  async uploadArtifact(
    request: DesktopArtifactUploadRequest
  ): Promise<DesktopArtifactUploadResponse> {
    if (!Number.isSafeInteger(request.companyId) || request.companyId <= 0) {
      throw new ValidationError('companyId must be a positive integer');
    }
    const decoded = Buffer.from(request.contentBase64, 'base64');
    const computedSha256 = createHash('sha256').update(decoded).digest('hex');
    if (computedSha256 !== request.artifact.sha256) {
      throw new ValidationError(
        `Artifact '${request.artifact.storageKey}' SHA-256 mismatch before upload`
      );
    }

    const response = await this.requestWithRetry('/api/ai/desktop/artifacts/upload', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const detail = await this.readSafeErrorText(response);
      throw new ValidationError(`Artifact upload failed (${response.status}): ${detail}`);
    }
    return (await response.json()) as DesktopArtifactUploadResponse;
  }

  async pushEnvelope(envelope: PcwSyncEnvelope): Promise<UpstreamPcwSyncResult> {
    try {
      const response = await this.requestWithRetry('/api/ai/desktop/pcw-sync', {
        method: 'POST',
        body: JSON.stringify(envelope),
      });

      if (response.status === 409) {
        const reason = await this.readSafeErrorText(response);
        this.quarantineEnvelope(envelope, reason || 'Upstream 409 conflict');
        return {
          outcome: 'conflict',
          message: reason || 'Upstream 409 conflict',
        };
      }

      if (!response.ok) {
        const reason = await this.readSafeErrorText(response);
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429
        ) {
          this.quarantineEnvelope(
            envelope,
            reason || `Upstream rejected with HTTP ${response.status}`
          );
          return {
            outcome: 'conflict',
            message: reason || `Upstream rejected with HTTP ${response.status}`,
          };
        }
        return {
          outcome: 'retryable_error',
          message: reason || `Upstream HTTP ${response.status}`,
        };
      }

      const payload = (await response.json()) as {
        readonly outcome?: 'synced' | 'conflict' | 'retryable_error';
        readonly upstreamRecordId?: number;
        readonly message?: string;
      };
      if (payload.outcome === 'conflict') {
        const reason = redactSensitiveText(
          payload.message ?? 'Upstream payload conflict',
          this.knownSecrets
        ).text;
        this.quarantineEnvelope(envelope, reason);
        return { outcome: 'conflict', message: reason };
      }
      if (payload.outcome === 'retryable_error') {
        return {
          outcome: 'retryable_error',
          message: redactSensitiveText(
            payload.message ?? 'Upstream temporary failure',
            this.knownSecrets
          ).text,
        };
      }
      this.quarantined.delete(envelope.envelopeId);
      return {
        outcome: 'synced',
        ...(payload.upstreamRecordId !== undefined
          ? { upstreamRecordId: payload.upstreamRecordId }
          : {}),
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      return {
        outcome: 'retryable_error',
        message: redactSensitiveText(rawMessage, this.knownSecrets).text,
      };
    }
  }

  async syncTodoTasksToProject(
    projectId: number,
    tasks: readonly LocalTodoTaskSnapshot[],
    defaultStageId?: number
  ): Promise<{ imported: number; updated: number; snapshots: readonly LocalTodoTaskSnapshot[] }> {
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new ValidationError('projectId must be a positive integer');
    }
    const response = await this.requestWithRetry(`/api/projects/${projectId}/todo-sync`, {
      method: 'POST',
      body: JSON.stringify({ default_stage_id: defaultStageId, tasks }),
    });
    if (!response.ok) {
      const detail = await this.readSafeErrorText(response);
      throw new ValidationError(`Todo sync failed (${response.status}): ${detail}`);
    }
    const result = (await response.json()) as {
      success: boolean;
      data: { imported: number; updated: number; snapshots: readonly LocalTodoTaskSnapshot[] };
    };
    return result.data;
  }

  async dispatchTaskWorkContract(
    taskId: number,
    options?: { riskTier?: string; assignedAgentId?: number }
  ): Promise<{ workContractId: number; code: string; status: string; created: boolean }> {
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      throw new ValidationError('taskId must be a positive integer');
    }
    const response = await this.requestWithRetry(`/api/projects/tasks/${taskId}/work-contract`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    });
    if (!response.ok) {
      const detail = await this.readSafeErrorText(response);
      throw new ValidationError(`WorkContract dispatch failed (${response.status}): ${detail}`);
    }
    const result = (await response.json()) as {
      success: boolean;
      created: boolean;
      data: { id: number; code: string; status: string };
    };
    return {
      workContractId: result.data.id,
      code: result.data.code,
      status: result.data.status,
      created: result.created,
    };
  }

  async syncTaskWorkContractStage(
    taskId: number
  ): Promise<{ advanced: boolean; taskStatus: string; workContractStatus: string }> {
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      throw new ValidationError('taskId must be a positive integer');
    }
    const response = await this.requestWithRetry(
      `/api/projects/tasks/${taskId}/work-contract/sync-stage`,
      {
        method: 'POST',
      }
    );
    if (!response.ok) {
      const detail = await this.readSafeErrorText(response);
      throw new ValidationError(`Stage sync failed (${response.status}): ${detail}`);
    }
    const result = (await response.json()) as {
      success: boolean;
      data: { advanced: boolean; task: { status: string }; work_contract: { status: string } };
    };
    return {
      advanced: result.data.advanced,
      taskStatus: result.data.task.status,
      workContractStatus: result.data.work_contract.status,
    };
  }

  getQuarantinedEnvelopes(): readonly QuarantinedEnvelopeRecord[] {
    return [...this.quarantined.values()];
  }

  clearQuarantine(envelopeId: string): boolean {
    return this.quarantined.delete(envelopeId);
  }

  private quarantineEnvelope(envelope: PcwSyncEnvelope, reason: string): void {
    this.quarantined.set(envelope.envelopeId, {
      envelopeId: envelope.envelopeId,
      companyId: envelope.companyId,
      agentRunId: envelope.agentRunId,
      reason: redactSensitiveText(reason, this.knownSecrets).text,
      quarantinedAt: new Date().toISOString(),
    });
  }

  private resolveAuthHeader(): Record<string, string> {
    const token = typeof this.authToken === 'function' ? this.authToken() : this.authToken;
    if (!token || !token.trim()) return {};
    return { authorization: `Bearer ${token.trim()}` };
  }

  private async requestWithRetry(
    endpointPath: string,
    init: { readonly method: 'GET' | 'POST'; readonly body?: string }
  ): Promise<Response> {
    const url = `${this.apiBaseUrl}${endpointPath}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: init.method,
          headers: {
            'content-type': 'application/json',
            ...this.resolveAuthHeader(),
          },
          ...(init.body !== undefined ? { body: init.body } : {}),
          redirect: 'error',
          signal: controller.signal,
        });

        if (!RETRYABLE_HTTP_STATUSES.has(response.status) || attempt === this.maxRetries) {
          return response;
        }
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries) {
          throw error;
        }
      } finally {
        clearTimeout(timer);
      }

      const backoffMs = Math.min(this.maxDelayMs, this.baseDelayMs * Math.pow(2, attempt));
      await this.sleepImpl(backoffMs);
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Upstream request failed after retries');
  }

  private async readSafeErrorText(response: Response): Promise<string> {
    try {
      const raw = await response.text();
      return redactSensitiveText(raw.slice(0, 500), this.knownSecrets).text;
    } catch {
      return `HTTP ${response.status}`;
    }
  }
}
