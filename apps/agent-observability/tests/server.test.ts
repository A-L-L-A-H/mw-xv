import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, startObservabilityServer } from '../src/server.js';
import { tracePayload } from './fixtures.js';

const temporaryDirectories: string[] = [];

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-observability-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'nested', 'telemetry.sqlite');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('observability server persistence', () => {
  it('loads the SQLite path from the environment', () => {
    const config = loadConfig({ AGENT_OBSERVABILITY_DB_PATH: '/tmp/custom-observability.sqlite' });
    expect(config.databasePath).toBe('/tmp/custom-observability.sqlite');
  });

  it('refuses a non-loopback bind without an auth token', async () => {
    const config = loadConfig({ AGENT_OBSERVABILITY_HOST: '0.0.0.0' });
    expect(config.host).toBe('0.0.0.0');
    await expect(
      startObservabilityServer({
        host: config.host,
        databasePath: await databasePath(),
      })
    ).rejects.toThrow('AGENT_OBSERVABILITY_TOKEN is required');
  });

  it('keeps telemetry across receiver restarts', async () => {
    const filename = await databasePath();
    const first = await startObservabilityServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: filename,
    });
    const ingested = await first.app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: tracePayload(Date.now()),
    });
    expect(ingested.statusCode).toBe(200);
    expect((await first.app.inject('/api/summary')).json()).toMatchObject({
      traceCount: 1,
      spanCount: 2,
    });
    await first.app.close();

    const second = await startObservabilityServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: filename,
    });
    expect((await second.app.inject('/api/summary')).json()).toMatchObject({
      traceCount: 1,
      spanCount: 2,
      totalTokens: 1160,
    });
    await second.app.close();
  });
});
