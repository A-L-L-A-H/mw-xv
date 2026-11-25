'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Domain, ResolvedViews } from '@moonwitness/client';
import { Button } from '@moonwitness/ui/components/button';
import { FilterFacetBar, type FilterFacet } from '@moonwitness/ui/components/filter-facet-bar';
import { Input } from '@moonwitness/ui/components/input';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

export interface SearchState {
  query: string;
  filterIndex: number | null;
  groupBy: string | null;
  view: string;
}

function searchStateToParams(state: SearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.filterIndex !== null) params.set('filter', String(state.filterIndex));
  if (state.groupBy) params.set('group', state.groupBy);
  if (state.view !== 'list') params.set('view', state.view);
  return params;
}

function setSearchState(next: SearchState) {
  const url = new URL(window.location.href);
  url.search = searchStateToParams(next).toString();
  window.history.replaceState(null, '', url);
}

export function SearchEngineBar({
  views,
  state,
  onChange,
}: {
  views: ResolvedViews;
  state: SearchState;
  onChange: (state: SearchState) => void;
}) {
  const update = useCallback(
    (patch: Partial<SearchState>) => {
      const next = { ...state, ...patch };
      onChange(next);
      setSearchState(next);
    },
    [onChange, state]
  );
  const groupableFields = views.fields.filter((field) =>
    ['selection', 'many2one', 'boolean'].includes(field.type)
  );
  const activeFilter =
    state.filterIndex !== null ? views.search.filters[state.filterIndex] : undefined;
  const activeGroupField = state.groupBy
    ? groupableFields.find((field) => field.name === state.groupBy)
    : undefined;
  const facets: FilterFacet[] = [
    ...(state.query.trim() ? [{ id: 'query', label: 'Search', value: state.query.trim() }] : []),
    ...(activeFilter ? [{ id: 'filter', label: 'Filter', value: activeFilter.label }] : []),
    ...(state.groupBy
      ? [{ id: 'group', label: 'Group', value: activeGroupField?.label ?? state.groupBy }]
      : []),
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm sm:w-80">
          <Input
            aria-label={`Search ${views.title}`}
            value={state.query}
            onChange={(event) => update({ query: event.target.value })}
            className="pl-4"
            placeholder={`Search ${views.title.toLowerCase()}...`}
          />
        </div>
        {groupableFields.length > 0 && (
          <label className="font-mono text-xs">
            Group by
            <SelectField
              value={state.groupBy ?? ''}
              onChange={(event) => update({ groupBy: event.target.value || null })}
              className="ml-2 h-8 border-2 border-ink bg-paper px-2"
            >
              <option value="">None</option>
              {groupableFields.map((field) => (
                <option key={field.name} value={field.name}>
                  {field.label}
                </option>
              ))}
            </SelectField>
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {views.search.filters.map((filter, index) => (
          <Button
            key={filter.label}
            data-active={state.filterIndex === index}
            className="sticker text-xs"
            onClick={() => update({ filterIndex: state.filterIndex === index ? null : index })}
          >
            {filter.label}
          </Button>
        ))}
      </div>
      <FilterFacetBar
        facets={facets}
        onFacetRemove={(facetId) => {
          if (facetId === 'query') update({ query: '' });
          else if (facetId === 'filter') update({ filterIndex: null });
          else if (facetId === 'group') update({ groupBy: null });
        }}
      />
      {state.groupBy && (
        <GroupHeader
          model={views.model}
          groupBy={state.groupBy}
          domain={activeFilter?.domain ?? []}
        />
      )}
    </div>
  );
}

function GroupHeader({
  model,
  groupBy,
  domain,
}: {
  model: string;
  groupBy: string;
  domain: Domain;
}) {
  const query = useQuery({
    queryKey: scopedQueryKey(['group-count', model, groupBy, domain]),
    queryFn: () => client.model(model).groupCount({ domain, groupBy: [groupBy], limit: 100 }),
  });
  return (
    <div role="status" className="border-2 border-ink bg-paper px-3 py-2 font-mono text-xs">
      {query.isLoading
        ? 'Loading group counts…'
        : `${query.data?.groups.length ?? 0} groups loaded`}
      {query.data?.hasMore && ' (more available)'}
    </div>
  );
}
