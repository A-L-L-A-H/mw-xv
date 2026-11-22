import type { JsonValue } from '@moonwitness/types';
import { isRecord } from '@moonwitness/types';
import type {
  JsonSchemaNode,
  JsonSchemaType,
  SchemaValidationIssue,
  SchemaValidationResult,
} from './types.js';

const MAX_SCHEMA_DEPTH = 32;

function getJsonType(value: unknown): JsonSchemaType | 'unknown' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'unknown';
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  if (isPlainObject(value)) return 'object';
  return 'unknown';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function matchesSingleType(value: unknown, expected: JsonSchemaType): boolean {
  const actual = getJsonType(value);
  if (expected === 'number') {
    return actual === 'number' || actual === 'integer';
  }
  return actual === expected;
}

function canonicalEquals(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > MAX_SCHEMA_DEPTH) return false;
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!canonicalEquals(a[index], b[index], depth + 1)) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    for (let index = 0; index < keysA.length; index += 1) {
      const key = keysA[index];
      if (key !== keysB[index]) return false;
      if (!canonicalEquals(a[key], b[key], depth + 1)) return false;
    }
    return true;
  }
  return false;
}

function canonicalKey(value: unknown, depth = 0): string {
  if (depth > MAX_SCHEMA_DEPTH) return '"[MAX_DEPTH]"';
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalKey(item, depth + 1)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalKey(value[key], depth + 1)}`);
    return `{${entries.join(',')}}`;
  }
  return String(value);
}

function validateNode(
  schema: JsonSchemaNode,
  value: unknown,
  path: string,
  depth: number,
  issues: SchemaValidationIssue[]
): void {
  if (depth > MAX_SCHEMA_DEPTH) {
    issues.push({ path, message: `Exceeded maximum validation depth (${MAX_SCHEMA_DEPTH})` });
    return;
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    issues.push({ path, message: 'Expected finite number' });
    return;
  }

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matched = allowed.some((expected) => matchesSingleType(value, expected));
    if (!matched) {
      issues.push({
        path,
        message: `Expected type ${allowed.join(' | ')}, received ${getJsonType(value)}`,
      });
      return;
    }
  }

  if (schema.const !== undefined && !canonicalEquals(value, schema.const)) {
    issues.push({ path, message: `Value must equal ${JSON.stringify(schema.const)}` });
  }

  if (schema.enum !== undefined) {
    const allowedEnum = schema.enum.some((entry: JsonValue) => canonicalEquals(value, entry));
    if (!allowedEnum) {
      issues.push({ path, message: 'Value is not one of the allowed enum values' });
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({ path, message: `String length must be >= ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({ path, message: `String length must be <= ${schema.maxLength}` });
    }
    if (schema.pattern !== undefined) {
      let regex: RegExp;
      try {
        regex = new RegExp(schema.pattern, 'u');
      } catch {
        issues.push({ path, message: 'Invalid schema regex pattern' });
        return;
      }
      if (!regex.test(value)) {
        issues.push({ path, message: `String does not match pattern ${schema.pattern}` });
      }
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push({ path, message: `Number must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push({ path, message: `Number must be <= ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({ path, message: `Array must have at least ${schema.minItems} item(s)` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push({ path, message: `Array must have at most ${schema.maxItems} item(s)` });
    }
    if (schema.uniqueItems) {
      const seen = new Set<string>();
      for (let index = 0; index < value.length; index += 1) {
        const key = canonicalKey(value[index]);
        if (seen.has(key)) {
          issues.push({ path: `${path}[${index}]`, message: 'Array items must be unique' });
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        validateNode(schema.items, value[index], `${path}[${index}]`, depth + 1, issues);
      }
    }
  }

  if (isPlainObject(value)) {
    if (schema.required) {
      for (const reqKey of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, reqKey) || value[reqKey] === undefined) {
          issues.push({
            path: `${path}.${reqKey}`,
            message: `Missing required property "${reqKey}"`,
          });
        }
      }
    }

    const declaredProps = schema.properties ?? {};
    for (const [key, propValue] of Object.entries(value)) {
      const propPath = `${path}.${key}`;
      if (Object.prototype.hasOwnProperty.call(declaredProps, key)) {
        const propSchema = declaredProps[key];
        if (propSchema) {
          validateNode(propSchema, propValue, propPath, depth + 1, issues);
        }
      } else if (schema.additionalProperties === false) {
        issues.push({ path: propPath, message: `Unexpected additional property "${key}"` });
      } else if (isPlainObject(schema.additionalProperties)) {
        validateNode(
          schema.additionalProperties as JsonSchemaNode,
          propValue,
          propPath,
          depth + 1,
          issues
        );
      }
    }
  } else if (
    (schema.properties || schema.required || schema.additionalProperties !== undefined) &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    issues.push({ path, message: 'Expected a plain JSON object' });
  }
}

export function validateJsonSchema(schema: JsonSchemaNode, value: unknown): SchemaValidationResult {
  const issues: SchemaValidationIssue[] = [];
  validateNode(schema, value, '$', 0, issues);
  if (issues.length === 0) {
    return { valid: true };
  }
  return { valid: false, errors: issues };
}
