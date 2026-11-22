import {
  normalizeLeaf,
  parseDomainToAST,
  resolveDomainContext,
  validateDomain,
  type ASTNode,
  type Domain,
  type DomainContextValues,
  type DomainOperator,
  type JsonValue,
} from '@moonwitness/types';

export {
  normalizeLeaf,
  parseDomainToAST,
  resolveDomainContext,
  validateDomain,
  type ASTNode,
  type DomainContextValues,
};

const MAX_RELATION_HOPS = 2;

export interface RelationMappingLike {
  modelClass?: DomainModelClassLike | string;
  join?: {
    from?: string;
    to?: string;
  };
}

export interface DomainModelClassLike {
  tableName?: string;
  relationMappings?:
    Record<string, RelationMappingLike> | (() => Record<string, RelationMappingLike>);
  hiddenFields?: readonly string[];
  jsonSchema?: {
    properties?: Record<string, unknown>;
  };
}

interface DomainQuery {
  where(callback: (query: DomainQuery) => void): DomainQuery;
  where(field: string, operator: string, value: string | number | boolean): DomainQuery;
  orWhere(callback: (query: DomainQuery) => void): DomainQuery;
  whereNot(callback: (query: DomainQuery) => void): DomainQuery;
  whereNull(field: string): DomainQuery;
  whereNotNull(field: string): DomainQuery;
  whereIn(field: string, values: unknown[]): DomainQuery;
  whereNotIn(field: string, values: unknown[]): DomainQuery;
  whereRaw(sql: string, bindings: unknown[]): DomainQuery;
  whereExists?(callback: (query: DomainQuery) => void): DomainQuery;
  select?(...cols: unknown[]): DomainQuery;
  from?(table: string): DomainQuery;
  modelClass?(): DomainModelClassLike;
}

function getRelationMappings(
  modelClass?: DomainModelClassLike
): Record<string, RelationMappingLike> {
  if (!modelClass?.relationMappings) return {};
  return typeof modelClass.relationMappings === 'function'
    ? modelClass.relationMappings()
    : modelClass.relationMappings;
}

function isHiddenField(modelClass: DomainModelClassLike | undefined, field: string): boolean {
  return Boolean(modelClass?.hiddenFields?.includes(field));
}

function hasKnownColumn(modelClass: DomainModelClassLike | undefined, column: string): boolean {
  const props = modelClass?.jsonSchema?.properties;
  if (!props) return true;
  return Object.prototype.hasOwnProperty.call(props, column);
}

interface ResolvedHop {
  fromCol: string;
  toTable: string;
  toCol: string;
  targetModel: DomainModelClassLike;
}

function resolveDottedPath(
  rootModel: DomainModelClassLike,
  dottedField: string
): { hops: ResolvedHop[]; leafColumn: string } {
  const segments = dottedField.split('.');
  const hopCount = segments.length - 1;
  if (hopCount > MAX_RELATION_HOPS) {
    throw new Error(
      `Invalid domain: relational path '${dottedField}' exceeds max depth of ${MAX_RELATION_HOPS} hops`
    );
  }

  const hops: ResolvedHop[] = [];
  let currentModel = rootModel;
  for (let i = 0; i < hopCount; i += 1) {
    const relName = segments[i]!;
    const mappings = getRelationMappings(currentModel);
    const mapping = mappings[relName];
    if (!mapping || !mapping.join?.from || !mapping.join?.to) {
      throw new Error(`Invalid domain: unknown relation '${relName}' in path '${dottedField}'`);
    }
    const targetModel =
      typeof mapping.modelClass === 'function' || typeof mapping.modelClass === 'object'
        ? (mapping.modelClass as DomainModelClassLike)
        : undefined;
    if (!targetModel?.tableName) {
      throw new Error(
        `Invalid domain: relation '${relName}' in path '${dottedField}' has no resolvable target model`
      );
    }
    const fromParts = mapping.join.from.split('.');
    const toParts = mapping.join.to.split('.');
    const fromCol = fromParts[fromParts.length - 1]!;
    const toCol = toParts[toParts.length - 1]!;
    hops.push({
      fromCol,
      toTable: targetModel.tableName,
      toCol,
      targetModel,
    });
    currentModel = targetModel;
  }

  const leafColumn = segments[segments.length - 1]!;
  if (isHiddenField(currentModel, leafColumn)) {
    throw new Error(`Invalid domain: field '${dottedField}' is hidden and not queryable`);
  }
  if (!hasKnownColumn(currentModel, leafColumn)) {
    throw new Error(`Invalid domain: unknown column '${leafColumn}' in path '${dottedField}'`);
  }

  return { hops, leafColumn };
}

