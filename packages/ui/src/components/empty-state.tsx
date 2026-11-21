import type { ComponentProps, ReactNode } from 'react';

export type EmptyStateProps = Omit<ComponentProps<'section'>, 'children' | 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel = 2,
  className,
  ...props
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={['mw-ui-empty-state', className].filter(Boolean).join(' ')} {...props}>
      {icon ? (
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
