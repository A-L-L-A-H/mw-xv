import { Model, type Transaction } from 'objection';
import type { Knex } from 'knex';
import { transaction } from 'objection';
import type { BaseModel } from './base.model.js';
import { Registry } from './registry.js';
import { ServiceContainer } from './services.js';
import type { ModelContext } from './types.js';

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
