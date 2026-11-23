import type { JSONSchema, RelationMappings, QueryContext, ModelOptions } from 'objection';
import {
  BaseModel,
  type BelongsToOptions,
  type DecimalOptions,
  type Field,
  type FieldMap,
  type FieldOptions,
  type ModelConstraint,
} from './base.model.js';
import { hashPassword } from './password.js';
import type {
  Domain,
  FieldDefault,
  FieldKind,
  HasManyOptions,
  ManyToManyOptions,
  ManyToManyTableMeta,
  ModelContext,
  OnchangeHandler,
  OnchangeResult,
  OnDeletePolicy,
  Scalar,
} from './types.js';

export type {
  BelongsToOptions,
  DecimalOptions,
  Domain,
  Field,
  FieldDefault,
  FieldKind,
  FieldMap,
  FieldOptions,
  HasManyOptions,
  ManyToManyOptions,
  ManyToManyTableMeta,
  ModelConstraint,
  ModelContext,
  OnchangeHandler,
  OnchangeResult,
  OnDeletePolicy,
  Scalar,
};

export const fields = {
  password(options: Pick<FieldOptions<string>, 'label' | 'help'> = {}) {
    return { kind: 'password' as const, ...options } as Field<string> & { kind: 'password' };
  },
  string<const O extends FieldOptions<string>>(options: O = {} as O) {
    return { kind: 'string' as const, ...options } as Field<string> & O;
  },
  text<const O extends FieldOptions<string>>(options: O = {} as O) {
    return { kind: 'text' as const, ...options } as Field<string> & O;
  },
  integer<const O extends FieldOptions<number>>(options: O = {} as O) {
    return { kind: 'integer' as const, ...options } as Field<number> & O;
  },
  float<const O extends FieldOptions<number>>(options: O = {} as O) {
    return { kind: 'float' as const, ...options } as Field<number> & O;
  },
  decimal<const O extends DecimalOptions>(options: O = {} as O) {
    return { kind: 'decimal' as const, ...options } as Field<number | string> & O;
  },
  boolean<const O extends FieldOptions<boolean>>(options: O = {} as O) {
    return { kind: 'boolean' as const, ...options } as Field<boolean> & O;
  },
  date<const O extends FieldOptions<string>>(options: O = {} as O) {
    return { kind: 'date' as const, ...options } as Field<string> & O;
  },
  datetime<const O extends FieldOptions<string>>(options: O = {} as O) {
    return { kind: 'datetime' as const, ...options } as Field<string> & O;
  },
  json<const O extends FieldOptions<Record<string, unknown> | unknown[]>>(options: O = {} as O) {
    return { kind: 'json' as const, ...options } as Field<Record<string, unknown> | unknown[]> & O;
  },
  enum<const V extends readonly [string, ...string[]], const O extends FieldOptions<V[number]>>(
    values: V,
    options: O = {} as O
  ) {
    return { kind: 'enum' as const, values, ...options } as Field<V[number]> & O;
  },
  belongsTo<M extends typeof BaseModel | (() => typeof BaseModel), O extends BelongsToOptions>(
    target: M | (() => M),
    options: O = {} as O
  ) {
    return {
      onDelete: 'restrict' as OnDeletePolicy,
      ...options,
      kind: 'belongsTo' as const,
      target,
    };
  },
  hasMany<M extends typeof BaseModel>(target: M | (() => M), options: HasManyOptions = {}) {
    return { ...options, kind: 'hasMany' as const, target };
  },
  manyToMany<M extends typeof BaseModel | (() => typeof BaseModel)>(
    target: M | (() => M),
    options: ManyToManyOptions = {}
  ) {
    return { ...options, kind: 'manyToMany' as const, target } as Field<number[]> & {
      kind: 'manyToMany';
      target: M | (() => M);
    };
  },
};

type FieldValue<F> = F extends { kind: 'belongsTo' }
  ? number
  : F extends { kind: 'manyToMany' }
    ? number[]
    : F extends Field<infer V>
      ? V
      : never;
type ColumnName<K, F> = K extends string
  ? F extends { kind: 'belongsTo' }
    ? `${K}_id`
    : K
  : never;
type RequiredField<F> = F extends { required: true } | { default: Scalar } ? true : false;
export type ModelValues<F extends FieldMap> = {
  -readonly [
    K in keyof F as RequiredField<F[K]> extends true ? ColumnName<K, F[K]> : never
  ]: FieldValue<F[K]>;
} & {
  -readonly [
    K in keyof F as RequiredField<F[K]> extends true ? never : ColumnName<K, F[K]>
  ]?: FieldValue<F[K]> | null;
} & {
  -readonly [K in keyof F as F[K] extends { kind: 'belongsTo' } ? K : never]?: F[K] extends {
    target: infer M;
  }
    ? M extends () => infer T
      ? T extends typeof BaseModel
        ? InstanceType<T>
        : BaseModel
      : M extends typeof BaseModel
        ? InstanceType<M>
        : BaseModel
    : never;
};

