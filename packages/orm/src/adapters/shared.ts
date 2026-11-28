import type {
  DatabaseDriverType,
  PreparedStatement,
  QueryResult,
  TransactionConnection,
} from '../binding-types.js';

const READ_OR_RETURNING_RE = /^\s*(?:SELECT|WITH|PRAGMA|EXPLAIN)\b|\bRETURNING\b/iu;

export function isSqlReadOrReturning(sql: string): boolean {
  return READ_OR_RETURNING_RE.test(sql);
}

export function assertConnectionOpen(closed: boolean, driver: DatabaseDriverType): void {
  if (closed) {
    throw new Error(`Database connection (${driver}) has been closed.`);
  }
}

export function assertTransactionActive(finalized: boolean, driver: DatabaseDriverType): void {
  if (finalized) {
    throw new Error(`Transaction (${driver}) has already been finalized.`);
  }
}

export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

export async function runWithTransactionLifecycle<T>(
  fn: (trx: TransactionConnection) => Promise<T>,
  trx: TransactionConnection,
  isFinalized: () => boolean
): Promise<T> {
  try {
    const result = await fn(trx);
    if (!isFinalized()) {
      await trx.commit();
    }
    return result;
  } catch (error) {
    if (!isFinalized()) {
      try {
        await trx.rollback();
      } catch {
        // Preserve original domain error when rollback also fails.
      }
    }
    throw error;
  }
}

export async function executeSavepoint<T>(
  parent: TransactionConnection,
  depth: number,
  fn: (trx: TransactionConnection) => Promise<T>
): Promise<T> {
  const savepoint = `mw_sp_${depth}`;
  await parent.query(`SAVEPOINT ${savepoint}`);

  let settled = false;
  const finalizeSavepoint = async (action: 'release' | 'rollback'): Promise<void> => {
    if (settled) return;
    settled = true;
    if (action === 'release') {
      await parent.query(`RELEASE SAVEPOINT ${savepoint}`);
      return;
    }
    await parent.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await parent.query(`RELEASE SAVEPOINT ${savepoint}`);
  };

  const nestedTrx: TransactionConnection = {
    driver: parent.driver,
    query: <R = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<R>> => {
      assertTransactionActive(settled, parent.driver);
      return parent.query<R>(sql, params);
    },
    prepare: (sql: string): Promise<PreparedStatement> => {
      assertTransactionActive(settled, parent.driver);
      return parent.prepare(sql);
    },
    transaction: <R>(nestedFn: (inner: TransactionConnection) => Promise<R>): Promise<R> => {
      assertTransactionActive(settled, parent.driver);
      return executeSavepoint(nestedTrx, depth + 1, nestedFn);
    },
    commit: () => finalizeSavepoint('release'),
    rollback: () => finalizeSavepoint('rollback'),
    close: () => Promise.resolve(),
  };

  return runWithTransactionLifecycle(fn, nestedTrx, () => settled);
}
