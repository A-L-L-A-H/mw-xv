import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import type { BaseModel } from './base.model.js';
import {
  columnName,
  isStoredField,
  manyToManyTableMeta,
  resolveFieldTarget,
  type Field,
  type FieldMap,
  type OnDeletePolicy,
} from './model-definition.js';
import { SchemaSyncError } from './types.js';

export type SyncModelClass = typeof BaseModel & { readonly fields: FieldMap };

export interface ColumnSnapshot {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
}

export interface IndexSnapshot {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeySnapshot {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: string;
}

export interface CheckConstraintSnapshot {
  name: string;
  column?: string;
  expression: string;
  enumValues?: string[];
}

export interface TableSchemaSnapshot {
  tableName: string;
  exists: boolean;
  columns: ColumnSnapshot[];
  indexes: IndexSnapshot[];
  foreignKeys: ForeignKeySnapshot[];
  checkConstraints: CheckConstraintSnapshot[];
}

export type SchemaDiffCategory =
  'safe_create' | 'safe_alter' | 'index_sync' | 'destructive_blocked';

export interface SchemaDiffItem {
  table: string;
  category: SchemaDiffCategory;
  action: string;
  detail: string;
  column?: string;
}

export interface SchemaDiffPlan {
  items: SchemaDiffItem[];
  hasDestructive: boolean;
  destructiveItems: SchemaDiffItem[];
}

export interface ApplySchemaSyncOptions {
  allowDestructive?: boolean;
}

function isPostgres(db: Knex | Knex.Transaction): boolean {
  return db.client?.config?.client === 'pg';
}

function normalizeOnDelete(policy: OnDeletePolicy | string | undefined): string {
  const upper = (policy ?? 'restrict').toUpperCase();
  if (upper === 'CASCADE') return 'CASCADE';
  if (upper === 'SET NULL') return 'SET NULL';
  return 'RESTRICT';
}

function parseEnumValuesFromCheck(expression: string): string[] | undefined {
  // Matches SQLite: check ("status" in ('a', 'b')) or PG: CHECK ((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))
  const inMatch = /\bin\s*\(([^)]+)\)/i.exec(expression);
  if (inMatch?.[1]) {
    const vals = Array.from(inMatch[1].matchAll(/'([^']*)'/g)).map((m) => m[1]!);
    if (vals.length > 0) return vals;
  }
  const anyMatch = /ARRAY\[([^\]]+)\]/i.exec(expression);
  if (anyMatch?.[1]) {
    const vals = Array.from(anyMatch[1].matchAll(/'([^']*)'/g)).map((m) => m[1]!);
    if (vals.length > 0) return vals;
  }
  return undefined;
}

function parseSqliteChecks(createSql: string): CheckConstraintSnapshot[] {
  const checks: CheckConstraintSnapshot[] = [];
  const regex = /check\s*\(([^)]+\)?)\)/gi;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = regex.exec(createSql)) !== null) {
    const expr = match[1] ?? '';
    const colMatch = /[`"']?([a-z_][a-z0-9_]*)[`"']?\s+in\s*\(/i.exec(expr);
    checks.push({
      name: `sqlite_check_${idx}`,
      column: colMatch?.[1],
      expression: expr,
      enumValues: parseEnumValuesFromCheck(expr),
    });
    idx += 1;
  }
  return checks;
}

/**
 * Introspect live database schema for the given table names on PostgreSQL or SQLite.
 */
