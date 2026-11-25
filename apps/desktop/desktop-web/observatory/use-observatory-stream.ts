import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ObservatoryGitCommitDetailDto,
  ObservatoryProbeResultDto,
  ObservatoryRuntime,
  ObservatorySessionDetailDto,
  ObservatorySnapshotDto,
} from './types';

export type ObservatoryConnectionState = 'connecting' | 'live' | 'reconnecting' | 'error';

export interface ObservatoryCutInAlert {
  readonly id: number;
  readonly tag: string;
  readonly headline: string;
  readonly subtext: string;
  readonly kind: 'commit' | 'levelup' | 'error' | 'clash';
}

interface DesktopApiWindow extends Window {
  __MW_DESKTOP_API_URL__?: string;
}

const MAX_REPLAY_HISTORY = 60;

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
  readonly liveSnapshot: ObservatorySnapshotDto | null;
  readonly snapshot: ObservatorySnapshotDto | null;
  readonly history: readonly ObservatorySnapshotDto[];
  readonly replayIndex: number | null;
  readonly setReplayIndex: (index: number | null) => void;
  readonly comboCount: number;
  readonly cutInAlert: ObservatoryCutInAlert | null;
  readonly triggerCutIn: (alert: Omit<ObservatoryCutInAlert, 'id'>) => void;
  readonly connectionState: ObservatoryConnectionState;
  readonly error: string | null;
  readonly refreshNow: () => Promise<void>;
  readonly fetchSessionDetail: (
    runtime: ObservatoryRuntime,
    id: string
  ) => Promise<ObservatorySessionDetailDto>;
  readonly fetchCommitDetail: (sha: string) => Promise<ObservatoryGitCommitDetailDto>;
  readonly runCustomProbe: (url: string) => Promise<ObservatoryProbeResultDto>;
  readonly downloadExport: (format: 'markdown' | 'json') => Promise<void>;
}

