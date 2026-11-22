import type { Model, Transaction } from 'objection';
import type { Domain, ModelContext } from '@moonwitness/types';
import type { ServiceContainer } from './services.js';

export * from '@moonwitness/types';
export {
  PlatformError,
  ValidationError,
  AccessDeniedError,
  NotFoundError,
  ConcurrencyConflictError,
  SchemaSyncError,
} from '@moonwitness/types';

export interface EnvironmentLike {
  readonly context: ModelContext;
  readonly services: ServiceContainer;
  readonly trx?: Transaction;
}

export type Scalar = string | number | boolean;
export type FieldDefault<T> = T | ((context?: ModelContext) => T);
export type OnDeletePolicy = 'restrict' | 'cascade' | 'set null';

export interface OnchangeResult {
  values?: Record<string, unknown>;
  domainOverrides?: Record<string, Domain>;
  warnings?: string[];
}

export type OnchangeHandler = (
  values: Record<string, unknown>,
  context?: ModelContext
) => OnchangeResult | Promise<OnchangeResult>;

export interface HasManyOptions {
  label?: string;
  help?: string;
  foreignKey?: string;
  invisible?: Domain | boolean;
}

export interface ManyToManyOptions {
  label?: string;
  help?: string;
  /** Optional explicit junction table name. */
  relationTable?: string;
  /** Optional explicit column name referencing the source table. */
  joinColumn?: string;
  /** Optional explicit column name referencing the target table. */
  inverseJoinColumn?: string;
  invisible?: Domain | boolean;
  readonlyIf?: Domain;
  readonly?: boolean;
}

export type FieldKind =
  | 'string'
  | 'text'
  | 'integer'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json'
  | 'enum'
  | 'belongsTo'
  | 'hasMany'
  | 'manyToMany'
  | 'password';

export interface ManyToManyTableMeta {
  relationTable: string;
  sourceTable: string;
  targetTable: string;
  joinColumn: string;
  inverseJoinColumn: string;
}

export type AnyModelClass = typeof Model & {
  modelName: string;
  tableName: string;
};
