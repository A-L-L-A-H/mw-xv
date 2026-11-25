#!/usr/bin/env node
// scripts/roadmap/gate-failure-issue.mjs
// Creates or updates a single "gate-failure" GitHub issue when CI gate jobs fail.
// Writes the issue number to dist/gate-failure/issue-number.txt for follow-up steps.
// Idempotent: one open issue per branch, updated with the latest failure.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const repo = process.env.GITHUB_REPOSITORY;
const gh = process.env.GH_TOKEN;
if (!repo || !gh) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required');

const failedJobs = process.env.FAILED_JOBS || 'unknown';
const runUrl = process.env.RUN_URL || '';
const commitSha = (process.env.COMMIT_SHA || '').slice(0, 12);
const branch = process.env.GITHUB_REF_NAME || 'unknown';

const GH = (...args) =>
  execFileSync('gh', args, {
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

const LABEL = 'gate-failure';
const marker = '<!-- gate-failure-triage:auto -->';

// Find existing open issue for this branch
let existing = null;
try {
  const out = GH(
    'issue', 'list', '--repo', repo,
    '--state', 'open',
    '--label', LABEL,
    '--search', `in:title "Gate failure: ${branch}"`,
    '--json', 'number,title',
  );
  const list = JSON.parse(out);
  if (list.length > 0) existing = list[0];
} catch {
  // listing failure should not block creation
}

const title = `Gate failure: ${branch}`;
const body = [
  marker,
  `CI gate jobs failed on branch \`${branch}\` at commit \`${commitSha}\`.`,
  '',
  '**Failed jobs:** ' + failedJobs,
  '',
  `[View run](${runUrl})`,
  '',
  '### What to do',
  '- If the failure is auto-fixable (lint, formatting, generated docs), run locally:',
  '  `bun run lint:ui -- --fix` or `bun run docs:generate` then commit the results.',
  '- If not auto-fixable, investigate the run logs above.',
  '',
  '_This issue is maintained by the `gate-failure-triage` CI job. It closes automatically when the gate passes._',
].join('\n');

let issueNumber;
if (existing) {
  issueNumber = existing.number;
  GH('issue', 'edit', String(issueNumber), '--repo', repo, '--body', body);
  console.log(`Updated existing gate-failure issue #${issueNumber}`);
} else {
  const out = GH(
    'issue', 'create', '--repo', repo,
    '--title', title,
    '--body', body,
    '--label', LABEL,
  );
  const m = out.match(/\/issues\/(\d+)/);
  issueNumber = m ? Number(m[1]) : null;
  console.log(`Created gate-failure issue #${issueNumber}`);
}

if (!issueNumber) throw new Error('Could not determine issue number');

mkdirSync('dist/gate-failure', { recursive: true });
writeFileSync('dist/gate-failure/issue-number.txt', String(issueNumber), 'utf8');

// Auto-close stale issues for failures that no longer reproduce:
// if a run succeeds and the issue body references an older commit, we leave it —
// explicit close happens in a separate success-path job to avoid racing with retries.
if (existsSync('dist/gate-failure/issue-number.txt')) {
  readFileSync('dist/gate-failure/issue-number.txt', 'utf8'); // sanity read
}
