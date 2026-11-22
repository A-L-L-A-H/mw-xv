export type DomainOperator =
  | '='
  | '!='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'like'
  | 'ilike'
  | 'not like'
  | 'not ilike'
  | '=like'
  | 'in'
  | 'not in'
  | 'is null'
  | 'is not null';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type DomainLeaf = [string, DomainOperator | (string & {}), unknown] | [string, unknown];

export type DomainLogical = '&' | '|' | '!';

export type DomainItem = DomainLeaf | DomainLogical;

export type Domain = DomainItem[];

export type ASTNode =
  | { type: 'LEAF'; field: string; op: DomainOperator; value: JsonValue }
  | { type: 'AND'; left: ASTNode; right: ASTNode }
  | { type: 'OR'; left: ASTNode; right: ASTNode }
  | { type: 'NOT'; child: ASTNode };

export interface SearchOptions {
  offset?: number;
  limit?: number;
  order?: string;
  fields?: string[];
  activeTest?: boolean;
  withGraphFetched?: string;
  context?: ModelContext;
  transaction?: object;
}

export interface GroupCountOptions extends Pick<
  SearchOptions,
  'activeTest' | 'context' | 'transaction'
> {
  /** Maximum number of distinct groups returned (1–500). */
  limit?: number;
  /** Number of groups to skip, bounded by the API. */
  offset?: number;
}

export interface GroupCountRow {
  values: Record<string, JsonValue>;
  count: number;
}

