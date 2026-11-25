#!/usr/bin/env node
// scripts/roadmap/gate-failure-issue.mjs
// Creates or updates the single auto-heal issue for a failing CI gate.
// Idempotent: one open issue per branch, keyed by a root-cause marker.

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = process.env.GITHUB_REPOSITORY;
const gh = process.env.GH_TOKEN;
if (!repo || !gh) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required');

const failedJobs = process.env.FAILED_JOBS || 'unknown';
const runUrl = process.env.RUN_URL || '';
const commitSha = (process.env.COMMIT_SHA || '').slice(0, 12);
const branch = process.env.GITHUB_REF_NAME || 'unknown';
const eventName = process.env.GITHUB_EVENT_NAME || 'unknown';
const prNumber = process.env.PR_NUMBER || '';

const GH_BIN = process.env.GH || 'gh';
const GH_PREFIX = process.env.GH_BIN_ARGS?.trim() ? process.env.GH_BIN_ARGS.trim().split(/\s+/u) : [];
const GH = (...args) =>
  execFileSync(GH_BIN, [...GH_PREFIX, ...args], {
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

const LABELS = ['gate-failure', 'auto-fix-requested', 'auto-heal'];
const marker = '<!-- gate-failure-triage:auto -->';

function rootCauseHash() {
  return createHash('sha256')
    .update(JSON.stringify({ branch, eventName, failedJobs }))
    .digest('hex')
    .slice(0, 12);
}

function existingIssue() {
  try {
    const out = GH(
      'issue', 'list', '--repo', repo,
      '--state', 'open',
      '--label', 'auto-heal',
      '--search', `in:title "Gate failure: ${branch}"`,
      '--json', 'number,title,body',
    );
    const found = JSON.parse(out).find(
      (issue) => typeof issue.body === 'string' && issue.body.includes(marker)
    );
    return found ?? null;
  } catch {
    return null;
  }
}

const rootCause = rootCauseHash();
const title = `Gate failure: ${branch} [${rootCause}]`;
const body = [
  marker,
  `${marker}:root-cause=${rootCause}`,
  '',
  `Auto-heal queue item for branch \`${branch}\` at commit \`${commitSha}\`.`,
  '',
  '**Failed jobs:** ' + failedJobs,
  '',
  '**Event:** ' + eventName,
  '',
  ...(prNumber ? ['**Pull request:** #' + prNumber, ''] : []),
  `[View run](${runUrl})`,
  '',
  '### Auto-heal contract',
  '- This issue is owned by the AI fixer; no human review or approval is requested.',
  '- Fix the failing gate itself. Never relax a gate, disable a check, or bypass the ratchet.',
  '- Keep the change minimal, run the exact failing lane locally, push, then wait for exact-SHA CI.',
  '- On green `ci-gate`, the workflow closes this issue automatically.',
  '',
  '_This issue is maintained by the `gate-failure-triage` CI job._',
].join('\n');

let issueNumber;
const existing = existingIssue();
if (existing) {
  issueNumber = existing.number;
  GH('issue', 'edit', String(issueNumber), '--repo', repo, '--title', title, '--body', body);
  console.log(`Updated auto-heal issue #${issueNumber}`);
} else {
  const out = GH(
    'issue', 'create', '--repo', repo,
    '--title', title,
    '--body', body,
    '--label', LABELS.join(','),
  );
  const match = out.match(/\/issues\/(\d+)/);
  issueNumber = match ? Number(match[1]) : null;
  console.log(`Created auto-heal issue #${issueNumber}`);
}

if (!issueNumber) throw new Error('Could not determine issue number');
mkdirSync('dist/gate-failure', { recursive: true });
writeFileSync('dist/gate-failure/issue-number.txt', String(issueNumber), 'utf8');
writeFileSync('dist/gate-failure/root-cause.txt', rootCause, 'utf8');