export async function introspectDatabaseSchema(
  db: Knex | Knex.Transaction,
  tableNames: readonly string[]
): Promise<Map<string, TableSchemaSnapshot>> {
  const result = new Map<string, TableSchemaSnapshot>();
  const pg = isPostgres(db);

  for (const tableName of tableNames) {
    const exists = await db.schema.hasTable(tableName);
    if (!exists) {
      result.set(tableName, {
        tableName,
        exists: false,
        columns: [],
        indexes: [],
        foreignKeys: [],
        checkConstraints: [],
      });
      continue;
    }

    if (pg) {
      const colRows = (await db.raw(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ?
         ORDER BY ordinal_position`,
        [tableName]
      )) as {
        rows: Array<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>;
      };

      const columns: ColumnSnapshot[] = colRows.rows.map((r) => ({
        name: r.column_name,
        dataType: r.data_type.toLowerCase(),
        nullable: r.is_nullable === 'YES',
        defaultValue: r.column_default,
      }));

      const idxRows = (await db.raw(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = ?`,
        [tableName]
      )) as { rows: Array<{ indexname: string; indexdef: string }> };

      const indexes: IndexSnapshot[] = idxRows.rows.map((r) => {
        const colMatch = /\(([^)]+)\)/.exec(r.indexdef);
        const cols = colMatch?.[1]
          ? colMatch[1].split(',').map((c) => c.trim().replaceAll('"', ''))
          : [];
        return {
          name: r.indexname,
          columns: cols,
          unique: /\bUNIQUE\b/i.test(r.indexdef),
        };
      });

      const fkRows = (await db.raw(
        `SELECT
           c.conname AS name,
           a.attname AS column_name,
           confrelid::regclass::text AS ref_table,
           af.attname AS ref_column,
           CASE c.confdeltype
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
             ELSE 'RESTRICT'
           END AS on_delete
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = ANY(c.confkey)
         WHERE c.contype = 'f' AND c.conrelid = ?::regclass`,
        [tableName]
      )) as {
        rows: Array<{
          name: string;
          column_name: string;
          ref_table: string;
          ref_column: string;
          on_delete: string;
        }>;
      };

      const foreignKeys: ForeignKeySnapshot[] = fkRows.rows.map((r) => ({
        name: r.name,
        column: r.column_name,
        referencedTable: r.ref_table.replaceAll('"', ''),
        referencedColumn: r.ref_column,
        onDelete: r.on_delete,
      }));

      const checkRows = (await db.raw(
        `SELECT conname AS name, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE contype = 'c' AND conrelid = ?::regclass`,
        [tableName]
      )) as { rows: Array<{ name: string; def: string }> };

      const checkConstraints: CheckConstraintSnapshot[] = checkRows.rows.map((r) => {
        const colMatch = /\(\(?([a-z_][a-z0-9_]*)\)?/i.exec(r.def);
        return {
          name: r.name,
          column: colMatch?.[1],
          expression: r.def,
          enumValues: parseEnumValuesFromCheck(r.def),
        };
      });

      result.set(tableName, {
        tableName,
        exists: true,
        columns,
        indexes,
        foreignKeys,
        checkConstraints,
      });
    } else {
      // SQLite introspection
      const pragmaCols = (await db.raw(`PRAGMA table_info(??)`, [tableName])) as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;

      const columns: ColumnSnapshot[] = pragmaCols.map((r) => ({
        name: r.name,
        dataType: (r.type || '').toLowerCase(),
        nullable: r.notnull === 0,
        defaultValue: r.dflt_value,
      }));

      const pragmaIndexes = (await db.raw(`PRAGMA index_list(??)`, [tableName])) as Array<{
        name: string;
        unique: number;
      }>;
      const indexes: IndexSnapshot[] = [];
      for (const idx of pragmaIndexes) {
        const idxInfo = (await db.raw(`PRAGMA index_info(??)`, [idx.name])) as Array<{
          name: string;
        }>;
        indexes.push({
          name: idx.name,
          columns: idxInfo.map((c) => c.name),
          unique: idx.unique === 1,
        });
      }

      const pragmaFks = (await db.raw(`PRAGMA foreign_key_list(??)`, [tableName])) as Array<{
        id: number;
        table: string;
        from: string;
        to: string;
        on_delete: string;
      }>;
      const foreignKeys: ForeignKeySnapshot[] = pragmaFks.map((fk) => ({
        name: `sqlite_fk_${fk.id}_${fk.from}`,
        column: fk.from,
        referencedTable: fk.table,
        referencedColumn: fk.to,
        onDelete: (fk.on_delete || 'NO ACTION').toUpperCase(),
      }));

      const masterRow = (await db('sqlite_master')
        .where({ type: 'table', name: tableName })
        .first('sql')) as { sql?: string } | undefined;
      const checkConstraints = masterRow?.sql ? parseSqliteChecks(masterRow.sql) : [];

      result.set(tableName, {
        tableName,
        exists: true,
        columns,
        indexes,
        foreignKeys,
        checkConstraints,
      });
    }
  }

  return result;
}

