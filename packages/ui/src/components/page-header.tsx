import type { ComponentProps, ReactNode } from 'react';

export type PageHeaderProps = Omit<ComponentProps<'header'>, 'children' | 'title'> & {
  title: ReactNode;
  accentTitle?: ReactNode;
  accent?: 'magenta' | 'yellow' | 'cyan';
  description?: ReactNode;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  treatment?: 'display' | 'brush';
  scale?: 'default' | 'hero';
  headingLevel?: 1 | 2 | 3;
};

export function PageHeader({
  title,
  accentTitle,
  accent = 'magenta',
  description,
  breadcrumbs,
  actions,
  treatment = 'display',
  scale = 'default',
  headingLevel = 1,
  className,
  ...props
}: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <header
      className={['mw-ui-page-header', className].filter(Boolean).join(' ')}
      data-accent={accent}
      data-scale={scale}
      data-treatment={treatment}
      {...props}
    >
      {breadcrumbs ? <nav aria-label="Breadcrumb">{breadcrumbs}</nav> : null}
      <div className="mw-ui-page-header-main">
        <div className="mw-ui-page-header-copy">
          <Heading className="mw-ui-page-header-title">
            {accentTitle ? (
              <>
                <span>{title}</span>{' '}
                <span className="mw-ui-page-header-title-accent">{accentTitle}</span>
              </>
            ) : (
              title
            )}
          </Heading>
          {description ? <p className="mw-ui-page-header-description">{description}</p> : null}
        </div>
        {actions ? <div className="mw-ui-page-header-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
