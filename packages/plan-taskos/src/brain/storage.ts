import { redactSensitiveText, sha256Hex, canonicalJson } from "../core/redaction.js";

export type BrainMode = "sqlite" | "memory";

export interface BrainStorageDriver {
  readonly mode: BrainMode;
  readonly dbPath: string;
  exec(sql: string): void;
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(sql: string, ...params: unknown[]): unknown;
  all(sql: string, ...params: unknown[]): unknown[];
  transactionImmediate<T>(fn: (tx: TransactionHandle) => T): T;
  close(): void;
}

export interface TransactionHandle {
  exec(sql: string): void;
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(sql: string, ...params: unknown[]): unknown;
  all(sql: string, ...params: unknown[]): unknown[];
}

interface InMemoryTable {
  columns: string[];
  rows: unknown[][];
}

class InMemoryStore {
  private tables = new Map<string, InMemoryTable>();

  exec(sql: string): void {
    // Simplified: parse basic CREATE TABLE statements
    const createMatch = /CREATE\s+(?:TABLE|VIRTUAL\s+TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([^)]+)\)/i.exec(sql);
    if (createMatch) {
      const tableName = createMatch[1];
      const columns = createMatch[2].split(",").map(c => c.trim().split(/\s+/)[0]);
      this.tables.set(tableName, { columns, rows: [] });
      return;
    }

    // Handle INSERT
    const insertMatch = /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i.exec(sql);
    if (insertMatch) {
      const tableName = insertMatch[1];
      const columns = insertMatch[2].split(",").map(c => c.trim());
      const valuesStr = insertMatch[3];
      const values = this.parseValues(valuesStr);
      const table = this.tables.get(tableName);
      if (table) {
        table.rows.push(values);
      }
      return;
    }

    // Handle PRAGMA
    if (/^PRAGMA\s/i.test(sql)) {
      return; // no-op for in-memory
    }
  }

  private parseValues(valuesStr: string): unknown[] {
    // Simple value parser for in-memory
    const values: unknown[] = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < valuesStr.length; i++) {
      const char = valuesStr[i];
      if ((char === "'" || char === '"') && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = "";
      } else if (char === "," && !inQuotes) {
        values.push(this.parseValue(current.trim()));
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim()) {
      values.push(this.parseValue(current.trim()));
    }
    return values;
  }

  private parseValue(v: string): unknown {
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    if (v === "NULL" || v === "null") return null;
    if (!isNaN(Number(v))) return Number(v);
    return v;
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const insertMatch = /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i.exec(sql);
    if (insertMatch) {
      const tableName = insertMatch[1];
      const columns = insertMatch[2].split(",").map(c => c.trim());
      const placeholders = insertMatch[3].split(",").map(p => p.trim());
      const table = this.tables.get(tableName);
      if (table) {
        const row: unknown[] = [];
        for (let i = 0; i < columns.length; i++) {
          const ph = placeholders[i];
          const param = params[i];
          if (ph === "?") {
            row.push(param);
          } else {
            row.push(this.parseValue(ph));
          }
        }
        table.rows.push(row);
        return { changes: 1, lastInsertRowid: BigInt(table.rows.length) };
      }
    }

    // Handle UPDATE
    const updateMatch = /UPDATE\s+(\w+)\s+SET\s+([^ ]+)\s+WHERE\s+(.+)/i.exec(sql);
    if (updateMatch) {
      const tableName = updateMatch[1];
      const table = this.tables.get(tableName);
      if (table) {
        // Simplified: just return success
        return { changes: 1, lastInsertRowid: 0n };
      }
    }

    // Handle DELETE
    const deleteMatch = /DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)/i.exec(sql);
    if (deleteMatch) {
      const tableName = deleteMatch[1];
      const table = this.tables.get(tableName);
      if (table) {
        return { changes: 0, lastInsertRowid: 0n };
      }
    }

    return { changes: 0, lastInsertRowid: 0n };
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    const results = this.all<T>(sql, ...params);
    return results[0];
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    const selectMatch = /SELECT\s+(.+)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?(?:\s+ORDER\s+BY\s+(.+))?(?:\s+LIMIT\s+(\d+))?/i.exec(sql);
    if (!selectMatch) return [];

    const columns = selectMatch[1].split(",").map(c => c.trim());
    const tableName = selectMatch[2];
    const table = this.tables.get(tableName);
    if (!table) return [];

    let rows = table.rows;
    if (selectMatch[3]) {
      // Simplified WHERE filtering
      // In real implementation, this would evaluate the WHERE clause
    }
    if (selectMatch[5]) {
      const limit = parseInt(selectMatch[5], 10);
      rows = rows.slice(0, limit);
    }

    return rows.map(row => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj as T;
    });
  }

  transactionImmediate<T>(fn: (tx: TransactionHandle) => T): T {
    return fn(this);
  }

  close(): void {
    this.tables.clear();
  }
}

