'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RocksoulSseStatus = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'offline';

export type RocksoulEventKind =
  | 'continuity.heartbeat'
  | 'artifact.verified'
  | 'obligation.triggered'
  | 'run.telemetry';

export interface RocksoulContinuityEvent {
  id: string;
  kind: RocksoulEventKind;
  nodeId: string;
  timestamp: string;
  summary: string;
  latencyMs?: number;
  activeRuns?: number;
  sha256?: string;
  obligationCode?: string;
}

const VALID_KINDS = new Set<RocksoulEventKind>([
  'continuity.heartbeat',
  'artifact.verified',
  'obligation.triggered',
  'run.telemetry',
]);

export function parseRocksoulSseEvent(raw: string): RocksoulContinuityEvent | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawKind = typeof parsed.kind === 'string' ? parsed.kind : 'continuity.heartbeat';
    const kind: RocksoulEventKind = VALID_KINDS.has(rawKind as RocksoulEventKind)
      ? (rawKind as RocksoulEventKind)
      : 'continuity.heartbeat';
    const timestamp =
      typeof parsed.timestamp === 'string' && parsed.timestamp.length > 0
        ? parsed.timestamp
        : new Date().toISOString();
    const nodeId =
      typeof parsed.nodeId === 'string' && parsed.nodeId.length > 0
        ? parsed.nodeId
        : typeof parsed.node_id === 'string' && parsed.node_id.length > 0
          ? parsed.node_id
          : 'rocksoul-core';
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.length > 0
        ? parsed.summary
        : typeof parsed.message === 'string' && parsed.message.length > 0
          ? parsed.message
          : `${kind} from ${nodeId}`;
    const id =
      typeof parsed.id === 'string' && parsed.id.length > 0
        ? parsed.id
        : `${kind}:${nodeId}:${timestamp}`;

    const latencyMs =
      typeof parsed.latencyMs === 'number' && Number.isFinite(parsed.latencyMs)
        ? parsed.latencyMs
        : typeof parsed.latency_ms === 'number' && Number.isFinite(parsed.latency_ms)
          ? parsed.latency_ms
          : undefined;
    const activeRuns =
      typeof parsed.activeRuns === 'number' && Number.isFinite(parsed.activeRuns)
        ? parsed.activeRuns
        : typeof parsed.active_runs === 'number' && Number.isFinite(parsed.active_runs)
          ? parsed.active_runs
          : undefined;

    return {
      id,
      kind,
      nodeId,
      timestamp,
      summary,
      latencyMs,
      activeRuns,
      sha256: typeof parsed.sha256 === 'string' ? parsed.sha256 : undefined,
      obligationCode:
        typeof parsed.obligationCode === 'string'
          ? parsed.obligationCode
          : typeof parsed.obligation_code === 'string'
            ? parsed.obligation_code
            : undefined,
    };
  } catch {
    return null;
  }
}

export function appendRocksoulEvent(
  events: readonly RocksoulContinuityEvent[],
  next: RocksoulContinuityEvent,
  maxEvents = 40
): RocksoulContinuityEvent[] {
  const deduped = events.filter((item) => item.id !== next.id);
  return [next, ...deduped].slice(0, Math.max(1, maxEvents));
}

export function useRocksoulContinuitySse(endpoint = '/api/ai/rocksoul/continuity/sse') {
  const [status, setStatus] = useState<RocksoulSseStatus>('connecting');
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState<RocksoulContinuityEvent[]>([]);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [streamNonce, setStreamNonce] = useState(0);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (paused) {
      setStatus('paused');
      return;
    }
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setStatus('offline');
      return;
    }

    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      source = new EventSource(endpoint, { withCredentials: true });

      source.onopen = () => {
        if (closed) return;
        attempt = 0;
        setReconnectAttempt(0);
        setStatus('live');
      };

      const handleRaw = (raw: string) => {
        if (closed || pausedRef.current) return;
        const parsed = parseRocksoulSseEvent(raw);
        if (!parsed) return;
        if (parsed.kind === 'continuity.heartbeat') {
          setLastHeartbeatAt(parsed.timestamp);
        }
        setEvents((prev) => appendRocksoulEvent(prev, parsed));
      };

      source.onmessage = (event) => handleRaw(String(event.data ?? ''));
      for (const eventName of VALID_KINDS) {
        source.addEventListener(eventName, (event) => {
          const messageEvent = event as MessageEvent<string>;
          handleRaw(String(messageEvent.data ?? ''));
        });
      }

      source.onerror = () => {
        if (closed) return;
        source?.close();
        source = null;
        attempt += 1;
        setReconnectAttempt(attempt);
        setStatus('reconnecting');
        const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
        retryTimer = setTimeout(connect, delayMs);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [endpoint, paused, streamNonce]);

  const reconnect = useCallback(() => {
    setPaused(false);
    setStreamNonce((n) => n + 1);
  }, []);

  return {
    status,
    paused,
    setPaused,
    events,
    lastHeartbeatAt,
    reconnectAttempt,
    reconnect,
  };
}
