import type {
  DatabaseConfig,
  DatabaseConnection,
  PreparedStatement,
  QueryResult,
  TransactionConnection,
  TursoClientLike,
  TursoExecutorLike,
  TursoResultSetLike,
} from '../binding-types.js';
import {
  assertConnectionOpen,
  assertTransactionActive,
  executeSavepoint,
  runWithTransactionLifecycle,
} from './shared.js';

interface LibsqlClientModule {
  createClient(config: { url: string; authToken?: string }): TursoClientLike;
}

function toTursoQueryResult<T>(result: TursoResultSetLike): QueryResult<T> {
  const normalized: QueryResult<T> = {
    rows: result.rows as T[],
    affectedRows: result.rowsAffected,
  };
  if (result.lastInsertRowid !== undefined) {
    normalized.insertId = result.lastInsertRowid;
  }
  return normalized;
}

function extractInjectedTursoClient(options?: Record<string, unknown>): TursoClientLike | undefined {
  const candidate = options?.client;
  if (
    candidate &&
    typeof (candidate as TursoClientLike).execute === 'function' &&
    typeof (candidate as TursoClientLike).transaction === 'function'
  ) {
    return candidate as TursoClientLike;
  }
  return undefined;
}

async function createLibsqlClient(config: DatabaseConfig): Promise<TursoClientLike> {
  if (!config.connectionString) {
    throw new Error('Turso driver requires connectionString or options.client.');
  }
  const libsqlSpecifier = ['@libsql', 'client'].join('/');
  const mod = (await import(libsqlSpecifier)) as LibsqlClientModule;
  return mod.createClient({
    url: config.connectionString,
    ...(config.authToken ? { authToken: config.authToken } : {}),
  });
}

/**
 * Turso / libSQL adapter supporting @libsql/client and injected client bindings.
 */
export class TursoDatabaseAdapter implements DatabaseConnection {
  public readonly driver = 'turso' as const;
  private readonly config: DatabaseConfig;
  private client: TursoClientLike | undefined;
  private closed = false;

  public constructor(config: DatabaseConfig) {
    this.config = config;
    this.client = extractInjectedTursoClient(config.options);
    if (!this.client && !config.connectionString) {
      throw new Error('Turso driver requires connectionString or options.client.');
    }
  }

  private async ensureClient(): Promise<TursoClientLike> {
    assertConnectionOpen(this.closed, this.driver);
    if (!this.client) {
      this.client = await createLibsqlClient(this.config);
    }
    return this.client;
  }

  private createPreparedStatement(
    executor: TursoExecutorLike,
    sql: string,
    guard: () => void
  ): PreparedStatement {
    return {
      all: async <T = unknown>(...params: unknown[]): Promise<T[]> => {
        guard();
        const result = await executor.execute(params.length > 0 ? { sql, args: params } : sql);
        return result.rows as T[];
      },
      get: async <T = unknown>(...params: unknown[]): Promise<T | undefined> => {
        guard();
        const result = await executor.execute(params.length > 0 ? { sql, args: params } : sql);
        return result.rows[0] as T | undefined;
      },
      run: async (...params: unknown[]): Promise<QueryResult> => {
        guard();
        const result = await executor.execute(params.length > 0 ? { sql, args: params } : sql);
        return toTursoQueryResult(result);
      },
    };
  }

  public async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const client = await this.ensureClient();
    const result = await client.execute(params.length > 0 ? { sql, args: params } : sql);
    return toTursoQueryResult<T>(result);
  }

  public async prepare(sql: string): Promise<PreparedStatement> {
    const client = await this.ensureClient();
    return this.createPreparedStatement(client, sql, () =>
      assertConnectionOpen(this.closed, this.driver)
    );
  }

  public async transaction<T>(fn: (trx: TransactionConnection) => Promise<T>): Promise<T> {
    const client = await this.ensureClient();
    const libsqlTx = await client.transaction('write');
    let finalized = false;

    const guard = (): void => {
      assertConnectionOpen(this.closed, this.driver);
      assertTransactionActive(finalized, this.driver);
    };

    const trx: TransactionConnection = {
      driver: this.driver,
      query: async <R = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> => {
        guard();
        const result = await libsqlTx.execute(params.length > 0 ? { sql, args: params } : sql);
        return toTursoQueryResult<R>(result);
      },
      prepare: async (sql: string): Promise<PreparedStatement> => {
        guard();
        return this.createPreparedStatement(libsqlTx, sql, guard);
      },
      transaction: <R>(nestedFn: (inner: TransactionConnection) => Promise<R>): Promise<R> => {
        guard();
        return executeSavepoint(trx, 1, nestedFn);
      },
      commit: async (): Promise<void> => {
        if (finalized) return;
        finalized = true;
        await libsqlTx.commit();
      },
      rollback: async (): Promise<void> => {
        if (finalized) return;
        finalized = true;
        await libsqlTx.rollback();
      },
      close: async (): Promise<void> => undefined,
    };

    try {
      return await runWithTransactionLifecycle(fn, trx, () => finalized);
    } finally {
      libsqlTx.close?.();
    }
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.client?.close) {
      await this.client.close();
    }
    this.client = undefined;
  }
}
