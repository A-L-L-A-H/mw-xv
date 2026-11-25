import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_DSL_OPS,
  evaluateDsl,
  isDslGroup,
  resolvePath,
  type AutomationDslNode,
} from '../src/index.js';

describe('resolvePath', () => {
  const root = {
    payload: {
      score: 87,
      customer: { name: 'acme', tags: ['vip'] },
      flag: null,
    },
  };

  it('resolves nested dotted paths', () => {
    expect(resolvePath(root, 'payload.score')).toBe(87);
    expect(resolvePath(root, 'payload.customer.name')).toBe('acme');
    expect(resolvePath(root, 'payload.customer.tags')).toEqual(['vip']);
  });

  it('returns undefined for missing segments and non-object traversal', () => {
    expect(resolvePath(root, 'payload.missing')).toBeUndefined();
    expect(resolvePath(root, 'payload.score.deeper')).toBeUndefined();
    expect(resolvePath(root, '')).toBeUndefined();
    expect(resolvePath(null, 'payload.score')).toBeUndefined();
  });

  it('resolves null values distinctly from missing paths', () => {
    expect(resolvePath(root, 'payload.flag')).toBeNull();
  });
});

describe('isDslGroup', () => {
  it('detects all/any groups versus comparisons', () => {
    expect(isDslGroup({ all: [] })).toBe(true);
    expect(isDslGroup({ any: [] })).toBe(true);
    expect(isDslGroup({ op: 'eq', path: 'payload.score', value: 1 })).toBe(false);
  });
});

describe('evaluateDsl comparisons', () => {
  const payload = {
    score: 87,
    tier: 'hot',
    tags: ['vip', 'enterprise'],
    owner: null,
  };

  it('supports every registered op', () => {
    expect(AUTOMATION_DSL_OPS).toEqual([
      'eq',
      'ne',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
      'nin',
      'contains',
      'exists',
      'regex',
    ]);
  });

  it('eq / ne', () => {
    expect(evaluateDsl({ op: 'eq', path: 'tier', value: 'hot' }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'ne', path: 'tier', value: 'cold' }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'eq', path: 'tier', value: 'cold' }, payload)).toEqual({
      matched: false,
      reason: 'tier eq failed',
    });
  });

  it('numeric ordering ops reject non-numeric operands', () => {
    expect(evaluateDsl({ op: 'gt', path: 'score', value: 80 }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'gte', path: 'score', value: 87 }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'lt', path: 'score', value: 100 }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'lte', path: 'score', value: 87 }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'gt', path: 'tier', value: 'hot' }, payload).matched).toBe(false);
    expect(evaluateDsl({ op: 'lt', path: 'missing', value: 1 }, payload).matched).toBe(false);
  });

  it('in / nin require array values', () => {
    expect(evaluateDsl({ op: 'in', path: 'tier', value: ['hot', 'warm'] }, payload).matched).toBe(
      true
    );
    expect(evaluateDsl({ op: 'nin', path: 'tier', value: ['cold'] }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'in', path: 'tier', value: ['cold'] }, payload).matched).toBe(false);
    expect(evaluateDsl({ op: 'in', path: 'tier', value: 'hot' }, payload).matched).toBe(false);
    expect(evaluateDsl({ op: 'nin', path: 'tier', value: 'hot' }, payload).matched).toBe(false);
  });

  it('contains works on strings and arrays', () => {
    expect(evaluateDsl({ op: 'contains', path: 'tier', value: 'ot' }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'contains', path: 'tags', value: 'vip' }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'contains', path: 'tags', value: 'missing' }, payload).matched).toBe(
      false
    );
  });

  it('exists honours expected flag including null values', () => {
    expect(evaluateDsl({ op: 'exists', path: 'tier', value: true }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'exists', path: 'missing', value: true }, payload).matched).toBe(
      false
    );
    expect(evaluateDsl({ op: 'exists', path: 'missing', value: false }, payload).matched).toBe(
      true
    );
    expect(evaluateDsl({ op: 'exists', path: 'owner', value: true }, payload).matched).toBe(true);
  });

  it('regex tests with pattern strings and rejects invalid patterns', () => {
    expect(evaluateDsl({ op: 'regex', path: 'tier', value: '^h' }, payload).matched).toBe(true);
    expect(evaluateDsl({ op: 'regex', path: 'tier', value: '^c' }, payload).matched).toBe(false);
    expect(evaluateDsl({ op: 'regex', path: 'tier', value: '[' }, payload).matched).toBe(false);
    expect(evaluateDsl({ op: 'regex', path: 'score', value: '^h' }, payload).matched).toBe(false);
  });
});

describe('evaluateDsl groups', () => {
  const payload = { score: 87, tier: 'hot' };

  it('all requires every clause to match', () => {
    const node: AutomationDslNode = {
      all: [
        { op: 'gte', path: 'score', value: 80 },
        { op: 'eq', path: 'tier', value: 'hot' },
      ],
    };
    expect(evaluateDsl(node, payload).matched).toBe(true);

    const failing: AutomationDslNode = {
      all: [
        { op: 'gte', path: 'score', value: 80 },
        { op: 'eq', path: 'tier', value: 'cold' },
      ],
    };
    expect(evaluateDsl(failing, payload)).toEqual({
      matched: false,
      reason: 'tier eq failed',
    });
  });

  it('any matches when at least one clause matches', () => {
    const node: AutomationDslNode = {
      any: [
        { op: 'eq', path: 'tier', value: 'cold' },
        { op: 'gte', path: 'score', value: 90 },
      ],
    };
    expect(evaluateDsl(node, payload)).toEqual({
      matched: false,
      reason: 'no clause in "any" group matched',
    });

    const passing: AutomationDslNode = {
      any: [
        { op: 'eq', path: 'tier', value: 'cold' },
        { op: 'eq', path: 'tier', value: 'hot' },
      ],
    };
    expect(evaluateDsl(passing, payload).matched).toBe(true);
  });

  it('null/undefined conditions match trivially', () => {
    expect(evaluateDsl(null, payload).matched).toBe(true);
    expect(evaluateDsl(undefined, payload).matched).toBe(true);
  });

  it('throws on malformed conditions', () => {
    expect(() => evaluateDsl('not-an-object', payload)).toThrow('DSL condition must be an object');
    expect(() => evaluateDsl({ op: 'bogus', path: 'score' }, payload)).toThrow('Unknown DSL op');
    expect(() => evaluateDsl({ op: 'eq', path: '' }, payload)).toThrow('non-empty "path"');
    expect(() => evaluateDsl({ all: [], any: [] }, payload)).toThrow('must not combine');
    expect(() => evaluateDsl({ all: 'nope' }, payload)).toThrow('DSL "all" must be an array');
    expect(() => evaluateDsl({ any: 'nope' }, payload)).toThrow('DSL "any" must be an array');
  });
});
