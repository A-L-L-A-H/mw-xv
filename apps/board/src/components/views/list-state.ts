import type { Domain, FieldMeta, ResolvedViews } from '@moonwitness/client';

export type ListSelection = {
  allOnPage: boolean;
  someOnPage: boolean;
  toggle(id: number): void;
  selectPage(ids: readonly number[], selected: boolean): void;
  clear(): void;
};

export function appendDomainTerms(domain: Domain, terms: Domain): Domain {
  return [...domain, ...terms];
}

export function escapeLike(value: string): string {
  return value.replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function orDomain(clauses: readonly [string, string, unknown][]): Domain {
  if (clauses.length === 0) return [];
  if (clauses.length === 1) return [clauses[0]];
  return [
    ...Array.from<Domain[number], '|'>({ length: clauses.length - 1 }, () => '|'),
    ...clauses,
  ];
}

export function coerceFilterValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  return value;
}

export function customFilterDomain(
  filters: ReadonlyArray<{ field: string; operator: string; value: string }>
): Domain {
  return filters.flatMap((filter): Domain => {
    if (filter.operator === 'ilike') return [[filter.field, 'ilike', `%${escapeLike(filter.value)}%`]];
    return [[filter.field, filter.operator, coerceFilterValue(filter.value)]];
  });
}

export function advancedFilterDomain(
  rules: ReadonlyArray<{ field: string; operator: string; value: string }>,
  conjunction: 'all' | 'any'
): Domain {
  const clauses = rules.flatMap((rule): Domain => {
    if (rule.operator === 'is_set') return [[rule.field, '!=', null]];
    if (rule.operator === 'is_null') return [[rule.field, '=', null]];
    if (rule.operator === 'ilike') return [[rule.field, 'ilike', `%${escapeLike(rule.value)}%`]];
    return [[rule.field, rule.operator, coerceFilterValue(rule.value)]];
  });
  if (clauses.length <= 1 || conjunction === 'all') return clauses;
  return orDomain(clauses as [string, string, unknown][]);
}

export function searchDomain(
  views: ResolvedViews,
  searchTerm: string
): Domain {
  const query = searchTerm.trim();
  if (!query) return [];
  const fields =
    views.search?.fields?.length
      ? views.search.fields
      : views.fields.filter((f) => f.type === 'string').map((f) => f.name).slice(0, 3);
  return orDomain(fields.map((field) => [field, 'ilike', `%${escapeLike(query)}%`]));
}

export function listColumns(views: ResolvedViews, hiddenColumns: ReadonlySet<string>) {
  return views.list.columns
    .map((name) => views.fields.find((field) => field.name === name))
    .filter((field): field is FieldMeta => Boolean(field) && !field!.writeOnly && !hiddenColumns.has(field!.name));
}

export function pagination(total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  return { totalPages, page: safePage, offset, first: total === 0 ? 0 : offset + 1, last: Math.min(offset + pageSize, total) };
}

export function selectionState(recordIds: readonly number[], selectedIds: readonly number[]) {
  const selected = new Set(selectedIds);
  const allOnPage = recordIds.length > 0 && recordIds.every((id) => selected.has(id));
  const someOnPage = recordIds.some((id) => selected.has(id)) && !allOnPage;
  return { allOnPage, someOnPage };
}

export function titleField(columns: readonly FieldMeta[]): FieldMeta | undefined {
  return columns.find((field) => ['name', 'login', 'summary', 'code'].includes(field.name)) ??
    columns.find((field) => field.type === 'string');
}

export function aggregate(columnName: string, rows: readonly Record<string, unknown>[], operation: 'sum' | 'avg'): number | undefined {
  const values = rows.map((row) => row[columnName]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return undefined;
  const sum = values.reduce((total, value) => total + value, 0);
  return operation === 'sum' ? sum : sum / values.length;
}
