import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import {
  compareSchemaStates,
  type AppliedSchemaState,
  type DesiredSchemaState,
} from '@moonwitness/orm';
import { redactStartupErrorText } from '../startup-diagnostics.js';

const BASE_MIGRATION_BACKOFF_MS = 5_000;
const MAX_MIGRATION_BACKOFF_MS = 60_000;
const MIGRATION_LOCK_KEY = 1297564238;
const MIGRATION_LOCK_NAME = 'moonwitness.addon.install';
const SCHEMA_STATE_LOCK_ID = 77490123;

export const API_SCHEMA_VERSION = 1;

export type SchemaMigrationStatus = 'pending' | 'running' | 'retrying' | 'applied';

export interface SchemaStateRecord {
  id: 'global';
  status: SchemaMigrationStatus;
  desired_version: number;
  desired_digest: string;
  applied_version: number | null;
  applied_digest: string | null;
  owner_id: string | null;
  attempt_count: number;
  heartbeat_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_attempt_at: string | null;
  updated_at: string;
}

export interface SchemaReadinessState {
  ready: boolean;
  status?: SchemaMigrationStatus;
  version?: number;
  digest?: string;
  errorCode?: string;
}

export interface MigrationCoordinatorOptions {
  desired: DesiredSchemaState;
  migrate: () => Promise<void>;
  tryAcquireLock?: (db: Knex) => Promise<boolean>;
  releaseLock?: (db: Knex) => Promise<void>;
  writeState?: (db: Knex, state: SchemaStateRecord) => Promise<void>;
  ensureStateTable?: (db: Knex) => Promise<void>;
  onStateChange?: (state: SchemaStateRecord) => void | Promise<void>;
  maxAttempts?: number;
  ownerId?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

export class SchemaVersionAheadError extends Error {
  constructor(
    readonly appliedVersion: number,
    readonly desiredVersion: number
  ) {
    super(
      `Database schema version ${appliedVersion} is ahead of application version ${desiredVersion}`
    );
    this.name = 'SchemaVersionAheadError';
  }
}

export function computeMigrationBackoffMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(BASE_MIGRATION_BACKOFF_MS * 2 ** exponent, MAX_MIGRATION_BACKOFF_MS);
}