function expectedSqlTypeFamily(field: Field): string {
  switch (field.kind) {
    case 'integer':
    case 'belongsTo':
      return 'integer';
    case 'float':
      return 'float';
    case 'decimal':
      return 'decimal';
    case 'boolean':
      return 'boolean';
    case 'text':
      return 'text';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'json':
      return 'json';
    default:
      return 'string';
  }
}

function normalizeDbTypeFamily(dataType: string): string {
  const t = dataType.toLowerCase();
  if (t.includes('int')) return 'integer';
  if (t.includes('double') || t.includes('real') || t.includes('float')) return 'float';
  if (t.includes('numeric') || t.includes('decimal')) return 'decimal';
  if (t.includes('bool')) return 'boolean';
  if (t === 'text') return 'text';
  if (t === 'date') return 'date';
  if (t.includes('timestamp') || t.includes('datetime')) return 'datetime';
  if (t.includes('json')) return 'json';
  return 'string';
}

function isSafeWidening(fromFamily: string, toFamily: string): boolean {
  if (fromFamily === toFamily) return true;
  if (fromFamily === 'string' && toFamily === 'text') return true;
  if (fromFamily === 'integer' && (toFamily === 'float' || toFamily === 'decimal')) return true;
  if (fromFamily === 'float' && toFamily === 'decimal') return true;
  if (fromFamily === 'date' && toFamily === 'datetime') return true;
  // SQLite stores json/date/datetime/string as text/varchar
  if (
    fromFamily === 'text' &&
    (toFamily === 'json' || toFamily === 'datetime' || toFamily === 'date')
  ) {
    return true;
  }
  return false;
}

export function expectedIndexNames(model: SyncModelClass): {
  indexes: Array<{ name: string; columns: string[] }>;
  uniques: Array<{ name: string; columns: string[] }>;
} {
  const entries = Object.entries(model.fields).filter(([, f]) => isStoredField(f));
  const hasCompanyColumn = entries.some(
    ([name, field]) => columnName(name, field) === 'company_id'
  );
  const rawIndexes: string[][] = [
    ['active', 'id'],
    ['create_uid'],
    ...(hasCompanyColumn ? [['company_id', 'active', 'id']] : []),
    ...entries.flatMap(([name, field]) =>
      field.kind === 'belongsTo' || field.index === true ? [[columnName(name, field)]] : []
    ),
  ];

  const indexes = rawIndexes.map((columns) => {
    const suffix = createHash('sha256')
      .update(`${model.tableName}.${columns.join('.')}`)
      .digest('hex')
      .slice(0, 12);
    return { name: `mw_idx_${suffix}`, columns };
  });

  const uniques = model.uniqueConstraints.map((constraint) => {
    if (constraint.length === 0) throw new Error(`Empty unique constraint on ${model.modelName}`);
    const columns = constraint.map((name) => {
      const field = model.fields[name];
      if (!field) throw new Error(`Unknown unique field: ${model.modelName}.${name}`);
      return columnName(name, field);
    });
    const suffix = createHash('sha256')
      .update(`${model.tableName}.unique.${columns.join('.')}`)
      .digest('hex')
      .slice(0, 12);
    return { name: `mw_uq_${suffix}`, columns };
  });

  return { indexes, uniques };
}

/**
 * Compute a fail-closed SchemaDiffPlan without mutating the database.
 */
