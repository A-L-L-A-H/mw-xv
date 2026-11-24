/**
 * Deterministic, fail-closed decision layer for durable multi-agent execution
 * claims. Persistence belongs to the ORM/jobs layer (see the handoff plan in
 * docs/roadmap/AUTONOMOUS-DELIVERY-FOUNDATION.md); this module owns the
 * invariants that all callers must enforce before a write, push, merge, or
 * credential mint.
 */

const fullShaPattern = /^[a-f0-9]{40}$/u;
const boundedIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
export const TRAILER_KEYS = ['Task-Id', 'Agent-Id', 'Agent-Run-Id', 'Trace-Id', 'Base-Sha'];
export const ALLOWED_CREDENTIAL_SCOPES = ['contents:write', 'pull-requests:write', 'actions:write'];
export const MAX_CREDENTIAL_TTL_SECONDS = 900;

/**
 * Normalize workspace path prefixes. Rejects traversal, absolute paths,
 * Windows separators, null bytes and empty segments so no presentation can
 * escape its declared scope.
 * @param {unknown} paths
 */
export function normalizePathScope(paths) {
  if (!Array.isArray(paths) || paths.length === 0)
    throw new Error('A claim must declare at least one path prefix.');
  const normalized = paths.map((value) => {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0'))
      throw new Error('Path prefixes must be non-empty strings.');
    if (value.includes('\\')) throw new Error(`Path prefix uses a Windows separator: ${value}`);
    if (value.startsWith('/')) throw new Error(`Absolute path prefix is not allowed: ${value}`);
    if (value.split('/').includes('..')) throw new Error(`Path traversal is not allowed: ${value}`);
    const segments = value.split('/').filter((segment) => segment.length > 0 && segment !== '.');
    if (segments.length === 0) throw new Error(`Path prefix has no usable segment: ${value}`);
    return segments.join('/');
  });
  return [...new Set(normalized)].sort();
}

/** @param {string} path @param {string[]} prefixes */
export function pathInScope(path, prefixes) {
  if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || path.split('/').includes('..'))
    return false;
  const normalized = path.split('/').filter((segment) => segment.length > 0 && segment !== '.').join('/');
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

/**
 * @param {string[]} changedPaths
 * @param {string[]} prefixes
 */
export function detectScopeViolation(changedPaths, prefixes) {
  if (!Array.isArray(changedPaths)) return '(missing diff)';
  return changedPaths.find((path) => !pathInScope(path, prefixes)) ?? null;
}

