import { describe, expect, it } from 'vitest';
import { hasValidationError, toRecord } from '../src/http-plugins/helpers.js';

describe('orm-knowledge HTTP plugin helpers', () => {
  it('toRecord returns plain and null-prototype objects as records', () => {
    const plain = { id: 'record-1', count: 2 };
    expect(toRecord(plain)).toBe(plain);

    const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, {
      key: 'value',
    });
    expect(toRecord(nullProto)).toBe(nullProto);
  });

  it('toRecord returns null for null, primitives, arrays, and functions', () => {
    expect(toRecord(null)).toBeNull();
    expect(toRecord(undefined)).toBeNull();
    expect(toRecord('text')).toBeNull();
    expect(toRecord(42)).toBeNull();
    expect(toRecord(true)).toBeNull();
    expect(toRecord(['a', 'b'])).toBeNull();
    expect(toRecord(() => ({ ok: true }))).toBeNull();
  });

  it('hasValidationError detects truthy validationError properties on request objects', () => {
    expect(hasValidationError({ validationError: new Error('bad input') })).toBe(true);
    expect(hasValidationError({ validationError: null })).toBe(false);
    expect(hasValidationError({})).toBe(false);
    expect(hasValidationError(null)).toBe(false);
  });
});
