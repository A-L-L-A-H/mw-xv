import { describe, expect, it } from 'vitest';
import schema from '../schemas/knowledge-record.schema.json' with { type: 'json' };
import { pointerForIssue } from '../src/json-schema.js';

describe('published knowledge record schema', () => {
  it('uses JSON Schema Draft 2020-12 and requires an explicit visibility', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.required).toContain('visibility');
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('pointerForIssue', () => {
  it('RFC 6901-escapes missing required and additional property names', () => {
    expect(pointerForIssue('', 'required', { missingProperty: 'a/b~c' })).toBe('/a~1b~0c');
    expect(
      pointerForIssue('/nested', 'additionalProperties', { additionalProperty: '~tilde/slash' })
    ).toBe('/nested/~0tilde~1slash');
  });

  it('falls back to root pointer when instancePath is empty', () => {
    expect(pointerForIssue('', 'type', {})).toBe('/');
    expect(pointerForIssue('/items/0', 'type', {})).toBe('/items/0');
  });
});
