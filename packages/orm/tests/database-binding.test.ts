import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseConnection,
  executeTransactionalOutbox,
  OUTBOX_EVENTS_TABLE_SQL,
  SqlOutboxRepository,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1ResultLike,
  type DatabaseConfig,
  type TursoClientLike,
  type TursoInStatement,
  type TursoResultSetLike,
  type TursoTransactionLike,
} from '../src/binding.js';

const runnerModuleName = process.env.VITEST ? 'vitest' : ['bun', 'test'].join(':');
const { describe, expect, it } = (await import(
  /* @vite-ignore */ runnerModuleName
)) as typeof import('vitest');

interface RecordedD1Call {
  sql: string;
  params: unknown[];
}

function createInMemoryD1Double(): {
  binding: D1DatabaseLike;
  batches: RecordedD1Call[][];
  rows: Array<{ id: number; name: string }>;
} {
  const batches: RecordedD1Call[][] = [];
  const rows: Array<{ id: number; name: string }> = [];
  let nextId = 1;

  const makeStatement = (sql: string, boundParams: unknown[] = []): D1PreparedStatementLike & {
    __sql: string;
    __params: unknown[];
  } => ({
    __sql: sql,
    __params: boundParams,
    bind(...values: unknown[]) {
      return makeStatement(sql, values);
    },
    async first<T = unknown>() {
      if (sql.includes('SELECT * FROM items WHERE id = ?')) {
        const match = rows.find((row) => row.id === boundParams[0]);
        return (match ?? null) as T | null;
      }
      return (rows[0] ?? null) as T | null;
    },
    async all<T = unknown>(): Promise<D1ResultLike<T>> {
      if (sql.includes('FAIL_QUERY')) {
        return { success: false, error: 'forced d1 failure', results: [] };
      }
      if (sql.includes('WHERE id = ?')) {
        return {
          success: true,
          results: rows.filter((row) => row.id === boundParams[0]) as T[],
        };
      }
      return { success: true, results: [...rows] as T[] };
    },
    async run<T = unknown>(): Promise<D1ResultLike<T>> {
      if (sql.startsWith('INSERT INTO items')) {
        const id = nextId++;
        rows.push({ id, name: String(boundParams[0] ?? '') });
        return { success: true, results: [], meta: { last_row_id: id, changes: 1 } };
      }
      return { success: true, results: [], meta: { changes: 1 } };
    },
  });

  const binding: D1DatabaseLike = {
    prepare(sql: string) {
      return makeStatement(sql);
    },
    async batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]> {
      const recorded: RecordedD1Call[] = [];
      const results: D1ResultLike<T>[] = [];
      for (const stmt of statements) {
        const tagged = stmt as D1PreparedStatementLike & { __sql: string; __params: unknown[] };
        recorded.push({ sql: tagged.__sql, params: tagged.__params });
        results.push(await stmt.run<T>());
      }
      batches.push(recorded);
      return results;
    },
  };

  return { binding, batches, rows };
}