export type DefinedModel<F extends FieldMap = FieldMap> = typeof BaseModel & {
  new (): BaseModel & ModelValues<F>;
  fields: F;
  uniqueConstraints: readonly (readonly string[])[];
};

export interface ModelExtension {
  readonly target: string;
  readonly fields?: FieldMap;
  readonly unique?: readonly (readonly string[])[];
  readonly exposedActions?: readonly string[];
  readonly constraints?: readonly ModelConstraint[];
  readonly onchange?: Readonly<Record<string, OnchangeHandler>>;
  readonly displayField?: string;
}

export function extendModel(
  target: string,
  extension: Omit<ModelExtension, 'target'>
): ModelExtension {
  return Object.freeze({ target, ...extension });
}

export function resolveFieldTarget(
  target: typeof BaseModel | (() => typeof BaseModel) | undefined
): typeof BaseModel | undefined {
  if (!target) return undefined;
  if (typeof target === 'function' && !('tableName' in target)) {
    return (target as () => typeof BaseModel)();
  }
  return target as typeof BaseModel;
}

export function manyToManyTableMeta(
  sourceTable: string,
  key: string,
  field: Field
): ManyToManyTableMeta | undefined {
  if (field.kind !== 'manyToMany') return undefined;
  const targetModel = resolveFieldTarget(field.target);
  if (!targetModel) return undefined;
  const targetTable = targetModel.tableName;
  const isSelf = sourceTable === targetTable;
  const relationTable = field.relationTable ?? `${sourceTable}_${targetTable}_${key}_rel`;
  const joinColumn =
    field.joinColumn ?? (isSelf ? `${sourceTable}_source_id` : `${sourceTable}_id`);
  const inverseJoinColumn =
    field.inverseJoinColumn ?? (isSelf ? `${targetTable}_target_id` : `${targetTable}_id`);
  return {
    relationTable,
    sourceTable,
    targetTable,
    joinColumn,
    inverseJoinColumn,
  };
}

export const standardProperties: Record<string, JSONSchema> = {
  id: { type: 'integer' },
  active: { type: 'boolean', default: true },
  create_date: { type: ['string', 'null'] },
  write_date: { type: ['string', 'null'] },
  create_uid: { type: ['integer', 'null'] },
  write_uid: { type: ['integer', 'null'] },
};

export function columnName(name: string, field: Field): string {
  return field.kind === 'belongsTo' ? `${name}_id` : name;
}

export function isStoredField(field: Field): boolean {
  if (field.kind === 'hasMany' || field.kind === 'manyToMany') return false;
  if (field.compute && !field.store) return false;
  return true;
}

