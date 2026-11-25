import type { Knex } from 'knex';
import type { QueryBuilder } from 'objection';
import type { BaseModel } from '@moonwitness/orm';

/**
 * Minimal execution context shared by the income-ledger helpers and adapters.
 * The ORM exposes model queries through Objection rather than a `Context`
 * export, so helpers bind their queries to the supplied Knex connection.
 */
export interface Context {
  readonly db: Knex;
  query<M extends BaseModel>(model: new () => M): QueryBuilder<M, M[]>;
}

export function createIncomeLedgerContext(db: Knex): Context {
  return {
    db,
    query: (model) =>
      (model as unknown as { query(db: Knex): QueryBuilder<never, never[]> }).query(db) as never,
  };
}