export function useDesktopObservatoryStream(): UseDesktopObservatoryStreamResult {
  const [liveSnapshot, setLiveSnapshot] = useState<ObservatorySnapshotDto | null>(null);
  const [history, setHistory] = useState<readonly ObservatorySnapshotDto[]>([]);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [comboCount, setComboCount] = useState(0);
  const [cutInAlert, setCutInAlert] = useState<ObservatoryCutInAlert | null>(null);
  const [connectionState, setConnectionState] = useState<ObservatoryConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const prevMetaRef = useRef<{ head: string; planDone: number; errorCount: number } | null>(null);
  const cutInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerCutIn = useCallback((alert: Omit<ObservatoryCutInAlert, 'id'>) => {
    if (!mountedRef.current) return;
    if (cutInTimerRef.current) clearTimeout(cutInTimerRef.current);
    setCutInAlert({ ...alert, id: Date.now() });
    cutInTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCutInAlert(null);
    }, 3_400);
  }, []);

  const ingestSnapshot = useCallback(
    (incoming: ObservatorySnapshotDto) => {
      if (!mountedRef.current) return;
      setLiveSnapshot(incoming);
      setError(null);
      setHistory((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.generatedAt === incoming.generatedAt) return prev;
        const next = [...prev, incoming];
        return next.length > MAX_REPLAY_HISTORY ? next.slice(next.length - MAX_REPLAY_HISTORY) : next;
      });

      const activePlan =
        incoming.plans.find((p) => p.id === incoming.defaultPlanId) ?? incoming.plans[0];
      const currentMeta = {
        head: incoming.git.head,
        planDone: activePlan?.done ?? 0,
        errorCount: incoming.analytics?.errorLedger.length ?? 0,
      };
      const prevMeta = prevMetaRef.current;
      prevMetaRef.current = currentMeta;

      if (prevMeta) {
        if (currentMeta.planDone > prevMeta.planDone) {
          setComboCount((c) => c + 1);
          triggerCutIn({
            tag: 'QUEST CLEARED',
            headline: `TASK DONE (${currentMeta.planDone}/${activePlan?.total ?? 0})`,
            subtext: activePlan?.nextTaskId
              ? `Next strike: ${activePlan.nextTaskId} — ${activePlan.nextTaskTitle ?? ''}`
              : 'All plan quests cleared!',
            kind: 'levelup',
          });
        } else if (currentMeta.head && prevMeta.head && currentMeta.head !== prevMeta.head) {
          setComboCount((c) => c + 1);
          const headCommit = incoming.git.commits[0];
          triggerCutIn({
            tag: 'NEW COMMIT',
            headline: `${currentMeta.head} LANDED`,
            subtext: headCommit?.subject ?? 'Repository HEAD advanced',
            kind: 'commit',
          });
        } else if (currentMeta.errorCount > prevMeta.errorCount) {
          const latestErr = incoming.analytics?.errorLedger[0];
          triggerCutIn({
            tag: 'GLITCH BONK',
            headline: `${latestErr?.runtimeLabel ?? 'AGENT'} ERROR`,
            subtext: latestErr?.message ?? 'New error detected in ledger',
            kind: 'error',
          });
        }
      }
    },
    [triggerCutIn]
  );

  const fetchSnapshotOnce = useCallback(
    async (fresh: boolean): Promise<ObservatorySnapshotDto | null> => {
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
        ingestSnapshot(payload.data);
        return payload.data;
      }
      return null;
    },
    [ingestSnapshot]
  );

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

  const fetchCommitDetail = useCallback(async (sha: string): Promise<ObservatoryGitCommitDetailDto> => {
    const baseUrl = getApiBaseUrl();
    const params = new URLSearchParams({ sha });
    const res = await fetch(`${baseUrl}/api/desktop/observatory/git/commit?${params.toString()}`, {
      method: 'GET',
      headers: buildAuthHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Commit detail failed (HTTP ${res.status})`);
    }
    const payload = (await res.json()) as { data?: ObservatoryGitCommitDetailDto };
    if (!payload.data) {
      throw new Error('Commit detail payload missing');
    }
    return payload.data;
  }, []);

  const runCustomProbe = useCallback(async (url: string): Promise<ObservatoryProbeResultDto> => {
    const baseUrl = getApiBaseUrl();
    const params = new URLSearchParams({ url });
    const res = await fetch(`${baseUrl}/api/desktop/observatory/probe?${params.toString()}`, {
      method: 'GET',
      headers: buildAuthHeaders(),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      data?: ObservatoryProbeResultDto;
    };
    if (!res.ok) {
      if (payload.data) return payload.data;
      throw new Error(payload.error ?? `Probe failed (HTTP ${res.status})`);
    }
    if (!payload.data) {
      throw new Error('Probe response missing');
    }
    return payload.data;
  }, []);

  const downloadExport = useCallback(async (format: 'markdown' | 'json'): Promise<void> => {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(
      `${baseUrl}/api/desktop/observatory/export?format=${encodeURIComponent(format)}`,
      {
        method: 'GET',
        headers: buildAuthHeaders(),
      }
    );
    if (!res.ok) {
      throw new Error(`Export failed (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download =
      format === 'markdown'
        ? 'moonwitness-observatory-report.md'
        : 'moonwitness-observatory-snapshot.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }, []);

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
                  ingestSnapshot(parsed);
                  setConnectionState('live');
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
      if (cutInTimerRef.current) clearTimeout(cutInTimerRef.current);
    };
  }, [fetchSnapshotOnce, ingestSnapshot]);

  const effectiveSnapshot =
    replayIndex !== null && history[replayIndex] ? history[replayIndex] : liveSnapshot;

  return {
    liveSnapshot,
    snapshot: effectiveSnapshot,
    history,
    replayIndex,
    setReplayIndex,
    comboCount,
    cutInAlert,
    triggerCutIn,
    connectionState,
    error,
    refreshNow,
    fetchSessionDetail,
    fetchCommitDetail,
    runCustomProbe,
    downloadExport,
  };
}
