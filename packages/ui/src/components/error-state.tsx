import type { ComponentProps, ReactNode } from 'react';
import { getStateIllustration, type StateIllustrationSlug } from '../lib/asset-registry.js';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { LoadingSpinner } from './effects.js';

export type ErrorStateProps = Omit<ComponentProps<'section'>, 'children' | 'title'> & {
  code?: string | number;
  title: ReactNode;
  description?: ReactNode;
  stateSlug?: StateIllustrationSlug;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  basePath?: string;
  headingLevel?: 1 | 2 | 3;
};

/** Illustrated error and recovery surface with accessible alert semantics and retry action. */
export function ErrorState({
  code,
  title,
  description,
  stateSlug = 'error',
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
  primaryAction,
  secondaryAction,
  basePath = '',
  headingLevel = 1,
  role = 'alert',
  className,
  ...props
}: ErrorStateProps) {
  const Heading = `h${headingLevel}` as const;
  const illustration = getStateIllustration(stateSlug, { basePath });

  return (
    <section
      role={role}
      data-slot="error-state"
      data-state-slug={stateSlug}
      className={cn('mw-ui-error-state', className)}
      {...props}
    >
      <div className="mw-ui-error-state-illustration" aria-hidden="true">
        <img src={illustration.src} alt="" decoding="async" />
      </div>
      {code !== undefined && code !== '' ? <p className="mw-ui-error-state-code">{code}</p> : null}
      <Heading className="mw-ui-error-state-title">{title}</Heading>
      {description ? <p className="mw-ui-error-state-description">{description}</p> : null}
      {primaryAction || onRetry || secondaryAction ? (
        <div className="mw-ui-error-state-actions">
          {primaryAction ??
            (onRetry ? (
              <Button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                aria-busy={retrying || undefined}
              >
                {retrying ? <LoadingSpinner /> : null}
                <span>{retryLabel}</span>
              </Button>
            ) : null)}
          {secondaryAction}
        </div>
      ) : null}
    </section>
  );
}
