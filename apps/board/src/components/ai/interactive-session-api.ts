'use client';

import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

export const INTERACTIVE_PROMPT_MAX_LENGTH = 8_000;
export const INTERACTIVE_SESSION_LIST_LIMIT = 20;

export type InteractiveSessionStatus =
  | 'starting'
  | 'running'
  | 'waiting_approval'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | string;

export interface InteractiveSessionDto {
  readonly id: number | string;
  readonly agentId?: number;
  readonly workContractId?: number;
  readonly status: InteractiveSessionStatus;
  readonly sequence?: number;
  readonly nextSequence?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly terminal?: boolean;
  readonly terminal_at?: string | null;
  readonly error?: string | null;
}

export interface InteractiveSessionEventDto {
  readonly sequence: number;
  readonly type: string;
  readonly status?: InteractiveSessionStatus;
  readonly summary?: string;
  readonly message?: string;
  readonly createdAt?: string;
  readonly approvalId?: string | number;
  readonly fingerprint?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface InteractiveSessionSnapshotDto extends Partial<InteractiveSessionDto> {
  readonly status: InteractiveSessionStatus;
  readonly sequence?: number;
  readonly lastSequence?: number;
  readonly pendingApprovalId?: number | string | null;
  readonly pending_approval_id?: number | null;
  readonly terminal_at?: string | null;
}

export interface InteractiveSessionStateDto {
  readonly session: InteractiveSessionDto;
  readonly snapshot?: InteractiveSessionSnapshotDto;
  readonly events: readonly InteractiveSessionEventDto[];
  readonly nextSequence: number;
  readonly gap?: boolean;
}

export interface InteractivePendingApprovalDto {
  readonly approvalId: number | string;
  readonly fingerprint: string;
  readonly capability: string;
  readonly expiresAt: string;
  readonly sessionId: number | string;
  readonly status: InteractiveSessionStatus;
  readonly ownerId: number;
  readonly requestedById: number;
}

export interface InteractiveSessionCreateInput {
  readonly agentId: number;
  readonly workContractId: number;
  readonly initialPrompt: string;
  readonly idempotencyKey: string;
}

export type InteractiveCommandType = 'prompt' | 'request_approval' | 'approve' | 'deny' | 'cancel';

export interface InteractiveCommandInput {
  readonly idempotencyKey: string;
  readonly type: InteractiveCommandType;
  readonly payload?: Readonly<Record<string, unknown>>;
}

interface ApiEnvelope<T> {
  readonly success?: boolean;
  readonly data: T;
}

function request<T>(path: string, options: Parameters<typeof client.request>[1] = {}): Promise<T> {
  return client.request<ApiEnvelope<T>>(path, options).then((response) => {
    if (response?.data === undefined) throw new Error('Interactive session API returned no data.');
    return response.data;
  });
}

function boundedSessionId(id: string | number): string {
  return String(id).trim().slice(0, 128);
}

function eventSequence(event: InteractiveSessionEventDto): number {
  return Number.isSafeInteger(event.sequence) ? event.sequence : 0;
}

export function normalizeInteractiveEvent(event: InteractiveSessionEventDto): InteractiveSessionEventDto {
  const approvalId = event.approvalId ?? event.payload?.approvalId;
  const fingerprint = event.fingerprint ?? event.payload?.fingerprint;
  return {
    ...event,
    ...(typeof approvalId === 'number' || typeof approvalId === 'string' ? { approvalId } : {}),
    ...(typeof fingerprint === 'string' ? { fingerprint } : {}),
  };
}

export function mergeInteractiveEvents(
  previous: readonly InteractiveSessionEventDto[],
  incoming: readonly InteractiveSessionEventDto[]
): InteractiveSessionEventDto[] {
  const events = new Map(previous.map((event) => [eventSequence(event), event]));
  incoming.forEach((event) => events.set(eventSequence(event), normalizeInteractiveEvent(event)));
  return [...events.values()].sort((left, right) => eventSequence(left) - eventSequence(right)).slice(-200);
}

export function isTerminalSession(session: InteractiveSessionDto | InteractiveSessionSnapshotDto): boolean {
  if (session.terminal === true || session.terminal_at) return true;
  return ['completed', 'failed', 'cancelled', 'denied', 'expired'].includes(session.status);
}

export function useInteractiveSessions() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'interactive-sessions', 'list']),
    queryFn: () =>
      request<InteractiveSessionDto[] | { sessions: InteractiveSessionDto[] }>(
        `/api/ai/interactive-sessions?limit=${INTERACTIVE_SESSION_LIST_LIMIT}`
      ).then((data) => (Array.isArray(data) ? data : (data.sessions ?? []).slice(0, INTERACTIVE_SESSION_LIST_LIMIT))),
  });
}

