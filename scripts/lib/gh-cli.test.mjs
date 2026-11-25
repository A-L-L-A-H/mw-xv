import assert from 'node:assert/strict';
import test from 'node:test';
import { ghJson, runGh } from './gh-cli.mjs';

test('runGh executes gh with default encoding, maxBuffer, and process.env', async () => {
  let captured;
  const output = await runGh(['release', 'view', 'v1.0.0'], {
    exec: async (file, args, options) => {
      captured = { file, args, options };
      return { stdout: 'ok\n' };
    },
  });

  assert.equal(output, 'ok\n');
  assert.equal(captured.file, 'gh');
  assert.deepEqual(captured.args, ['release', 'view', 'v1.0.0']);
  assert.equal(captured.options.encoding, 'utf8');
  assert.equal(captured.options.maxBuffer, 16 * 1024 * 1024);
  assert.equal(captured.options.env, process.env);
  assert.equal('cwd' in captured.options, false);
});

test('runGh merges env overrides and forwards cwd and maxBuffer', async () => {
  let captured;
  await runGh(['api', 'user'], {
    cwd: '/tmp/repo',
    env: { GH_TOKEN: 'test-token' },
    maxBuffer: 32 * 1024 * 1024,
    exec: async (_file, _args, options) => {
      captured = options;
      return { stdout: '{}' };
    },
  });

  assert.equal(captured.cwd, '/tmp/repo');
  assert.equal(captured.maxBuffer, 32 * 1024 * 1024);
  assert.equal(captured.env.GH_TOKEN, 'test-token');
  assert.notEqual(captured.env, process.env);
});

test('runGh preserves raw errors by default, wraps with errorMessage, and supports allowFailure', async () => {
  const rawError = Object.assign(new Error('Command failed'), {
    code: 1,
    stderr: 'HTTP 404 Not Found',
  });
  const failingExec = async () => {
    throw rawError;
  };

  await assert.rejects(
    runGh(['api', 'repos/o/r'], { exec: failingExec }),
    (error) => error === rawError && error.code === 1 && error.stderr === 'HTTP 404 Not Found'
  );

  await assert.rejects(
    runGh(['release', 'upload'], {
      exec: failingExec,
      errorMessage: 'GitHub CLI release operation failed',
    }),
    (error) => error.message === 'GitHub CLI release operation failed' && error.cause === rawError
  );

  const allowed = await runGh(['api', 'repos/o/r'], {
    exec: failingExec,
    allowFailure: true,
  });
  assert.equal(allowed, null);
});

test('runGh and ghJson reject non-array or non-string arguments', async () => {
  await assert.rejects(runGh('status'), TypeError);
  await assert.rejects(runGh(['api', 123]), TypeError);
  await assert.rejects(ghJson(null), TypeError);
  await assert.rejects(
    ghJson(['pr', 'list'], { api: false, paginate: true }),
    /requires api mode/u
  );
});

test('ghJson prepends api and optional pagination flags, and parses JSON', async () => {
  const calls = [];
  const exec = async (_file, args) => {
    calls.push(args);
    return { stdout: JSON.stringify([{ id: 1 }]) };
  };

  const single = await ghJson(['repos/o/r/rulesets'], { exec });
  assert.deepEqual(single, [{ id: 1 }]);

  const paginated = await ghJson(['repos/o/r/releases?per_page=100'], { exec, paginate: true });
  assert.deepEqual(paginated, [{ id: 1 }]);

  const rawSubcommand = await ghJson(['pr', 'list', '--json', 'number'], { exec, api: false });
  assert.deepEqual(rawSubcommand, [{ id: 1 }]);

  assert.deepEqual(calls, [
    ['api', 'repos/o/r/rulesets'],
    ['api', '--paginate', '--slurp', 'repos/o/r/releases?per_page=100'],
    ['pr', 'list', '--json', 'number'],
  ]);
});

test('ghJson handles allowFailure and invalid JSON error wrapping', async () => {
  const failed = await ghJson(['repos/o/r'], {
    allowFailure: true,
    exec: async () => {
      throw new Error('gh failed');
    },
  });
  assert.equal(failed, null);

  await assert.rejects(
    ghJson(['repos/o/r'], {
      exec: async () => ({ stdout: 'not-json' }),
    }),
    SyntaxError
  );

  await assert.rejects(
    ghJson(['repos/o/r'], {
      jsonErrorMessage: 'GitHub CLI returned invalid JSON',
      exec: async () => ({ stdout: 'not-json' }),
    }),
    (error) =>
      error.message === 'GitHub CLI returned invalid JSON' && error.cause instanceof SyntaxError
  );
});
