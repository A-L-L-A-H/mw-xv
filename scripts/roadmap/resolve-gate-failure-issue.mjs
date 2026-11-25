#!/usr/bin/env node
// scripts/roadmap/resolve-gate-failure-issue.mjs
// Closes the single open auto-heal issue for the current branch after exact-SHA
// `ci-gate` has already been verified by release-await-ci.mjs.

import { execFileSync } from 'node:child_process';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const sha = (process.env.EXPECTED_SHA || '').slice(0, 40);
const branch = process.env.GITHUB_REF_NAME || 'unknown';

if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required');
if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error('EXPECTED_SHA must be a full 40-character SHA');
if (!/^[A-Za-z0-9_./-]{1,128}$/u.test(branch)) throw new Error('Invalid branch name');

const GH_BIN = process.env.GH || 'gh';
const GH_PREFIX = process.env.GH_BIN_ARGS?.trim()
  ? process.env.GH_BIN_ARGS.trim().split(/\s+/u)
  : [];
const GH = (...args) =>
  execFileSync(GH_BIN, [...GH_PREFIX, ...args], {
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

const listed = GH(
  'issue', 'list', '--repo', repo,
  '--state', 'open',
  '--label', 'auto-heal',
  '--search', `in:title "Gate failure: ${branch}"`,
  '--json', 'number,title,body'
);
const issues = JSON.parse(listed);
const marker = '<!-- gate-failure-triage:auto -->';
const targets = issues.filter(
  (issue) => typeof issue.body === 'string' && issue.body.includes(marker)
);
if (targets.length > 1) throw new Error('Multiple auto-heal issues found; refusing ambiguous close');

for (const issue of targets) {
  const number = String(issue.number);
  GH('issue', 'edit', number, '--repo', repo, '--remove-label', 'auto-fix-requested,priority:P0');
  GH(
    'issue', 'close', number, '--repo', repo,
    '--comment',
    `Auto-healed: ci-gate is green for \`${sha}\`. Ratchet and required checks were not bypassed.`
  );
  console.log(`Closed auto-heal issue #${issue.number}`);
}
