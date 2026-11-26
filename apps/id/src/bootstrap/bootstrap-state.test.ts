import { describe, expect, it, vi } from 'vitest';

import {
  getBootstrapSetupState,
  PUBLIC_SETUP_STATE,
  type BootstrapDatabasePort,
  validBootstrapTokenExists,
} from './bootstrap-state.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function database(rows: Array<Record<string, unknown>> = []): {
  port: BootstrapDatabasePort;
  raw: ReturnType<typeof vi.fn>;
} {
  const raw = vi.fn(async (_sql: string, _bindings: readonly unknown[]) => ({ rows }));
  return { port: { raw }, raw };
}

describe('bootstrap setup state service', () => {
  it('requires setup only when a valid unconsumed token exists', async () => {
    const { port, raw } = database([{ present: 1 }]);
    const state = await getBootstrapSetupState({
      bootstrapDatabase: port,
      now: () => NOW,
      hasPlatformOwner: async () => false,
    });

    expect(state).toEqual({ setupRequired: true });
    expect(Object.keys(state)).toEqual(['setupRequired']);
    expect(String(raw.mock.calls[0][0])).toContain('consumed_at IS NULL');
    expect(String(raw.mock.calls[0][0])).not.toContain('token_digest');
  });

  it('disables setup when no token, expired token, or consumed token exists', async () => {
    for (const rows of [[], [{ present: 1 }]]) {
      const { port } = database(rows);
      const hasPlatformOwner = rows.length
        ? async () => true
        : async () => false;
      const state = await getBootstrapSetupState({
        bootstrapDatabase: port,
        now: () => NOW,
        hasPlatformOwner,
      });
      expect(state).toEqual({ setupRequired: false });
    }

    const { port } = database([]);
    expect(await validBootstrapTokenExists({ bootstrapDatabase: port, now: () => NOW })).toBe(false);
  });

  it('fails closed on checker or database errors', async () => {
    const failingDatabase = {
      raw: vi.fn(async (_sql: string, _bindings: readonly unknown[]) => {
        throw new Error('db unavailable');
      }),
    };
    expect(await getBootstrapSetupState({ bootstrapDatabase: failingDatabase })).toEqual({
      setupRequired: false,
    });
    expect(await getBootstrapSetupState({
      bootstrapDatabase: database([{ present: 1 }]).port,
      hasPlatformOwner: async () => { throw new Error('checker unavailable'); },
    })).toEqual({ setupRequired: false });
  });

  it('keeps the public response stable and secret-free', () => {
    expect(PUBLIC_SETUP_STATE).toEqual({ setupRequired: false });
    expect(Object.isFrozen(PUBLIC_SETUP_STATE)).toBe(true);
    expect(JSON.stringify(PUBLIC_SETUP_STATE)).toBe('{"setupRequired":false}');
  });
});