/** @param {string[]} left @param {string[]} right */
export function scopesOverlap(left, right) {
  return left.some((a) => right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

/**
 * Deterministic workspace-lock decision. The winner is the lexicographically
 * smallest claim id, so a retry of the same race always reaches the same
 * conclusion and never grants two overlapping scopes.
 * @param {Array<{claimId:string,pathScope:string[]}>} activeClaims
 * @param {{claimId:string,pathScope:string[]}} requested
 */
export function resolvePathLock(activeClaims, requested) {
  if (!Array.isArray(activeClaims) || !requested?.claimId) return { granted: false, reason: 'invalid lock request' };
  const scope = normalizePathScope(requested.pathScope);
  const blockedBy = activeClaims
    .filter((claim) => claim?.claimId && claim.claimId !== requested.claimId)
    .filter((claim) => {
      try {
        return scopesOverlap(scope, normalizePathScope(claim.pathScope));
      } catch {
        return true;
      }
    })
    .map((claim) => claim.claimId)
    .sort();
  if (blockedBy.length === 0) return { granted: true, claimId: requested.claimId, pathScope: scope };
  const winner = [requested.claimId, ...blockedBy].sort()[0];
  return {
    granted: winner === requested.claimId,
    winner,
    blockedBy,
    reason: winner === requested.claimId ? 'lowest claim id wins the overlapping scope' : 'overlapping path scope is already claimed',
  };
}

/**
 * Validate a claim presentation. Every identity field is bound; failures are
 * returned rather than thrown so callers can log them without leaking tokens.
 * @param {any} presentation
 */
export function verifyClaimShape(presentation) {
  const problems = [];
  const requiredIds = {
    taskId: presentation?.taskId,
    agentId: presentation?.agentId,
    agentRunId: presentation?.agentRunId,
    traceId: presentation?.traceId,
    jobRunId: presentation?.jobRunId,
  };
  for (const [key, value] of Object.entries(requiredIds)) {
    if (typeof value !== 'string' || !boundedIdPattern.test(value)) problems.push(`invalid ${key}`);
  }
  if (!fullShaPattern.test(presentation?.baseSha ?? '')) problems.push('invalid baseSha');
  if (!Number.isSafeInteger(presentation?.fencingToken) || presentation.fencingToken < 0)
    problems.push('invalid fencingToken');
  if (!Number.isSafeInteger(presentation?.fleetEpoch) || presentation.fleetEpoch < 1)
    problems.push('invalid fleetEpoch');
  if (!Number.isFinite(presentation?.leaseExpiresAtMs) || presentation.leaseExpiresAtMs <= 0)
    problems.push('invalid leaseExpiresAtMs');
  let pathScope;
  try {
    pathScope = normalizePathScope(presentation?.pathScope);
  } catch (error) {
    problems.push(error.message);
  }
  return { valid: problems.length === 0, problems, pathScope };
}

/**
 * The core authorization decision. A claim is usable only when its identity
 * is well-formed, its fencing token and fleet epoch match the authoritative
 * durable state, the fleet is not paused, the lease is live, and its scope is
 * a subset of the authoritative grant.
 * @param {any} presentation
 * @param {any} authoritative
 * @param {number} nowMs
 */
export function verifyExecutionClaim(presentation, authoritative, nowMs = Date.now()) {
  const shape = verifyClaimShape(presentation);
  if (!shape.valid) return { allowed: false, reason: shape.problems.join('; ') };
  if (!authoritative || authoritative.paused === true)
    return { allowed: false, reason: 'fleet is paused' };
  if (authoritative.fleetEpoch !== presentation.fleetEpoch)
    return { allowed: false, reason: 'fleet epoch is stale' };
  if (!Number.isSafeInteger(authoritative.fencingToken))
    return { allowed: false, reason: 'authoritative fencing token is missing' };
  if (presentation.fencingToken < authoritative.fencingToken)
    return { allowed: false, reason: 'fencing token is stale' };
  if (
    presentation.taskId !== authoritative.taskId ||
    presentation.agentId !== authoritative.agentId ||
    presentation.agentRunId !== authoritative.agentRunId ||
    presentation.traceId !== authoritative.traceId
  )
    return { allowed: false, reason: 'claim identity does not match the durable claim' };
  if (presentation.leaseExpiresAtMs <= nowMs) return { allowed: false, reason: 'lease expired' };
  let granted;
  try {
    granted = normalizePathScope(authoritative.pathScope);
  } catch {
    return { allowed: false, reason: 'authoritative path scope is invalid' };
  }
  if (!shape.pathScope.every((prefix) => pathInScope(prefix, granted)))
    return { allowed: false, reason: 'claim scope exceeds the durable grant' };
  return { allowed: true, pathScope: shape.pathScope, claimId: authoritative.claimId };
}

/**
 * Short-lived, repository-scoped credentials are minted only after a valid
 * claim. Scope and TTL can never exceed the policy ceiling.
 */
export function authorizeCredentialMint(presentation, authoritative, policy, nowMs = Date.now()) {
  const claim = verifyExecutionClaim(presentation, authoritative, nowMs);
  if (!claim.allowed) return claim;
  if (!policy?.repository || typeof policy.repository !== 'string')
    return { allowed: false, reason: 'credential repository is missing' };
  if (!Array.isArray(policy.scopes) || policy.scopes.length === 0)
    return { allowed: false, reason: 'credential scopes are missing' };
  const unknown = policy.scopes.filter((scope) => !ALLOWED_CREDENTIAL_SCOPES.includes(scope));
  if (unknown.length > 0) return { allowed: false, reason: `disallowed credential scope: ${unknown.join(', ')}` };
  if (!Number.isSafeInteger(policy.ttlSeconds) || policy.ttlSeconds < 1 || policy.ttlSeconds > MAX_CREDENTIAL_TTL_SECONDS)
    return { allowed: false, reason: `credential TTL must be 1-${MAX_CREDENTIAL_TTL_SECONDS} seconds` };
  return { allowed: true, repository: policy.repository, scopes: [...policy.scopes], ttlSeconds: policy.ttlSeconds };
}

/** Parse Git trailers without trusting arbitrary header-like lines. */
export function extractTrailers(message) {
  const trailers = {};
  const lines = String(message ?? '').split(/\r?\n/u).reverse();
  for (const line of lines) {
    if (line.trim() === '') break;
    const match = /^([A-Za-z][A-Za-z-]{1,31}):\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (!(key in trailers)) trailers[key] = match[2];
  }
  return trailers;
}

/** @param {string} message @param {any} presentation */
export function verifyCommitTrailers(message, presentation) {
  const trailers = extractTrailers(message);
  const expected = {
    'task-id': presentation?.taskId,
    'agent-id': presentation?.agentId,
    'agent-run-id': presentation?.agentRunId,
    'trace-id': presentation?.traceId,
    'base-sha': presentation?.baseSha,
  };
  const mismatches = Object.entries(expected).filter(([key, value]) => trailers[key] !== value).map(([key]) => key);
  return mismatches.length === 0
    ? { valid: true }
    : { valid: false, reason: `missing or mismatched trailers: ${mismatches.join(', ')}` };
}

/** Re-verify an exact PR diff against the bound scope before any merge. */
export function verifyClaimedDiff(changedPaths, presentation, authoritative, nowMs = Date.now()) {
  const claim = verifyExecutionClaim(presentation, authoritative, nowMs);
  if (!claim.allowed) return claim;
  const violation = detectScopeViolation(changedPaths, claim.pathScope);
  if (violation) return { allowed: false, reason: `path outside claim scope: ${violation}` };
  return { allowed: true, pathScope: claim.pathScope };
}

/** Stale fencing must never be accepted, even if every other field is valid. */
export function compareFencing(presentedToken, authoritativeToken) {
  if (!Number.isSafeInteger(presentedToken) || !Number.isSafeInteger(authoritativeToken))
    return { acceptable: false, reason: 'fencing tokens must be safe integers' };
  if (presentedToken < authoritativeToken)
    return { acceptable: false, reason: 'fencing token is stale', required: authoritativeToken };
  return { acceptable: true, token: presentedToken };
}
