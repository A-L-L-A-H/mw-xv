import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN_OPERATORS,
  evalDomain,
  resolveDomainContext,
  parseInteger,
  countValue,
  resolveLocale,
  translate,
} from '../dist/index.js';

test('DOMAIN_OPERATORS covers all 16 canonical operators', () => {
  assert.equal(DOMAIN_OPERATORS.size, 16);
});

test('evalDomain evaluates all 16 operators accurately', () => {
  const rec = {
    name: 'Alice Smith',
    age: 30,
    active: true,
    note: null,
    partner: { country: { code: 'ID' } },
  };

  assert.equal(evalDomain([['name', '=', 'Alice Smith']], rec), true);
  assert.equal(evalDomain([['name', '!=', 'Bob']], rec), true);
  assert.equal(evalDomain([['name', '<>', 'Bob']], rec), true);
  assert.equal(evalDomain([['age', '>', 20]], rec), true);
  assert.equal(evalDomain([['age', '>=', 30]], rec), true);
  assert.equal(evalDomain([['age', '<', 40]], rec), true);
  assert.equal(evalDomain([['age', '<=', 30]], rec), true);
  assert.equal(evalDomain([['name', 'like', 'Alice%']], rec), true);
  assert.equal(evalDomain([['name', 'not like', 'Bob%']], rec), true);
  assert.equal(evalDomain([['name', 'ilike', 'alice']], rec), true);
  assert.equal(evalDomain([['name', 'not ilike', 'charlie']], rec), true);
  assert.equal(evalDomain([['name', '=like', 'Alice Smith']], rec), true);
  assert.equal(evalDomain([['age', 'in', [25, 30, 35]]], rec), true);
  assert.equal(evalDomain([['age', 'not in', [10, 20]]], rec), true);
  assert.equal(evalDomain([['note', 'is null', true]], rec), true);
  assert.equal(evalDomain([['name', 'is not null', true]], rec), true);
  assert.equal(evalDomain([['partner.country.code', '=', 'ID']], rec), true);
  assert.equal(evalDomain(['!', ['age', '<', 18]], rec), true);
});

test('resolveDomainContext interpolates whitelisted tokens and rejects unknown tokens', () => {
  const fixedNow = new Date('2026-11-22T05:00:00.000Z');
  const resolved = resolveDomainContext(
    [
      ['user_id', '=', '$uid'],
      ['company_id', '=', '$company_id'],
      ['partner_id', '=', '$partner_id'],
      ['date', '>=', '$today'],
      ['created_at', '<=', '$now'],
    ],
    { uid: 7, companyId: 2, partnerId: 11, now: fixedNow }
  );

  assert.deepEqual(resolved, [
    ['user_id', '=', 7],
    ['company_id', '=', 2],
    ['partner_id', '=', 11],
    ['date', '>=', '2026-11-22'],
    ['created_at', '<=', '2026-11-22T05:00:00.000Z'],
  ]);

  assert.throws(
    () => resolveDomainContext([['x', '=', '$secret_env']], { uid: 1 }),
    /Unsupported domain context token/
  );
});

test('parseInteger and countValue handle numbers, strings, bigints, and invalid inputs', () => {
  assert.equal(parseInteger(42), 42);
  assert.equal(parseInteger('123'), 123);
  assert.equal(parseInteger(99n), 99);
  assert.equal(parseInteger('12.5'), null);
  assert.equal(parseInteger(NaN), null);
  assert.equal(countValue({ count: '15' }), 15);
  assert.equal(countValue({ 'count(*)': 4 }), 4);
  assert.equal(countValue(null), 0);
});

test('i18n resolveLocale and translate fall back deterministically to en-US', () => {
  assert.equal(resolveLocale('id-ID'), 'id-ID');
  assert.equal(resolveLocale(null, 'id,en-US;q=0.8'), 'id-ID');
  assert.equal(resolveLocale('fr-FR', 'de-DE'), 'en-US');

  const dict = {
    'en-US': { 'nav.partners': 'Partners' },
    'id-ID': { 'nav.partners': 'Mitra' },
  };
  assert.equal(translate(dict, 'nav.partners', 'id-ID'), 'Mitra');
  assert.equal(translate(dict, 'nav.partners', 'en-US'), 'Partners');
  assert.equal(translate(dict, 'nav.missing', 'id-ID', 'Fallback'), 'Fallback');
});
