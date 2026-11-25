'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip.js';
import { WarningIcon } from '../icons/warning.js';

export type MetricTileProps = Omit<ComponentProps<'article'>, 'children' | 'title'> & {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  accent?: 'magenta' | 'cyan' | 'yellow' | 'green' | 'violet';
  surface?: 'default' | 'paper' | 'ink';
  frame?: 'line' | 'torn' | 'scuffed' | 'grunge';
  size?: 'compact' | 'default' | 'hero';
  interactive?: boolean;
  error?: string;
};

/** Presentation only: callers own metric meaning, loading, and error states. */
export function MetricTile({
  label,
  value,
  detail,
  icon,
  accent = 'cyan',
  surface = 'default',
  frame = 'line',
  size = 'default',
  interactive = false,
  error,
  className,
  ...props
}: MetricTileProps) {
  const hasError = typeof error === 'string' && error.length > 0;
  const displayValue = hasError ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mw-ui-metric-tile-error-indicator" aria-label="Error">
          <WarningIcon
            aria-hidden="true"
            className="size-4 text-destructive"
            title={error}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{error}</TooltipContent>
    </Tooltip>
  ) : (
    value
  );

  return (
    <article
      className={['mw-ui-metric-tile', className].filter(Boolean).join(' ')}
      data-accent={accent}
      data-frame={frame}
      data-interactive={interactive ? 'true' : undefined}
      data-size={size}
      data-surface={surface}
      {...props}
    >
      <div className="mw-ui-metric-tile-heading">
        <p className="mw-ui-metric-tile-label">{label}</p>
        {icon ? (
          <span aria-hidden="true" className="mw-ui-metric-tile-icon">
            {icon}
          </span>
        ) : null}
      </div>
      <strong className="mw-ui-metric-tile-value">{displayValue}</strong>
      {detail ? <p className="mw-ui-metric-tile-detail">{detail}</p> : null}
    </article>
  );
}
