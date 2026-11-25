import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ObservatoryRuntime,
  ObservatorySessionDetailDto,
  ObservatorySnapshotDto,
} from './types';

export type ObservatoryConnectionState = 'connecting' | 'live' | 'reconnecting' | 'error';

interface DesktopApiWindow extends Window {
  __MW_DESKTOP_API_URL__?: string;
}

function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const desktopUrl = (window as DesktopApiWindow).__MW_DESKTOP_API_URL__;
  if (typeof desktopUrl === 'string' && desktopUrl.trim().length > 0) {
    return desktopUrl.trim().replace(/\/+$/u, '');
  }
  return window.location.origin;
}

function readAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('mw-board-session');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: unknown };
    return typeof parsed.access_token === 'string' && parsed.access_token.trim().length > 0
      ? parsed.access_token.trim()
      : null;
  } catch {
    return null;
  }
}

function buildAuthHeaders(): Record<string, string> {
  const token = readAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface UseDesktopObservatoryStreamResult {
  readonly snapshot: ObservatorySnapshotDto | null;
  readonly connectionState: ObservatoryConnectionState;
  readonly error: string | null;
  readonly refreshNow: () => Promise<void>;
  readonly fetchSessionDetail: (
    runtime: ObservatoryRuntime,
    id: string
  ) => Promise<ObservatorySessionDetailDto>;
}

export function useDesktopObservatoryStream(): UseDesktopObservatoryStreamResult {
  const [snapshot, setSnapshot] = useState<ObservatorySnapshotDto | null>(null);
  const [connectionState, setConnectionState] = useState<ObservatoryConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchSnapshotOnce = useCallback(async (fresh: boolean): Promise<ObservatorySnapshotDto | null> => {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(
      `${baseUrl}/api/desktop/observatory/state${fresh ? '?fresh=1' : ''}`,
      {
        method: 'GET',
        headers: buildAuthHeaders(),
      }
    );
    if (!res.ok) {
      throw new Error(`Observatory API returned HTTP ${res.status}`);
    }
    const payload = (await res.json()) as { success?: boolean; data?: ObservatorySnapshotDto };
    if (payload.data) {
      if (mountedRef.current) {
        setSnapshot(payload.data);
        setError(null);
      }
      return payload.data;
    }
    return null;
  }, []);

  const refreshNow = useCallback(async () => {
    try {
      await fetchSnapshotOnce(true);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to refresh observatory');
      }
    }
  }, [fetchSnapshotOnce]);

  const fetchSessionDetail = useCallback(
    async (runtime: ObservatoryRuntime, id: string): Promise<ObservatorySessionDetailDto> => {
      const baseUrl = getApiBaseUrl();
      const params = new URLSearchParams({ runtime, id });
      const res = await fetch(`${baseUrl}/api/desktop/observatory/session?${params.toString()}`, {
        method: 'GET',
        headers: buildAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error(`Session detail failed (HTTP ${res.status})`);
      }
      const payload = (await res.json()) as { data?: ObservatorySessionDetailDto };
      if (!payload.data) {
        throw new Error('Session detail payload missing');
      }
      return payload.data;
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    let controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 2_000;

    const consumeStream = async (): Promise<void> => {
      if (!mountedRef.current) return;
      controller = new AbortController();
      const baseUrl = getApiBaseUrl();

      try {
        const res = await fetch(`${baseUrl}/api/desktop/observatory/stream`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...buildAuthHeaders(),
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Stream HTTP ${res.status}`);
        }

        if (mountedRef.current) {
          setConnectionState('live');
          setError(null);
        }
        backoffMs = 2_000;

        const contentType = res.headers.get('content-type') ?? '';
        if (!res.body || contentType.includes('application/json')) {
          await fetchSnapshotOnce(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (mountedRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/u);
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            if (!frame.trim() || frame.startsWith(':')) continue;
            const lines = frame.split(/\r?\n/u);
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            if (eventName === 'snapshot' && dataLines.length > 0) {
              try {
                const parsed = JSON.parse(dataLines.join('\n')) as ObservatorySnapshotDto;
                if (mountedRef.current) {
                  setSnapshot(parsed);
                  setConnectionState('live');
                  setError(null);
                }
              } catch {
                // Ignore malformed SSE frame
              }
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted || !mountedRef.current) return;
        setConnectionState('reconnecting');
        setError(err instanceof Error ? err.message : 'Stream disconnected');
        try {
          await fetchSnapshotOnce(false);
        } catch {
          // Keep reconnecting
        }
      }

      if (mountedRef.current) {
        setConnectionState((prev) => (prev === 'live' ? 'reconnecting' : prev));
        reconnectTimer = setTimeout(() => {
          void consumeStream();
        }, backoffMs);
        backoffMs = Math.min(backoffMs + 1_500, 8_000);
      }
    };

    void consumeStream();

    return () => {
      mountedRef.current = false;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [fetchSnapshotOnce]);

  return {
    snapshot,
    connectionState,
    error,
    refreshNow,
    fetchSessionDetail,
  };
}
