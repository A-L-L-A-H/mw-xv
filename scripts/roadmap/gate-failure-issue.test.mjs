import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.resolve('scripts/roadmap/gate-failure-issue.mjs');

function createFakeGh(log, existing = '[]') {
  const dir = mkdtempSync(path.join(tmpdir(), 'mw-gate-issue-'));
  const fake = path.join(dir, 'gh.cjs');
  const scriptSource = [
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');`,
    "if (args[0] === 'issue' && args[1] === 'list') {",
    `  process.stdout.write(${JSON.stringify(existing)});`,
    '} else {',
    `  process.stdout.write(${JSON.stringify('https://github.com/owner/repo/issues/4242\\n')});`,
    '}',
  ].join('\n');
  writeFileSync(fake, scriptSource, 'utf8');
  return { dir, fake };
}

function run(scriptPath, envOverrides, fakeGh) {
  execFileSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GH: process.execPath,
      GH_BIN_ARGS: fakeGh,
      GITHUB_REPOSITORY: 'owner/repo',
      GH_TOKEN: 'test-token',
      ...envOverrides,
    },
    encoding: 'utf8',
  });
}

test('gate failure issue uses one deduped root-cause marker and queues auto-fix', () => {
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'mw-gate-log-')), 'calls.log');
  const { fake } = createFakeGh(log);
  run(script, {
    FAILED_JOBS: 'quality-and-build, unit-tests',
    RUN_URL: 'https://github.com/owner/repo/actions/runs/99',
    COMMIT_SHA: 'abcdef1234567890',
    GITHUB_REF_NAME: 'dev',
    GITHUB_EVENT_NAME: 'push',
    PR_NUMBER: '123',
  }, fake);

  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /issue list .*--label auto-heal/u);
  assert.match(calls, /--label gate-failure,auto-fix-requested,auto-heal/u);
  assert.match(calls, /--title Gate failure: dev \[[a-f0-9]{12}\]/u);
  assert.equal(readFileSync('dist/gate-failure/issue-number.txt', 'utf8'), '4242');
  assert.match(readFileSync('dist/gate-failure/root-cause.txt', 'utf8'), /^[a-f0-9]{12}$/u);
});

test('repeated failure updates the existing auto-heal issue instead of opening a duplicate', () => {
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'mw-gate-log-')), 'calls.log');
  const existing = JSON.stringify([
    {
      number: 77,
      title: 'Gate failure: dev [old]',
      body: '<!-- gate-failure-triage:auto --> previous',
    },
  ]);
  const { fake } = createFakeGh(log, existing);
  run(script, {
    FAILED_JOBS: 'unit-tests',
    RUN_URL: 'https://github.com/owner/repo/actions/runs/100',
    COMMIT_SHA: '1234567890abcdef',
    GITHUB_REF_NAME: 'dev',
    GITHUB_EVENT_NAME: 'push',
  }, fake);

  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /issue edit 77/u);
  assert.doesNotMatch(calls, /issue create/u);
  assert.equal(readFileSync('dist/gate-failure/issue-number.txt', 'utf8'), '77');
});
