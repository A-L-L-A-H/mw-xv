import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isApiFatalLine,
  waitForApiReady,
} from './local-service-orchestrator.mjs';

test('waits until the API is ready without starting dependent services early', async () => {
  let calls = 0;
  const ready = await waitForApiReady({
    url: 'http://127.0.0.1:3000/readyz',
    fetchImpl: async () => {
      calls += 1;
      return { ok: calls >= 2 };
    },
    sleep: async () => {},
  });

  assert.equal(ready, true);
  assert.equal(calls, 2);
});

test('detects fatal API startup and migration output', () => {
  assert.equal(
    isApiFatalLine('[api] {"event":"api_startup_failure","context":{"code":"57014"}}'),
    true
  );
  assert.equal(isApiFatalLine('[api] Schema migration failed'), true);
  assert.equal(isApiFatalLine('[api] {"level":60,"msg":"Uncaught exception"}'), true);
  assert.equal(isApiFatalLine('[api] API server listening'), false);
});
