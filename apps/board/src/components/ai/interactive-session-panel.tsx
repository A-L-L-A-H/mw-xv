'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { RefreshIcon, WarningIcon } from '@moonwitness/ui/icons';
import type { AiAgentDto, AiWorkContractDto } from './ai-api';
import {
  INTERACTIVE_PROMPT_MAX_LENGTH,
  createInteractiveSession,
  isTerminalSession,
  mergeInteractiveEvents,
  normalizeInteractiveEvent,
  openInteractiveSessionEvents,
  parseInteractiveStreamFrame,
  readPendingInteractiveApproval,
  sendInteractiveCommand,
  useInteractiveSession,
  useInteractiveSessions,
  type InteractiveCommandType,
  type InteractivePendingApprovalDto,
  type InteractiveSessionEventDto,
  type InteractiveSessionSnapshotDto,
  type InteractiveSessionStateDto,
} from './interactive-session-api';
import { InteractiveSessionTimeline } from './interactive-session-timeline';

const EMPTY_SESSIONS: never[] = [];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The interactive session request failed.';
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function promptBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function InteractiveSessionPanel({
  agents,
  contracts,
  initialContractId,
}: {
  readonly agents: readonly AiAgentDto[];
  readonly contracts: readonly AiWorkContractDto[];
  readonly initialContractId?: number;
}) {
  const sessionsQuery = useInteractiveSessions();
  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [contractId, setContractId] = useState(String(initialContractId ?? ''));
  const [initialPrompt, setInitialPrompt] = useState('');
  const [prompt, setPrompt] = useState('');
  const [capability, setCapability] = useState('');
  const [events, setEvents] = useState<readonly InteractiveSessionEventDto[]>([]);
  const [snapshot, setSnapshot] = useState<InteractiveSessionSnapshotDto | undefined>();
  const [streamState, setStreamState] = useState<'connecting' | 'live' | 'reconnecting' | 'gap'>('connecting');
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvalFingerprint, setApprovalFingerprint] = useState<string>();
  const [busyAction, setBusyAction] = useState<InteractiveCommandType | 'create' | null>(null);
  const [reviewerSessionId, setReviewerSessionId] = useState('');
  const [reviewerApproval, setReviewerApproval] = useState<InteractivePendingApprovalDto>();
  const [reviewerError, setReviewerError] = useState<string | null>(null);
  const [reviewerBusy, setReviewerBusy] = useState(false);
  const afterSequence = useRef(0);
  const recoveringGap = useRef(false);
  const awaitingGapSnapshot = useRef(false);
  const sessionQuery = useInteractiveSession(selectedId);

  useEffect(() => {
    if (!selectedId && sessions[0]) setSelectedId(String(sessions[0].id));
  }, [selectedId, sessions]);

  useEffect(() => {
    if (!contractId && contracts[0]) setContractId(String(contracts[0].id));
  }, [contractId, contracts]);

  useEffect(() => {
    if (!agentId && contracts[0]?.assigned_agent_id) setAgentId(String(contracts[0].assigned_agent_id));
  }, [agentId, contracts]);

  const replaceState = useCallback((state: InteractiveSessionStateDto) => {
    setSnapshot(state.snapshot ?? state.session);
    const nextEvents = [...state.events].map(normalizeInteractiveEvent).sort((a, b) => a.sequence - b.sequence).slice(-200);
    setEvents(nextEvents);
    setApprovalFingerprint(nextEvents.findLast((event) => event.type === 'approval.requested')?.fingerprint);
    afterSequence.current = state.nextSequence;
    if (state.gap) setStreamState('gap');
  }, []);

  useEffect(() => {
    if (sessionQuery.data) replaceState(sessionQuery.data);
  }, [sessionQuery.data, replaceState]);

  useEffect(() => {
    if (!selectedId) return;
    setEvents([]);
    setSnapshot(undefined);
    setActionError(null);
    setApprovalFingerprint(undefined);
    setStreamState('connecting');
    afterSequence.current = 0;
    recoveringGap.current = false;
    awaitingGapSnapshot.current = false;
    let source: EventSource | undefined;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      setStreamState((current) => (current === 'gap' ? 'gap' : 'reconnecting'));
      source = openInteractiveSessionEvents(
        selectedId,
        afterSequence.current,
        (message) => {
          const frame = parseInteractiveStreamFrame(message.data);
          if (!frame) return;
          if (frame.kind === 'gap') {
            recoveringGap.current = true;
            awaitingGapSnapshot.current = true;
            setStreamState('gap');
            if (frame.snapshot) setSnapshot(frame.snapshot);
            if (frame.events?.length) {
              const incoming = frame.events.map(normalizeInteractiveEvent).sort((a, b) => a.sequence - b.sequence).slice(-200);
              setEvents(incoming);
              setApprovalFingerprint(incoming.findLast((event) => event.type === 'approval.requested')?.fingerprint);
            }
            afterSequence.current = Math.max(afterSequence.current, frame.nextSequence ?? 0);
            source?.close();
            void sessionQuery.refetch().finally(() => {
              recoveringGap.current = false;
              if (!closed) reconnectTimer = setTimeout(connect, 0);
            });
            return;
          }
          if (frame.snapshot) setSnapshot(frame.snapshot);
          if (frame.session) setSnapshot(frame.session);
          if (frame.events?.length) {
            const incoming = frame.events.map(normalizeInteractiveEvent);
            setEvents((current) => mergeInteractiveEvents(current, incoming));
            setApprovalFingerprint(incoming.findLast((event) => event.type === 'approval.requested')?.fingerprint);
            const requested = incoming.findLast((event) => event.type === 'approval.requested');
            if (requested?.approvalId !== undefined) {
              setSnapshot((current) => current ? { ...current, pendingApprovalId: requested.approvalId } : current);
            }
          }
          afterSequence.current = Math.max(afterSequence.current, frame.nextSequence ?? 0);
          recoveringGap.current = false;
          awaitingGapSnapshot.current = false;
          setStreamState('live');
        },
        () => {
          if (!awaitingGapSnapshot.current) setStreamState('live');
        },
        () => {
          source?.close();
          if (closed || recoveringGap.current) return;
          setStreamState('reconnecting');
          reconnectTimer = setTimeout(connect, 1_000);
        }
      );
    };
    connect();
    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
    // Refetch is stable for a selected query; reconnect owns its cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const runCommand = async (type: InteractiveCommandType) => {
    if (!selectedId || busyAction) return;
    if (type === 'prompt' && !prompt.trim()) return;
    setBusyAction(type);
    setActionError(null);
    try {
      const result = await sendInteractiveCommand(selectedId, {
        idempotencyKey: newIdempotencyKey(),
        type,
        payload:
          type === 'prompt'
            ? { prompt: prompt.trim().slice(0, INTERACTIVE_PROMPT_MAX_LENGTH) }
            : type === 'request_approval'
              ? { capability: capability.trim(), arguments: {} }
              : type === 'approve' || type === 'deny'
                ? {
                    approvalId: pendingApprovalId,
                    fingerprint: pendingFingerprint,
                  }
                : undefined,
      });
      if ('events' in result && 'nextSequence' in result) replaceState(result);
      if (type === 'prompt') setPrompt('');
      await sessionsQuery.refetch();
      await sessionQuery.refetch();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const loadReviewerApproval = async () => {
    const id = reviewerSessionId.trim();
    if (!/^\d{1,20}$/u.test(id) || reviewerBusy) return;
    setReviewerBusy(true);
    setReviewerError(null);
    setReviewerApproval(undefined);
    try {
      setReviewerApproval(await readPendingInteractiveApproval(id));
    } catch (error) {
      setReviewerError(errorMessage(error));
    } finally {
      setReviewerBusy(false);
    }
  };

  const decideReviewerApproval = async (type: 'approve' | 'deny') => {
    if (!reviewerApproval || reviewerBusy) return;
    setReviewerBusy(true);
    setReviewerError(null);
    try {
      await sendInteractiveCommand(reviewerApproval.sessionId, {
        idempotencyKey: newIdempotencyKey(),
        type,
        payload: { approvalId: reviewerApproval.approvalId, fingerprint: reviewerApproval.fingerprint },
      });
      setReviewerApproval(undefined);
      await sessionsQuery.refetch();
    } catch (error) {
      setReviewerError(errorMessage(error));
    } finally {
      setReviewerBusy(false);
    }
  };

  const createSession = async () => {
    const parsedAgent = Number(agentId);
    const parsedContract = Number(contractId);
    if (!Number.isSafeInteger(parsedAgent) || !Number.isSafeInteger(parsedContract) || !initialPrompt.trim()) return;
    setBusyAction('create');
    setActionError(null);
    try {
      const session = await createInteractiveSession({
        agentId: parsedAgent,
        workContractId: parsedContract,
        initialPrompt: initialPrompt.trim().slice(0, INTERACTIVE_PROMPT_MAX_LENGTH),
        idempotencyKey: newIdempotencyKey(),
      });
      setInitialPrompt('');
      setSelectedId(String(session.id));
      await sessionsQuery.refetch();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const terminal = snapshot ? isTerminalSession(snapshot) : false;
  const canCreate = Boolean(agentId && contractId && initialPrompt.trim()) && promptBytes(initialPrompt) <= 8_192 && busyAction === null;
  const pendingApprovalId = snapshot?.pendingApprovalId ?? snapshot?.pending_approval_id ?? events.findLast((event) => event.type === 'approval.requested')?.approvalId;
  const pendingFingerprint = approvalFingerprint ?? events.findLast((event) => event.type === 'approval.requested')?.fingerprint;
  const status = snapshot?.status ?? 'loading';

  return (
    <Panel
      aria-label="Durable Interactive Sessions"
      title="Durable Interactive Sessions"
      description="Resume a bounded agent session with durable sequence replay and explicit human decisions. No terminal or raw payload access."
      headingLevel={2}
      density="compact"
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void sessionsQuery.refetch();
            if (selectedId) void sessionQuery.refetch();
          }}
          disabled={sessionsQuery.isFetching || sessionQuery.isFetching}
        >
          <RefreshIcon className="size-3.5" /> Refresh sessions
        </Button>
      }
    >
      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <label htmlFor="interactive-session-list" className="font-mono text-xs font-bold uppercase text-ink">
              Resume session
            </label>
            <SelectField
              id="interactive-session-list"
              value={selectedId ?? ''}
              onChange={(event) => setSelectedId(event.target.value || null)}
              disabled={sessionsQuery.isPending}
            >
              <option value="">Select a session</option>
              {sessions.map((session) => (
                <option key={session.id} value={String(session.id)}>
                  Session #{session.id} · {session.status}
                </option>
              ))}
            </SelectField>
            {sessionsQuery.isPending ? <Skeleton className="h-8 w-full bg-ink/10" label="Loading sessions" /> : null}
            {sessionsQuery.isError ? (
              <p role="alert" className="font-mono text-xs text-destructive">{errorMessage(sessionsQuery.error)}</p>
            ) : null}
            {!sessionsQuery.isPending && !sessionsQuery.isError && sessions.length === 0 ? (
              <p role="status" className="font-mono text-xs text-ink-soft">No resumable sessions yet.</p>
            ) : null}
          </div>

          <form
            className="space-y-3 border-t border-ink/15 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createSession();
            }}
          >
            <h3 className="font-mono text-xs font-bold uppercase text-ink">Start session</h3>
            <div>
              <label htmlFor="interactive-new-contract" className="sr-only">Work contract</label>
              <SelectField id="interactive-new-contract" value={contractId} onChange={(event) => setContractId(event.target.value)}>
                <option value="">Select work contract</option>
                {contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.code} · {contract.title}</option>)}
              </SelectField>
            </div>
            <div>
              <label htmlFor="interactive-new-agent" className="sr-only">Agent</label>
              <SelectField id="interactive-new-agent" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">Select agent</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.display_name ?? agent.name ?? agent.code}</option>)}
              </SelectField>
            </div>
            <div>
              <label htmlFor="interactive-initial-prompt" className="mb-1 block font-mono text-xs text-ink">Initial prompt</label>
              <Input
                id="interactive-initial-prompt"
                value={initialPrompt}
                maxLength={INTERACTIVE_PROMPT_MAX_LENGTH}
                onChange={(event) => setInitialPrompt(event.target.value)}
                placeholder="Describe the bounded task"
              />
              <p className="mt-1 text-right font-mono text-[10px] text-ink-faint">{initialPrompt.length}/{INTERACTIVE_PROMPT_MAX_LENGTH}</p>
            </div>
            <Button type="submit" size="sm" disabled={!canCreate}>{busyAction === 'create' ? 'Starting…' : 'Start durable session'}</Button>
          </form>

          <form
            className="space-y-3 border-t border-ink/15 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void loadReviewerApproval();
            }}
          >
            <h3 className="font-mono text-xs font-bold uppercase text-ink">Independent review</h3>
            <p className="font-mono text-[10px] text-ink-soft">Enter a session ID shared by its owner. Reviewers receive only the pending decision, never prompts or checkpoints.</p>
            <div>
              <label htmlFor="interactive-review-session" className="mb-1 block font-mono text-xs text-ink">Session ID to review</label>
              <Input
                id="interactive-review-session"
                inputMode="numeric"
                value={reviewerSessionId}
                maxLength={20}
                onChange={(event) => {
                  setReviewerSessionId(event.target.value);
                  setReviewerApproval(undefined);
                  setReviewerError(null);
                }}
                placeholder="Session ID"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={reviewerBusy || !/^\d{1,20}$/u.test(reviewerSessionId.trim())}>
              {reviewerBusy ? 'Loading…' : 'Load pending approval'}
            </Button>
            {reviewerError ? <p role="alert" className="font-mono text-xs text-destructive">{reviewerError}</p> : null}
            {reviewerApproval ? (
              <div className="space-y-2 border-2 border-ink/15 p-3">
                <p className="font-mono text-xs font-bold text-ink">Approval #{reviewerApproval.approvalId} · {reviewerApproval.capability}</p>
                <p className="break-all font-mono text-[10px] text-ink-soft">Fingerprint {reviewerApproval.fingerprint}</p>
                <p className="font-mono text-[10px] text-ink-soft">Expires {reviewerApproval.expiresAt}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={reviewerBusy} onClick={() => void decideReviewerApproval('approve')}>Approve</Button>
                  <Button type="button" size="sm" variant="outline" disabled={reviewerBusy} onClick={() => void decideReviewerApproval('deny')}>Deny</Button>
                </div>
              </div>
            ) : null}
          </form>
        </div>

        <section aria-label="Selected interactive session" className="min-w-0 space-y-4 border-t-2 border-ink/15 pt-4 xl:border-t-0 xl:border-l-2 xl:pl-5">
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <Badge variant={terminal ? 'default' : 'primary'}>{status}</Badge>
            <Badge variant={streamState === 'live' ? 'primary' : 'default'}>{streamState}</Badge>
            {sessionQuery.isFetching ? <span className="font-mono text-xs text-ink-soft">Refreshing snapshot…</span> : null}
            {terminal ? <span className="font-mono text-xs text-ink-soft">Terminal session · read only</span> : null}
          </div>
          {streamState === 'gap' ? (
            <p role="status" className="border-2 border-yellow-500/40 bg-yellow-500/10 p-3 font-mono text-xs text-ink">
              Event history gap detected. Replacing the snapshot from sequence zero.
            </p>
          ) : null}
          {streamState === 'reconnecting' ? (
            <p role="status" className="font-mono text-xs text-ink-soft">Connection lost. Reconnecting from the last applied sequence.</p>
          ) : null}
          {selectedId && sessionQuery.isPending ? <Skeleton className="h-48 w-full bg-ink/10" label="Loading session timeline" /> : null}
          {sessionQuery.isError ? (
            <div role="alert" className="border-2 border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-ink">
              <WarningIcon className="mr-2 inline size-4" /> {errorMessage(sessionQuery.error)}
            </div>
          ) : null}
          {actionError ? <p role="alert" className="border-2 border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-ink">{actionError}</p> : null}
          {snapshot ? (
            <>
              <InteractiveSessionTimeline snapshot={snapshot} events={events} />
              <form
                className="space-y-3 border-t border-ink/15 pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runCommand('prompt');
                }}
              >
                <label htmlFor="interactive-prompt" className="block font-mono text-xs font-bold uppercase text-ink">Send prompt</label>
                <Input
                  id="interactive-prompt"
                  value={prompt}
                  maxLength={INTERACTIVE_PROMPT_MAX_LENGTH}
                  disabled={terminal || busyAction !== null}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Steer the active session"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-ink-faint">{prompt.length}/{INTERACTIVE_PROMPT_MAX_LENGTH}</span>
                  <Button type="submit" size="sm" disabled={terminal || !prompt.trim() || promptBytes(prompt) > 8_192 || busyAction !== null}>
                    {busyAction === 'prompt' ? 'Sending…' : 'Send prompt'}
                  </Button>
                </div>
              </form>
              <div className="space-y-3 border-t border-ink/15 pt-4">
                <div>
                  <label htmlFor="interactive-approval-capability" className="mb-1 block font-mono text-xs text-ink">Approval capability</label>
                  <Input id="interactive-approval-capability" value={capability} maxLength={256} disabled={terminal || busyAction !== null} onChange={(event) => setCapability(event.target.value)} placeholder="Capability requiring a decision" />
                </div>
                {snapshot.status === 'waiting_approval' ? (
                  <p className="break-all font-mono text-[10px] text-ink-soft">
                    Pending approval #{pendingApprovalId ?? 'unknown'} · fingerprint {pendingFingerprint ?? 'unavailable'}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2" aria-label="Session controls">
                <Button type="button" variant="outline" size="sm" disabled={terminal || busyAction !== null || !capability.trim()} onClick={() => void runCommand('request_approval')}>
                  Request approval
                </Button>
                <p className="font-mono text-[10px] text-ink-soft">Approval requires a different company reviewer; the session owner cannot decide.</p>
                <Button type="button" variant="outline" size="sm" disabled={terminal || busyAction !== null} onClick={() => void runCommand('cancel')}>
                  {busyAction === 'cancel' ? 'Cancelling…' : 'Cancel session'}
                </Button>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </Panel>
  );
}