export function useInteractiveSession(id: string | null) {
  const boundedId = boundedSessionId(id ?? '');
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'interactive-sessions', boundedId]),
    queryFn: () =>
      request<InteractiveSessionStateDto>(
        `/api/ai/interactive-sessions/${encodeURIComponent(boundedId)}?afterSequence=0`
      ),
    enabled: boundedId.length > 0,
  });
}

export function readPendingInteractiveApproval(id: string | number) {
  return request<InteractivePendingApprovalDto>(
    `/api/ai/interactive-sessions/${encodeURIComponent(boundedSessionId(id))}/approval`
  );
}

export function createInteractiveSession(input: InteractiveSessionCreateInput) {
  return request<InteractiveSessionDto>('/api/ai/interactive-sessions', {
    method: 'POST',
    body: input,
  });
}

export function sendInteractiveCommand(id: string | number, input: InteractiveCommandInput) {
  return request<InteractiveSessionStateDto | InteractiveSessionDto>(
    `/api/ai/interactive-sessions/${encodeURIComponent(boundedSessionId(id))}/commands`,
    { method: 'POST', body: input }
  );
}

export function openInteractiveSessionEvents(
  id: string | number,
  afterSequence: number,
  onMessage: (event: MessageEvent<string>) => void,
  onOpen: () => void,
  onError: () => void
): EventSource {
  const source = new EventSource(
    `/api/ai/interactive-sessions/${encodeURIComponent(boundedSessionId(id))}/events?afterSequence=${Math.max(0, afterSequence)}`
  );
  // The backend uses named SSE events; accept a generic data event as well.
  ['interactive_snapshot', 'snapshot', 'replay', 'gap', 'message'].forEach((type) => {
    source.addEventListener(type, (event) => onMessage(event as MessageEvent<string>));
  });
  source.onopen = onOpen;
  source.onerror = onError;
  return source;
}

export interface InteractiveStreamFrame {
  readonly kind: 'snapshot' | 'replay' | 'gap';
  readonly snapshot?: InteractiveSessionSnapshotDto;
  readonly session?: InteractiveSessionDto;
  readonly events?: readonly InteractiveSessionEventDto[];
  readonly nextSequence?: number;
}

export function parseInteractiveStreamFrame(raw: string): InteractiveStreamFrame | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const inferredKind = value.kind ?? value.type ?? (value.snapshot ? 'snapshot' : undefined);
    const kind = value.gap === true && inferredKind === 'snapshot' ? 'gap' : inferredKind;
    if (kind === 'interactive_snapshot') {
      return {
        kind: value.gap ? 'gap' : 'snapshot',
        snapshot: value.snapshot as InteractiveSessionSnapshotDto,
        events: Array.isArray(value.events) ? (value.events as InteractiveSessionEventDto[]) : undefined,
        nextSequence: typeof value.nextSequence === 'number' ? value.nextSequence : undefined,
      };
    }
    if (kind !== 'snapshot' && kind !== 'replay' && kind !== 'gap') return null;
    return {
      kind,
      snapshot: (value.snapshot ?? value) as InteractiveSessionSnapshotDto,
      session: value.session as InteractiveSessionDto | undefined,
      events: Array.isArray(value.events) ? (value.events as InteractiveSessionEventDto[]) : undefined,
      nextSequence: typeof value.nextSequence === 'number' ? value.nextSequence : undefined,
    };
  } catch {
    return null;
  }
}