export async function ensureSchemaStateTable(db: Knex): Promise<void> {
  if (db.client.config.client === 'pg') {
    while (true) {
      const created = await db.transaction(async (trx) => {
        const lock = await trx.raw('SELECT pg_try_advisory_xact_lock(?) AS acquired', [
          SCHEMA_STATE_LOCK_ID,
        ]);
        const acquired = Boolean(lock.rows?.[0]?.acquired ?? lock[0]?.acquired);
        if (!acquired) return false;
        await trx.raw(`
          CREATE TABLE IF NOT EXISTS "_orm_schema_state" (
            "id" varchar(255) PRIMARY KEY,
            "status" varchar(255) NOT NULL,
            "desired_version" integer NOT NULL,
            "desired_digest" varchar(255) NOT NULL,
            "applied_version" integer NULL,
            "applied_digest" varchar(255) NULL,
            "owner_id" varchar(255) NULL,
            "attempt_count" integer NOT NULL DEFAULT 0,
            "heartbeat_at" varchar(255) NULL,
            "started_at" varchar(255) NULL,
            "completed_at" varchar(255) NULL,
            "last_error_code" varchar(255) NULL,
            "last_error_message" text NULL,
            "last_attempt_at" varchar(255) NULL,
            "updated_at" varchar(255) NOT NULL
          )
        `);
        return true;
      });
      if (created) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
  if (await db.schema.hasTable('_orm_schema_state')) return;
  try {
    await db.schema.createTable('_orm_schema_state', (table) => {
      table.string('id').primary();
      table.string('status').notNullable();
      table.integer('desired_version').notNullable();
      table.string('desired_digest').notNullable();
      table.integer('applied_version').nullable();
      table.string('applied_digest').nullable();
      table.string('owner_id').nullable();
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.string('heartbeat_at').nullable();
      table.string('started_at').nullable();
      table.string('completed_at').nullable();
      table.string('last_error_code').nullable();
      table.text('last_error_message').nullable();
      table.string('last_attempt_at').nullable();
      table.string('updated_at').notNullable();
    });
  } catch (error) {
    if (!(await db.schema.hasTable('_orm_schema_state'))) throw error;
  }
}

export async function readSchemaState(db: Knex): Promise<SchemaStateRecord | null> {
  const row = await db<SchemaStateRecord>('_orm_schema_state').where({ id: 'global' }).first();
  return row ?? null;
}

function appliedState(record: SchemaStateRecord | null): AppliedSchemaState | null {
  if (
    !record ||
    record.status !== 'applied' ||
    record.applied_version === null ||
    record.applied_digest === null
  ) {
    return null;
  }
  return { version: record.applied_version, digest: record.applied_digest };
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[0-9A-Z]{5}$/u.test(error.code)
  ) {
    return error.code;
  }
  return 'MIGRATION_FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? redactStartupErrorText(error.message) : 'Unknown migration error';
}

async function writeSchemaState(db: Knex, record: SchemaStateRecord): Promise<SchemaStateRecord> {
  await db('_orm_schema_state').insert(record).onConflict('id').merge(record);
  return record;
}

async function tryAcquireMigrationLock(db: Knex): Promise<boolean> {
  if (db.client.config.client !== 'pg') return true;
  const result = await db.raw('SELECT pg_try_advisory_lock(?, hashtext(?)) AS acquired', [
    MIGRATION_LOCK_KEY,
    MIGRATION_LOCK_NAME,
  ]);
  const row = result.rows?.[0] ?? result[0];
  return Boolean(row?.acquired);
}

async function releaseMigrationLock(db: Knex): Promise<void> {
  if (db.client.config.client !== 'pg') return;
  await db.raw('SELECT pg_advisory_unlock(?, hashtext(?))', [
    MIGRATION_LOCK_KEY,
    MIGRATION_LOCK_NAME,
  ]);
}

export interface SchemaWaitOptions {
  desired: DesiredSchemaState;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function waitForSchemaReady(
  db: Knex,
  options: SchemaWaitOptions
): Promise<SchemaStateRecord> {
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  while (true) {
    if (!(await db.schema.hasTable('_orm_schema_state'))) {
      await sleep(1_000);
      continue;
    }
    const state = await readSchemaState(db);
    if (!state) {
      await sleep(1_000);
      continue;
    }
    const comparison = compareSchemaStates(options.desired, appliedState(state));
    if (comparison.kind === 'current') return state;
    if (comparison.kind === 'ahead') {
      throw new SchemaVersionAheadError(state.applied_version ?? 0, options.desired.version);
    }
    await sleep(1_000);
  }
}

export async function runApiSchemaMigration(
  db: Knex,
  options: {
    desired: DesiredSchemaState;
    readiness: SchemaReadinessState;
    migrate: () => Promise<void>;
  }
): Promise<SchemaStateRecord> {
  const state = await coordinateApiMigration(db, {
    desired: options.desired,
    migrate: options.migrate,
    onStateChange: async (state) => {
      options.readiness.ready = false;
      options.readiness.status = state.status;
      options.readiness.version = state.desired_version;
      options.readiness.digest = state.desired_digest;
      options.readiness.errorCode = state.last_error_code ?? undefined;
    },
  });
  options.readiness.ready = true;
  options.readiness.status = 'applied';
  options.readiness.version = options.desired.version;
  options.readiness.digest = options.desired.digest;
  options.readiness.errorCode = undefined;
  return state;
}

export async function coordinateApiMigration(
  db: Knex,
  options: MigrationCoordinatorOptions
): Promise<SchemaStateRecord> {
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? (() => new Date());
  const ownerId = options.ownerId ?? randomUUID();
  const ensureStateTable = options.ensureStateTable ?? ensureSchemaStateTable;
  const tryAcquireLock = options.tryAcquireLock ?? tryAcquireMigrationLock;
  const releaseLock = options.releaseLock ?? releaseMigrationLock;
  const writeState = options.writeState ?? writeSchemaState;
  let attemptCount = 0;
  let initializationFailures = 0;

  while (true) {
    try {
      await ensureStateTable(db);
      break;
    } catch (error) {
      initializationFailures += 1;
      if (options.maxAttempts !== undefined && initializationFailures >= options.maxAttempts) {
        throw error;
      }
      await sleep(computeMigrationBackoffMs(initializationFailures));
    }
  }

  while (true) {
    const fresh = await readSchemaState(db);
    const freshComparison = compareSchemaStates(options.desired, appliedState(fresh));
    if (freshComparison.kind === 'current') return fresh as SchemaStateRecord;
    if (freshComparison.kind === 'ahead') {
      throw new SchemaVersionAheadError(fresh?.applied_version ?? 0, options.desired.version);
    }

    const acquired = await tryAcquireLock(db);
    if (!acquired) {
      await sleep(1_000);
      continue;
    }

    const current = await readSchemaState(db);
    const comparison = compareSchemaStates(options.desired, appliedState(current));
    if (comparison.kind === 'current') {
      await releaseLock(db);
      return current as SchemaStateRecord;
    }
    if (comparison.kind === 'ahead') {
      await releaseLock(db);
      throw new SchemaVersionAheadError(current?.applied_version ?? 0, options.desired.version);
    }

    attemptCount += 1;
    const timestamp = now().toISOString();
    const previous = await readSchemaState(db);
    const running: SchemaStateRecord = {
      id: 'global',
      status: 'running',
      desired_version: options.desired.version,
      desired_digest: options.desired.digest,
      applied_version: previous?.applied_version ?? null,
      applied_digest: previous?.applied_digest ?? null,
      owner_id: ownerId,
      attempt_count: attemptCount,
      heartbeat_at: timestamp,
      started_at: previous?.started_at ?? timestamp,
      completed_at: null,
      last_error_code: previous?.last_error_code ?? null,
      last_error_message: previous?.last_error_message ?? null,
      last_attempt_at: timestamp,
      updated_at: timestamp,
    };
    try {
      await writeState(db, running);
      await options.onStateChange?.(running);

      await options.migrate();
      const completedAt = now().toISOString();
      const applied: SchemaStateRecord = {
        ...running,
        status: 'applied',
        applied_version: options.desired.version,
        applied_digest: options.desired.digest,
        heartbeat_at: completedAt,
        completed_at: completedAt,
        updated_at: completedAt,
      };
      await writeState(db, applied);
      await options.onStateChange?.(applied);
      return applied;
    } catch (error) {
      const failedAt = now().toISOString();
      const retrying: SchemaStateRecord = {
        ...running,
        status: 'retrying',
        heartbeat_at: failedAt,
        last_error_code: errorCode(error),
        last_error_message: errorMessage(error),
        last_attempt_at: failedAt,
        updated_at: failedAt,
      };
      await writeState(db, retrying);
      await options.onStateChange?.(retrying);
      if (options.maxAttempts !== undefined && attemptCount >= options.maxAttempts) throw error;
      await sleep(computeMigrationBackoffMs(attemptCount));
    } finally {
      await releaseLock(db);
    }
  }
}
