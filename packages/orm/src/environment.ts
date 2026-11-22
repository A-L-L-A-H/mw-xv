import { Model, type Transaction } from 'objection';
import type { Knex } from 'knex';
import { transaction } from 'objection';
import { BaseModel } from './base.model.js';
import { Registry } from './registry.js';
import { ServiceContainer } from './services.js';
import { ValidationError, type Domain, type ModelContext, type SearchOptions } from './types.js';

/**
 * Immutable, chainable collection of model records bound to an Environment.
 */
export class Recordset<M extends BaseModel = BaseModel> implements Iterable<M> {
  readonly model: typeof BaseModel;
  readonly env: Environment;
  readonly records: readonly M[];

  constructor(model: typeof BaseModel, env: Environment, records: readonly M[]) {
    this.model = model;
    this.env = env;
    this.records = Object.freeze([...records]);
  }

  get ids(): number[] {
    return this.records.map((r) => r.id);
  }

  get length(): number {
    return this.records.length;
  }

  [Symbol.iterator](): Iterator<M> {
    return this.records[Symbol.iterator]();
  }

  /** Assert this recordset contains exactly one record and return it. */
  ensureOne(): M {
    if (this.records.length !== 1) {
      throw new ValidationError(
        `Expected singleton recordset for '${this.model.modelName}', got ${this.records.length} records`
      );
    }
    return this.records[0]!;
  }

  /** Project records using a field name or mapper function. */
  mapped<K extends keyof M>(field: K): M[K][];
  mapped<R>(fn: (record: M) => R): R[];
  mapped<R>(fnOrField: ((record: M) => R) | keyof M): R[] {
    if (typeof fnOrField === 'function') {
      return this.records.map(fnOrField);
    }
    return this.records.map((record) => record[fnOrField] as unknown as R);
  }

  /** Return a new Recordset containing only records matching the predicate. */
  filtered(predicate: (record: M) => boolean): Recordset<M> {
    return new Recordset<M>(this.model, this.env, this.records.filter(predicate));
  }

  /** Batch-update all records in this recordset. */
  async write(
    vals: Partial<M> | Record<string, unknown>,
    options: { context?: ModelContext; transaction?: Transaction; expectedWriteDate?: string } = {}
  ): Promise<number> {
    if (this.records.length === 0) return 0;
    const BoundModel = this.env.get(this.model.modelName);
    return BoundModel.write(this.ids, vals, options);
  }

  /** Archive (or hard-delete) all records in this recordset. */
  async unlink(
    hardDelete = false,
    options: { transaction?: Transaction; expectedWriteDate?: string } = {}
  ): Promise<number> {
    if (this.records.length === 0) return 0;
    const BoundModel = this.env.get(this.model.modelName);
    return BoundModel.unlink(this.ids, hardDelete, options);
  }

  /** Execute an exposed action method on every record in this recordset. */
  async executeAction(actionName: string, ...args: unknown[]): Promise<unknown[]> {
    if (!this.model.exposedActions.includes(actionName)) {
      throw new ValidationError(
        `Action '${actionName}' is not exposed on model '${this.model.modelName}'`
      );
    }
    const results: unknown[] = [];
    for (const record of this.records) {
      const fn = (record as unknown as Record<string, unknown>)[actionName];
      if (typeof fn !== 'function') {
        throw new ValidationError(
          `Action '${actionName}' is not implemented on model '${this.model.modelName}'`
        );
      }
      results.push(await (fn as (...a: unknown[]) => unknown).apply(record, args));
    }
    return results;
  }
}

export class Environment {
  readonly context: ModelContext;
  readonly services: ServiceContainer;
  readonly trx?: Transaction;
  private readonly boundModels = new Map<string, typeof BaseModel>();

  constructor(
    context: ModelContext = {},
    trx?: Transaction,
    services: ServiceContainer = new ServiceContainer()
  ) {
    this.context = {
      activeTest: true,
      ...context,
    };
    this.trx = trx;
    this.services = services;

    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop === 'string' && !(prop in target) && Registry.has(prop)) {
          return target.get(prop);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /**
   * Get a registered model bound to this environment (transaction & context).
   */
  get<T extends typeof BaseModel = typeof BaseModel>(modelName: string): T {
    const RawModelClass = Registry.get<T>(modelName);
    const cached = this.boundModels.get(modelName);
    if (cached && Object.getPrototypeOf(cached) === RawModelClass) {
      return cached as T;
    }
    const bound = this.bindModel(RawModelClass);
    this.boundModels.set(modelName, bound);
    return bound;
  }

  /**
   * Returns a model class configured with this environment's context and transaction.
   */
  private bindModel<T extends typeof BaseModel>(modelClass: T): T {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const env = this;

    // Create a subclass dynamically that carries this env
    const BoundClass = class extends (modelClass as new (...args: never[]) => BaseModel) {
      static get env(): Environment {
        return env;
      }
    } as unknown as T;

    // Copy static descriptors and properties
    Object.defineProperty(BoundClass, 'name', { value: modelClass.name });
    Object.defineProperty(BoundClass, 'modelName', { value: modelClass.modelName });
    Object.defineProperty(BoundClass, 'tableName', { value: modelClass.tableName });

    return BoundClass;
  }

  /**
   * Create a new Environment with a specific user ID.
   */
  withUser(userId: number): Environment {
    return new Environment({ ...this.context, userId }, this.trx, this.services);
  }

  /**
   * Create a new Environment with merged context.
   */
  withContext(extraContext: ModelContext): Environment {
    return new Environment({ ...this.context, ...extraContext }, this.trx, this.services);
  }

  /**
   * Create a new Environment bound to a database transaction.
   */
  withTransaction(trx: Transaction): Environment {
    return new Environment(this.context, trx, this.services);
  }

  /**
   * Load records by ID(s) into an immutable Recordset bound to this environment.
   */
  async browse<M extends BaseModel = BaseModel>(
    modelName: string,
    ids: number | number[],
    options: SearchOptions = {}
  ): Promise<Recordset<M>> {
    const BoundModel = this.get(modelName);
    const idList = Array.isArray(ids) ? ids : [ids];
    const records = (await BoundModel.browse(idList, options)) as M[];
    return new Recordset<M>(BoundModel, this, records);
  }

  /**
   * Search records matching a domain into an immutable Recordset bound to this environment.
   */
  async search<M extends BaseModel = BaseModel>(
    modelName: string,
    domain: Domain = [],
    options: SearchOptions = {}
  ): Promise<Recordset<M>> {
    const BoundModel = this.get(modelName);
    return BoundModel.search(domain, options).then(
      (records) => new Recordset<M>(BoundModel, this, records as M[])
    );
  }

  /**
   * Execute an async callback within a database transaction.
   */
  async runInTransaction<R>(cb: (env: Environment) => Promise<R>): Promise<R> {
    const knex = Model.knex() as Knex;
    return transaction(knex, async (trx) => {
      const transactionalEnv = this.withTransaction(trx);
      return cb(transactionalEnv);
    });
  }
}

BaseModel.setDefaultEnvironmentFactory(() => new Environment());