export async function planSchemaSync(
  db: Knex | Knex.Transaction,
  models: readonly SyncModelClass[]
): Promise<SchemaDiffPlan> {
  const tableNames = models.map((m) => m.tableName);
  const snapshots = await introspectDatabaseSchema(db, tableNames);
  const items: SchemaDiffItem[] = [];

  for (const model of models) {
    const snapshot = snapshots.get(model.tableName);
    const storedEntries = Object.entries(model.fields).filter(([, f]) => isStoredField(f));

    if (!snapshot || !snapshot.exists) {
      items.push({
        table: model.tableName,
        category: 'safe_create',
        action: 'create_table',
        detail: `Create table '${model.tableName}' for model '${model.modelName}'`,
      });
    } else {
      const existingCols = new Map(snapshot.columns.map((c) => [c.name, c]));
      const populated = Boolean(await db(model.tableName).first('id'));

      for (const [name, field] of storedEntries) {
        const col = columnName(name, field);
        const existing = existingCols.get(col);
        const hasStaticDefault = field.default !== undefined && typeof field.default !== 'function';
        const wantsNotNull = Boolean(field.required) || hasStaticDefault;

        if (!existing) {
          if (populated && ((field.required && !hasStaticDefault) || field.unique)) {
            items.push({
              table: model.tableName,
              column: col,
              category: 'destructive_blocked',
              action: 'add_column_not_null_populated',
              detail: `Cannot safely add ${model.modelName}.${name} to populated table '${model.tableName}' without default; backfill explicitly first`,
            });
          } else {
            items.push({
              table: model.tableName,
              column: col,
              category: 'safe_create',
              action: 'add_column',
              detail: `Add column '${col}' to '${model.tableName}'`,
            });
          }
          continue;
        }

        // Check type evolution
        const fromFamily = normalizeDbTypeFamily(existing.dataType);
        const toFamily = expectedSqlTypeFamily(field);
        if (fromFamily !== toFamily) {
          if (isSafeWidening(fromFamily, toFamily)) {
            items.push({
              table: model.tableName,
              column: col,
              category: 'safe_alter',
              action: 'widen_column_type',
              detail: `Widen '${model.tableName}.${col}' from ${fromFamily} to ${toFamily}`,
            });
          } else {
            items.push({
              table: model.tableName,
              column: col,
              category: 'destructive_blocked',
              action: 'narrow_column_type',
              detail: `Blocked type narrowing on '${model.tableName}.${col}': ${fromFamily} -> ${toFamily}`,
            });
          }
        }

        // Check nullability evolution
        if (!existing.nullable && !wantsNotNull) {
          items.push({
            table: model.tableName,
            column: col,
            category: 'safe_alter',
            action: 'drop_not_null',
            detail: `Relax NOT NULL on '${model.tableName}.${col}'`,
          });
        } else if (existing.nullable && wantsNotNull) {
          if (populated && !hasStaticDefault) {
            items.push({
              table: model.tableName,
              column: col,
              category: 'destructive_blocked',
              action: 'set_not_null_populated',
              detail: `Cannot enforce NOT NULL on populated '${model.tableName}.${col}' without default`,
            });
          } else {
            items.push({
              table: model.tableName,
              column: col,
              category: 'safe_alter',
              action: 'set_not_null',
              detail: `Set NOT NULL on '${model.tableName}.${col}'`,
            });
          }
        }

        // Check enum CHECK constraint evolution
        if (field.kind === 'enum' && field.values) {
          const check = snapshot.checkConstraints.find((c) => c.column === col && c.enumValues);
          if (check?.enumValues) {
            const currentSet = new Set(check.enumValues);
            const targetSet = new Set(field.values);
            const removed = check.enumValues.filter((v) => !targetSet.has(v));
            const added = field.values.filter((v) => !currentSet.has(v));
            if (removed.length > 0) {
              items.push({
                table: model.tableName,
                column: col,
                category: 'destructive_blocked',
                action: 'enum_values_removed',
                detail: `Blocked enum value removal on '${model.tableName}.${col}': ${removed.join(', ')}`,
              });
            } else if (added.length > 0) {
              items.push({
                table: model.tableName,
                column: col,
                category: 'safe_alter',
                action: 'enum_values_expanded',
                detail: `Expand enum CHECK on '${model.tableName}.${col}' with: ${added.join(', ')}`,
              });
            }
          }
        }

        // Check FK onDelete reconciliation (Postgres)
        if (field.kind === 'belongsTo' && isPostgres(db)) {
          const targetModel = resolveFieldTarget(field.target);
          if (targetModel) {
            const desiredOnDelete = normalizeOnDelete(field.onDelete);
            const existingFk = snapshot.foreignKeys.find((fk) => fk.column === col);
            if (!existingFk) {
              items.push({
                table: model.tableName,
                column: col,
                category: 'safe_alter',
                action: 'add_foreign_key',
                detail: `Add FK on '${model.tableName}.${col}' -> '${targetModel.tableName}.id' ON DELETE ${desiredOnDelete}`,
              });
            } else if (
              existingFk.onDelete !== desiredOnDelete &&
              !(existingFk.onDelete === 'NO ACTION' && desiredOnDelete === 'RESTRICT')
            ) {
              items.push({
                table: model.tableName,
                column: col,
                category: 'safe_alter',
                action: 'update_foreign_key',
                detail: `Update FK on '${model.tableName}.${col}' ON DELETE ${existingFk.onDelete} -> ${desiredOnDelete}`,
              });
            }
          }
        }
      }

      // Check orphan mw_idx_* / mw_uq_* indexes
      const { indexes, uniques } = expectedIndexNames(model);
      const expectedSet = new Set([...indexes.map((i) => i.name), ...uniques.map((u) => u.name)]);
      const existingIdxSet = new Set(snapshot.indexes.map((i) => i.name));

      for (const idx of [...indexes, ...uniques]) {
        if (!existingIdxSet.has(idx.name)) {
          items.push({
            table: model.tableName,
            category: 'index_sync',
            action: 'create_index',
            detail: `Create index '${idx.name}' on '${model.tableName}' (${idx.columns.join(', ')})`,
          });
        }
      }
      for (const existingIdx of snapshot.indexes) {
        if (
          (existingIdx.name.startsWith('mw_idx_') || existingIdx.name.startsWith('mw_uq_')) &&
          !expectedSet.has(existingIdx.name)
        ) {
          items.push({
            table: model.tableName,
            category: 'index_sync',
            action: 'drop_orphan_index',
            detail: `Drop orphan ORM index '${existingIdx.name}' on '${model.tableName}'`,
          });
        }
      }
    }

    // Check M2M junction tables
    for (const [key, field] of Object.entries(model.fields)) {
      if (field.kind !== 'manyToMany') continue;
      const meta = manyToManyTableMeta(model.tableName, key, field);
      if (meta && !(await db.schema.hasTable(meta.relationTable))) {
        items.push({
          table: meta.relationTable,
          category: 'safe_create',
          action: 'create_m2m_table',
          detail: `Create M2M junction table '${meta.relationTable}'`,
        });
      }
    }
  }

  const destructiveItems = items.filter((i) => i.category === 'destructive_blocked');
  return {
    items,
    hasDestructive: destructiveItems.length > 0,
    destructiveItems,
  };
}

