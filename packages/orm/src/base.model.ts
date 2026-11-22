import {
  Model,
  type QueryBuilder,
  type Transaction,
  type ModelOptions,
  type QueryContext,
} from 'objection';
import { applyDomain } from './domain.js';
import { isRecord } from '@moonwitness/types';
import { hashPassword } from './password.js';
import { ServiceContainer } from './services.js';
import {
  ConcurrencyConflictError,
  ValidationError,
  type Domain,
  type EnvironmentLike,
  type FieldDefault,
  type FieldKind,
  type GroupCountOptions,
  type GroupCountPage,
  type GroupCountRow,
  type JsonValue,
  type ManyToManyTableMeta,
  type ModelContext,
  type OnchangeHandler,
  type OnchangeResult,
  type OnDeletePolicy,
  type Scalar,
  type SearchOptions,
  type SearchReadOptions,
} from './types.js';

export type ModelConstraint<TEnv = EnvironmentLike> = (
  record: Record<string, unknown>,
  env?: TEnv
) => void | Promise<void>;

export interface FieldOptions<T = Scalar, TEnv = EnvironmentLike> {
  required?: boolean;
  unique?: boolean;
  /** Creates a non-unique database index on this column during addon schema sync. */
  index?: boolean;
  /** Excludes the field from serialized records and generic query inputs. */
  hidden?: boolean;
  /** Excludes the field from audit and outbox snapshots while keeping normal authorized reads. */
  sensitive?: boolean;
  readonly?: boolean;
  default?: FieldDefault<T>;
  /** Human-readable label for generated UIs; defaults to the humanized field name. */
  label?: string;
  /** Tooltip / helper text for generated UIs. */
  help?: string;
  /** Optional regular expression used by generated JSON Schema validation. */
  pattern?: string;
  /** Conditional visibility based on domain */
  invisible?: Domain | boolean;
  /** Conditional readonly based on domain */
  readonlyIf?: Domain;
  /** Conditional required based on domain */
  requiredIf?: Domain;
  /** Declarative computed field evaluator */
  compute?: (record: Record<string, unknown>, env?: TEnv) => unknown | Promise<unknown>;
  /** Dependency field names (or dotted relation paths) that trigger recomputation */
  depends?: readonly string[];
  /** When true, computed value is persisted in the database column */
  store?: boolean;
}

export interface DecimalOptions<TEnv = EnvironmentLike> extends FieldOptions<
  number | string,
  TEnv
> {
  precision?: number;
  scale?: number;
}

export interface BelongsToOptions<TEnv = EnvironmentLike> extends FieldOptions<number, TEnv> {
  /** Foreign key delete policy; defaults to 'restrict'. */
  onDelete?: OnDeletePolicy;
}

export interface Field<T = unknown, TEnv = EnvironmentLike> extends FieldOptions<T, TEnv> {
  kind: FieldKind;
  values?: readonly string[];
  target?: typeof BaseModel | (() => typeof BaseModel);
  foreignKey?: string;
  onDelete?: OnDeletePolicy;
  precision?: number;
  scale?: number;
  relationTable?: string;
  joinColumn?: string;
  inverseJoinColumn?: string;
  /** Type-only marker used to infer the model's record shape. */
  readonly valueType?: T;
}

export type FieldMap<TEnv = EnvironmentLike> = Readonly<Record<string, Field<unknown, TEnv>>>;

function columnName(name: string, field: Field): string {
  return field.kind === 'belongsTo' ? `${name}_id` : name;
}

function manyToManyTableMeta(
  sourceTable: string,
  key: string,
  field: Field
): ManyToManyTableMeta | undefined {
  if (field.kind !== 'manyToMany' || !field.target) return undefined;
  const targetModel =
    typeof field.target === 'function' && !('tableName' in field.target)
      ? (field.target as () => typeof BaseModel)()
      : (field.target as typeof BaseModel);
  if (!targetModel) return undefined;
  const targetTable = targetModel.tableName;
  const isSelf = sourceTable === targetTable;
  return {
    relationTable: field.relationTable ?? `${sourceTable}_${targetTable}_${key}_rel`,
    sourceTable,
    targetTable,
    joinColumn: field.joinColumn ?? (isSelf ? `${sourceTable}_source_id` : `${sourceTable}_id`),
    inverseJoinColumn:
      field.inverseJoinColumn ?? (isSelf ? `${targetTable}_target_id` : `${targetTable}_id`),
  };
}

const SERVER_MANAGED_FIELDS = new Set([
  'id',
  'create_date',
  'write_date',
  'create_uid',
  'write_uid',
]);

export interface WriteOptions {
  context?: ModelContext;
  transaction?: Transaction;
  expectedWriteDate?: string;
}

export interface UnlinkOptions {
  transaction?: Transaction;
  expectedWriteDate?: string;
}

