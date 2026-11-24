import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { ChevronRightIcon } from '../icons/chevron-right.js';
import { cn } from '../lib/cn.js';

export type BreadcrumbItem = {
  readonly label: ReactNode;
  readonly href?: string;
  readonly current?: boolean;
};

export type BreadcrumbsProps = Omit<ComponentProps<'nav'>, 'children'> & {
  items: readonly BreadcrumbItem[];
  renderLink?: (item: BreadcrumbItem, index: number, className: string) => ReactNode;
  onNavigate?: (item: BreadcrumbItem, event: MouseEvent<HTMLAnchorElement>) => void;
};

/** Router-agnostic breadcrumb navigation landmark with customizable link rendering. */
export function Breadcrumbs({
  items,
  renderLink,
  onNavigate,
  className,
  'aria-label': ariaLabel = 'Breadcrumb',
  ...props
}: BreadcrumbsProps) {
  return (
    <nav
      aria-label={ariaLabel}
      data-slot="breadcrumbs"
      className={cn('mw-ui-breadcrumbs', className)}
      {...props}
    >
      <ol className="mw-ui-breadcrumbs-list">
        {items.map((item, index) => {
          const isCurrent = Boolean(item.current ?? (!item.href && index === items.length - 1));
          const key =
            typeof item.label === 'string' && item.href
              ? `${item.href}:${item.label}:${index}`
              : index;
          return (
            <li key={key} className="mw-ui-breadcrumbs-item">
              {index > 0 ? (
                <span className="mw-ui-breadcrumbs-separator" aria-hidden="true">
                  <ChevronRightIcon size={14} />
                </span>
              ) : null}
              {isCurrent ? (
                <span className="mw-ui-breadcrumbs-current" aria-current="page">
                  {item.label}
                </span>
              ) : item.href ? (
                renderLink ? (
                  renderLink(item, index, 'mw-ui-breadcrumbs-link')
                ) : (
                  <a
                    href={item.href}
                    className="mw-ui-breadcrumbs-link"
                    onClick={onNavigate ? (event) => onNavigate(item, event) : undefined}
                  >
                    {item.label}
                  </a>
                )
              ) : (
                <span className="mw-ui-breadcrumbs-text">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
