import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type FilterFacet = {
  id: string;
  label: string;
  value: string;
};

export type FilterFacetBarProps = {
  facets: readonly FilterFacet[];
  onFacetRemove?: (facetId: string) => void;
  children?: ReactNode;
  className?: string;
};

export function FilterFacetBar({
  facets,
  onFacetRemove,
  children,
  className,
}: FilterFacetBarProps) {
  if (facets.length === 0 && !children) return null;

  return (
    <div className={cn('mw-ui-filter-facet-bar', className)} data-slot="filter-facet-bar">
      {facets.map((facet) => (
        <button
          aria-label={`Remove ${facet.label}: ${facet.value}`}
          className="mw-ui-filter-facet"
          data-slot="filter-facet"
          key={facet.id}
          onClick={() => onFacetRemove?.(facet.id)}
          type="button"
        >
          <span className="mw-ui-filter-facet-label">
            {facet.label}: {facet.value}
          </span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
      {children}
    </div>
  );
}
