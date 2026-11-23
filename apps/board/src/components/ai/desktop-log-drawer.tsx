'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import {
  LogConsole,
  type LogConsoleEntry,
} from '@moonwitness/ui/components/log-console';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@moonwitness/ui/components/sheet';
import {
  CheckCircleIcon,
  CodeIcon,
  SparkleIcon,
} from '@moonwitness/ui/icons';
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

function getDesktopApiBaseUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as DesktopApiWindow).__MW_DESKTOP_API_URL__;
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/\/+$/u, '');
}

function buildFallbackMarkdown(entries: readonly LogConsoleEntry[]): string {
  const lines = [
    '# MoonWitness Desktop Diagnostic Bundle',
    '',
    `- **Captured At**: ${new Date().toISOString()}`,
    `- **Entries**: ${entries.length}`,
    '',
    '```text',
    ...entries.slice(-50).map(
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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const isDeveloperMode = mode === 'developer';

  const fetchLogs = useCallback(async () => {
    const baseUrl = getDesktopApiBaseUrl();
    if (!baseUrl) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseUrl}/api/desktop/logs`);
      if (!response.ok) return;
      const payload = (await response.json()) as DesktopLogsResponse;
      if (Array.isArray(payload.entries)) {
        setEntries(payload.entries);
      }
    } catch {
      // Sidecar may be restarting; keep last known entries.
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClear = useCallback(async () => {
    const baseUrl = getDesktopApiBaseUrl();
    if (!baseUrl) {
      setEntries([]);
      return;
    }
    try {
      await fetch(`${baseUrl}/api/desktop/logs/clear`, { method: 'POST' });
      setEntries([]);
    } catch {
      // Keep UI responsive if sidecar is unavailable.
    }
  }, []);

  const handleCopyForAi = useCallback(
    async (visibleEntries?: readonly LogConsoleEntry[]) => {
      const baseUrl = getDesktopApiBaseUrl();
      let markdown = buildFallbackMarkdown(visibleEntries ?? entries);

      if (baseUrl) {
        try {
          const response = await fetch(`${baseUrl}/api/desktop/logs/bundle`);
          if (response.ok) {
            const contentType = response.headers.get('content-type') ?? '';
            if (contentType.includes('application/json')) {
              const payload = (await response.json()) as DesktopBundleResponse;
              markdown = payload.markdown ?? payload.bundle ?? markdown;
            } else {
              const text = await response.text();
              if (text.trim().length > 0) markdown = text;
            }
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
    if (!isDeveloperMode || !open) return;
    void fetchLogs();
    const timer = window.setInterval(() => {
      void fetchLogs();
    }, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, [isDeveloperMode, open, fetchLogs]);

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
            {errorCount > 0 ? (
              <Badge variant="destructive">{errorCount}</Badge>
            ) : null}
          </Button>
        </div>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Desktop Diagnostics & Logs</SheetTitle>
          <SheetDescription>
            Live loopback sidecar, Rust host, Webview, MCP, and Mesh logs. Shortcut: Ctrl+Shift+L.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <LogConsole
            entries={entries}
            loading={loading}
            copyStatus={copyStatus}
            onRefresh={() => {
              void fetchLogs();
            }}
            onClear={() => {
              void handleClear();
            }}
            onCopyForAi={(visible) => {
              void handleCopyForAi(visible);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