export interface GroupCountPage {
  groups: GroupCountRow[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SearchReadOptions extends SearchOptions {
  fields?: string[];
}

export interface ModelContext {
  userId?: number;
  role?: string;
  companyId?: number;
  partnerId?: number;
  lang?: string;
  tz?: string;
  activeTest?: boolean;
  [key: string]: JsonValue | undefined;
}

export const DOMAIN_OPERATORS: ReadonlySet<DomainOperator> = new Set<DomainOperator>([
  '=',
  '!=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'like',
  'ilike',
  'not like',
  'not ilike',
  '=like',
  'in',
  'not in',
  'is null',
  'is not null',
]);

export const MAX_DOMAIN_TERMS = 100;
export const MAX_DOMAIN_FIELD_LENGTH = 255;
export const MAX_DOMAIN_STRING_LENGTH = 4096;
export const MAX_DOMAIN_LIST_LENGTH = 500;
export const MAX_DOMAIN_NESTING = 32;

function isDomainScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** Validates untrusted REST/RPC input before it reaches query construction or evaluation. */
export function validateDomain(input: unknown, allowedFields?: ReadonlySet<string>): Domain {
  if (!Array.isArray(input) || input.length > MAX_DOMAIN_TERMS) {
    throw new Error(`Invalid domain: expected an array with at most ${MAX_DOMAIN_TERMS} terms`);
  }

  const terms: unknown[] = input;
  for (const [index, item] of terms.entries()) {
    if (item === '&' || item === '|' || item === '!') continue;
    if (!Array.isArray(item) || (item.length !== 2 && item.length !== 3)) {
      throw new Error(`Invalid domain: term ${index} must be a two- or three-item leaf`);
    }
    const leaf: unknown[] = item;
    const [field, rawOperator, value] = leaf;
    if (
      typeof field !== 'string' ||
      field.length === 0 ||
      field.length > MAX_DOMAIN_FIELD_LENGTH ||
      !/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(field)
    ) {
      throw new Error(`Invalid domain: term ${index} has an invalid field`);
    }
    if (allowedFields && !allowedFields.has(field)) {
      throw new Error(`Invalid domain: field '${field}' is not queryable`);
    }

    let operator: DomainOperator = '=';
    let operand = rawOperator;
    if (leaf.length === 3) {
      if (typeof rawOperator !== 'string') {
        throw new Error(`Invalid domain: term ${index} has an invalid operator`);
      }
      operator = rawOperator.toLowerCase() as DomainOperator;
      if (!DOMAIN_OPERATORS.has(operator)) {
        throw new Error(`Invalid domain: operator '${rawOperator}' is not supported`);
      }
      operand = value;
    }

    if (typeof operand === 'string' && operand.length > MAX_DOMAIN_STRING_LENGTH) {
      throw new Error(`Invalid domain: term ${index} value is too long`);
    }
    if (!isDomainScalar(operand)) {
      if (
        !Array.isArray(operand) ||
        operand.length > MAX_DOMAIN_LIST_LENGTH ||
        !operand.every(isDomainScalar)
      ) {
        throw new Error(`Invalid domain: term ${index} must use a scalar or a bounded scalar list`);
      }
    }
    if (
      ['like', 'ilike', 'not like', 'not ilike', '=like'].includes(operator) &&
      typeof operand !== 'string'
    ) {
      throw new Error(`Invalid domain: operator '${operator}' requires a string value`);
    }
    if (Array.isArray(operand) && operator !== 'in' && operator !== 'not in') {
      throw new Error(`Invalid domain: operator '${operator}' does not accept a list`);
    }
  }

  const depths: number[] = [];
  for (const item of [...terms].reverse()) {
    if (item === '&' || item === '|') {
      const left = depths.pop();
      const right = depths.pop();
      if (left === undefined || right === undefined) {
        throw new Error(`Invalid domain: '${item}' operator expects 2 arguments`);
      }
      depths.push(Math.max(left, right) + 1);
    } else if (item === '!') {
      const child = depths.pop();
      if (child === undefined) throw new Error("Invalid domain: '!' operator expects 1 argument");
      depths.push(child + 1);
    } else {
      depths.push(1);
    }
    if ((depths.at(-1) ?? 0) > MAX_DOMAIN_NESTING) {
      throw new Error(`Invalid domain: expression nesting exceeds ${MAX_DOMAIN_NESTING}`);
    }
  }

  return input as Domain;
}

/**
 * Normalizes a domain leaf.
 * E.g. ['name', '=', 'Bob'] or ['name', 'Bob'] -> { field: 'name', op: '=', value: 'Bob' }
 */
export function normalizeLeaf(leaf: DomainLeaf): {
  field: string;
  op: DomainOperator;
  value: JsonValue;
} {
  if (leaf.length === 2) {
    return { field: leaf[0], op: '=', value: leaf[1] as JsonValue };
  }
  const [field, rawOp, value] = leaf;
  const op = (rawOp.toLowerCase() as DomainOperator) || '=';
  return { field, op, value: value as JsonValue };
}

function astDepth(node: ASTNode): number {
  switch (node.type) {
    case 'LEAF':
      return 1;
    case 'NOT':
      return astDepth(node.child) + 1;
    case 'AND':
    case 'OR':
      return Math.max(astDepth(node.left), astDepth(node.right)) + 1;
  }
}

/**
 * Parses a Polish notation domain array into an AST.
 * Supports '&', '|', '!', and leaves.
 * Implicit consecutive leaves are joined with 'AND'.
 */
export function parseDomainToAST(domain: Domain): ASTNode | null {
  domain = validateDomain(domain);
  if (!Array.isArray(domain) || domain.length === 0) {
    return null;
  }

  const stack: ASTNode[] = [];
  const reversed = [...domain].reverse();

  for (const item of reversed) {
    if (item === '&') {
      const left = stack.pop();
      const right = stack.pop();
      if (!left || !right) {
        throw new Error(`Invalid domain: '&' operator expects 2 arguments.`);
      }
      if (Math.max(astDepth(left), astDepth(right)) >= MAX_DOMAIN_NESTING) {
        throw new Error(`Invalid domain: expression nesting exceeds ${MAX_DOMAIN_NESTING}`);
      }
      stack.push({ type: 'AND', left, right });
    } else if (item === '|') {
      const left = stack.pop();
      const right = stack.pop();
      if (!left || !right) {
        throw new Error(`Invalid domain: '|' operator expects 2 arguments.`);
      }
      if (Math.max(astDepth(left), astDepth(right)) >= MAX_DOMAIN_NESTING) {
        throw new Error(`Invalid domain: expression nesting exceeds ${MAX_DOMAIN_NESTING}`);
      }
      stack.push({ type: 'OR', left, right });
    } else if (item === '!') {
      const child = stack.pop();
      if (!child) {
        throw new Error(`Invalid domain: '!' operator expects 1 argument.`);
      }
      if (astDepth(child) >= MAX_DOMAIN_NESTING) {
        throw new Error(`Invalid domain: expression nesting exceeds ${MAX_DOMAIN_NESTING}`);
      }
      stack.push({ type: 'NOT', child });
    } else if (Array.isArray(item)) {
      const { field, op, value } = normalizeLeaf(item as DomainLeaf);
      stack.push({ type: 'LEAF', field, op, value });
    } else {
      throw new Error(`Invalid domain element: ${JSON.stringify(item)}`);
    }
  }

  if (stack.length === 0) {
    return null;
  }

  let root = stack.pop()!;
  while (stack.length > 0) {
    const next = stack.pop()!;
    root = { type: 'AND', left: root, right: next };
  }

  return root;
}

function getNestedField(record: Record<string, unknown>, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, field)) {
    return record[field];
  }
  if (!field.includes('.')) {
    return undefined;
  }
  const parts = field.split('.');
  let current: unknown = record;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function matchSqlLike(
  actual: unknown,
  pattern: string,
  caseInsensitive: boolean,
  anchored: boolean
): boolean {
  if (actual === null || actual === undefined) return false;
  const text = String(actual);
  const hasWildcard = pattern.includes('%') || pattern.includes('_');
  if (!hasWildcard && !anchored) {
    return caseInsensitive
      ? text.toLowerCase().includes(pattern.toLowerCase())
      : text.includes(pattern);
  }
  let regexBody = '';
  for (const ch of pattern) {
    if (ch === '%') regexBody += '.*';
    else if (ch === '_') regexBody += '.';
    else regexBody += escapeRegex(ch);
  }
  const regex = new RegExp(`^${regexBody}$`, caseInsensitive ? 'isu' : 'su');
  return regex.test(text);
}

function compareOrdered(actual: unknown, expected: unknown): number | null {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Number.isNaN(actual) || Number.isNaN(expected)) return null;
    return actual < expected ? -1 : actual > expected ? 1 : 0;
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual < expected ? -1 : actual > expected ? 1 : 0;
  }
  return null;
}

