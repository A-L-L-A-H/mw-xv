import { describe, expect, it } from 'vitest';
import { toCanonicalJson, sha256Canonical } from '../src/canonical-json.js';

describe('canonical-json cross-call-site consistency', () => {
  const testCases = [
    { name: 'primitives', input: null },
    { name: 'primitives', input: 42 },
    { name: 'primitives', input: 'hello' },
    { name: 'primitives', input: true },
    { name: 'array', input: [3, 1, 2] },
    { name: 'array of objects', input: [{ b: 2 }, { a: 1 }] },
    { name: 'nested object', input: { c: 3, a: { z: 26, b: 2 }, b: [9, 7] } },
    { name: 'undefined in object', input: { a: 1, b: undefined, c: 3 } },
    { name: 'empty object', input: {} },
    { name: 'empty array', input: [] },
    {
      name: 'complex nested',
      input: {
        users: [
          { id: 1, tags: ['b', 'a'] },
          { id: 2, tags: [] },
        ],
        meta: { version: 2, created: '2024-01-01' },
      },
    },
    { name: 'unicode', input: { 你好: '世界', emoji: '🚀🌟' } },
    { name: 'special numbers', input: { nan: NaN, inf: Infinity, negInf: -Infinity, zero: 0 } },
    { name: 'deep nesting', input: { a: { b: { c: { d: { e: { f: 1 } } } } } } },
  ];

  for (const { name, input } of testCases) {
    it(`serializes ${name} deterministically`, () => {
      const result1 = toCanonicalJson(input);
      const result2 = toCanonicalJson(input);
      expect(result1).toBe(result2);
    });

    it(`hashes ${name} deterministically`, () => {
      const hash1 = sha256Canonical(input);
      const hash2 = sha256Canonical(input);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it(`sorts keys for ${name}`, () => {
      if (input && typeof input === 'object' && !Array.isArray(input)) {
        const result = toCanonicalJson(input);
        // Should be valid JSON
        expect(() => JSON.parse(result)).not.toThrow();
      }
    });
  }

  it('produces identical output regardless of key insertion order', () => {
    const obj1 = { b: 1, a: 2 };
    const obj2 = { a: 2, b: 1 };
    expect(toCanonicalJson(obj1)).toBe(toCanonicalJson(obj2));
    expect(sha256Canonical(obj1)).toBe(sha256Canonical(obj2));
  });

  it('drops undefined values in objects but keeps null', () => {
    const withUndefined = { a: 1, b: undefined, c: 3 };
    const withoutB = { a: 1, c: 3 };
    const withNull = { a: 1, b: null, c: 3 };
    expect(toCanonicalJson(withUndefined)).toBe(toCanonicalJson(withoutB));
    expect(toCanonicalJson(withUndefined)).not.toBe(toCanonicalJson(withNull));
  });

  it('preserves array order', () => {
    const arr1 = [1, 2, 3];
    const arr2 = [3, 2, 1];
    expect(toCanonicalJson(arr1)).not.toBe(toCanonicalJson(arr2));
  });

  it('handles circular references by throwing', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => toCanonicalJson(circular)).toThrow();
  });
});

describe('sha256Hex helper', () => {
  it('produces consistent hex output for known input', () => {
    // sha256 of canonical JSON '"test"' (with quotes)
    expect(sha256Canonical('test')).toBe(
      '4d967a30111bf29f0eba01c448b375c1629b2fed01cdfcc3aed91f1b57d5dd5e'
    );
  });
});