export class InMemoryBrainStore implements BrainStorageDriver {
  readonly mode: BrainMode = "memory";
  readonly dbPath = ":memory:";
  private store = new InMemoryStore();

  exec(sql: string): void {
    this.store.exec(sql);
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.store.run(sql, ...params);
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    return this.store.get<T>(sql, ...params);
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.store.all<T>(sql, ...params);
  }

  transactionImmediate<T>(fn: (tx: TransactionHandle) => T): T {
    return this.store.transactionImmediate(fn);
  }

  close(): void {
    this.store.close();
  }
}

export class NodeSqliteBrainStore implements BrainStorageDriver {
  readonly mode: BrainMode = "sqlite";
  readonly dbPath: string;
  private db: unknown; // DatabaseSync from node:sqlite
  private DatabaseSync: unknown;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async ensureDb(): Promise<void> {
    if (this.db) return;
    const { DatabaseSync } = await import("node:sqlite");
    this.DatabaseSync = DatabaseSync;

    // Ensure parent directory exists
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const dir = path.dirname(this.dbPath);
    if (dir !== "." && dir !== "") {
      await fs.mkdir(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    const db = this.db as { exec: (sql: string) => void; prepare: (sql: string) => { run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint }; get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] } };
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
  }

  exec(sql: string): void {
    const db = this.db as { exec: (sql: string) => void };
    db.exec(sql);
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const db = this.db as { prepare: (sql: string) => { run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint } } };
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    const db = this.db as { prepare: (sql: string) => { get: (...params: unknown[]) => T | undefined } };
    const stmt = db.prepare(sql);
    return stmt.get(...params);
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    const db = this.db as { prepare: (sql: string) => { all: (...params: unknown[]) => T[] } };
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  }

  transactionImmediate<T>(fn: (tx: TransactionHandle) => T): T {
    const db = this.db as { exec: (sql: string) => void; prepare: (sql: string) => { run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint }; get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] } };
    db.exec("BEGIN IMMEDIATE;");
    try {
      const txHandle: TransactionHandle = {
        exec: (sql: string) => db.exec(sql),
        run: (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params),
        get: <T = unknown>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...params),
        all: <T = unknown>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params),
      };
      const result = fn(txHandle);
      db.exec("COMMIT;");
      return result;
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    }
  }

  close(): void {
    const db = this.db as { close: () => void };
    db.close();
    this.db = undefined;
  }
}

export async function openBrainStore(options: { dbPath?: string; mode?: BrainMode } = {}): Promise<BrainStorageDriver> {
  const mode = options.mode ?? (options.dbPath === ":memory:" ? "memory" : "sqlite");
  if (mode === "memory" || options.dbPath === ":memory:") {
    return new InMemoryBrainStore();
  }
  const dbPath = options.dbPath ?? ".plan/.brain/taskos.sqlite";
  const store = new NodeSqliteBrainStore(dbPath);
  await store.ensureDb();
  return store;
}