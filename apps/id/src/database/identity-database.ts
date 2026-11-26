import knex, { type Knex } from 'knex';

export interface IdentityPoolSettings {
  readonly min?: number;
  readonly max?: number;
  readonly acquireTimeoutMs?: number;
}

export interface IdentityDatabase {
  readonly raw: Knex['raw'];
  readonly close: () => Promise<void>;
}

export interface IdentityDatabaseOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly pool?: IdentityPoolSettings;
  readonly createConnection?: (config: Knex.Config) => IdentityDatabaseConnection;
}

interface IdentityDatabaseConnection {
  readonly raw: Knex['raw'];
  readonly destroy: () => Promise<void>;
}

export class IdentityDatabaseError extends Error {
  override readonly name = 'IdentityDatabaseError';
}

export function createIdentityDatabase(options: IdentityDatabaseOptions = {}): IdentityDatabase {
  const environment = options.environment ?? process.env;
  const url = environment.IDENTITY_DATABASE_URL;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new IdentityDatabaseError('Missing required environment variable: IDENTITY_DATABASE_URL');
  }
  if (!/^postgres(?:ql)?:\/\//.test(url)) {
    throw new IdentityDatabaseError('IDENTITY_DATABASE_URL must use PostgreSQL');
  }
  if (environment.DATABASE_URL && environment.DATABASE_URL === url) {
    throw new IdentityDatabaseError('IDENTITY_DATABASE_URL must not equal DATABASE_URL');
  }

  const config: Knex.Config = {
    client: 'pg',
    connection: url,
    pool: {
      ...(options.pool?.min === undefined ? {} : { min: options.pool.min }),
      ...(options.pool?.max === undefined ? {} : { max: options.pool.max }),
      ...(options.pool?.acquireTimeoutMs === undefined
        ? {}
        : { acquireTimeoutMillis: options.pool.acquireTimeoutMs }),
    },
  };
  const connection: IdentityDatabaseConnection =
    options.createConnection?.(config) ?? wrapKnexConnection(knex(config));

  let closed = false;
  return {
    raw: connection.raw,
    close: async () => {
      if (closed) return;
      closed = true;
      await connection.destroy();
    },
  };
}

function wrapKnexConnection(db: Knex): IdentityDatabaseConnection {
  return {
    raw: db.raw.bind(db),
    destroy: async () => {
      await db.destroy();
    },
  };
}
