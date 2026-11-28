import type {
  DatabaseConfig,
  DatabaseConnection,
  PreparedStatement,
  QueryResult,
  SqliteDatabaseLike,
  SqliteRunResultLike,
  SqliteStatementLike,
  TransactionConnection,
} from '../binding-types.js';
import {
  assertConnectionOpen,
  assertTransactionActive,
  createSerialQueue,
  executeSavepoint,
  isSqlReadOrReturning,
  runWithTransactionLifecycle,
} from './shared.js';

type SqliteConstructor = new (filename: string, options?: Record<string, unknown>) => SqliteDatabaseLike;

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

async function openNativeSqlite(
  filename: string,
  options?: Record<string, unknown>
): Promise<SqliteDatabaseLike> {
  if (isBunRuntime()) {
    const bunSqliteSpecifier = ['bun', 'sqlite'].join(':');
    const mod = (await import(bunSqliteSpecifier)) as { Database: SqliteConstructor };
    return new mod.Database(filename);
  }
  const betterSqliteSpecifier = 'better-sqlite3';
  const mod = (await import(betterSqliteSpecifier)) as { default: SqliteConstructor };
  return new mod.default(filename, options);
}

function isReaderStatement(stmt: SqliteStatementLike, sql: string): boolean {
  if (typeof stmt.reader === 'boolean') {
    return stmt.reader;
  }
  if (Array.isArray(stmt.columnNames)) {
    return stmt.columnNames.length > 0;
  }
  return isSqlReadOrReturning(sql);
}

function normalizeRunResult(result: SqliteRunResultLike): QueryResult {
  const normalized: QueryResult = { rows: [] };
  if (result.lastInsertRowid !== undefined) {
    normalized.insertId = result.lastInsertRowid;
  }
  if (result.changes !== undefined) {
    normalized.affectedRows = Number(result.changes);
  }
  return normalized;
}

function extractInjectedSqlite(options?: Record<string, unknown>): SqliteDatabaseLike | undefined {
  const candidate = options?.database;
  if (candidate && typeof (candidate as SqliteDatabaseLike).prepare === 'function') {
    return candidate as SqliteDatabaseLike;
  }
  return undefined;
}

/**
 * Local SQLite adapter supporting injected SQLite handles, bun:sqlite, and better-sqlite3.
 */
export class SqliteDatabaseAdapter implements DatabaseConnection {
  public readonly driver = 'sqlite' as const;
  private readonly config: DatabaseConfig;
  private readonly enqueueTx = createSerialQueue();
  private handle: SqliteDatabaseLike | undefined;
  private closed = false;

  public constructor(config: DatabaseConfig) {
    this.config = config;
    this.handle = extractInjectedSqlite(config.options);
  }

  private async ensureHandle(): Promise<SqliteDatabaseLike> {
    assertConnectionOpen(this.closed, this.driver);
    if (!this.handle) {
      const filename = this.config.filename ?? this.config.connectionString ?? ':memory:';
      this.handle = await openNativeSqlite(filename, this.config.options);
    }
    return this.handle;
  }

  private executeQuery<T>(db: SqliteDatabaseLike, sql: string, params: unknown[]): QueryResult<T> {
    const stmt = db.prepare(sql);
    if (isReaderStatement(stmt, sql)) {
      return { rows: stmt.all(...params) as T[] };
    }
    return normalizeRunResult(stmt.run(...params)) as QueryResult<T>;
  }

  private createPreparedStatement(db: SqliteDatabaseLike, sql: string): PreparedStatement {
    const stmt = db.prepare(sql);
    return {
      all: async <T = unknown>(...params: unknown[]): Promise<T[]> => {
        assertConnectionOpen(this.closed, this.driver);
        return stmt.all(...params) as T[];
      },
      get: async <T = unknown>(...params: unknown[]): Promise<T | undefined> => {
        assertConnectionOpen(this.closed, this.driver);
        const row = stmt.get(...params);
        return row === undefined || row === null ? undefined : (row as T);
      },
      run: async (...params: unknown[]): Promise<QueryResult> => {
        assertConnectionOpen(this.closed, this.driver);
        return normalizeRunResult(stmt.run(...params));
      },
    };
  }

  public async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const db = await this.ensureHandle();
    return this.executeQuery<T>(db, sql, params);
  }

  public async prepare(sql: string): Promise<PreparedStatement> {
    const db = await this.ensureHandle();
    return this.createPreparedStatement(db, sql);
  }

  public async transaction<T>(fn: (trx: TransactionConnection) => Promise<T>): Promise<T> {
    const db = await this.ensureHandle();
    return this.enqueueTx(async () => {
      assertConnectionOpen(this.closed, this.driver);
      db.prepare('BEGIN IMMEDIATE').run();
      let finalized = false;

      const finalize = (sql: 'COMMIT' | 'ROLLBACK'): void => {
        if (finalized) return;
        finalized = true;
        db.prepare(sql).run();
      };

      const trx: TransactionConnection = {
        driver: this.driver,
        query: async <R = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> => {
          assertTransactionActive(finalized, this.driver);
          return this.executeQuery<R>(db, sql, params);
        },
        prepare: async (sql: string): Promise<PreparedStatement> => {
          assertTransactionActive(finalized, this.driver);
          return this.createPreparedStatement(db, sql);
        },
        transaction: <R>(nestedFn: (inner: TransactionConnection) => Promise<R>): Promise<R> => {
          assertTransactionActive(finalized, this.driver);
          return executeSavepoint(trx, 1, nestedFn);
        },
        commit: async (): Promise<void> => finalize('COMMIT'),
        rollback: async (): Promise<void> => finalize('ROLLBACK'),
        close: async (): Promise<void> => undefined,
      };

      return runWithTransactionLifecycle(fn, trx, () => finalized);
    });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.handle) {
      this.handle.close();
      this.handle = undefined;
    }
  }
}
