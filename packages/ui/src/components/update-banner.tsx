import type { ComponentProps } from 'react';
import { Badge } from './badge.js';
import { Button } from './button.js';
import {
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshIcon,
  WarningIcon,
} from '../icons/index.js';

export type UpdateBannerStatus =
  'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export type UpdateBannerProps = Omit<ComponentProps<'div'>, 'children'> & {
  currentVersion: string;
  availableVersion?: string;
  status: UpdateBannerStatus;
  progressPercent?: number;
  releaseUrl?: string;
  errorMessage?: string;
  onCheck?: () => void;
  onInstall?: () => void;
  onDismiss?: () => void;
};

function clampPercent(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getStatusBadge(status: UpdateBannerStatus): {
  label: string;
  variant: 'default' | 'primary' | 'magenta' | 'cyan' | 'destructive';
} {
  switch (status) {
    case 'checking':
      return { label: 'Checking', variant: 'cyan' };
    case 'available':
      return { label: 'Update Available', variant: 'primary' };
    case 'downloading':
      return { label: 'Downloading', variant: 'cyan' };
    case 'ready':
      return { label: 'Ready to Install', variant: 'magenta' };
    case 'error':
      return { label: 'Update Error', variant: 'destructive' };
    case 'idle':
    default:
      return { label: 'Up to Date', variant: 'default' };
  }
}

export function UpdateBanner({
  currentVersion,
  availableVersion,
  status,
  progressPercent,
  releaseUrl,
  errorMessage,
  onCheck,
  onInstall,
  onDismiss,
  className,
  ...props
}: UpdateBannerProps) {
  const badge = getStatusBadge(status);
  const clampedProgress = clampPercent(progressPercent);
  const isLiveAlert = status === 'error';
  const classes = [
    'mw-ui-update-banner flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink bg-paper-raised px-4 py-2.5 text-sm text-ink',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      data-slot="update-banner"
      data-status={status}
      role={isLiveAlert ? 'alert' : 'status'}
      aria-live={isLiveAlert ? 'assertive' : 'polite'}
      className={classes}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <Badge variant={badge.variant}>{badge.label}</Badge>

        {status === 'checking' && (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-soft">
            <RefreshIcon className="size-3.5 animate-spin" aria-hidden="true" />
            Checking for updates (v{currentVersion})…
          </span>
        )}

        {status === 'idle' && (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-soft">
            <CheckCircleIcon className="size-3.5" aria-hidden="true" />
            MoonWitness Desktop v{currentVersion}
          </span>
        )}

        {status === 'available' && (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink">
            <DownloadIcon className="size-3.5" aria-hidden="true" />v{availableVersion ?? 'new'}{' '}
            available (current v{currentVersion})
          </span>
        )}

        {status === 'downloading' && (
          <span className="inline-flex items-center gap-2 font-mono text-xs text-ink">
            <DownloadIcon className="size-3.5" aria-hidden="true" />
            <span>
              Downloading v{availableVersion ?? 'update'}
              {clampedProgress !== undefined ? ` (${clampedProgress}%)` : '…'}
            </span>
          </span>
        )}

        {status === 'ready' && (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink">
            <CheckCircleIcon className="size-3.5" aria-hidden="true" />v
            {availableVersion ?? 'update'} ready — restart to apply
          </span>
        )}

        {status === 'error' && (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink">
            <WarningIcon className="size-3.5" aria-hidden="true" />
            {errorMessage ?? `Unable to check for updates (v${currentVersion})`}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {releaseUrl && (status === 'available' || status === 'ready') && (
          <Button asChild variant="outline" size="xs">
            <a href={releaseUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              Release Notes
            </a>
          </Button>
        )}

        {onCheck && (status === 'idle' || status === 'error') && (
          <Button type="button" variant="outline" size="xs" onClick={onCheck}>
            <RefreshIcon className="size-3.5" aria-hidden="true" />
            Check for Updates
          </Button>
        )}

        {onInstall && (status === 'available' || status === 'ready') && (
          <Button type="button" variant="default" size="xs" onClick={onInstall}>
            <DownloadIcon className="size-3.5" aria-hidden="true" />
            {status === 'ready' ? 'Restart & Install' : 'Download & Install'}
          </Button>
        )}

        {onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onDismiss}
            aria-label="Dismiss update banner"
          >
            <CloseIcon className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