function applyDottedLeafToQuery(
  qb: DomainQuery,
  rootModel: DomainModelClassLike,
  dottedField: string,
  op: DomainOperator,
  value: JsonValue
): void {
  const { hops, leafColumn } = resolveDottedPath(rootModel, dottedField);
  if (!qb.whereExists) {
    throw new Error('Invalid domain: query builder does not support relational EXISTS subqueries');
  }

  const rootTable = rootModel.tableName;
  const applyHop = (parentQb: DomainQuery, hopIndex: number, parentAlias: string): void => {
    const hop = hops[hopIndex]!;
    const alias = `__dom_rel_${hopIndex}`;
    parentQb.whereExists!((subQb: DomainQuery) => {
      subQb.select!(1).from!(`${hop.toTable} as ${alias}`).whereRaw('?? = ??', [
        `${alias}.${hop.toCol}`,
        `${parentAlias}.${hop.fromCol}`,
      ]);

      if (hopIndex === hops.length - 1) {
        applyScalarLeafToQuery(subQb, `${alias}.${leafColumn}`, op, value);
      } else {
        applyHop(subQb, hopIndex + 1, alias);
      }
    });
  };

  if (!rootTable) {
    throw new Error('Invalid domain: root model has no tableName for relational path compilation');
  }
  applyHop(qb, 0, rootTable);
}

/**
 * Recursively applies an AST node to an Objection/Knex QueryBuilder.
 */
export function applyAstToQuery(
  qb: DomainQuery,
  node: ASTNode,
  modelClass?: DomainModelClassLike
): void {
  const resolvedModel =
    modelClass ?? (typeof qb.modelClass === 'function' ? qb.modelClass() : undefined);
  switch (node.type) {
    case 'LEAF':
      applyLeafToQuery(qb, node.field, node.op, node.value, resolvedModel);
      break;

    case 'AND':
      qb.where((subQb: DomainQuery) => {
        applyAstToQuery(subQb, node.left, resolvedModel);
        applyAstToQuery(subQb, node.right, resolvedModel);
      });
      break;

    case 'OR':
      qb.where((subQb: DomainQuery) => {
        subQb
          .where((q1: DomainQuery) => applyAstToQuery(q1, node.left, resolvedModel))
          .orWhere((q2: DomainQuery) => applyAstToQuery(q2, node.right, resolvedModel));
      });
      break;

    case 'NOT':
      qb.whereNot((subQb: DomainQuery) => {
        applyAstToQuery(subQb, node.child, resolvedModel);
      });
      break;
  }
}

/**
 * Applies a single domain leaf to a QueryBuilder (supports dotted relational paths up to 2 hops).
 */
function applyLeafToQuery(
  qb: DomainQuery,
  field: string,
  op: DomainOperator,
  value: JsonValue,
  modelClass?: DomainModelClassLike
): void {
  if (field.includes('.') && modelClass) {
    const firstSegment = field.split('.')[0]!;
    if (firstSegment !== modelClass.tableName) {
      applyDottedLeafToQuery(qb, modelClass, field, op, value);
      return;
    }
  }
  applyScalarLeafToQuery(qb, field, op, value);
}

function applyScalarLeafToQuery(
  qb: DomainQuery,
  field: string,
  op: DomainOperator,
  value: JsonValue
): void {
  const scalar = value as string | number | boolean | null;
  switch (op) {
    case '=':
      if (value === null) {
        qb.whereNull(field);
      } else {
        qb.whereRaw('?? = ?', [field, scalar]);
      }
      break;

    case '!=':
    case '<>':
      if (value === null) {
        qb.whereNotNull(field);
      } else {
        qb.whereRaw('?? != ?', [field, scalar]);
      }
      break;

    case '>':
    case '>=':
    case '<':
    case '<=':
      qb.whereRaw(`?? ${op} ?`, [field, scalar]);
      break;

    case 'in': {
      const list = Array.isArray(value) ? value : [value];
      qb.whereIn(field, list);
      break;
    }

    case 'not in': {
      const list = Array.isArray(value) ? value : [value];
      qb.whereNotIn(field, list);
      break;
    }

    case 'like':
      qb.whereRaw('?? LIKE ?', [field, scalar]);
      break;

    case 'ilike':
      qb.whereRaw('LOWER(??) LIKE LOWER(?)', [field, value]);
      break;

    case 'not like':
      qb.whereRaw('?? NOT LIKE ?', [field, scalar]);
      break;

    case 'not ilike':
      qb.whereRaw('LOWER(??) NOT LIKE LOWER(?)', [field, value]);
      break;

    case '=like':
      qb.whereRaw('?? LIKE ?', [field, scalar]);
      break;

    case 'is null':
      qb.whereNull(field);
      break;

    case 'is not null':
      qb.whereNotNull(field);
      break;

    default:
      throw new Error(`Unsupported domain operator: ${op}`);
  }
}

/**
 * Applies a filter domain directly to an Objection QueryBuilder.
 */
export function applyDomain<QB>(qb: QB, domain?: Domain, modelClass?: DomainModelClassLike): QB {
  if (!domain || domain.length === 0) {
    return qb;
  }
  const ast = parseDomainToAST(domain);
  if (ast) {
    applyAstToQuery(qb as DomainQuery, ast, modelClass);
  }
  return qb;
}
