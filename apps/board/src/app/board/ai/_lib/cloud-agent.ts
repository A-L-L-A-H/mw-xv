'use client';

/**
 * Board-side DTOs and actions for the cloud coding-agent workflow.
 * This module never imports ORM, AI runtime, Node filesystem, Docker or
 * inference secrets. Only masked references and server-owned identifiers
 * cross this boundary.
 */
import { client } from '@/lib/client';

export interface CloudProviderDto {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly data_classification: string;
  readonly endpoint_url?: string | null;
  readonly enabled: boolean;
  /** Environment variable reference only; never a raw credential. */
  readonly secret_ref?: string;
  readonly secret_masked?: string;
}

export interface DiscoveredModelDto {
  readonly id: number;
  readonly modelId: string;
  readonly created: boolean;
  readonly secret_reference?: string;
}

export interface CloudRunDto {
  readonly id: number;
  readonly status: string;
  readonly execution_fingerprint?: string | null;
  readonly approval_workflow_id?: number | null;
  readonly job_id?: number | null;
  readonly fencing_token?: number;
  readonly error_code?: string | null;
  readonly error_summary?: string | null;
  readonly started_at?: string | null;
  readonly finished_at?: string | null;
}

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly approval?: { readonly id: number; readonly currentState: string };
  readonly executionFingerprint?: string;
}

function unwrap<T>(payload: unknown): ApiEnvelope<T> {
  if (payload === null || typeof payload !== 'object') {
    throw new Error('Server returned an invalid response');
  }
  return payload as ApiEnvelope<T>;
}

export function maskedReference(value: unknown): string {
  return typeof value === 'string' && /^MW_AI_[A-Z0-9_]+$/u.test(value) ? value : '••••••••';
}

export async function discoverGatewayModels(providerId: number): Promise<DiscoveredModelDto[]> {
  const response = unwrap<DiscoveredModelDto[]>(
    await client.request(`/api/ai/providers/${providerId}/discovered-models`, { method: 'GET' })
  );
  return response.data ?? [];
}

export async function selectGatewayModel(
  providerId: number,
  modelId: string
): Promise<{ id: number; modelId: string }> {
  const response = unwrap<{ id: number; modelId: string }>(
    await client.request(`/api/ai/providers/${providerId}/select-default-model`, {
      method: 'POST',
      body: { model_id: modelId },
    })
  );
  return response.data;
}

export async function fetchCloudRun(runId: number): Promise<CloudRunDto> {
  const response = unwrap<CloudRunDto>(
    await client.request(`/api/ai/runs/${runId}`, { method: 'GET' })
  );
  return response.data;
}

export async function decideRunApproval(
  workflowId: number,
  action: 'approve' | 'reject',
  fingerprint?: string | null,
  expectedRevision?: number
): Promise<void> {
  await client.request(`/api/ai/governance/approvals/${workflowId}/decide`, {
    method: 'POST',
    body: {
      action,
      ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
      ...(fingerprint ? { execution_fingerprint: fingerprint } : {}),
    },
  });
}

export function isFreellmProvider(provider: CloudProviderDto): boolean {
  return provider.kind === 'freellmapi' || provider.code === 'freellmapi_default';
}

export function shortFingerprint(fingerprint: unknown): string {
  return typeof fingerprint === 'string' && /^[a-f0-9]{64}$/u.test(fingerprint)
    ? `${fingerprint.slice(0, 12)}…`
    : 'not computed';
}
