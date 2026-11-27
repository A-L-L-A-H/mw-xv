export type DatabaseDriverType = 'sqlite' | 'd1' | 'turso';

export interface D1MetaLike {
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  duration?: number;
}

export interface D1ResultLike<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta?: D1MetaLike;
}

export interface D1ExecResultLike {
  count: number;
  duration: number;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1ResultLike<T>>;
  all<T = unknown>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]>;
  exec?(query: string): Promise<D1ExecResultLike>;
}

export interface SqliteRunResultLike {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
}

export interface SqliteStatementLike {
  readonly reader?: boolean;
  readonly columnNames?: readonly string[];
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): SqliteRunResultLike;
}

export interface SqliteDatabaseLike {
  prepare(sql: string): SqliteStatementLike;
  exec?(sql: string): void;
  close(): void;
}

export type TursoInStatement = string | { sql: string; args?: unknown[] };

export interface TursoResultSetLike {
  columns?: readonly string[];
  rows: readonly Record<string, unknown>[];
  rowsAffected: number;
  lastInsertRowid?: bigint;
}

export interface TursoExecutorLike {
  execute(stmt: TursoInStatement): Promise<TursoResultSetLike>;
}

export interface TursoTransactionLike extends TursoExecutorLike {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close?(): void;
}

export interface TursoClientLike extends TursoExecutorLike {
  transaction(mode?: 'write' | 'read' | 'deferred'): Promise<TursoTransactionLike>;
  close?(): void | Promise<void>;
}

export interface DatabaseConfig {
  driver: DatabaseDriverType;
  connectionString?: string;
  authToken?: string;
  d1Binding?: D1DatabaseLike;
  filename?: string;
  options?: Record<string, unknown>;
}

export interface QueryResult<T = unknown> {
  rows: T[];
  insertId?: number | bigint;
  affectedRows?: number;
}

export interface PreparedStatement {
  all<T = unknown>(...params: unknown[]): Promise<T[]>;
  get<T = unknown>(...params: unknown[]): Promise<T | undefined>;
  run(...params: unknown[]): Promise<QueryResult>;
}

export interface DatabaseConnection {
  readonly driver: DatabaseDriverType;

  /** Execute raw query with positional parameters */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  /** Prepare statement for repeated execution */
  prepare(sql: string): Promise<PreparedStatement>;

  /** Execute statements within a transaction boundary */
  transaction<T>(fn: (trx: TransactionConnection) => Promise<T>): Promise<T>;

  /** Close underlying connection pool or handle */
  close(): Promise<void>;
}

export interface TransactionConnection extends DatabaseConnection {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export type OutboxEventStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

export interface OutboxEventRecord {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: string;
  status: OutboxEventStatus;
  created_at?: string;
  processed_at?: string | null;
}

export interface OutboxRepository {
  enqueue(trx: TransactionConnection, event: OutboxEventInput): Promise<void>;
}
