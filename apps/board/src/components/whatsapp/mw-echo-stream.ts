'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type MwEchoConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface MwEchoStatusRecord {
  id: number;
  status_type: 'text' | 'image' | 'video';
  content: string | null;
  media_file_name: string | null;
  allow_reshare: boolean;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'unknown';
  attempt_count: number;
  last_error: string | null;
  published_at: string | null;
  create_date: string;
}

export type MwEchoStatusEvent =
  | {
      type: 'status.update';
      item: MwEchoStatusRecord;
    }
  | {
      type: 'account.state';
      status: string;
      canSend?: boolean;
    }
  | {
      type: 'heartbeat';
      timestamp: string;
    };

export function resolveMwEchoWsUrl(origin?: string): string {
  const base =
    origin ??
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:8000');
  const wsBase = base.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:').replace(/\/+$/u, '');
  return `${wsBase}/ws/mw-echo/statuses`;
}

export function parseMwEchoStatusFrame(raw: string): MwEchoStatusEvent | null {
  if (!raw || !raw.trim()) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const type = typeof data.type === 'string' ? data.type : '';

    if (type === 'heartbeat' || type === 'pong') {
      return {
        type: 'heartbeat',
        timestamp:
          typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
      };
    }

    if (type === 'account.state' && typeof data.status === 'string') {
      return {
        type: 'account.state',
        status: data.status,
        canSend: typeof data.canSend === 'boolean' ? data.canSend : undefined,
      };
    }

    if (
      (type === 'status.update' ||
        type === 'status.queued' ||
        type === 'status.sending' ||
        type === 'status.sent' ||
        type === 'status.failed') &&
      data.item &&
      typeof data.item === 'object'
    ) {
      const item = data.item as Record<string, unknown>;
      if (typeof item.id !== 'number' || typeof item.status !== 'string') return null;
      return {
        type: 'status.update',
        item: {
          id: item.id,
          status_type:
            item.status_type === 'image' || item.status_type === 'video'
              ? item.status_type
              : 'text',
          content: typeof item.content === 'string' ? item.content : null,
          media_file_name: typeof item.media_file_name === 'string' ? item.media_file_name : null,
          allow_reshare: Boolean(item.allow_reshare),
          status:
            item.status === 'queued' ||
            item.status === 'sending' ||
            item.status === 'sent' ||
            item.status === 'failed' ||
            item.status === 'unknown'
              ? item.status
              : 'unknown',
          attempt_count: typeof item.attempt_count === 'number' ? item.attempt_count : 0,
          last_error: typeof item.last_error === 'string' ? item.last_error : null,
          published_at: typeof item.published_at === 'string' ? item.published_at : null,
          create_date:
            typeof item.create_date === 'string' ? item.create_date : new Date().toISOString(),
        },
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function applyMwEchoStatusEvent(
  current: readonly MwEchoStatusRecord[],
  event: MwEchoStatusEvent
): MwEchoStatusRecord[] {
  if (event.type !== 'status.update') return [...current];
  const idx = current.findIndex((item) => item.id === event.item.id);
  if (idx === -1) {
    return [event.item, ...current];
  }
  const next = [...current];
  next[idx] = { ...next[idx], ...event.item };
  return next;
}

export function useMwEchoStatusStream(options: {
  onStatusUpdate: (item: MwEchoStatusRecord) => void;
  onAccountState?: (status: string, canSend?: boolean) => void;
  wsUrl?: string;
}) {
  const [connectionState, setConnectionState] = useState<MwEchoConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const onStatusUpdateRef = useRef(options.onStatusUpdate);
  const onAccountStateRef = useRef(options.onAccountState);

  useEffect(() => {
    onStatusUpdateRef.current = options.onStatusUpdate;
    onAccountStateRef.current = options.onAccountState;
  }, [options.onStatusUpdate, options.onAccountState]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      setConnectionState('offline');
      return;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const url = options.wsUrl ?? resolveMwEchoWsUrl();

    const connect = () => {
      if (closed) return;
      setConnectionState(attempt === 0 ? 'connecting' : 'reconnecting');
      socket = new WebSocket(url);

      socket.onopen = () => {
        if (closed) return;
        attempt = 0;
        setConnectionState('live');
      };

      socket.onmessage = (event) => {
        if (closed) return;
        const parsed = parseMwEchoStatusFrame(String(event.data ?? ''));
        if (!parsed) return;
        setLastEventAt(new Date().toISOString());
        if (parsed.type === 'status.update') {
          onStatusUpdateRef.current(parsed.item);
        } else if (parsed.type === 'account.state') {
          onAccountStateRef.current?.(parsed.status, parsed.canSend);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (closed) return;
        attempt += 1;
        setConnectionState('reconnecting');
        const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
        retryTimer = setTimeout(connect, delayMs);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [options.wsUrl, nonce]);

  const reconnect = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return {
    connectionState,
    lastEventAt,
    reconnect,
  };
}
