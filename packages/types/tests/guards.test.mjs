import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNonEmpty,
  assertPositiveInteger,
  isJsonObject,
  isJsonValue,
  isPositiveId,
  isRecord,
} from '../dist/guards.js';

test('isRecord accepts non-null non-array objects only', () => {
  assert.equal(isRecord({ value: 1 }), true);
  assert.equal(isRecord(Object.create(null)), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord('value'), false);
});

test('isJsonValue accepts recursive JSON values and finite numbers', () => {
  assert.equal(isJsonValue(null), true);
  assert.equal(isJsonValue({ nested: [true, 1, 'value', null] }), true);
  assert.equal(isJsonValue(Number.MAX_VALUE), true);
  assert.equal(isJsonValue(Number.NaN), false);
  assert.equal(isJsonValue(Number.POSITIVE_INFINITY), false);
  assert.equal(isJsonValue(undefined), false);
  assert.equal(isJsonValue(1n), false);
  assert.equal(isJsonValue(new Date()), false);
  assert.equal(isJsonValue(new Map()), false);
});

test('isJsonValue rejects cyclic references without recursion overflow', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(isJsonValue(cyclic), false);
});

test('isJsonValue allows shared non-cyclic subobjects', () => {
  const child = { ok: true };
  assert.equal(isJsonValue({ first: child, second: child }), true);
});

test('isJsonObject narrows only recursively valid object payloads', () => {
  assert.equal(isJsonObject({ id: 1, values: ['valid'] }), true);
  assert.equal(isJsonObject({ id: Number.NaN }), false);
  assert.equal(isJsonObject(new Date()), false);
  assert.equal(isJsonObject([]), false);
  assert.equal(isJsonObject(null), false);
});

test('isPositiveId accepts positive safe integers only', () => {
  assert.equal(isPositiveId(1), true);
  assert.equal(isPositiveId(Number.MAX_SAFE_INTEGER), true);
  assert.equal(isPositiveId(0), false);
  assert.equal(isPositiveId(-1), false);
  assert.equal(isPositiveId(1.5), false);
  assert.equal(isPositiveId('1'), false);
  assert.equal(isPositiveId(Number.MAX_SAFE_INTEGER + 1), false);
});

test('assertNonEmpty and assertPositiveInteger throw canonical error messages', () => {
  assert.doesNotThrow(() => assertNonEmpty('ok', 'tenantId'));
  assert.throws(() => assertNonEmpty('', 'tenantId'), {
    name: 'Error',
    message: 'tenantId must be a non-empty string',
  });
  assert.throws(() => assertNonEmpty('   ', 'keyId'), {
    name: 'Error',
    message: 'keyId must be a non-empty string',
  });
  assert.throws(() => assertNonEmpty(123, 'keyId'), {
    name: 'Error',
    message: 'keyId must be a non-empty string',
  });

  assert.doesNotThrow(() => assertPositiveInteger(1, 'companyId'));
  assert.throws(() => assertPositiveInteger(0, 'companyId'), {
    name: 'Error',
    message: 'companyId must be a positive safe integer',
  });
  assert.throws(() => assertPositiveInteger(-5, 'companyId'), {
    name: 'Error',
    message: 'companyId must be a positive safe integer',
  });
  assert.throws(() => assertPositiveInteger('7', 'companyId'), {
    name: 'Error',
    message: 'companyId must be a positive safe integer',
  });
});
