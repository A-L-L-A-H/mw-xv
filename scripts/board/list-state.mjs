export function escapeLike(value) {
  return value.replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function orDomain(clauses) {
  if (clauses.length === 0) return [];
  if (clauses.length === 1) return [...clauses];
  return [...Array.from({ length: clauses.length - 1 }, () => '|'), ...clauses];
}

export function coerceFilterValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  return /^-?\d+(?:\.\d+)?$/u.test(value) ? Number(value) : value;
}

export function customFilterDomain(filters) {
  return filters.flatMap((filter) => filter.operator === 'ilike'
    ? [[filter.field, 'ilike', `%${escapeLike(filter.value)}%`]]
    : [[filter.field, filter.operator, coerceFilterValue(filter.value)]]);
}

export function advancedFilterDomain(rules, conjunction) {
  const clauses = rules.flatMap((rule) => {
    if (rule.operator === 'is_set') return [[rule.field, '!=', null]];
    if (rule.operator === 'is_null') return [[rule.field, '=', null]];
    if (rule.operator === 'ilike') return [[rule.field, 'ilike', `%${escapeLike(rule.value)}%`]];
    return [[rule.field, rule.operator, coerceFilterValue(rule.value)]];
  });
  return clauses.length <= 1 || conjunction === 'all' ? clauses : orDomain(clauses);
}

export function searchDomain(views, searchTerm) {
  const query = searchTerm.trim();
  if (!query) return [];
  const fields = views.search?.fields?.length
    ? views.search.fields
    : (views.fields ?? []).filter((field) => field.type === 'string').map((field) => field.name).slice(0, 3);
  return orDomain(fields.map((field) => [field, 'ilike', `%${escapeLike(query)}%`]));
}

export function pagination(total, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  return { totalPages, page: safePage, offset, first: total === 0 ? 0 : offset + 1, last: Math.min(offset + pageSize, total) };
}

export function selectionState(recordIds, selectedIds) {
  const selected = new Set(selectedIds);
  const allOnPage = recordIds.length > 0 && recordIds.every((id) => selected.has(id));
  const someOnPage = recordIds.some((id) => selected.has(id)) && !allOnPage;
  return { allOnPage, someOnPage };
}

export function aggregate(columnName, rows, operation) {
  const values = rows.map((row) => row[columnName]).filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return undefined;
  const sum = values.reduce((total, value) => total + value, 0);
  return operation === 'avg' ? sum / values.length : sum;
}
