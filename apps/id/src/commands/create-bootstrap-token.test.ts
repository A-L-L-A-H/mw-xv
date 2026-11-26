import { describe, expect, it, vi } from 'vitest';

import {
  BOOTSTRAP_HANDOFF_NOTE,
  BootstrapIssueError,
  createBootstrapToken,
  isOperatorInvocation,
  redactCommandMessage,
} from './create-bootstrap-token.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function databaseMock(rows: Array<Record<string, unknown>> = [{}]) {
  const raw = vi.fn(async (_sql: string, _bindings: readonly unknown[]) => ({ rows }));
  const close = vi.fn(async () => undefined);
  return { raw, close };
}

describe('create bootstrap token operator command', () => {
  it('is reachable only as an explicit operator invocation', () => {
    expect(isOperatorInvocation(['create-bootstrap-token'])).toBe(true);
    expect(isOperatorInvocation(['--issue-bootstrap-token'])).toBe(true);
    expect(isOperatorInvocation([])).toBe(false);
    expect(isOperatorInvocation(['--help'])).toBe(false);
  });

  it('prints raw token once and persists only its digest', async () => {
    const database = databaseMock();
    const stdout = vi.fn();
    const stderr = vi.fn();
    const result = await createBootstrapToken({
      database,
      stdout,
      stderr,
      now: NOW,
      installationScope: 'installation',
    });

    expect(stdout).toHaveBeenCalledTimes(1);
    const rawToken = String(stdout.mock.calls[0][0]);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.rawTokenPrintedOnce).toBe(true);
    expect(result.expiresAt).toBe('2026-01-01T00:15:00.000Z');
    expect(stderr).toHaveBeenCalledWith(BOOTSTRAP_HANDOFF_NOTE);
    expect(BOOTSTRAP_HANDOFF_NOTE).toContain('shown once');
    expect(BOOTSTRAP_HANDOFF_NOTE).toContain('cannot be recovered');

    const bindings = database.raw.mock.calls[0][1];
    expect(bindings).toHaveLength(5);
    expect(bindings[2]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(bindings[2]).not.toContain(rawToken);
    expect(String(database.raw.mock.calls[0][0])).toContain('INSERT INTO identity.bootstrap_token');
  });

  it('redacts command errors and does not emit secrets', async () => {
    const database = databaseMock([]);
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(createBootstrapToken({ database, stdout, stderr })).rejects.toThrow(
      BootstrapIssueError
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(redactCommandMessage('bootstrap_token=supersecret value')).toBe(
      'bootstrap token=[REDACTED] value'
    );
    expect(redactCommandMessage('raw=supersecret', 'supersecret')).toBe('raw=[REDACTED]');
  });

  it('has no public HTTP route registration', async () => {
    const appModule = await import('../app.js');
    expect(Object.keys(appModule)).not.toContain('bootstrapRoutes');
    expect(Object.keys(appModule)).toContain('buildApp');
  });
});
