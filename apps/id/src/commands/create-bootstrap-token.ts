import { createIdentityDatabase, type IdentityDatabase } from '../database/identity-database.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const MIN_BOOTSTRAP_TOKEN_BYTES = 32;
const DEFAULT_BOOTSTRAP_TOKEN_TTL_SECONDS = 15 * 60;

interface BootstrapDatabasePort {
  readonly raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
}

function rowsFrom(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

function digestBootstrapToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function generateBootstrapToken(byteLength = MIN_BOOTSTRAP_TOKEN_BYTES): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < MIN_BOOTSTRAP_TOKEN_BYTES) {
    throw new Error(`bootstrap token must contain at least ${MIN_BOOTSTRAP_TOKEN_BYTES} random bytes`);
  }
  return randomBytes(byteLength).toString('base64url');
}

async function insertBootstrapToken(
  token: { id: string; scope: string; digest: string; createdAt: string; expiresAt: string },
  database: BootstrapDatabasePort
): Promise<void> {
  try {
    const rows = rowsFrom(
      await database.raw(
        `INSERT INTO identity.bootstrap_token
           (id, installation_scope, token_digest, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (installation_scope) WHERE consumed_at IS NULL AND revoked_at IS NULL
         DO NOTHING
         RETURNING *`,
        [token.id, token.scope, token.digest, token.createdAt, token.expiresAt]
      )
    );
    if (!rows[0]) throw new Error('An active bootstrap token already exists');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|duplicate|conflict|active bootstrap/i.test(message)) {
      throw new Error('An active bootstrap token already exists');
    }
    throw error;
  }
}

export interface CreateBootstrapTokenOptions {
  readonly database: BootstrapDatabasePort;
  readonly installationScope?: string;
  readonly ttlSeconds?: number;
  readonly now?: Date;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface CreateBootstrapTokenResult {
  readonly expiresAt: string;
  readonly installationScope: string;
  readonly rawTokenPrintedOnce: true;
}

export const BOOTSTRAP_HANDOFF_NOTE =
  'Hand off the printed token privately to the operator performing first-owner setup. ' +
  'It is shown once, expires quickly, and cannot be recovered from the database. ' +
  'Do not place it in .env files, compose defaults, telemetry, or shell history.';

export class BootstrapIssueError extends Error {
  override readonly name = 'BootstrapIssueError';
}

export function redactCommandMessage(message: string, rawToken?: string): string {
  let redacted = message;
  if (rawToken) redacted = redacted.split(rawToken).join('[REDACTED]');
  return redacted.replace(
    /bootstrap[_ -]?token[=: ]+[A-Za-z0-9_-]+/gi,
    'bootstrap token=[REDACTED]'
  );
}

export async function createBootstrapToken(
  options: CreateBootstrapTokenOptions
): Promise<CreateBootstrapTokenResult> {
  const stdout = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  try {
    const rawToken = generateBootstrapToken();
    const now = options.now ?? new Date();
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_BOOTSTRAP_TOKEN_TTL_SECONDS;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 3600) {
      throw new Error('ttlSeconds must be between 1 and 3600');
    }
    const scope = options.installationScope ?? 'installation';
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    await insertBootstrapToken({
      id: randomUUID(),
      scope,
      digest: digestBootstrapToken(rawToken),
      createdAt: now.toISOString(),
      expiresAt,
    }, options.database);

    stdout(rawToken);
    stderr(BOOTSTRAP_HANDOFF_NOTE);
    return Object.freeze({
      expiresAt,
      installationScope: scope,
      rawTokenPrintedOnce: true as const,
    });
  } catch (error) {
    throw new BootstrapIssueError(redactCommandMessage(
      error instanceof Error ? error.message : String(error)
    ));
  }
}

export function isOperatorInvocation(argv: readonly string[]): boolean {
  return argv[0] === 'create-bootstrap-token' || argv[0] === '--issue-bootstrap-token';
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (!isOperatorInvocation(argv)) {
    process.stderr.write(
      'Operator-only command. Run: bun --filter @moonwitness/id run bootstrap:token -- create-bootstrap-token\n'
    );
    return 2;
  }

  let database: IdentityDatabase | undefined;
  try {
    database = createIdentityDatabase({
      environment: process.env,
      pool: { min: 0, max: 1 },
    });
    const result = await createBootstrapToken({ database });
    process.stderr.write(`Expires at: ${result.expiresAt}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${redactCommandMessage(message)}\n`);
    return 1;
  } finally {
    await database?.close();
  }
}

const invokedDirectly = process.argv[1]?.endsWith('create-bootstrap-token.ts') ?? false;
if (invokedDirectly) {
  await main();
}
