import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
  DatabaseConfig,
  DatabaseConnection,
  PreparedStatement,
  QueryResult,
  TransactionConnection,
} from '../binding-types.js';
import {
  assertConnectionOpen,
  assertTransactionActive,
  isSqlReadOrReturning,
  runWithTransactionLifecycle,
} from './shared.js';

function bindD1Statement(
  stmt: D1PreparedStatementLike,
  params: unknown[]
): D1PreparedStatementLike {
  return params.length > 0 ? stmt.bind(...params) : stmt;
}

function toD1QueryResult<T>(result: D1ResultLike<T>): QueryResult<T> {
  if (result.success === false) {
    throw new Error(result.error ?? 'Cloudflare D1 query execution failed.');
  }
  const normalized: QueryResult<T> = {
    rows: (result.results ?? []) as T[],
  };
  if (result.meta?.last_row_id !== undefined) {
    normalized.insertId = result.meta.last_row_id;
  }
  const changes = result.meta?.changes ?? result.meta?.rows_written;
  if (changes !== undefined) {
    normalized.affectedRows = changes;
  }
  return normalized;
}

function validateD1Binding(binding: unknown): D1DatabaseLike {
  const candidate = binding as Partial<D1DatabaseLike> | undefined;
  if (!candidate || typeof candidate.prepare !== 'function') {
    throw new Error('D1 driver requires a valid d1Binding instance with prepare().');
  }
  return candidate as D1DatabaseLike;
}

/**
 * Cloudflare D1 binding adapter with atomic batch-backed transactions.
 */
export class D1DatabaseAdapter implements DatabaseConnection {
  public readonly driver = 'd1' as const;
  private readonly d1: D1DatabaseLike;
  private closed = false;

  public constructor(config: DatabaseConfig) {
    this.d1 = validateD1Binding(config.d1Binding);
  }

  public async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    assertConnectionOpen(this.closed, this.driver);
    const bound = bindD1Statement(this.d1.prepare(sql), params);
    const raw = isSqlReadOrReturning(sql) ? await bound.all<T>() : await bound.run<T>();
    return toD1QueryResult(raw);
  }

  public async prepare(sql: string): Promise<PreparedStatement> {
    assertConnectionOpen(this.closed, this.driver);
    const stmt = this.d1.prepare(sql);
    return {
      all: async <T = unknown>(...params: unknown[]): Promise<T[]> => {
        assertConnectionOpen(this.closed, this.driver);
        const result = await bindD1Statement(stmt, params).all<T>();
        return toD1QueryResult(result).rows;
      },
      get: async <T = unknown>(...params: unknown[]): Promise<T | undefined> => {
        assertConnectionOpen(this.closed, this.driver);
        const row = await bindD1Statement(stmt, params).first<T>();
        return row === null || row === undefined ? undefined : row;
      },
      run: async (...params: unknown[]): Promise<QueryResult> => {
        assertConnectionOpen(this.closed, this.driver);
        const result = await bindD1Statement(stmt, params).run();
        return toD1QueryResult(result);
      },
    };
  }

  public async transaction<T>(fn: (trx: TransactionConnection) => Promise<T>): Promise<T> {
    assertConnectionOpen(this.closed, this.driver);
    const queued: D1PreparedStatementLike[] = [];
    return this.runBatchTransaction(queued, 0, true, fn);
  }

  private async runBatchTransaction<T>(
    queued: D1PreparedStatementLike[],
    checkpoint: number,
    isRoot: boolean,
    fn: (trx: TransactionConnection) => Promise<T>
  ): Promise<T> {
    let finalized = false;

    const commit = async (): Promise<void> => {
      if (finalized) return;
      finalized = true;
      if (!isRoot || queued.length === 0) return;
      if (typeof this.d1.batch !== 'function') {
        throw new Error('D1 binding does not support batch() for atomic transactions.');
      }
      const results = await this.d1.batch(queued.splice(0, queued.length));
      for (const item of results) {
        if (item.success === false) {
          throw new Error(item.error ?? 'Cloudflare D1 batch transaction failed.');
        }
      }
    };

    const rollback = async (): Promise<void> => {
      if (finalized) return;
      finalized = true;
      queued.length = checkpoint;
    };

    const trx: TransactionConnection = {
      driver: this.driver,
      query: async <R = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> => {
        assertConnectionOpen(this.closed, this.driver);
        assertTransactionActive(finalized, this.driver);
        const bound = bindD1Statement(this.d1.prepare(sql), params);
        if (isSqlReadOrReturning(sql)) {
          return toD1QueryResult(await bound.all<R>());
        }
        queued.push(bound);
        return { rows: [] };
      },
      prepare: async (sql: string): Promise<PreparedStatement> => {
        assertConnectionOpen(this.closed, this.driver);
        assertTransactionActive(finalized, this.driver);
        const stmt = this.d1.prepare(sql);
        return {
          all: async <R = unknown>(...params: unknown[]): Promise<R[]> => {
            assertTransactionActive(finalized, this.driver);
            return toD1QueryResult(await bindD1Statement(stmt, params).all<R>()).rows;
          },
          get: async <R = unknown>(...params: unknown[]): Promise<R | undefined> => {
            assertTransactionActive(finalized, this.driver);
            const row = await bindD1Statement(stmt, params).first<R>();
            return row === null || row === undefined ? undefined : row;
          },
          run: async (...params: unknown[]): Promise<QueryResult> => {
            assertTransactionActive(finalized, this.driver);
            queued.push(bindD1Statement(stmt, params));
            return { rows: [] };
          },
        };
      },
      transaction: <R>(nestedFn: (inner: TransactionConnection) => Promise<R>): Promise<R> => {
        assertTransactionActive(finalized, this.driver);
        return this.runBatchTransaction(queued, queued.length, false, nestedFn);
      },
      commit,
      rollback,
      close: async (): Promise<void> => undefined,
    };

    return runWithTransactionLifecycle(fn, trx, () => finalized);
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}
