import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { Panel } from '@moonwitness/ui/components/panel';
import { CheckCircleIcon, RefreshIcon, SparkleIcon, WarningIcon } from '@moonwitness/ui/icons';

type TelemetryLevel = 'info' | 'warn' | 'error';

interface TelemetryPayload {
  readonly level: TelemetryLevel;
  readonly source: 'webview';
  readonly message: string;
  readonly detail?: string;
  readonly timestamp: string;
}

const REDACT_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/giu,
  /\bsk-[A-Za-z0-9_-]{12,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/gu,
  /(?:api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*["']?([^\s"',;}{]+)["']?/giu,
];

function redactClientText(input: string): string {
  let out = input;
  out = out.replace(REDACT_PATTERNS[0]!, 'Bearer [REDACTED]');
  out = out.replace(REDACT_PATTERNS[1]!, '[REDACTED_KEY]');
  out = out.replace(REDACT_PATTERNS[2]!, '[REDACTED_TOKEN]');
  out = out.replace(REDACT_PATTERNS[3]!, (match, value: string) =>
    match.replace(value, '[REDACTED]')
  );
  return out;
}

function serializeUnknownArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function postTelemetry(
  getApiUrl: () => string | null | undefined,
  payload: TelemetryPayload
): void {
  const rawUrl = getApiUrl();
  if (!rawUrl || typeof rawUrl !== 'string') return;
  const apiUrl = rawUrl.replace(/\/+$/u, '');
  try {
    void fetch(`${apiUrl}/api/desktop/logs/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Non-blocking best-effort telemetry delivery.
    });
  } catch {
    // Ignore synchronous fetch construction errors.
  }
}

export function installWebviewErrorTelemetry(
  getApiUrl: () => string | null | undefined
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let forwarding = false;
  const emit = (level: TelemetryLevel, message: string, detail?: string) => {
    if (forwarding) return;
    forwarding = true;
    try {
      postTelemetry(getApiUrl, {
        level,
        source: 'webview',
        message: redactClientText(message).slice(0, 1000),
        ...(detail ? { detail: redactClientText(detail).slice(0, 4000) } : {}),
        timestamp: new Date().toISOString(),
      });
    } finally {
      forwarding = false;
    }
  };

  const previousOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    const text = typeof message === 'string' ? message : String(message);
    const location = source ? `${source}:${lineno ?? 0}:${colno ?? 0}` : undefined;
    const detail = error?.stack ?? location;
    emit('error', text, detail);
    if (typeof previousOnError === 'function') {
      return previousOnError(message, source, lineno, colno, error);
    }
    return false;
  };

  const previousOnUnhandledRejection = window.onunhandledrejection;
  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? `Unhandled rejection: ${reason.message}`
        : `Unhandled rejection: ${serializeUnknownArg(reason)}`;
    const detail = reason instanceof Error ? reason.stack : undefined;
    emit('error', message, detail);
    if (typeof previousOnUnhandledRejection === 'function') {
      return previousOnUnhandledRejection.call(window, event);
    }
    return undefined;
  };

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: readonly unknown[]) => {
    const joined = args.map(serializeUnknownArg).join(' ');
    emit('error', joined);
    originalConsoleError(...args);
  };

  return () => {
    window.onerror = previousOnError;
    window.onunhandledrejection = previousOnUnhandledRejection;
    console.error = originalConsoleError;
  };
}

export interface DesktopErrorBoundaryProps {
  readonly children: ReactNode;
  readonly getApiUrl?: () => string | null | undefined;
}

interface DesktopErrorBoundaryState {
  readonly error: Error | null;
  readonly componentStack: string | null;
  readonly copied: boolean;
}

export class DesktopErrorBoundary extends Component<
  DesktopErrorBoundaryProps,
  DesktopErrorBoundaryState
> {
  override state: DesktopErrorBoundaryState = {
    error: null,
    componentStack: null,
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<DesktopErrorBoundaryState> {
    return { error, copied: false };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = info.componentStack ?? null;
    this.setState({ componentStack: stack });
    if (this.props.getApiUrl) {
      postTelemetry(this.props.getApiUrl, {
        level: 'error',
        source: 'webview',
        message: redactClientText(`React boundary caught: ${error.message}`),
        detail: redactClientText([error.stack, stack].filter(Boolean).join('\n')),
        timestamp: new Date().toISOString(),
      });
    }
  }

  private readonly handleCopyForAi = async (): Promise<void> => {
    const { error, componentStack } = this.state;
    const report = [
      '# MoonWitness Desktop Crash Report',
      '',
      `- **Timestamp**: ${new Date().toISOString()}`,
      `- **Message**: ${redactClientText(error?.message ?? 'Unknown error')}`,
      '',
      '```text',
      redactClientText(error?.stack ?? 'No stack trace'),
      componentStack ? `\nComponent Stack:\n${redactClientText(componentStack)}` : '',
      '```',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(report);
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  private readonly handleReload = (): void => {
    this.setState({ error: null, componentStack: null, copied: false });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return React.createElement(
      'main',
      {
        className: 'flex min-h-dvh items-center justify-center bg-paper p-6 text-ink',
        role: 'alert',
      },
      React.createElement(Panel, {
        className: 'w-full max-w-xl',
        title: 'Desktop View Interrupted',
        description:
          'An unexpected rendering error occurred. You can reload safely or copy a redacted diagnostic report for AI troubleshooting.',
        actions: React.createElement(WarningIcon, {
          className: 'size-5 text-destructive',
          'aria-hidden': 'true',
        }),
        children: React.createElement(
          'div',
          { className: 'flex flex-col gap-4' },
          React.createElement(
            'pre',
            {
              className:
                'max-h-48 overflow-auto border-2 border-ink bg-night p-3 font-mono text-xs text-paper whitespace-pre-wrap break-words',
            },
            redactClientText(this.state.error.message)
          ),
          React.createElement(
            'div',
            { className: 'flex flex-wrap items-center gap-2' },
            React.createElement(
              Button,
              {
                type: 'button',
                variant: 'default',
                size: 'sm',
                onClick: () => {
                  void this.handleCopyForAi();
                },
              },
              this.state.copied
                ? React.createElement(CheckCircleIcon, {
                    className: 'size-3.5',
                    'aria-hidden': 'true',
                  })
                : React.createElement(SparkleIcon, {
                    className: 'size-3.5',
                    'aria-hidden': 'true',
                  }),
              React.createElement('span', null, this.state.copied ? 'Copied for AI' : 'Copy for AI')
            ),
            React.createElement(
              Button,
              {
                type: 'button',
                variant: 'outline',
                size: 'sm',
                onClick: this.handleReload,
              },
              React.createElement(RefreshIcon, {
                className: 'size-3.5',
                'aria-hidden': 'true',
              }),
              React.createElement('span', null, 'Reload View')
            )
          )
        ),
      })
    );
  }
}
