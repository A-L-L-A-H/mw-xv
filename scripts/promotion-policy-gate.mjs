import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const fullShaPattern = /^[a-f0-9]{40}$/u;

/**
 * Paths that only a human break-glass bootstrap may change. These are never
 * writable from an autonomous agent PR. The ruleset is the server-side
 * enforcement; this gate is the deterministic pre-merge check.
 */
export const GOVERNANCE_PATHS = [
  '.github/governance/',
  'scripts/github-rulesets.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/promotion-policy.yml',
  '.github/workflows/release-orchestrate.yml',
  '.gitleaks-baseline.json',
];

/** @param {string} eventName @param {any} payload @param {string} githubSha */
export function resolvePolicyContext(eventName, payload, githubSha) {
  if (eventName === 'pull_request') {
    const pullRequest = payload?.pull_request;
    return {
      event: eventName,
      headSha: pullRequest?.head?.sha,
      baseSha: pullRequest?.base?.sha,
      mergeSha: githubSha,
      headRepo: pullRequest?.head?.repo?.full_name,
      baseRepo: pullRequest?.base?.repo?.full_name,
      number: pullRequest?.number,
    };
  }
  if (eventName === 'merge_group') {
    const group = payload?.merge_group;
    return {
      event: eventName,
      headSha: group?.head_sha,
      baseSha: group?.base_sha,
      mergeSha: githubSha,
      headRepo: group?.head_repo?.full_name,
      baseRepo: group?.base_repo?.full_name,
    };
  }
  throw new Error(`Unsupported policy gate event: ${eventName || '(missing)'}.`);
}

/** Fail closed on any missing, malformed, cross-repository, or fork context. */
export function verifyPolicyContext(context, repository) {
  if (!context || !repository) throw new Error('Policy context and repository are required.');
  for (const key of ['headSha', 'baseSha', 'mergeSha']) {
    if (!fullShaPattern.test(context[key] ?? ''))
      throw new Error(`Policy context has an invalid ${key}.`);
  }
  if (context.headRepo !== repository || context.baseRepo !== repository)
    throw new Error('Policy gate only accepts same-repository heads and bases.');
  return {
    headSha: context.headSha,
    baseSha: context.baseSha,
    mergeSha: context.mergeSha,
    repository,
  };
}

/**
 * Reject path traversal, absolute paths, and changes to the governance plane
 * unless an explicit human break-glass attestation is provided.
 * @param {string[]} changedFiles
 */
export function verifyChangedPaths(changedFiles, { breakGlass = false } = {}) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0)
    throw new Error('Policy gate requires a non-empty exact diff scope.');
  const violations = [];
  for (const path of changedFiles) {
    if (
      typeof path !== 'string' ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').includes('..')
    )
      violations.push(`unsafe path: ${String(path)}`);
    if (
      !breakGlass &&
      GOVERNANCE_PATHS.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))
    )
      violations.push(`governance plane change requires break-glass: ${path}`);
  }
  if (violations.length > 0) throw new Error(violations.join('\n'));
  return changedFiles;
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  process.stderr.write(
    'This module is imported by promotion-policy.yml; it has no standalone CLI.\n'
  );
  process.exitCode = 1;
}
