import knex from 'knex';
import { E2E_JWT_SECRET, E2E_SUPERADMIN_PASSWORD } from '@moonwitness/types/node';
import { buildApp } from '../app.js';

const database = knex({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
});

const app = await buildApp({
  db: database,
  superadminPassword: E2E_SUPERADMIN_PASSWORD,
  jwtSecret: E2E_JWT_SECRET,
  loginRateMax: 100,
});

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await app.close();
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

await app.listen({
  host: process.env.API_HOST ?? '127.0.0.1',
  port: Number(process.env.API_PORT ?? 3017),
});