function addColumnToTable(
  table: Knex.CreateTableBuilder,
  name: string,
  field: Field,
  includeForeignKey = true
): void {
  const column = columnName(name, field);
  let builder: Knex.ColumnBuilder;
  switch (field.kind) {
    case 'integer':
    case 'belongsTo':
      builder = table.integer(column);
      break;
    case 'float':
      builder = table.double(column);
      break;
    case 'decimal':
      builder = table.decimal(column, field.precision ?? 18, field.scale ?? 4);
      break;
    case 'text':
      builder = table.text(column);
      break;
    case 'boolean':
      builder = table.boolean(column);
      break;
    case 'date':
      builder = table.date(column);
      break;
    case 'datetime':
      builder = table.timestamp(column);
      break;
    case 'json':
      builder = table.text(column);
      break;
    default:
      builder = table.string(column, 255);
      break;
  }

  const hasStaticDefault = field.default !== undefined && typeof field.default !== 'function';
  if (field.required || hasStaticDefault) builder.notNullable();
  else builder.nullable();

  if (hasStaticDefault) {
    const defVal =
      field.kind === 'json' && typeof field.default === 'object'
        ? JSON.stringify(field.default)
        : (field.default as Knex.Value);
    builder.defaultTo(defVal);
  }
  if (field.unique) builder.unique();
  if (field.values) builder.checkIn([...field.values]);

  const targetModel = resolveFieldTarget(field.target);
  if (field.kind === 'belongsTo' && targetModel && includeForeignKey) {
    builder
      .references('id')
      .inTable(targetModel.tableName)
      .onDelete(normalizeOnDelete(field.onDelete));
  }
}