function createTursoClientDouble(): {
  client: TursoClientLike;
  executed: Array<{ sql: string; args: unknown[] }>;
  txLog: string[];
  closedRef: { clientClosed: boolean; txClosed: number };
} {
  const executed: Array<{ sql: string; args: unknown[] }> = [];
  const txLog: string[] = [];
  const closedRef = { clientClosed: false, txClosed: 0 };
  const store: Array<{ id: number; title: string }> = [];
  let seq = 1;

  const runStatement = async (stmt: TursoInStatement): Promise<TursoResultSetLike> => {
    const sql = typeof stmt === 'string' ? stmt : stmt.sql;
    const args = typeof stmt === 'string' ? [] : (stmt.args ?? []);
    executed.push({ sql, args });

    if (sql.startsWith('INSERT INTO tasks')) {
      const id = seq++;
      store.push({ id, title: String(args[0] ?? '') });
      return { rows: [], rowsAffected: 1, lastInsertRowid: BigInt(id) };
    }
    if (sql.startsWith('SELECT')) {
      if (args.length > 0) {
        return {
          rows: store.filter((row) => row.id === Number(args[0])),
          rowsAffected: 0,
        };
      }
      return { rows: [...store], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: 1 };
  };

  const client: TursoClientLike = {
    execute: runStatement,
    async transaction(mode): Promise<TursoTransactionLike> {
      txLog.push(`begin:${mode ?? 'write'}`);
      return {
        execute: runStatement,
        async commit() {
          txLog.push('commit');
        },
        async rollback() {
          txLog.push('rollback');
        },
        close() {
          closedRef.txClosed++;
        },
      };
    },
    async close() {
      closedRef.clientClosed = true;
    },
  };

  return { client, executed, txLog, closedRef };
}

describe('Unified Database Binding & Adapters', () => {
  describe('createDatabaseConnection factory', () => {
    it('rejects unsupported driver values', () => {
      expect(() =>
        createDatabaseConnection({ driver: 'postgres' } as unknown as DatabaseConfig)
      ).toThrow('Unsupported database driver');
    });
  });

  describe('SqliteDatabaseAdapter (in-memory SQLite)', () => {
    it('executes queries, prepared statements, and reports insertId/affectedRows', async () => {
      const db = createDatabaseConnection({ driver: 'sqlite', filename: ':memory:' });
      try {
        expect(db.driver).toBe('sqlite');
        await db.query('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL)');

        const inserted = await db.query('INSERT INTO users (email) VALUES (?)', ['a@mw.dev']);
        expect(inserted.affectedRows).toBe(1);
        expect(Number(inserted.insertId)).toBe(1);

        const stmt = await db.prepare('INSERT INTO users (email) VALUES (?)');
        const second = await stmt.run('b@mw.dev');
        expect(Number(second.insertId)).toBe(2);

        const selectStmt = await db.prepare('SELECT id, email FROM users WHERE id = ?');
        expect(await selectStmt.get<{ id: number; email: string }>(2)).toEqual({
          id: 2,
          email: 'b@mw.dev',
        });
        expect(await selectStmt.get(999)).toBeUndefined();

        const allStmt = await db.prepare('SELECT id, email FROM users ORDER BY id ASC');
        const allRows = await allStmt.all<{ id: number; email: string }>();
        expect(allRows).toHaveLength(2);
      } finally {
        await db.close();
      }
    });

    it('commits, rolls back on throw, supports nested savepoints, and serializes concurrent transactions', async () => {
      const db = createDatabaseConnection({ driver: 'sqlite', filename: ':memory:' });
      try {
        await db.query('CREATE TABLE ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL)');

        await db.transaction(async (trx) => {
          await trx.query('INSERT INTO ledger (amount) VALUES (?)', [100]);
          await expect(
            trx.transaction(async (nested) => {
              await nested.query('INSERT INTO ledger (amount) VALUES (?)', [999]);
              throw new Error('nested failure');
            })
          ).rejects.toThrow('nested failure');

          await trx.transaction(async (nested) => {
            await nested.query('INSERT INTO ledger (amount) VALUES (?)', [200]);
          });
        });

        await expect(
          db.transaction(async (trx) => {
            await trx.query('INSERT INTO ledger (amount) VALUES (?)', [500]);
            throw new Error('outer failure');
          })
        ).rejects.toThrow('outer failure');

        await Promise.all([
          db.transaction(async (trx) => {
            await trx.query('INSERT INTO ledger (amount) VALUES (?)', [300]);
          }),
          db.transaction(async (trx) => {
            await trx.query('INSERT INTO ledger (amount) VALUES (?)', [400]);
          }),
        ]);

        const result = await db.query<{ amount: number }>('SELECT amount FROM ledger ORDER BY id ASC');
        expect(result.rows.map((r) => r.amount)).toEqual([100, 200, 300, 400]);
      } finally {
        await db.close();
      }
    });

    it('rejects operations after transaction finalization or connection close', async () => {
      const db = createDatabaseConnection({ driver: 'sqlite', filename: ':memory:' });
      await db.transaction(async (trx) => {
        await trx.commit();
        await expect(trx.query('SELECT 1')).rejects.toThrow('already been finalized');
      });
      await db.close();
      await expect(db.query('SELECT 1')).rejects.toThrow('has been closed');
    });
  });

  describe('D1DatabaseAdapter', () => {
    it('requires a valid d1Binding instance', () => {
      expect(() => createDatabaseConnection({ driver: 'd1' })).toThrow(
        'D1 driver requires a valid d1Binding'
      );
    });

    it('executes queries, prepared statements, and propagates D1 errors', async () => {
      const { binding } = createInMemoryD1Double();
      const db = createDatabaseConnection({ driver: 'd1', d1Binding: binding });

      const insertRes = await db.query('INSERT INTO items (name) VALUES (?)', ['alpha']);
      expect(insertRes.insertId).toBe(1);
      expect(insertRes.affectedRows).toBe(1);

      const stmt = await db.prepare('SELECT * FROM items WHERE id = ?');
      expect(await stmt.get<{ id: number; name: string }>(1)).toEqual({ id: 1, name: 'alpha' });
      expect(await stmt.get(404)).toBeUndefined();
      expect(await stmt.all<{ id: number; name: string }>(1)).toEqual([{ id: 1, name: 'alpha' }]);

      await expect(db.query('SELECT * FROM FAIL_QUERY')).rejects.toThrow('forced d1 failure');
    });

    it('batches transaction writes atomically and discards on rollback or nested error', async () => {
      const { binding, batches, rows } = createInMemoryD1Double();
      const db = createDatabaseConnection({ driver: 'd1', d1Binding: binding });

      await expect(
        db.transaction(async (trx) => {
          await trx.query('INSERT INTO items (name) VALUES (?)', ['never-committed']);
          throw new Error('abort batch');
        })
      ).rejects.toThrow('abort batch');
      expect(batches).toHaveLength(0);
      expect(rows).toHaveLength(0);

      await db.transaction(async (trx) => {
        await trx.query('INSERT INTO items (name) VALUES (?)', ['outer']);
        await expect(
          trx.transaction(async (nested) => {
            await nested.query('INSERT INTO items (name) VALUES (?)', ['rolled-back-nested']);
            await nested.rollback();
          })
        ).resolves.toBeUndefined();
        const stmt = await trx.prepare('INSERT INTO items (name) VALUES (?)');
        await stmt.run('inner-committed');
      });

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
      expect(rows.map((r) => r.name)).toEqual(['outer', 'inner-committed']);
    });
  });

  describe('TursoDatabaseAdapter', () => {
    it('requires connectionString or options.client', () => {
      expect(() => createDatabaseConnection({ driver: 'turso' })).toThrow(
        'Turso driver requires connectionString or options.client'
      );
    });

    it('executes queries, prepared statements, transactions, and closes cleanly', async () => {
      const { client, txLog, closedRef } = createTursoClientDouble();
      const db = createDatabaseConnection({ driver: 'turso', options: { client } });

      const insertRes = await db.query('INSERT INTO tasks (title) VALUES (?)', ['ship']);
      expect(insertRes.insertId).toBe(1n);
      expect(insertRes.affectedRows).toBe(1);

      const stmt = await db.prepare('SELECT * FROM tasks WHERE id = ?');
      expect(await stmt.get<{ id: number; title: string }>(1)).toEqual({ id: 1, title: 'ship' });
      expect(await stmt.all<{ id: number; title: string }>()).toEqual([{ id: 1, title: 'ship' }]);

      await db.transaction(async (trx) => {
        await trx.query('INSERT INTO tasks (title) VALUES (?)', ['verify']);
        await trx.transaction(async (nested) => {
          await nested.query('INSERT INTO tasks (title) VALUES (?)', ['savepoint-row']);
        });
      });

      await expect(
        db.transaction(async (trx) => {
          await trx.query('INSERT INTO tasks (title) VALUES (?)', ['fail']);
          throw new Error('turso rollback');
        })
      ).rejects.toThrow('turso rollback');

      expect(txLog).toEqual(['begin:write', 'commit', 'begin:write', 'rollback']);
      expect(closedRef.txClosed).toBe(2);

      await db.close();
      expect(closedRef.clientClosed).toBe(true);
    });
  });

  describe('Transactional Outbox Contract (AC4)', () => {
    it('commits domain mutation and outbox event atomically and rolls back both on failure', async () => {
      const db = createDatabaseConnection({ driver: 'sqlite', filename: ':memory:' });
      const outbox = new SqlOutboxRepository();

      try {
        await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, total INTEGER NOT NULL)');
        await outbox.ensureSchema(db);
        expect(OUTBOX_EVENTS_TABLE_SQL).toContain('CREATE TABLE IF NOT EXISTS outbox_events');

        await executeTransactionalOutbox(db, outbox, async (trx) => {
          await trx.query('INSERT INTO orders (id, total) VALUES (?, ?)', ['ord-1', 4200]);
          await outbox.enqueue(trx, {
            aggregateType: 'Order',
            aggregateId: 'ord-1',
            eventType: 'OrderCreated',
            payload: { total: 4200 },
          });
        });

        await expect(
          executeTransactionalOutbox(db, outbox, async (trx) => {
            await trx.query('INSERT INTO orders (id, total) VALUES (?, ?)', ['ord-2', 9900]);
            await outbox.enqueue(trx, {
              aggregateType: 'Order',
              aggregateId: 'ord-2',
              eventType: 'OrderCreated',
              payload: { total: 9900 },
            });
            throw new Error('downstream domain failure');
          })
        ).rejects.toThrow('downstream domain failure');

        const orders = await db.query<{ id: string }>('SELECT id FROM orders');
        expect(orders.rows).toEqual([{ id: 'ord-1' }]);

        const events = await db.query<{
          aggregate_type: string;
          aggregate_id: string;
          event_type: string;
          payload: string;
          status: string;
        }>('SELECT aggregate_type, aggregate_id, event_type, payload, status FROM outbox_events');
        expect(events.rows).toEqual([
          {
            aggregate_type: 'Order',
            aggregate_id: 'ord-1',
            event_type: 'OrderCreated',
            payload: '{"total":4200}',
            status: 'PENDING',
          },
        ]);
      } finally {
        await db.close();
      }
    });
  });

  describe('Isolation Verification (AC2)', () => {
    it('contains zero @moonwitness/orm-* or apps/ imports across new binding and adapter files', () => {
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const srcFiles = [
        join(currentDir, '../src/binding.ts'),
        join(currentDir, '../src/binding-types.ts'),
        join(currentDir, '../src/adapters/shared.ts'),
        join(currentDir, '../src/adapters/sqlite-adapter.ts'),
        join(currentDir, '../src/adapters/d1-adapter.ts'),
        join(currentDir, '../src/adapters/turso-adapter.ts'),
      ];

      for (const filePath of srcFiles) {
        const content = readFileSync(filePath, 'utf8');
        expect(content).not.toContain('@moonwitness/orm-');
        expect(content).not.toMatch(/from\s+['"]apps\//);
      }
    });
  });
});
