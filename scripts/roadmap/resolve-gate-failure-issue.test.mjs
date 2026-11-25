import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.resolve('scripts/roadmap/resolve-gate-failure-issue.mjs');

function createFakeGh(log, existing) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mw-gate-resolve-'));
  const fake = path.join(dir, 'gh.cjs');
  writeFileSync(
    fake,
    [
      "const fs = require('node:fs');",
      'const args = process.argv.slice(2);',
      `fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');`,
      `process.stdout.write(${JSON.stringify(existing)});`,
    ].join('\n'),
    'utf8'
  );
  return fake;
}

test('resolve closes every marked auto-heal issue on exact-SHA green', () => {
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'mw-gate-resolve-log-')), 'calls.log');
  const existing = JSON.stringify([
    { number: 9, title: 'Gate failure: dev [a]', body: '<!-- gate-failure-triage:auto -->' },
    { number: 10, title: 'Gate failure: dev [b]', body: 'unrelated issue' },
    { number: 11, title: 'Gate failure: 330/merge [c]', body: '<!-- gate-failure-triage:auto -->' },
  ]);
  const fake = createFakeGh(log, existing);

  execFileSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GH: process.execPath,
      GH_BIN_ARGS: fake,
      GITHUB_REPOSITORY: 'owner/repo',
      GH_TOKEN: 'test-token',
      EXPECTED_SHA: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      GITHUB_REF_NAME: 'dev',
    },
    encoding: 'utf8',
  });

  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /issue edit 9 --repo owner\/repo --remove-label auto-fix-requested,priority:p0/u);
  assert.match(calls, /issue close 9 --repo owner\/repo/u);
  assert.match(calls, /issue close 11 --repo owner\/repo/u);
  assert.match(calls, /abcdefabcdefabcdefabcdefabcdefabcdefabcd/u);
  assert.doesNotMatch(calls, /issue close 10/u);
});