/**
 * Synchronize a single model's table, columns, M2M junction tables, constraints, and indexes.
 */
export async function syncModelSchema(
  db: Knex.Transaction,
  model: SyncModelClass,
  options: ApplySchemaSyncOptions = {}
): Promise<void> {
  const plan = await planSchemaSync(db, [model]);
  if (plan.hasDestructive && !options.allowDestructive) {
    const summary = plan.destructiveItems.map((i) => i.detail).join('; ');
    throw new SchemaSyncError(`Destructive schema change blocked: ${summary}`, {
      details: {
        table: model.tableName,
        destructiveItems: plan.destructiveItems,
      },
    });
  }

  const storedEntries = Object.entries(model.fields).filter(([, f]) => isStoredField(f));
  const tableExists = await db.schema.hasTable(model.tableName);
  const pg = isPostgres(db);

  if (!tableExists) {
    await db.schema.createTable(model.tableName, (table) => {
      table.increments('id').primary();
      table.boolean('active').notNullable().defaultTo(true);
      table.timestamp('create_date').notNullable().defaultTo(db.fn.now());
      table.timestamp('write_date').notNullable().defaultTo(db.fn.now());
      table.integer('create_uid').nullable();
      table.integer('write_uid').nullable();
      for (const [name, field] of storedEntries) addColumnToTable(table, name, field);
    });
  } else {
    const snapshots = await introspectDatabaseSchema(db, [model.tableName]);
    const snapshot = snapshots.get(model.tableName)!;

    for (const [name, field] of storedEntries) {
      const col = columnName(name, field);
      if (!(await db.schema.hasColumn(model.tableName, col))) {
        await db.schema.alterTable(model.tableName, (table) =>
          addColumnToTable(table, name, field, db.client.config.client !== 'better-sqlite3')
        );
        continue;
      }

      // Apply safe alterations on PostgreSQL
      if (pg) {
        const existing = snapshot.columns.find((c) => c.name === col);
        const hasStaticDefault = field.default !== undefined && typeof field.default !== 'function';
        const wantsNotNull = Boolean(field.required) || hasStaticDefault;

        if (existing) {
          const fromFamily = normalizeDbTypeFamily(existing.dataType);
          const toFamily = expectedSqlTypeFamily(field);
          if (fromFamily !== toFamily && isSafeWidening(fromFamily, toFamily)) {
            const sqlType =
              toFamily === 'text'
                ? 'TEXT'
                : toFamily === 'float'
                  ? 'DOUBLE PRECISION'
                  : toFamily === 'decimal'
                    ? `NUMERIC(${field.precision ?? 18}, ${field.scale ?? 4})`
                    : toFamily === 'datetime'
                      ? 'TIMESTAMPTZ'
                      : 'TEXT';
            await db.raw(`ALTER TABLE ?? ALTER COLUMN ?? TYPE ${sqlType}`, [model.tableName, col]);
          }
          if (!existing.nullable && !wantsNotNull) {
            await db.raw(`ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL`, [model.tableName, col]);
          } else if (existing.nullable && wantsNotNull) {
            await db.raw(`ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL`, [model.tableName, col]);
          }
        }

        // Enum CHECK constraint expansion on PostgreSQL
        if (field.kind === 'enum' && field.values) {
          const check = snapshot.checkConstraints.find((c) => c.column === col && c.enumValues);
          if (check?.enumValues) {
            const currentSet = new Set(check.enumValues);
            const hasNew = field.values.some((v) => !currentSet.has(v));
            if (hasNew) {
              await db.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`, [
                model.tableName,
                check.name,
              ]);
              const quoted = field.values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', ');
              await db.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (?? IN (${quoted}))`, [
                model.tableName,
                check.name,
                col,
              ]);
            }
          }
        }

        // FK onDelete reconciliation on PostgreSQL
        if (field.kind === 'belongsTo') {
          const targetModel = resolveFieldTarget(field.target);
          if (targetModel) {
            const desiredOnDelete = normalizeOnDelete(field.onDelete);
            const existingFk = snapshot.foreignKeys.find((fk) => fk.column === col);
            if (!existingFk) {
              const fkName = `mw_fk_${model.tableName}_${col}`.slice(0, 63);
              await db.raw(
                `ALTER TABLE ?? ADD CONSTRAINT ?? FOREIGN KEY (??) REFERENCES ?? ("id") ON DELETE ${desiredOnDelete}`,
                [model.tableName, fkName, col, targetModel.tableName]
              );
            } else if (
              existingFk.onDelete !== desiredOnDelete &&
              !(existingFk.onDelete === 'NO ACTION' && desiredOnDelete === 'RESTRICT')
            ) {
              await db.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`, [
                model.tableName,
                existingFk.name,
              ]);
              await db.raw(
                `ALTER TABLE ?? ADD CONSTRAINT ?? FOREIGN KEY (??) REFERENCES ?? ("id") ON DELETE ${desiredOnDelete}`,
                [model.tableName, existingFk.name, col, targetModel.tableName]
              );
            }
          }
        }
      }
    }

    // Reconcile orphan mw_idx_* / mw_uq_* indexes (never touching non-mw_* DBA indexes)
    const { indexes, uniques } = expectedIndexNames(model);
    const expectedSet = new Set([...indexes.map((i) => i.name), ...uniques.map((u) => u.name)]);
    for (const existingIdx of snapshot.indexes) {
      if (
        (existingIdx.name.startsWith('mw_idx_') || existingIdx.name.startsWith('mw_uq_')) &&
        !expectedSet.has(existingIdx.name)
      ) {
        await db.raw(`DROP INDEX IF EXISTS ??`, [existingIdx.name]);
      }
    }
  }

  // Create M2M junction tables
  for (const [key, field] of Object.entries(model.fields)) {
    if (field.kind !== 'manyToMany') continue;
    const meta = manyToManyTableMeta(model.tableName, key, field);
    if (!meta) continue;
    if (!(await db.schema.hasTable(meta.relationTable))) {
      await db.schema.createTable(meta.relationTable, (table) => {
        table
          .integer(meta.joinColumn)
          .notNullable()
          .references('id')
          .inTable(meta.sourceTable)
          .onDelete('CASCADE');
        table
          .integer(meta.inverseJoinColumn)
          .notNullable()
          .references('id')
          .inTable(meta.targetTable)
          .onDelete('CASCADE');
        table.unique([meta.joinColumn, meta.inverseJoinColumn]);
        table.index([meta.inverseJoinColumn, meta.joinColumn]);
      });
    }
  }

  // Create expected ORM indexes & unique constraints
  const { indexes, uniques } = expectedIndexNames(model);
  for (const idx of indexes) {
    const identifiers = idx.columns.map(() => '??').join(', ');
    await db.raw(`CREATE INDEX IF NOT EXISTS ?? ON ?? (${identifiers})`, [
      idx.name,
      model.tableName,
      ...idx.columns,
    ]);
  }
  for (const uq of uniques) {
    const identifiers = uq.columns.map(() => '??').join(', ');
    // Pre-check duplicates before creating a new unique index
    const existingSnaps = await introspectDatabaseSchema(db, [model.tableName]);
    const alreadyExists = existingSnaps
      .get(model.tableName)
      ?.indexes.some((i) => i.name === uq.name);
    if (!alreadyExists) {
      const dupQuery = db(model.tableName)
        .select(uq.columns)
        .count('* as cnt')
        .groupBy(uq.columns)
        .havingRaw('count(*) > 1')
        .first();
      const dup: unknown = await dupQuery;
      if (dup) {
        throw new SchemaSyncError(
          `Cannot create unique index '${uq.name}' on '${model.tableName}' (${uq.columns.join(', ')}): duplicate rows exist`,
          { details: { table: model.tableName, columns: uq.columns } }
        );
      }
    }
    await db.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ?? ON ?? (${identifiers})`, [
      uq.name,
      model.tableName,
      ...uq.columns,
    ]);
  }
}