function conflictsWithInstanceMember(name: string): boolean {
  let prototype: object | null = BaseModel.prototype;
  while (prototype !== null) {
    if (Object.hasOwn(prototype, name)) return true;
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return false;
}

function assertNoComputedCycles(modelName: string, fieldMap: FieldMap): void {
  const computed = new Map<string, readonly string[]>();
  for (const [key, field] of Object.entries(fieldMap)) {
    if (field.compute && field.depends && field.depends.length > 0) {
      computed.set(key, field.depends);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function dfs(fieldName: string) {
    if (visited.has(fieldName)) return;
    if (visiting.has(fieldName)) {
      throw new Error(`Circular computed field dependency on ${modelName}.${fieldName}`);
    }
    const deps = computed.get(fieldName);
    if (!deps) return;
    visiting.add(fieldName);
    for (const dep of deps) {
      const rootDep = dep.split('.')[0] ?? dep;
      if (computed.has(rootDep)) {
        dfs(rootDep);
      }
    }
    visiting.delete(fieldName);
    visited.add(fieldName);
  }
  for (const key of computed.keys()) {
    dfs(key);
  }
}

export function fieldSchema(field: Field): JSONSchema {
  const hasStaticDefault = field.default !== undefined && typeof field.default !== 'function';
  const staticDefault = hasStaticDefault ? (field.default as JSONSchema['default']) : undefined;
  const nonNullable = Boolean(field.required) || hasStaticDefault;

  if (field.kind === 'decimal') {
    return {
      type: nonNullable ? ['number', 'string'] : ['number', 'string', 'null'],
      ...(hasStaticDefault ? { default: staticDefault } : {}),
    };
  }
  if (field.kind === 'json') {
    return {
      type: nonNullable ? ['object', 'array', 'string'] : ['object', 'array', 'null', 'string'],
      ...(hasStaticDefault ? { default: staticDefault } : {}),
    };
  }
  if (field.kind === 'float') {
    return {
      type: nonNullable ? 'number' : ['number', 'null'],
      ...(hasStaticDefault ? { default: staticDefault } : {}),
    };
  }
  if (field.kind === 'date') {
    return {
      type: nonNullable ? 'string' : ['string', 'null'],
      pattern: field.pattern ?? '^\\d{4}-\\d{2}-\\d{2}$',
      ...(hasStaticDefault ? { default: staticDefault } : {}),
    };
  }
  if (field.kind === 'datetime') {
    return {
      type: nonNullable ? 'string' : ['string', 'null'],
      ...(field.pattern !== undefined ? { pattern: field.pattern } : {}),
      ...(hasStaticDefault ? { default: staticDefault } : {}),
    };
  }

  const type =
    field.kind === 'belongsTo'
      ? 'integer'
      : field.kind === 'enum' || field.kind === 'password' || field.kind === 'text'
        ? 'string'
        : field.kind;
  return {
    type: nonNullable ? type : [type, 'null'],
    ...(field.values ? { enum: nonNullable ? [...field.values] : [...field.values, null] } : {}),
    ...(hasStaticDefault ? { default: staticDefault } : {}),
    ...(field.pattern !== undefined ? { pattern: field.pattern } : {}),
    ...(type === 'string' && field.kind !== 'text'
      ? {
          maxLength: field.kind === 'password' ? 1024 : 255,
          ...(field.required || field.kind === 'password' ? { minLength: 1 } : {}),
        }
      : {}),
  };
}

function buildSchemaFromFields(
  name: string,
  fieldMap: FieldMap
): { properties: Record<string, JSONSchema>; required: string[] } {
  const properties = { ...standardProperties };
  const required: string[] = [];
  for (const [key, field] of Object.entries(fieldMap)) {
    const column = columnName(key, field);
    if (
      !/^[a-z][a-z0-9_]*$/.test(key) ||
      (isStoredField(field) && column in properties) ||
      conflictsWithInstanceMember(key)
    ) {
      throw new Error(`Invalid or duplicate field: ${name}.${key}`);
    }
    if (!isStoredField(field)) {
      continue;
    }
    if (
      field.default !== undefined &&
      typeof field.default !== 'function' &&
      field.values &&
      !field.values.includes(String(field.default))
    ) {
      throw new Error(`Invalid default for ${name}.${key}`);
    }
    properties[column] = fieldSchema(field);
    if (field.required && field.default === undefined && !field.compute) required.push(column);
  }
  assertNoComputedCycles(name, fieldMap);
  return { properties, required };
}

/** Apply an `extendModel(...)` patch to a registered model class before schema sync. */
export function applyModelExtension(model: typeof BaseModel, extension: ModelExtension): void {
  const currentFields: Record<string, Field> = { ...(model.fields ?? {}) };
  const existingColumns = new Set<string>(Object.keys(standardProperties));
  for (const [key, field] of Object.entries(currentFields)) {
    existingColumns.add(columnName(key, field));
  }

  if (extension.fields) {
    for (const [key, field] of Object.entries(extension.fields)) {
      const col = columnName(key, field);
      if (key in currentFields || (isStoredField(field) && existingColumns.has(col))) {
        throw new Error(
          `Model extension collision on ${model.modelName}: field '${key}' (column '${col}') already exists`
        );
      }
      currentFields[key] = field;
      if (isStoredField(field)) existingColumns.add(col);
    }
  }

  model.fields = currentFields;
  const { properties, required } = buildSchemaFromFields(model.modelName, currentFields);
  model.jsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
  model.hiddenFields = Object.entries(currentFields)
    .filter(([, field]) => field.kind === 'password' || field.hidden === true)
    .map(([key]) => key);
  model.sensitiveFields = Object.entries(currentFields)
    .filter(([, field]) => field.sensitive === true)
    .map(([key]) => key);

  if (extension.unique && extension.unique.length > 0) {
    model.uniqueConstraints = [
      ...model.uniqueConstraints,
      ...extension.unique.map((cols) => [...cols]),
    ];
  }
  if (extension.exposedActions && extension.exposedActions.length > 0) {
    model.exposedActions = Array.from(
      new Set([...model.exposedActions, ...extension.exposedActions])
    );
  }
  if (extension.constraints && extension.constraints.length > 0) {
    model.constraints = [...model.constraints, ...extension.constraints];
  }
  if (extension.onchange) {
    model.onchangeHandlers = { ...model.onchangeHandlers, ...extension.onchange };
  }
  if (extension.displayField) {
    model.displayField = extension.displayField;
  }
}

/** Define business fields once; validation, relations, storage and TS types follow. */
export function defineModel<const F extends FieldMap>(
  name: string,
  definition: {
    fields: F;
    table?: string;
    order?: string;
    unique?: readonly (readonly (keyof F & string)[])[];
    displayField?: string;
    _recName?: string;
    constraints?: readonly ModelConstraint[];
    onchange?: Readonly<Record<string, OnchangeHandler>>;
    exposedActions?: readonly string[];
  }
): DefinedModel<F> {
  const tableName = definition.table ?? name.replaceAll('.', '_');
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) throw new Error(`Invalid table name: ${tableName}`);
  const { properties, required } = buildSchemaFromFields(name, definition.fields);

  class DeclaredModel extends BaseModel {
    static override hiddenFields = Object.entries(definition.fields)
      .filter(([, field]) => field.kind === 'password' || field.hidden === true)
      .map(([key]) => key);

    static override sensitiveFields = Object.entries(definition.fields)
      .filter(([, field]) => field.sensitive === true)
      .map(([key]) => key);

    static override displayField = definition.displayField ?? definition._recName;
    static override constraints: readonly ModelConstraint[] = [...(definition.constraints ?? [])];
    static override onchangeHandlers: Readonly<Record<string, OnchangeHandler>> = {
      ...(definition.onchange ?? {}),
    };
    static override exposedActions: readonly string[] = definition.exposedActions
      ? [...definition.exposedActions]
      : ['action_archive', 'action_unarchive'];

    private async hashPasswords() {
      const values = this as unknown as Record<string, unknown>;
      const activeFields = (this.constructor as typeof BaseModel).fields ?? definition.fields;
      const passwordFields = Object.entries(activeFields)
        .filter(([, field]) => field.kind === 'password')
        .map(([key]) => key);
      for (const key of passwordFields) {
        if (typeof values[key] === 'string' && !values[key].startsWith('scrypt$')) {
          values[key] = await hashPassword(values[key]);
        }
      }
    }

    override async $beforeInsert(context: QueryContext) {
      await super.$beforeInsert(context);
      await this.hashPasswords();
    }

    override async $beforeUpdate(options: ModelOptions, context: QueryContext) {
      await super.$beforeUpdate(options, context);
      await this.hashPasswords();
    }

    override $formatJson(json: Record<string, unknown>): Record<string, unknown> {
      const result: Record<string, unknown> = super.$formatJson(json);
      for (const key of DeclaredModel.hiddenFields) delete result[key];
      return result;
    }

    static override modelName = name;
    static override tableName = tableName;
    static override defaultOrder = definition.order ?? 'id asc';
    static override fields: FieldMap = { ...definition.fields };
    static override uniqueConstraints = (definition.unique ?? []).map((cols) => [...cols]);
    static override jsonSchema: JSONSchema = {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    };

    private static _customRelationMappings?: RelationMappings;

    static override get relationMappings(): RelationMappings {
      const rels: RelationMappings = {};
      const activeFields = this.fields ?? definition.fields;

      for (const [key, field] of Object.entries(activeFields)) {
        const column = columnName(key, field);
        if (field.kind === 'hasMany') {
          const target = resolveFieldTarget(field.target);
          if (target) {
            const foreignKey = field.foreignKey ?? `${name.split('.').pop()}_id`;
            rels[key] = {
              relation: BaseModel.HasManyRelation,
              modelClass: target,
              join: { from: `${tableName}.id`, to: `${target.tableName}.${foreignKey}` },
            };
          }
        } else if (field.kind === 'belongsTo') {
          const target = resolveFieldTarget(field.target);
          if (target) {
            rels[key] = {
              relation: BaseModel.BelongsToOneRelation,
              modelClass: target,
              join: { from: `${tableName}.${column}`, to: `${target.tableName}.id` },
            };
          }
        } else if (field.kind === 'manyToMany') {
          const target = resolveFieldTarget(field.target);
          const meta = manyToManyTableMeta(tableName, key, field);
          if (target && meta) {
            rels[key] = {
              relation: BaseModel.ManyToManyRelation,
              modelClass: target,
              join: {
                from: `${tableName}.id`,
                through: {
                  from: `${meta.relationTable}.${meta.joinColumn}`,
                  to: `${meta.relationTable}.${meta.inverseJoinColumn}`,
                },
                to: `${target.tableName}.id`,
              },
            };
          }
        }
      }
      return { ...rels, ...this._customRelationMappings };
    }

    static override set relationMappings(value: RelationMappings) {
      this._customRelationMappings = { ...value };
    }
  }
  return DeclaredModel as unknown as DefinedModel<F>;
}
