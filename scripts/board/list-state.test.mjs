import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregate,
  advancedFilterDomain,
  customFilterDomain,
  escapeLike,
  orDomain,
  pagination,
  searchDomain,
  selectionState,
} from './list-state.mjs';

test('builds escaped search and filter domains', () => {
  assert.deepEqual(escapeLike('50%_off'), '50\\%\\_off');
  assert.deepEqual(
    orDomain([
      ['name', 'ilike', 'x'],
      ['email', 'ilike', 'x'],
    ]),
    ['|', ['name', 'ilike', 'x'], ['email', 'ilike', 'x']]
  );
  assert.deepEqual(customFilterDomain([{ field: 'age', operator: '>', value: '21' }]), [
    ['age', '>', 21],
  ]);
  assert.deepEqual(
    advancedFilterDomain([{ field: 'name', operator: 'is_set', value: '' }], 'all'),
    [['name', '!=', null]]
  );
});

test('computes pagination and selection state', () => {
  assert.deepEqual(pagination(41, 5, 20), {
    totalPages: 3,
    page: 3,
    offset: 40,
    first: 41,
    last: 41,
  });
  assert.deepEqual(selectionState([1, 2], [2]), { allOnPage: false, someOnPage: true });
});

test('aggregates numeric rows only', () => {
  const rows = [{ amount: 2 }, { amount: 'x' }, { amount: 4 }];
  assert.equal(aggregate('amount', rows, 'sum'), 6);
  assert.equal(aggregate('amount', rows, 'avg'), 3);
  const optionalAggregation = undefined;
  assert.equal(aggregate('amount', rows, optionalAggregation ?? 'sum'), 6);
});

test('search domain uses metadata or falls back to strings', () => {
  const views = { search: { fields: ['name'], filters: [] }, fields: [] };
  assert.deepEqual(searchDomain(views, ' moon '), [['name', 'ilike', '%moon%']]);
  assert.deepEqual(searchDomain({ search: undefined, fields: [] }, ''), []);
});