export class BaseModel extends Model {
  /**
   * Model identifier in dot-notation (e.g. 'base.user', 'base.item').
   * Must be overridden by subclasses.
   */
  static modelName: string;

  /**
   * Default ordering for queries (e.g. 'id desc', 'name asc').
   */
  static defaultOrder: string = 'id desc';
  static exposedActions: readonly string[] = ['action_archive', 'action_unarchive'];
  static hiddenFields: readonly string[] = [];
  static sensitiveFields: readonly string[] = [];
  static uniqueConstraints: readonly (readonly string[])[] = [];
  /** Optional display field name (e.g. 'login' for base.user, 'code' for base.sequence). */
  static displayField?: string;
  /** Declarative addon fields, when the model is defined through `defineModel`. */
  static fields?: FieldMap;
  /** Transactional cross-field validators executed before commit on create/write/update. */
  static constraints: readonly ModelConstraint[] = [];
  /** Declarative onchange handlers keyed by field name. */
  static onchangeHandlers: Readonly<Record<string, OnchangeHandler>> = {};

  /**
   * The Environment associated with this model class execution.
   */
  private static _env?: EnvironmentLike;
  private static _defaultEnvFactory?: () => EnvironmentLike;

  static setDefaultEnvironmentFactory(factory: () => EnvironmentLike): void {
    this._defaultEnvFactory = factory;
  }

  static get env(): EnvironmentLike {
    if (!this._env) {
      this._env = this._defaultEnvFactory
        ? this._defaultEnvFactory()
        : { context: { activeTest: true }, services: new ServiceContainer() };
    }
    return this._env;
  }

  static set env(value: EnvironmentLike) {
    this._env = value;
  }

  // --- Standard Audit & Status Fields ---
  id!: number;
  active?: boolean;
  create_date?: string;
  write_date?: string;
  create_uid?: number | null;
  write_uid?: number | null;

  /**
   * Lifecycle hook: executed before inserting into the database.
   */
  override async $beforeInsert(context: QueryContext) {
    await super.$beforeInsert(context);

    const now = new Date().toISOString();
    if (this.active === undefined) {
      this.active = true;
    }
    if (!this.create_date) {
      this.create_date = now;
    }
    if (!this.write_date) {
      this.write_date = now;
    }

    const currentUserId = (this.$modelClass as unknown as typeof BaseModel).env?.context?.userId;
    if (currentUserId !== undefined && this.create_uid === undefined) {
      this.create_uid = currentUserId;
    }
    if (currentUserId !== undefined && this.write_uid === undefined) {
      this.write_uid = currentUserId;
    }
  }

  /**
   * Lifecycle hook: executed when parsing database rows into Model instances.
   * Ensures booleans and JSON fields are always typed properly across PostgreSQL and SQLite.
   */
  override $parseDatabaseJson(json: Record<string, unknown>) {
    json = super.$parseDatabaseJson(json);

    if (json.active !== undefined && typeof json.active === 'number') {
      json.active = json.active === 1;
    }

    const ctor = this.constructor as typeof BaseModel;
    const schema = ctor.jsonSchema;
    if (schema?.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (typeof prop === 'object' && prop !== null && 'type' in prop) {
          const propType = prop.type;
          const isBool =
            propType === 'boolean' || (Array.isArray(propType) && propType.includes('boolean'));
          if (isBool && typeof json[key] === 'number') {
            json[key] = json[key] === 1;
          }
        }
      }
    }

    if (ctor.fields) {
      for (const [key, field] of Object.entries(ctor.fields)) {
        if (field.kind === 'json' && typeof json[key] === 'string') {
          try {
            json[key] = JSON.parse(json[key]);
          } catch {
            // Keep raw string if not valid JSON
          }
        }
      }
    }

