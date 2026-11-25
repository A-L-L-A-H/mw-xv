#!/usr/bin/env node
// scripts/gitlab-report-to-github.mjs
// Reports GitLab pipeline status to GitHub commit via GitHub App installation token.
// Reads GitHub App credentials from CI/CD variables: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

// Configuration from CI/CD variables
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY;
const GITHUB_REPO = 'A-L-L-A-H/mw-xv'; // or detect from CI_PROJECT_URL

if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
  console.log('GitHub App credentials not set — skipping status report');
  process.exit(0);
}

// Get pipeline info from GitLab CI variables
const commitSha = process.env.CI_COMMIT_SHA;
const pipelineId = process.env.CI_PIPELINE_ID;
const pipelineUrl = process.env.CI_PIPELINE_URL;
const pipelineStatus = process.env.CI_JOB_STATUS || 'running';
const branch = process.env.CI_COMMIT_REF_NAME;

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

// Create GitHub App JWT
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

// Get installation token
async function getInstallationToken(jwt) {
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: jwt });

  // Get installation ID for the repo owner
  const { data: installations } = await octokit.apps.listInstallations();
  const installation = installations.find(inst =>
    inst.account.login.toLowerCase() === GITHUB_REPO.split('/')[0].toLowerCase()
  );

  if (!installation) {
    throw new Error(`No GitHub App installation found for ${GITHUB_REPO.split('/')[0]}`);
  }

  // Create installation access token
  const { data: tokenData } = await octokit.apps.createInstallationAccessToken({
    installation_id: installation.id,
    repository_ids: [/* repo ID - we'd need to fetch it */],
  });

  return tokenData.token;
}

// Post status to GitHub
async function postStatus(token) {
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: token });

  await octokit.repos.createCommitStatus({
    owner: GITHUB_REPO.split('/')[0],
    repo: GITHUB_REPO.split('/')[1],
    sha: commitSha,
    state: githubState,
    description,
    context,
    target_url: pipelineUrl,
  });

  console.log(`Posted ${githubState} status to GitHub commit ${commitSha.slice(0, 7)}`);
}

async function main() {
  try {
    const jwt = createJWT();
    const token = await getInstallationToken(jwt);
    await postStatus(token);
  } catch (error) {
    console.error('Failed to report to GitHub:', error.message);
    // Don't fail the pipeline for reporting issues
  }
}

main();