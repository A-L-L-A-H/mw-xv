import type { ComponentProps, ReactNode } from 'react';
import {
  STATE_ILLUSTRATIONS,
  getStateIllustration,
  type StateIllustrationSlug,
} from '../lib/asset-registry.js';
import { cn } from '../lib/cn.js';

export type EmptyStateProps = Omit<ComponentProps<'section'>, 'children' | 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  illustration?: StateIllustrationSlug | ReactNode;
  basePath?: string;
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
};

function isStateIllustrationSlug(value: unknown): value is StateIllustrationSlug {
  return typeof value === 'string' && (STATE_ILLUSTRATIONS as readonly string[]).includes(value);
}

export function EmptyState({
  title,
  description,
  icon,
  illustration,
  basePath = '',
  action,
  headingLevel = 2,
  className,
  ...props
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  const resolvedIllustration = isStateIllustrationSlug(illustration)
    ? getStateIllustration(illustration, { basePath })
    : null;

  return (
    <section className={cn('mw-ui-empty-state', className)} {...props}>
      {resolvedIllustration ? (
        <div className="mw-ui-empty-state-illustration" aria-hidden="true">
          <img src={resolvedIllustration.src} alt="" decoding="async" />
        </div>
      ) : illustration ? (
        <div className="mw-ui-empty-state-illustration" aria-hidden="true">
          {illustration}
        </div>
      ) : icon ? (
        <div className="mw-ui-empty-state-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <Heading className="mw-ui-empty-state-title">{title}</Heading>
      {description ? <p className="mw-ui-empty-state-description">{description}</p> : null}
      {action ? <div className="mw-ui-empty-state-action">{action}</div> : null}
    </section>
  );
}