    return json;
  }

  override $formatDatabaseJson(json: Record<string, unknown>) {
    const formatted = super.$formatDatabaseJson(json);
    const ctor = this.constructor as typeof BaseModel;
    if (ctor.fields) {
      for (const [key, field] of Object.entries(ctor.fields)) {
        if (
          field.kind === 'json' &&
          formatted[key] !== undefined &&
          formatted[key] !== null &&
          typeof formatted[key] !== 'string'
        ) {
          formatted[key] = JSON.stringify(formatted[key]);
        }
      }
    }
    return formatted;
  }

  /**
   * Lifecycle hook: executed before updating a record.
   */
  override async $beforeUpdate(opt: ModelOptions, context: QueryContext) {
    await super.$beforeUpdate(opt, context);

    this.write_date = new Date().toISOString();
    const currentUserId = (this.$modelClass as unknown as typeof BaseModel).env?.context?.userId;
    if (currentUserId !== undefined) {
      this.write_uid = currentUserId;
    }
  }

  /**
   * Display name / string representation.
   */
  get display_name(): string {
    const ctor = this.constructor as typeof BaseModel;
    const recField = ctor.displayField;
    const self = this as unknown as Record<string, unknown>;
    if (recField && self[recField] !== undefined && self[recField] !== null) {
      const val = String(self[recField]);
      if (val.length > 0) return val;
    }
    if ('name' in this && typeof this.name === 'string' && this.name.length > 0) {
      return this.name;
    }
    return `[${this.id}]`;
  }

  /**
   * Efficiently resolve `[id, display_name]` pairs for a list of IDs.
   */
  static async nameGet(
    ids: readonly number[],
    options: { transaction?: Transaction } = {}
  ): Promise<Array<[number, string]>> {
    if (ids.length === 0) return [];
    const trx = this.resolveTrx(options.transaction);
    const properties = this.jsonSchema?.properties ?? {};
    const recField =
      this.displayField && Object.hasOwn(properties, this.displayField)
        ? this.displayField
        : Object.hasOwn(properties, 'name')
          ? 'name'
          : undefined;

    const selectCols = recField ? ['id', recField] : ['id'];
    const rows = await this.query(trx)
      .whereIn('id', [...ids])
      .select(selectCols);
    return rows.map((row) => [row.id, row.display_name]);
  }

  /**
   * Return default values for fields (evaluating static defaults, dynamic default functions,
   * and safe `default_*` entries from context).
   */
  static async defaultGet(
    fieldNames?: readonly string[],
    context?: ModelContext
  ): Promise<Record<string, unknown>> {
    const resolvedCtx = this.resolveContext(context);
    const defaults: Record<string, unknown> = {};
    const activeFields = this.fields ?? {};
    const targetKeys = fieldNames ? new Set(fieldNames) : undefined;

    for (const [key, field] of Object.entries(activeFields)) {
      const col = columnName(key, field);
      if (targetKeys && !targetKeys.has(key) && !targetKeys.has(col)) continue;
      if (field.default !== undefined) {
        defaults[col] =
          typeof field.default === 'function' ? field.default(resolvedCtx) : field.default;
      }
    }

    // Apply safe `default_*` context overrides (never server-managed or company_id)
    for (const [ctxKey, ctxVal] of Object.entries(resolvedCtx)) {
      if (!ctxKey.startsWith('default_') || ctxVal === undefined) continue;
      const fieldKey = ctxKey.slice('default_'.length);
      if (SERVER_MANAGED_FIELDS.has(fieldKey) || fieldKey === 'company_id') continue;
      const properties = this.jsonSchema?.properties ?? {};
      if (!Object.hasOwn(properties, fieldKey)) continue;
      if (targetKeys && !targetKeys.has(fieldKey)) continue;
      defaults[fieldKey] = ctxVal;
    }

    return defaults;
  }

  /**
   * Execute declarative onchange handler for `changedField`.
   */
  static async onchange(
    values: Record<string, unknown>,
    changedField: string,
    context?: ModelContext
  ): Promise<OnchangeResult> {
    const resolvedCtx = this.resolveContext(context);
    const handler = this.onchangeHandlers[changedField];
    if (!handler) {
      return { values: {}, domainOverrides: {}, warnings: [] };
    }
    const result = await handler({ ...values }, resolvedCtx);
    return {
      values: result.values ?? {},
      domainOverrides: result.domainOverrides ?? {},
      warnings: result.warnings ?? [],
    };
  }

  /**
   * Strip hidden and sensitive fields from a record payload (for audit logs / outbox).
   */
  static redactSensitive(record: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = { ...record };
    for (const key of this.hiddenFields) {
      delete redacted[key];
    }
    for (const key of this.sensitiveFields) {
      if (key in redacted) {
        redacted[key] = '[REDACTED]';
      }
    }
    return redacted;
  }

  /**
   * Run all declared transactional constraints on a record payload.
   */
  protected static async runConstraints(
    record: Record<string, unknown>,
    env?: EnvironmentLike
  ): Promise<void> {
    if (this.constraints.length === 0) return;
    for (const constraint of this.constraints) {
      try {
        await constraint(record, env ?? this.env);
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * Compute stored computed fields on a payload before persistence.
   */
  protected static async applyStoredComputedFields(
    payload: Record<string, unknown>,
    baseRecord?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!this.fields) return payload;
    const merged: Record<string, unknown> = { ...(baseRecord ?? {}), ...payload };
    const result: Record<string, unknown> = { ...payload };
    for (const [key, field] of Object.entries(this.fields)) {
      if (!field.compute || !field.store) continue;
      const col = columnName(key, field);
      const computedVal = await field.compute(merged, this.env);
      result[col] = computedVal;
      merged[col] = computedVal;
    }
    return result;
  }

  /**
   * Populate non-stored computed fields on read records.
   */
  protected static async populateComputedFields(records: Record<string, unknown>[]): Promise<void> {
    if (!this.fields || records.length === 0) return;
    const nonStored = Object.entries(this.fields).filter(([, f]) => Boolean(f.compute) && !f.store);
    if (nonStored.length === 0) return;
    for (const rec of records) {
      for (const [key, field] of nonStored) {
        rec[columnName(key, field)] = await field.compute!(rec, this.env);
      }
    }
  }

  /**
   * Extract manyToMany field assignments from a write/create payload.
   */
  protected static extractManyToMany(vals: Record<string, unknown>): {
    scalarVals: Record<string, unknown>;
    m2mOps: Array<{ fieldName: string; targetIds: number[] }>;
  } {
    if (!this.fields) return { scalarVals: vals, m2mOps: [] };
    const scalarVals: Record<string, unknown> = {};
    const m2mOps: Array<{ fieldName: string; targetIds: number[] }> = [];
    for (const [key, value] of Object.entries(vals)) {
      const field = this.fields[key];
      if (field?.kind === 'manyToMany' && Array.isArray(value)) {
        m2mOps.push({
          fieldName: key,
          targetIds: value.map((v) => Number(v)).filter((n) => Number.isSafeInteger(n)),
        });
      } else {
        scalarVals[key] = value;
      }
    }
    return { scalarVals, m2mOps };
  }

  /**
   * Replace all M2M links for `recordId` on `fieldName` with `targetIds`.
   */
  static async setManyToMany(
    recordId: number,
    fieldName: string,
    targetIds: readonly number[],
    options: { transaction?: Transaction } = {}
  ): Promise<void> {
    const field = this.fields?.[fieldName];
    const meta = field ? manyToManyTableMeta(this.tableName, fieldName, field) : undefined;
    if (!meta) {
      throw new ValidationError(`Unknown manyToMany field '${fieldName}' on '${this.modelName}'`);
    }
    const db = this.resolveTrx(options.transaction) ?? this.knex();
    await db(meta.relationTable).where(meta.joinColumn, recordId).delete();
    const uniqueIds = Array.from(new Set(targetIds));
    if (uniqueIds.length > 0) {
      await db(meta.relationTable).insert(
        uniqueIds.map((targetId) => ({
          [meta.joinColumn]: recordId,
          [meta.inverseJoinColumn]: targetId,
        }))
      );
    }
  }

  /**
   * Add M2M links for `recordId` on `fieldName` without removing existing links.
   */
  static async linkManyToMany(
    recordId: number,
    fieldName: string,
    targetIds: readonly number[],
    options: { transaction?: Transaction } = {}
  ): Promise<void> {
    const field = this.fields?.[fieldName];
    const meta = field ? manyToManyTableMeta(this.tableName, fieldName, field) : undefined;
    if (!meta) {
      throw new ValidationError(`Unknown manyToMany field '${fieldName}' on '${this.modelName}'`);
    }
    const uniqueIds = Array.from(new Set(targetIds));
    if (uniqueIds.length === 0) return;
    const db = this.resolveTrx(options.transaction) ?? this.knex();
    for (const targetId of uniqueIds) {
      const existing = await db(meta.relationTable)
        .where({ [meta.joinColumn]: recordId, [meta.inverseJoinColumn]: targetId })
        .first();
      if (!existing) {
        await db(meta.relationTable).insert({
          [meta.joinColumn]: recordId,
          [meta.inverseJoinColumn]: targetId,
        });
      }
    }
  }

  /**
   * Remove specific M2M links for `recordId` on `fieldName`.
   */
  static async unlinkManyToMany(
    recordId: number,
    fieldName: string,
    targetIds: readonly number[],
    options: { transaction?: Transaction } = {}
  ): Promise<void> {
    const field = this.fields?.[fieldName];
    const meta = field ? manyToManyTableMeta(this.tableName, fieldName, field) : undefined;
    if (!meta) {
      throw new ValidationError(`Unknown manyToMany field '${fieldName}' on '${this.modelName}'`);
    }
    const uniqueIds = Array.from(new Set(targetIds));
    if (uniqueIds.length === 0) return;
    const db = this.resolveTrx(options.transaction) ?? this.knex();
    await db(meta.relationTable)
      .where(meta.joinColumn, recordId)
      .whereIn(meta.inverseJoinColumn, uniqueIds)
      .delete();
  }

  /**
   * Resolves the active transaction from options or current environment.
   */
  protected static resolveTrx(optionsTrx?: Transaction): Transaction | undefined {
    return optionsTrx || this.env?.trx;
  }

  /**
   * Resolves context merged from environment and options.
   */
  protected static resolveContext(optionsContext?: ModelContext): ModelContext {
    return {
      ...(this.env?.context || {}),
      ...(optionsContext || {}),
    };
  }

  /**
   * Create single record or multiple records.
   */
  static async create<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    vals: Partial<M> | Partial<M>[] | Record<string, unknown> | Record<string, unknown>[],
    options: { context?: ModelContext; transaction?: Transaction } = {}
  ): Promise<M | M[]> {
    const trx = this.resolveTrx(options.transaction as Transaction | undefined);

    const prepareOne = async (raw: Record<string, unknown>) => {
      const { scalarVals, m2mOps } = this.extractManyToMany(raw);
      const withComputed = await this.applyStoredComputedFields(scalarVals);
      await this.runConstraints(withComputed, this.env);
      return { withComputed, m2mOps };
    };

    if (Array.isArray(vals)) {
      if (vals.length === 0) return [];
      const prepared = await Promise.all(
        (vals as Record<string, unknown>[]).map((item) => prepareOne(item))
      );
      const created = await this.query(trx).insertAndFetch(prepared.map((p) => p.withComputed));
      for (let i = 0; i < created.length; i += 1) {
        const rec = created[i]!;
        for (const op of prepared[i]!.m2mOps) {
          await this.setManyToMany(rec.id, op.fieldName, op.targetIds, { transaction: trx });
        }
      }
      return created as unknown as M[];
    } else {
      const { withComputed, m2mOps } = await prepareOne(vals as Record<string, unknown>);
      const created = await this.query(trx).insertAndFetch(withComputed);
      for (const op of m2mOps) {
        await this.setManyToMany(created.id, op.fieldName, op.targetIds, { transaction: trx });
      }
      return created as unknown as M;
    }
  }

  /**
   * Instance method to update this record.
   */
  async update(
    vals: Partial<this> | Record<string, unknown>,
    options: WriteOptions = {}
  ): Promise<this> {
    const ModelClass = this.$modelClass as unknown as typeof BaseModel;
    const trx = ModelClass.resolveTrx(options.transaction);
    const { scalarVals, m2mOps } = ModelClass.extractManyToMany(vals as Record<string, unknown>);
    const baseRecord = this.toJSON() as Record<string, unknown>;
    const withComputed = await ModelClass.applyStoredComputedFields(scalarVals, baseRecord);
    await ModelClass.runConstraints({ ...baseRecord, ...withComputed }, ModelClass.env);

    if (options.expectedWriteDate !== undefined) {
      const affected = await ModelClass.write(this.id, vals, options);
      if (affected > 0) {
        const refreshed = await this.$query(trx);
        if (refreshed) Object.assign(this, refreshed);
      }
      return this;
    }

    const updated = await this.$query(trx).patchAndFetch(withComputed);
    for (const op of m2mOps) {
      await ModelClass.setManyToMany(this.id, op.fieldName, op.targetIds, { transaction: trx });
    }
    Object.assign(this, updated);
    return this;
  }

  /**
   * Static method to update multiple records by IDs.
   * Unified pipeline: validates patch JSON schema, hashes passwords, recomputes stored fields,
   * runs constraints, enforces `expectedWriteDate` optimistic concurrency, and syncs M2M relations.
   */
  static async write<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    ids: number | number[],
    vals: Partial<M> | Record<string, unknown>,
    options: WriteOptions = {}
  ): Promise<number> {
    const trx = this.resolveTrx(options.transaction as Transaction | undefined);
    const idList = Array.isArray(ids) ? ids : [ids];
    if (idList.length === 0) return 0;

    const { scalarVals, m2mOps } = this.extractManyToMany(vals as Record<string, unknown>);
    const patchVals: Record<string, unknown> = { ...scalarVals };

    // Validate patch against jsonSchema (unified with instance update)
    if (Object.keys(patchVals).length > 0 && this.jsonSchema?.properties) {
      this.fromJson(patchVals, { patch: true });
    }

    // Hash password fields uniformly
    if (this.fields) {
      for (const [key, field] of Object.entries(this.fields)) {
        if (
          field.kind === 'password' &&
          typeof patchVals[key] === 'string' &&
          !patchVals[key].startsWith('scrypt$')
        ) {
          patchVals[key] = await hashPassword(patchVals[key]);
        }
      }
    }

    // If model has stored computed fields or constraints, evaluate against existing rows
    const hasStoredComputed = Boolean(
      this.fields && Object.values(this.fields).some((f) => Boolean(f.compute) && Boolean(f.store))
    );
    if (hasStoredComputed || this.constraints.length > 0) {
      const existingRows = await this.query(trx).whereIn('id', idList);
      let totalPatched = 0;
      for (const row of existingRows) {
        const baseRecord = row.toJSON() as Record<string, unknown>;
        const withComputed = await this.applyStoredComputedFields(patchVals, baseRecord);
        await this.runConstraints({ ...baseRecord, ...withComputed }, this.env);

        let qb = this.query(trx).where('id', row.id);
        if (options.expectedWriteDate !== undefined) {
          qb = qb.where('write_date', options.expectedWriteDate);
        }
        const count = await qb.patch({
          ...withComputed,
          write_date: new Date().toISOString(),
          ...(this.env?.context?.userId !== undefined
            ? { write_uid: this.env.context.userId }
            : {}),
        });
        if (options.expectedWriteDate !== undefined && count === 0) {
          throw new ConcurrencyConflictError(
            `Concurrency conflict updating '${this.modelName}' id=${row.id}: expected write_date '${options.expectedWriteDate}'`
          );
        }
        totalPatched += count;
      }
      if (m2mOps.length > 0) {
        for (const id of idList) {
          for (const op of m2mOps) {
            await this.setManyToMany(id, op.fieldName, op.targetIds, { transaction: trx });
          }
        }
      }
      return totalPatched;
    }

    let qb = this.query(trx).whereIn('id', idList);
    if (options.expectedWriteDate !== undefined) {
      qb = qb.where('write_date', options.expectedWriteDate);
    }

    const patchedCount = await qb.patch({
      ...patchVals,
      write_date: new Date().toISOString(),
      ...(this.env?.context?.userId !== undefined ? { write_uid: this.env.context.userId } : {}),
    });

    if (options.expectedWriteDate !== undefined && patchedCount === 0) {
      const existing = await this.query(trx).whereIn('id', idList).select('id').first();
      if (existing) {
        throw new ConcurrencyConflictError(
          `Concurrency conflict updating '${this.modelName}': expected write_date '${options.expectedWriteDate}'`
        );
      }
    }

    if (m2mOps.length > 0) {
      for (const id of idList) {
        for (const op of m2mOps) {
          await this.setManyToMany(id, op.fieldName, op.targetIds, { transaction: trx });
        }
      }
    }

    return patchedCount;
  }

  /**
   * Instance method to delete (soft-delete / archive by default).
   * If hardDelete is true, permanently deletes the record from DB.
   */
  async remove(hardDelete = false, options: UnlinkOptions = {}): Promise<boolean> {
    const ModelClass = this.$modelClass as unknown as typeof BaseModel;

    if (hardDelete) {
      const deleted = await ModelClass.unlink(this.id, true, options);
      return deleted > 0;
    } else {
      await this.update({ active: false }, options);
      return true;
    }
  }

  /**
   * Static method to delete or archive multiple records by ID.
   */
  static async unlink<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    ids: number | number[],
    hardDelete = false,
    options: UnlinkOptions = {}
  ): Promise<number> {
    const trx = this.resolveTrx(options.transaction as Transaction | undefined);
    const idList = Array.isArray(ids) ? ids : [ids];
    if (idList.length === 0) return 0;

    if (hardDelete) {
      let qb = this.query(trx).whereIn('id', idList);
      if (options.expectedWriteDate !== undefined) {
        qb = qb.where('write_date', options.expectedWriteDate);
      }
      const deleted = await qb.delete();
      if (options.expectedWriteDate !== undefined && deleted === 0) {
        const existing = await this.query(trx).whereIn('id', idList).select('id').first();
        if (existing) {
          throw new ConcurrencyConflictError(
            `Concurrency conflict deleting '${this.modelName}': expected write_date '${options.expectedWriteDate}'`
          );
        }
      }
      return deleted;
    } else {
      return await this.write(idList, { active: false }, options);
    }
  }

  /**
   * Search records matching a filter domain.
   */
  static async search<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    domain: Domain = [],
    options: SearchOptions = {}
  ): Promise<M[]> {
    const qb = this.buildSearchQuery(domain, options);
    const results = await qb;
    await this.populateComputedFields(results as unknown as Record<string, unknown>[]);
    return results as unknown as M[];
  }

  /**
   * Search records and returns serializable plain objects with selected fields.
   */
  static async search_read<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    domain: Domain = [],
    options: SearchReadOptions = {}
  ): Promise<Record<string, unknown>[]> {
    const qb = this.buildSearchQuery(domain, options);
    const nonStoredComputedNames = new Set(
      Object.entries(this.fields ?? {})
        .filter(([, f]) => Boolean(f.compute) && !f.store)
        .map(([k, f]) => columnName(k, f))
    );

    if (options.fields && options.fields.length > 0) {
      const properties = this.jsonSchema?.properties;
      const hasSchemaProperties =
        typeof properties === 'object' && properties !== null && Object.keys(properties).length > 0;
      if (
        options.fields.some(
          (field) =>
            !/^[a-z_][a-z0-9_]*$/i.test(field) ||
            this.hiddenFields.includes(field) ||
            (hasSchemaProperties &&
              !Object.hasOwn(properties, field) &&
              !nonStoredComputedNames.has(field))
        )
      ) {
        throw Object.assign(new Error('Invalid or private field selection'), { statusCode: 400 });
      }
      const dbFields = Array.from(
        new Set(['id', ...options.fields.filter((f) => !nonStoredComputedNames.has(f))])
      ).map((f) => `${this.tableName}.${f}`);
      qb.select(dbFields);
    }

    const records = await qb;
    const jsonRows = records.map((record) => record.toJSON() as Record<string, unknown>);
    await this.populateComputedFields(jsonRows);
    return jsonRows;
  }

  /**
   * Returns the number of records matching the domain.
   */
  static async search_count<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    domain: Domain = [],
    options: SearchOptions = {}
  ): Promise<number> {
    const qb = this.buildSearchQuery(domain, { ...options, order: '' });
    const countResult: unknown = await qb.count('* as count').first();
    const count =
      typeof countResult === 'object' && countResult !== null && 'count' in countResult
        ? countResult.count
        : undefined;
    return typeof count === 'string' ? parseInt(count, 10) : Number(count || 0);
  }

  /** Returns bounded grouped counts for scalar columns declared by the model. */
  static async search_group_count<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    domain: Domain = [],
    groupBy: readonly string[] = [],
    options: GroupCountOptions = {}
  ): Promise<GroupCountPage> {
    const maxGroups = 500;
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const properties = this.jsonSchema.properties ?? {};
    if (
      groupBy.length === 0 ||
      groupBy.length > 3 ||
      new Set(groupBy).size !== groupBy.length ||
      groupBy.some(
        (field) =>
          !/^[a-z_][a-z0-9_]*$/i.test(field) ||
          !Object.hasOwn(properties, field) ||
          this.hiddenFields.includes(field)
      )
    ) {
      throw Object.assign(new Error('Invalid or private group-by field'), { statusCode: 400 });
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxGroups) {
      throw Object.assign(new Error(`Group count limit must be 1–${maxGroups}`), {
        statusCode: 400,
      });
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
      throw Object.assign(new Error('Group count offset must be 0–10000'), { statusCode: 400 });
    }

    const rows: BaseModel[] = await this.buildSearchQuery(domain, {
      activeTest: options.activeTest,
      context: options.context,
      transaction: options.transaction,
      order: '',
    })
      .clearSelect()
      .select([...groupBy])
      .count({ __group_count: '*' })
      .groupBy([...groupBy])
      .orderBy([...groupBy])
      .offset(offset)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const groups: GroupCountRow[] = rows.slice(0, limit).map((row) => {
      const record: unknown = row.toJSON();
      if (!isRecord(record)) {
        throw new Error('Database returned an invalid grouped-count row');
      }
      const rawCount = record.__group_count;
      const count =
        typeof rawCount === 'number'
          ? rawCount
          : typeof rawCount === 'string' && /^\d+$/u.test(rawCount)
            ? Number(rawCount)
            : Number.NaN;
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('Database returned an invalid grouped-count value');
      }
      const values: Record<string, JsonValue> = {};
      for (const field of groupBy) {
        const value = record[field];
        if (
          value !== null &&
          typeof value !== 'string' &&
          typeof value !== 'number' &&
          typeof value !== 'boolean'
        ) {
          throw new Error('Database returned an invalid grouped-count key');
        }
        values[field] = value;
      }
      return { values, count };
    });
    return { groups, limit, offset, hasMore };
  }

  /**
   * Loads record(s) by ID(s).
   */
  static async browse<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    ids: number | number[],
    options: SearchOptions = {}
  ): Promise<M | M[] | null> {
    const trx = this.resolveTrx(options.transaction as Transaction | undefined);
    if (Array.isArray(ids)) {
      if (ids.length === 0) return [];
      let qb = this.query(trx).whereIn('id', ids);
      if (options.withGraphFetched) {
        qb = qb.withGraphFetched(options.withGraphFetched);
      }
      const rows = await qb;
      await this.populateComputedFields(rows as unknown as Record<string, unknown>[]);
      return rows as unknown as M[];
    } else {
      let qb = this.query(trx).findById(ids);
      if (options.withGraphFetched) {
        qb = qb.withGraphFetched(options.withGraphFetched);
      }
      const record = await qb;
      if (record) {
        await this.populateComputedFields([record as unknown as Record<string, unknown>]);
      }
      return (record ?? null) as unknown as M | null;
    }
  }

  /**
   * Archive record (soft delete).
   */
  async action_archive(): Promise<this> {
    return this.update({ active: false });
  }

  /**
   * Unarchive record.
   */
  async action_unarchive(): Promise<this> {
    return this.update({ active: true });
  }

  /**
   * Private fields (e.g. password hashes) must never be usable as a filter or sort key,
   * otherwise their content could be inferred one comparison at a time.
   */
  private static assertQueryable(domain: Domain, order?: string): void {
    if (this.hiddenFields.length === 0) return;
    const used: string[] = [];
    for (const item of domain) if (Array.isArray(item)) used.push(String(item[0]));
    if (order) {
      for (const part of order.split(',')) used.push(part.trim().split(/\s+/)[0] ?? '');
    }
    if (used.some((field) => this.hiddenFields.includes(field.split('.').pop() ?? field))) {
      throw Object.assign(new Error('Invalid or private field in domain or order'), {
        statusCode: 400,
      });
    }
  }

  /**
   * Helper to construct the query with domain, activeTest, ordering (including dotted belongsTo order), and pagination.
   */
  private static buildSearchQuery<M extends BaseModel>(
    this: { new (): M } & typeof BaseModel,
    domain: Domain = [],
    options: SearchOptions = {}
  ): QueryBuilder<BaseModel, BaseModel[]> {
    const trx = this.resolveTrx(options.transaction as Transaction | undefined);
    const context = this.resolveContext(options.context);
    this.assertQueryable(domain, options.order);

    let qb: QueryBuilder<BaseModel, BaseModel[]> = this.query(trx);

    const orderClause = options.order === undefined ? this.defaultOrder : options.order;
    const orderParts = orderClause
      ? orderClause
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const hasDottedOrder = orderParts.some((part) => (part.split(/\s+/)[0] ?? '').includes('.'));

    if (hasDottedOrder) {
      qb = qb.select(`${this.tableName}.*`);
    }

    // Apply activeTest filter if active field exists and activeTest is true (default)
    const activeTest = options.activeTest ?? context.activeTest ?? true;
    const hasExplicitActiveInDomain = domain.some(
      (item) => Array.isArray(item) && item[0] === 'active'
    );

    if (activeTest && !hasExplicitActiveInDomain) {
      qb = qb.where(hasDottedOrder ? `${this.tableName}.active` : 'active', true);
    }

    // Apply domain AST
    qb = applyDomain(qb, domain);

    // Apply relations eager loading
    if (options.withGraphFetched) {
      qb = qb.withGraphFetched(options.withGraphFetched);
    }

    // Pagination
    if (options.offset !== undefined && options.offset > 0) {
      qb = qb.offset(options.offset);
    }
    if (options.limit !== undefined && options.limit > 0) {
      qb = qb.limit(options.limit);
    }

    // Ordering (supports dotted belongsTo relation paths, up to 2 hops)
    const joinedAliases = new Map<string, string>();
    let joinIndex = 0;

    for (const part of orderParts) {
      const [col, dir] = part.split(/\s+/);
      const direction: 'asc' | 'desc' = dir?.toLowerCase() === 'desc' ? 'desc' : 'asc';
      if (!col) continue;

      if (!col.includes('.')) {
        qb = qb.orderBy(hasDottedOrder ? `${this.tableName}.${col}` : col, direction);
        continue;
      }

      const segments = col.split('.');
      if (segments.length > 3) {
        throw Object.assign(new Error(`Order path exceeds max depth of 2 hops: ${col}`), {
          statusCode: 400,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      let currentModel: typeof BaseModel = this;
      let currentAlias = this.tableName;
      let pathKey = '';

      for (let i = 0; i < segments.length - 1; i += 1) {
        const relName = segments[i]!;
        const rawMappings = currentModel.relationMappings;
        const resolvedMappings = typeof rawMappings === 'function' ? rawMappings() : rawMappings;
        const relMapping = resolvedMappings?.[relName];
        if (!relMapping || relMapping.relation !== BaseModel.BelongsToOneRelation) {
          throw Object.assign(
            new Error(`Invalid belongsTo relation '${relName}' in order '${col}'`),
            { statusCode: 400 }
          );
        }
        const targetModel = relMapping.modelClass as typeof BaseModel;
        const fromCol = String(relMapping.join.from).split('.').pop()!;
        const toCol = String(relMapping.join.to).split('.').pop()!;

        pathKey = pathKey ? `${pathKey}.${relName}` : relName;
        let alias = joinedAliases.get(pathKey);
        if (!alias) {
          alias = `__ord_${joinIndex}`;
          joinIndex += 1;
          joinedAliases.set(pathKey, alias);
          qb = qb.leftJoin(
            `${targetModel.tableName} as ${alias}`,
            `${currentAlias}.${fromCol}`,
            `${alias}.${toCol}`
          );
        }
        currentModel = targetModel;
        currentAlias = alias;
      }

      const leafField = segments[segments.length - 1]!;
      const leafProps = currentModel.jsonSchema?.properties ?? {};
      if (
        !/^[a-z_][a-z0-9_]*$/i.test(leafField) ||
        currentModel.hiddenFields.includes(leafField) ||
        (Object.keys(leafProps).length > 0 && !Object.hasOwn(leafProps, leafField))
      ) {
        throw Object.assign(
          new Error(`Invalid or private field '${leafField}' in order '${col}'`),
          { statusCode: 400 }
        );
      }

      qb = qb.orderBy(`${currentAlias}.${leafField}`, direction);
    }

    return qb;
  }
}
