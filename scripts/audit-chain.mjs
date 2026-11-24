import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const GENESIS = '0'.repeat(64);
const fullShaPattern = /^[a-f0-9]{40}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const secretKeyPattern = /pass(word)?|secret|token|api[_-]?key|credential|authorization|cookie|private[_-]?key/iu;

export const AUDIT_STAGES = [
  'task',
  'agent',
  'run',
  'commit',
  'pr',
  'ci',
  'artifact',
  'tag',
  'release',
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && !Array.isArray(value))
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** Deterministic payload hash independent of key insertion order. */
export function hashEvent(event) {
  return createHash('sha256').update(canonical(event)).digest('hex');
}

export function createGenesisCheckpoint() {
  return { schemaVersion: 1, headHash: GENESIS, sequence: 0, events: [] };
}

/** Redact common secret fields before an event enters the append-only chain. */
export function redactEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event))
    throw new Error('Audit event must be an object.');
  const clean = {};
  for (const [key, value] of Object.entries(event)) {
    if (secretKeyPattern.test(key)) continue;
    if (typeof value === 'string' && value.length > 0 && /bearer\s+\S+|ghp_[A-Za-z0-9]+/iu.test(value)) {
      clean[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = redactEvent(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Append one event. The chain hash binds the previous head, the sequence, and
 * the canonical event so any reordering, deletion, or edit is detectable.
 */
export function appendEvent(checkpoint, event) {
  const previous = checkpoint ?? createGenesisCheckpoint();
  if (!hashPattern.test(previous.headHash ?? ''))
    throw new Error('Checkpoint has an invalid head hash.');
  const clean = redactEvent(event);
  const sequence = previous.sequence + 1;
  const record = {
    sequence,
    previousHash: previous.headHash,
    event: clean,
    hash: hashEvent({ sequence, previousHash: previous.headHash, event: clean }),
  };
  return {
    schemaVersion: 1,
    headHash: record.hash,
    sequence,
    events: [...previous.events, record],
  };
}

/** Verify continuity, uniqueness, ordering and per-record hashes. */
export function verifyChain(checkpoint) {
  if (!checkpoint || checkpoint.schemaVersion !== 1 || !Array.isArray(checkpoint.events))
    return { valid: false, reason: 'invalid checkpoint schema' };
  let expectedHash = GENESIS;
  const seen = new Set();
  for (const [index, record] of checkpoint.events.entries()) {
    if (record.sequence !== index + 1) return { valid: false, reason: `sequence gap at ${index}` };
    if (record.previousHash !== expectedHash) return { valid: false, reason: `hash gap at ${record.sequence}` };
    if (!hashPattern.test(record.hash ?? '')) return { valid: false, reason: `invalid hash at ${record.sequence}` };
    const recomputed = hashEvent({
      sequence: record.sequence,
      previousHash: record.previousHash,
      event: record.event,
    });
    if (recomputed !== record.hash) return { valid: false, reason: `event tampered at ${record.sequence}` };
    try {
      const identity = canonical(record.event);
      if (seen.has(identity)) return { valid: false, reason: `duplicate event at ${record.sequence}` };
      seen.add(identity);
    } catch {
      return { valid: false, reason: `unserializable event at ${record.sequence}` };
    }
    expectedHash = record.hash;
  }
  if (checkpoint.headHash !== expectedHash || checkpoint.sequence !== checkpoint.events.length)
    return { valid: false, reason: 'checkpoint head does not match its events' };
  return { valid: true, headHash: expectedHash, sequence: checkpoint.events.length };
}

/**
 * Deterministically merge two checkpoints that share a prefix. A fork (two
 * different events at the same sequence) is a conflict and fails closed.
 */
export function mergeCheckpoints(left, right) {
  const leftChain = verifyChain(left);
  const rightChain = verifyChain(right);
  if (!leftChain.valid || !rightChain.valid) throw new Error('Cannot merge an invalid checkpoint.');
  const common = Math.min(left.sequence, right.sequence);
  for (let index = 0; index < common; index += 1) {
    if (left.events[index].hash !== right.events[index].hash)
      throw new Error(`Audit fork at sequence ${index + 1}; refusing to merge.`);
  }
  const base = left.sequence >= right.sequence ? left : right;
  const extra = (left.sequence >= right.sequence ? right : left).events.slice(common);
  return extra.reduce((checkpoint, record) => appendEvent(checkpoint, record.event), base);
}

/**
 * Project the stages required by the governance plan. Missing stages are
 * reported, never invented, so an incomplete trail cannot claim acceptance.
 */
export function projectCorrelation(events) {
  const seen = new Map();
  for (const record of Array.isArray(events) ? events : []) {
    const stage = record?.event?.stage ?? record?.stage;
    if (AUDIT_STAGES.includes(stage)) seen.set(stage, { sequence: record?.sequence, ref: record?.event?.ref });
  }
  const stages = AUDIT_STAGES.map((stage) => ({
    stage,
    present: seen.has(stage),
    ...(seen.get(stage) ?? {}),
  }));
  return {
    complete: stages.every((entry) => entry.present),
    missing: stages.filter((entry) => !entry.present).map((entry) => entry.stage),
    stages,
  };
}

/** Verify an event carries the exact claim linkage required for attribution. */
export function verifyEventLinkage(event) {
  const payload = event?.event ?? event;
  const required = ['taskId', 'agentId', 'agentRunId', 'traceId'];
  const missing = required.filter((key) => typeof payload?.[key] !== 'string' || payload[key].length === 0);
  const commitSha = payload?.commitSha ?? payload?.ref;
  if (payload?.stage === 'commit' && !fullShaPattern.test(commitSha ?? '')) missing.push('commitSha');
  return missing.length === 0 ? { valid: true } : { valid: false, reason: `missing linkage: ${missing.join(', ')}` };
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  try {
    const [command, filePath] = process.argv.slice(2);
    if (command !== 'verify' || !filePath) throw new Error('Usage: node scripts/audit-chain.mjs verify <checkpoint.json>');
    const checkpoint = JSON.parse(await readFile(filePath, 'utf8'));
    const verdict = verifyChain(checkpoint);
    process.stdout.write(`${JSON.stringify({ ...verdict, correlation: projectCorrelation(checkpoint.events) }, null, 2)}\n`);
    if (!verdict.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
