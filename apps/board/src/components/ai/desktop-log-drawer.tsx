'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { LogConsole, type LogConsoleEntry } from '@moonwitness/ui/components/log-console';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@moonwitness/ui/components/sheet';
import { CheckCircleIcon, CodeIcon, SparkleIcon } from '@moonwitness/ui/icons';
import { ConfirmDialog } from '@/components/views/confirm-dialog';
import { client } from '@/lib/client';
import { useDesktopMode } from '@/lib/desktop-mode';

interface DesktopApiWindow extends Window {
  __MW_DESKTOP_API_URL__?: string;
}

interface DesktopLogsResponse {
  readonly entries?: readonly LogConsoleEntry[];
}

interface DesktopBundleResponse {
  readonly markdown?: string;
  readonly bundle?: string;
}

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = (window as DesktopApiWindow).__MW_DESKTOP_API_URL__;
  return typeof raw === 'string' && raw.trim().length > 0;
}

function buildFallbackMarkdown(entries: readonly LogConsoleEntry[]): string {
  const lines = [
    '# MoonWitness Desktop Diagnostic Bundle',
    '',
    `- **Captured At**: ${new Date().toISOString()}`,
    `- **Entries**: ${entries.length}`,
    '',
    '```text',
    ...entries
      .slice(-50)
      .map(
        (entry) =>
          `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`
      ),
    '```',
  ];
  return lines.join('\n');
}

export function DesktopLogDrawer() {
  const { mode } = useDesktopMode();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<readonly LogConsoleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const fetchInFlightRef = useRef(false);
  const readGenerationRef = useRef(0);

  const isDeveloperMode = mode === 'developer';

  const fetchLogs = useCallback(async () => {
    if (!isDesktopRuntime() || fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    const requestGeneration = readGenerationRef.current;
    setLoading(true);
    try {
      const payload = await client.request<DesktopLogsResponse>('/api/desktop/logs');
      if (!Array.isArray(payload?.entries)) {
        throw new Error('Desktop log response did not contain an entries array.');
      }
      if (requestGeneration !== readGenerationRef.current) return;
      setEntries(payload.entries);
      setReadError(null);
    } catch {
      if (requestGeneration === readGenerationRef.current) {
        // Sidecar may be restarting; retain entries but label them as stale.
        setReadError('Desktop log refresh failed. Any entries shown are last known data.');
      }
    } finally {
      fetchInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (clearing) return;
    readGenerationRef.current += 1;
    setClearError(null);
    setClearing(true);
    if (!isDesktopRuntime()) {
      setClearError('Desktop sidecar is unavailable. Logs were not cleared.');
      setClearConfirmOpen(false);
      setClearing(false);
      return;
    }
    try {
      await client.request('/api/desktop/logs/clear', { method: 'POST' });
      setEntries([]);
      setClearConfirmOpen(false);
    } catch {
      setClearError('Unable to clear desktop logs. Existing entries were kept.');
      setClearConfirmOpen(false);
    } finally {
      setClearing(false);
    }
  }, [clearing]);

  const handleCopyForAi = useCallback(
    async (visibleEntries?: readonly LogConsoleEntry[]) => {
      let markdown = buildFallbackMarkdown(visibleEntries ?? entries);

      if (isDesktopRuntime()) {
        try {
          const payload = await client.request<DesktopBundleResponse>('/api/desktop/logs/bundle');
          if (typeof payload?.markdown === 'string' && payload.markdown.trim().length > 0) {
            markdown = payload.markdown;
          } else if (typeof payload?.bundle === 'string' && payload.bundle.trim().length > 0) {
            markdown = payload.bundle;
          }
        } catch {
          // Fall back to client-formatted diagnostic bundle.
        }
      }

      try {
        await navigator.clipboard.writeText(markdown);
        setCopyStatus('copied');
      } catch {
        setCopyStatus('error');
      }

      window.setTimeout(() => {
        setCopyStatus('idle');
      }, 2500);
    },
    [entries]
  );

  useEffect(() => {
    if (!isDeveloperMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isDeveloperMode]);

  useEffect(() => {
    if (!isDeveloperMode || !open || clearConfirmOpen || clearing) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) void fetchLogs();
    };
    queueMicrotask(run);
    const timer = window.setInterval(run, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isDeveloperMode, open, clearConfirmOpen, clearing, fetchLogs]);

  if (!isDeveloperMode) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void handleCopyForAi();
          }}
          aria-label="Copy Diagnostics"
        >
          {copyStatus === 'copied' ? (
            <CheckCircleIcon className="size-3.5" aria-hidden="true" />
          ) : (
            <SparkleIcon className="size-3.5" aria-hidden="true" />
          )}
          <span>
            {copyStatus === 'copied'
              ? 'Diagnostics Copied'
              : copyStatus === 'error'
                ? 'Copy Failed'
                : 'Copy Diagnostics'}
          </span>
        </Button>
      </div>
    );
  }

  const errorCount = entries.filter((entry) => entry.level === 'error').length;
  const logsDescription = readError
    ? 'Latest refresh failed. Any entries shown are last known local diagnostics, not live results.'
    : 'Live local diagnostics across Rust, Sidecar, Webview, MCP, and Mesh.';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <div className="fixed bottom-4 right-4 z-40">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Toggle Desktop Log Console (Ctrl+Shift+L)"
          >
            <CodeIcon className="size-3.5" aria-hidden="true" />
            <span>Logs</span>
            {errorCount > 0 ? <Badge variant="destructive">{errorCount}</Badge> : null}
          </Button>
        </div>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Desktop Diagnostics & Logs</SheetTitle>
          <SheetDescription>{logsDescription} Shortcut: Ctrl+Shift+L.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {clearError ? (
            <p role="alert" className="text-sm text-destructive">
              {clearError}
            </p>
          ) : null}
          {readError ? (
            <p role="alert" className="text-sm text-destructive">
              {readError}
            </p>
          ) : null}
          <fieldset disabled={clearing} aria-busy={clearing || loading} className="min-w-0">
            <LogConsole
              entries={entries}
              description={logsDescription}
              loading={loading || clearing}
              emptyMessage={
                readError
                  ? 'No log entries to display. The latest refresh failed; any results are last known data.'
                  : undefined
              }
              copyStatus={copyStatus}
              onRefresh={() => {
                if (!clearing) void fetchLogs();
              }}
              onClear={() => {
                if (!clearing) {
                  setClearError(null);
                  setClearConfirmOpen(true);
                }
              }}
              onCopyForAi={(visible) => {
                if (!clearing) void handleCopyForAi(visible);
              }}
            />
          </fieldset>
          <ConfirmDialog
            open={clearConfirmOpen}
            title="Clear desktop logs?"
            description="This permanently clears the local desktop diagnostic log. This action cannot be undone."
            confirmLabel="Clear logs"
            destructive
            busy={clearing}
            onConfirm={() => {
              void handleClear();
            }}
            onCancel={() => setClearConfirmOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
