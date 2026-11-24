import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const FLEET_STATE_REF = 'refs/heads/governance/fleet-state';
export const FLEET_STATE_FILE = 'fleet-state.json';
export const FLEET_ACTIONS = ['pause', 'resume'];

const boundedPattern = /^[A-Za-z0-9][A-Za-z0-9_.: -]{0,127}$/u;
const shaPattern = /^[a-f0-9]{40}$/u;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && !Array.isArray(value))
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function fleetStateHash(state) {
  const { hash: _hash, ...payload } = state ?? {};
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

export function createGenesisFleetState(nowMs = Date.now()) {
  const state = {
    schemaVersion: 1,
    paused: false,
    epoch: 1,
    reason: 'initial bootstrap',
    actor: 'bootstrap',
    updatedAt: new Date(nowMs).toISOString(),
    previousCommit: '0'.repeat(40),
  };
  return { ...state, hash: fleetStateHash(state) };
}

export function parseFleetState(text) {
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new Error('Fleet state is not valid JSON.');
  }
  const verdict = verifyFleetState(state);
  if (!verdict.valid) throw new Error(`Invalid fleet state: ${verdict.reason}`);
  return state;
}

export function verifyFleetState(state) {
  if (!state || state.schemaVersion !== 1) return { valid: false, reason: 'invalid schemaVersion' };
  if (typeof state.paused !== 'boolean') return { valid: false, reason: 'paused must be boolean' };
  if (!Number.isSafeInteger(state.epoch) || state.epoch < 1)
    return { valid: false, reason: 'epoch must be a positive safe integer' };
  if (typeof state.reason !== 'string' || !boundedPattern.test(state.reason))
    return { valid: false, reason: 'reason is missing or unsafe' };
  if (typeof state.actor !== 'string' || !boundedPattern.test(state.actor))
    return { valid: false, reason: 'actor is missing or unsafe' };
  if (Number.isNaN(Date.parse(state.updatedAt ?? '')))
    return { valid: false, reason: 'updatedAt must be an ISO timestamp' };
  if (!shaPattern.test(state.previousCommit ?? ''))
    return { valid: false, reason: 'previousCommit must be a full SHA' };
  if (state.hash !== fleetStateHash(state)) return { valid: false, reason: 'fleet state hash mismatch' };
  return { valid: true, epoch: state.epoch, paused: state.paused };
}

/**
 * Every transition bumps the epoch — including resume — so a lease, token, or
 * fencing credential issued under the old epoch can never come back to life.
 */
export function buildNextFleetState(state, action, { actor, reason, nowMs = Date.now() } = {}) {
  const verdict = verifyFleetState(state);
  if (!verdict.valid) throw new Error(`Refusing transition from invalid state: ${verdict.reason}`);
  if (!FLEET_ACTIONS.includes(action)) throw new Error(`Unknown fleet action: ${action}`);
  if (typeof actor !== 'string' || !boundedPattern.test(actor)) throw new Error('A bounded actor is required.');
  if (typeof reason !== 'string' || reason.length < 8 || !boundedPattern.test(reason))
    throw new Error('A bounded reason of at least 8 characters is required.');
  const next = {
    schemaVersion: 1,
    paused: action === 'pause',
    epoch: state.epoch + 1,
    reason,
    actor,
    updatedAt: new Date(nowMs).toISOString(),
    previousCommit: state.previousCommit,
  };
  return { ...next, hash: fleetStateHash(next) };
}

export function verifyFleetTransition(before, after, action) {
  if (!verifyFleetState(before).valid || !verifyFleetState(after).valid)
    return { valid: false, reason: 'invalid state on one side of the transition' };
  if (after.epoch !== before.epoch + 1)
    return { valid: false, reason: 'epoch must advance by exactly one' };
  if (after.paused !== (action === 'pause'))
    return { valid: false, reason: 'transition did not apply the requested pause state' };
  if (Date.parse(after.updatedAt) < Date.parse(before.updatedAt))
    return { valid: false, reason: 'transition timestamp moved backwards' };
  if (after.previousCommit !== before.previousCommit)
    return { valid: false, reason: 'transition rewrote the anchor commit' };
  return { valid: true, epoch: after.epoch };
}

/**
 * Mutation paths (claim, heartbeat, token mint, commit/push, promotion,
 * publication) call this before any external side effect.
 */
export function isMutationAllowed(state, presentation) {
  const verdict = verifyFleetState(state);
  if (!verdict.valid) return { allowed: false, reason: verdict.reason };
  if (state.paused) return { allowed: false, reason: 'fleet is paused' };
  if (!presentation || state.epoch !== presentation.fleetEpoch)
    return { allowed: false, reason: 'fleet epoch is stale' };
  return { allowed: true, epoch: state.epoch };
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  try {
    const [command, filePath, ...rest] = process.argv.slice(2);
    if (command === 'check') {
      const state = parseFleetState(await readFile(filePath, 'utf8'));
      const epoch = Number(rest[0]);
      const verdict = isMutationAllowed(state, { fleetEpoch: epoch });
      process.stdout.write(`${JSON.stringify(verdict)}\n`);
      if (!verdict.allowed) process.exitCode = 1;
    } else if (command === 'verify') {
      const state = parseFleetState(await readFile(filePath, 'utf8'));
      process.stdout.write(`${JSON.stringify(verifyFleetState(state))}\n`);
    } else if (command === 'next') {
      const [action, actor, reason] = rest;
      const state = parseFleetState(await readFile(filePath, 'utf8'));
      process.stdout.write(`${JSON.stringify(buildNextFleetState(state, action, { actor, reason }), null, 2)}\n`);
    } else {
      throw new Error('Usage: node scripts/fleet-state.mjs check|verify|next <state.json> [args]');
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