/** Evaluates a single domain leaf against an in-memory record across all 16 DomainOperators. */
export function evalTerm(
  term: DomainLeaf | [string, string, unknown] | [string, unknown],
  record: Record<string, unknown>
): boolean {
  const leaf =
    term.length === 2
      ? { field: term[0], op: '=' as DomainOperator, value: term[1] as JsonValue }
      : {
          field: term[0],
          op: (String(term[1]).toLowerCase() as DomainOperator) || '=',
          value: term[2] as JsonValue,
        };
  const actual = getNestedField(record, leaf.field);
  const expected = leaf.value;

  switch (leaf.op) {
    case '=':
      return actual === expected;
    case '!=':
    case '<>':
      return actual !== expected;
    case '>': {
      const cmp = compareOrdered(actual, expected);
      return cmp !== null && cmp > 0;
    }
    case '>=': {
      const cmp = compareOrdered(actual, expected);
      return cmp !== null && cmp >= 0;
    }
    case '<': {
      const cmp = compareOrdered(actual, expected);
      return cmp !== null && cmp < 0;
    }
    case '<=': {
      const cmp = compareOrdered(actual, expected);
      return cmp !== null && cmp <= 0;
    }
    case 'like':
      return typeof expected === 'string' && matchSqlLike(actual, expected, false, false);
    case 'ilike':
      return typeof expected === 'string' && matchSqlLike(actual, expected, true, false);
    case 'not like':
      return typeof expected === 'string' && !matchSqlLike(actual, expected, false, false);
    case 'not ilike':
      return typeof expected === 'string' && !matchSqlLike(actual, expected, true, false);
    case '=like':
      return typeof expected === 'string' && matchSqlLike(actual, expected, false, true);
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as JsonValue);
    case 'not in':
      return Array.isArray(expected) && !expected.includes(actual as JsonValue);
    case 'is null':
      return actual === null || actual === undefined;
    case 'is not null':
      return actual !== null && actual !== undefined;
    default:
      return false;
  }
}

function evalAstNode(node: ASTNode, record: Record<string, unknown>): boolean {
  switch (node.type) {
    case 'LEAF':
      return evalTerm([node.field, node.op, node.value], record);
    case 'AND':
      return evalAstNode(node.left, record) && evalAstNode(node.right, record);
    case 'OR':
      return evalAstNode(node.left, record) || evalAstNode(node.right, record);
    case 'NOT':
      return !evalAstNode(node.child, record);
  }
}

/**
 * Evaluates a prefix (Polish notation) domain array against an in-memory record.
 * Terms are ANDed by default.
 * Example: `['|', ['active', '=', true], ['name', '=', 'admin']]`
 */
export function evalDomain(
  domain: Domain | boolean | undefined,
  record: Record<string, unknown>
): boolean {
  if (domain === undefined || domain === null) return false;
  if (typeof domain === 'boolean') return domain;
  if (!Array.isArray(domain) || domain.length === 0) return true;

  const ast = parseDomainToAST(domain);
  return ast ? evalAstNode(ast, record) : true;
}

export interface DomainContextValues {
  uid?: number | null;
  partnerId?: number | null;
  companyId?: number | null;
  now?: Date;
}

const ALLOWED_CONTEXT_TOKENS = new Set(['$uid', '$partner_id', '$company_id', '$today', '$now']);

function resolveTokenValue(token: string, ctx: DomainContextValues): JsonValue {
  if (!ALLOWED_CONTEXT_TOKENS.has(token)) {
    throw new Error(`Unsupported domain context token: '${token}'`);
  }
  const now = ctx.now ?? new Date();
  switch (token) {
    case '$uid':
      return ctx.uid ?? null;
    case '$partner_id':
      return ctx.partnerId ?? null;
    case '$company_id':
      return ctx.companyId ?? null;
    case '$today':
      return now.toISOString().slice(0, 10);
    case '$now':
      return now.toISOString();
    default:
      throw new Error(`Unsupported domain context token: '${token}'`);
  }
}

function resolveValueTokens(value: JsonValue, ctx: DomainContextValues): JsonValue {
  if (typeof value === 'string' && value.startsWith('$')) {
    return resolveTokenValue(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string' && item.startsWith('$') ? resolveTokenValue(item, ctx) : item
    );
  }
  return value;
}

/**
 * Interpolates whitelisted dynamic context tokens (`$uid`, `$partner_id`, `$company_id`,
 * `$today`, `$now`) in a domain. Rejects any unknown `$...` token.
 */
export function resolveDomainContext(domain: Domain, ctx: DomainContextValues): Domain {
  return domain.map((item) => {
    if (typeof item === 'string') return item;
    if (item.length === 2) {
      return [item[0], resolveValueTokens(item[1] as JsonValue, ctx)] as DomainLeaf;
    }
    return [item[0], item[1], resolveValueTokens(item[2] as JsonValue, ctx)] as DomainLeaf;
  });
}
