#!/usr/bin/env node
// scripts/gitlab-report-to-github.mjs
// Reports GitLab pipeline status to the GitHub commit status API.
//
// Two auth modes (checked in order):
//   1. PAT:      GITHUB_STATUS_TOKEN (repo:status scope, minimal) — recommended
//   2. GitHub App: GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (PEM) — optional
// If neither is set, exits 0 without failing the pipeline.

import { execFileSync } from 'node:child_process';

// Configuration from CI/CD variables
const GITHUB_REPO = 'A-L-L-A-H/mw-xv';
const [GITHUB_OWNER, GITHUB_REPO_NAME] = GITHUB_REPO.split('/');

const GITHUB_STATUS_TOKEN = process.env.GITHUB_STATUS_TOKEN;
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY;

if (!GITHUB_STATUS_TOKEN && !(GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY)) {
  console.log('GitHub status credentials not set — skipping status report');
  process.exit(0);
}

// Get pipeline info from GitLab CI variables
const commitSha = process.env.CI_COMMIT_SHA;
const pipelineId = process.env.CI_PIPELINE_ID;
const pipelineUrl = process.env.CI_PIPELINE_URL;
const pipelineStatus = process.env.CI_JOB_STATUS || 'running';

if (!commitSha || !pipelineUrl) {
  console.error('Missing required CI variables');
  process.exit(1);
}

// Map GitLab status to GitHub status
const statusMap = {
  'success': 'success',
  'failed': 'failure',
  'canceled': 'failure',
  'running': 'pending',
  'pending': 'pending',
  'created': 'pending',
  'preparing': 'pending',
  'waiting_for_resource': 'pending',
  'manual': 'pending',
  'skipped': 'success',
};

const githubState = statusMap[pipelineStatus] || 'pending';
const description = `GitLab CI: ${pipelineStatus} (pipeline #${pipelineId})`;
const context = 'continuous-integration/gitlab';

// Create GitHub App JWT (only used in App mode)
function createJWT() {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600, // 10 minutes
    iss: GITHUB_APP_ID,
  };

  const base64url = (obj) => Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const signingInput = `${base64url(header)}.${base64url(payload)}`;

  // Sign with private key using openssl
  const signature = execFileSync('openssl', [
    'dgst', '-sha256', '-sign', '/dev/stdin',
  ], {
    input: Buffer.from(GITHUB_APP_PRIVATE_KEY, 'utf8'),
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  const signatureB64 = Buffer.from(signature)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signingInput}.${signatureB64}`;
}

// Exchange App JWT for an installation token
async function getInstallationToken(jwt) {
  const res = await fetch('https://api.github.com/app/installations', {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`list installations: ${res.status} ${await res.text()}`);
  const installations = await res.json();
  const installation = installations.find(
    (inst) => inst.account && inst.account.login.toLowerCase() === GITHUB_OWNER.toLowerCase(),
  );
  if (!installation) throw new Error(`No GitHub App installation for ${GITHUB_OWNER}`);

  const tokenRes = await fetch(installation.access_tokens_url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!tokenRes.ok) throw new Error(`installation token: ${tokenRes.status} ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();
  return tokenData.token;
}

// Post status to GitHub commit
async function postStatus(token) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/statuses/${commitSha}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        state: githubState,
        description,
        context,
        target_url: pipelineUrl,
      }),
    },
  );
  if (!res.ok) throw new Error(`create status: ${res.status} ${await res.text()}`);
  console.log(`Posted ${githubState} status to GitHub commit ${commitSha.slice(0, 7)}`);
}

async function main() {
  try {
    const token = GITHUB_STATUS_TOKEN || (await getInstallationToken(createJWT()));
    await postStatus(token);
  } catch (error) {
    console.error('Failed to report to GitHub:', error.message);
    // Don't fail the pipeline for reporting issues
  }
}

main();
