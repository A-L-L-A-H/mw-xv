export const AUTOMATION_DSL_OPS = [
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
] as const;

export type AutomationDslOp = (typeof AUTOMATION_DSL_OPS)[number];

export interface AutomationDslComparison {
  readonly op: AutomationDslOp;
  readonly path: string;
  readonly value?: unknown;
}

export interface AutomationDslGroup {
  readonly all?: readonly AutomationDslNode[];
  readonly any?: readonly AutomationDslNode[];
}

export type AutomationDslNode = AutomationDslComparison | AutomationDslGroup;

export type AutomationEvaluationResult =
  | { readonly matched: true }
  | { readonly matched: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDslGroup(node: AutomationDslNode): node is AutomationDslGroup {
  return isRecord(node) && ('all' in node || 'any' in node);
}

/**
 * Resolves a dotted path like "payload.score" or "payload.customer.name" against
 * a root object. Returns `undefined` when any segment is missing.
 */
export function resolvePath(root: unknown, path: string): unknown {
  if (typeof path !== 'string' || path.length === 0) return undefined;
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function compare(op: AutomationDslOp, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'gt':
      return (
        typeof actual === 'number' &&
        typeof expected === 'number' &&
        actual > expected
      );
    case 'gte':
      return (
        typeof actual === 'number' &&
        typeof expected === 'number' &&
        actual >= expected
      );
    case 'lt':
      return (
        typeof actual === 'number' &&
        typeof expected === 'number' &&
        actual < expected
      );
    case 'lte':
      return (
        typeof actual === 'number' &&
        typeof expected === 'number' &&
        actual <= expected
      );
    case 'in':
      return Array.isArray(expected) && (expected as unknown[]).includes(actual);
    case 'nin':
      return Array.isArray(expected) && !(expected as unknown[]).includes(actual);
    case 'contains':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.includes(expected);
      }
      return Array.isArray(actual) && (actual as unknown[]).includes(expected);
    case 'exists':
      return expected ? actual !== undefined : actual === undefined;
    case 'regex': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return false;
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

function assertComparable(node: AutomationDslComparison): void {
  if (typeof node.op !== 'string' || !AUTOMATION_DSL_OPS.includes(node.op)) {
    throw new Error(`Unknown DSL op: ${String((node as { op?: unknown }).op)}`);
  }
  if (typeof node.path !== 'string' || node.path.length === 0) {
    throw new Error('DSL comparison requires a non-empty "path"');
  }
}

/**
 * Evaluates a pure DSL condition tree against a payload root. Throws on
 * malformed nodes so callers can distinguish "not matched" from "invalid".
 */
export function evaluateDsl(
  condition: unknown,
  payload: unknown
): AutomationEvaluationResult {
  if (condition === undefined || condition === null) {
    return { matched: true };
  }
  if (!isRecord(condition)) {
    throw new Error('DSL condition must be an object');
  }
  const node = condition as unknown as AutomationDslNode;

  if (isDslGroup(node)) {
    if (node.all !== undefined && node.any !== undefined) {
      throw new Error('DSL group must not combine "all" and "any"');
    }
    if (node.all !== undefined) {
      if (!Array.isArray(node.all)) throw new Error('DSL "all" must be an array');
      for (const child of node.all) {
        const result = evaluateDsl(child, payload);
        if (!result.matched) return result;
      }
      return { matched: true };
    }
    if (!Array.isArray(node.any)) throw new Error('DSL "any" must be an array');
    for (const child of node.any) {
      if (evaluateDsl(child, payload).matched) return { matched: true };
    }
    return { matched: false, reason: 'no clause in "any" group matched' };
  }

  assertComparable(node);
  const actual = resolvePath(payload, node.path);
  if (compare(node.op, actual, node.value)) {
    return { matched: true };
  }
  return { matched: false, reason: `${node.path} ${node.op} failed` };
}
