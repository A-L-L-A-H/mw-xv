import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type PanelProps = Omit<ComponentProps<'section'>, 'children' | 'title'> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  surface?: 'default' | 'ink' | 'paper';
  frame?: 'line' | 'torn' | 'scuffed' | 'grunge';
  density?: 'comfortable' | 'compact' | 'micro' | 'spacious';
  contentClassName?: string;
  headingLevel?: 2 | 3 | 4;
};

export function Panel({
  title,
  description,
  actions,
  children,
  surface = 'default',
  frame = 'line',
  density = 'comfortable',
  contentClassName,
  headingLevel = 2,
  className,
  ...props
}: PanelProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section
      className={cn('mw-ui-panel', className)}
      data-density={density}
      data-frame={frame}
      data-surface={surface}
      {...props}
    >
      {title || description || actions ? (
        <header className="mw-ui-panel-header">
          <div>
            {title ? <Heading className="mw-ui-panel-title">{title}</Heading> : null}
            {description ? <p className="mw-ui-panel-description">{description}</p> : null}
          </div>
          {actions ? <div className="mw-ui-panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('mw-ui-panel-content', contentClassName)}>{children}</div>
    </section>
  );
}
