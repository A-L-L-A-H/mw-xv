import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { defineModel, fields } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';
import { modelRef } from './models/helpers.js';

export const COGNITIVE_TRACE_SCHEMA_VERSION = '1.0.0';

export type CognitiveTraceKind =
  | 'non_rem_consolidation_report'
  | 'active_inference_decision'
  | 'merkle_transparency_leaf'
  | 'epistemic_calibration_report'
  | 'incident_healing_proposal';

export interface CognitiveTraceEnvelope {
  readonly schemaVersion: string;
  readonly traceKind: CognitiveTraceKind;
  readonly companyId: string;
  readonly traceId: string;
  readonly createdAtIso: string;
  readonly payload: unknown;
  readonly payloadSha256: string;
  readonly envelopeSha256: string;
  readonly previousEnvelopeHash?: string;
}

export interface StoredCognitiveTrace {
  readonly id: number;
  readonly company_id: number;
  readonly trace_kind: string;
  readonly trace_id: string;
  readonly envelope_json: string;
  readonly envelope_sha256: string;
  readonly payload_sha256: string;
  readonly previous_envelope_hash: string | null;
  readonly merkle_leaf_hash: string;
  readonly merkle_tree_root: string;
  readonly merkle_tree_size: number;
  readonly created_at: string;
}

const RFC6962_LEAF_DOMAIN_PREFIX = 0x00;
const RFC6962_NODE_DOMAIN_PREFIX = 0x01;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/iu;

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        sorted[key] = canonicalizeValue(entry);
      }
    }
    return sorted;
  }
  return value;
}

function toCanonicalJson(payload: unknown): string {
  const normalized = canonicalizeValue(payload);
  const serialized = JSON.stringify(normalized);
  return serialized === undefined ? 'null' : serialized;
}

function sha256Canonical(payload: unknown): string {
  return createHash('sha256').update(toCanonicalJson(payload), 'utf8').digest('hex');
}

function emptyTreeHash(): string {
  return createHash('sha256').update(Buffer.alloc(0)).digest('hex');
}

function largestPowerOfTwoLessThan(n: number): number {
  let k = 1;
  while (k * 2 < n) {
    k *= 2;
  }
  return k;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function hashMerkleLeaf(payload: unknown): string {
  const canonicalJson = toCanonicalJson(payload);
  const input = Buffer.concat([
    Buffer.from([RFC6962_LEAF_DOMAIN_PREFIX]),
    Buffer.from(canonicalJson, 'utf8'),
  ]);
  return createHash('sha256').update(input).digest('hex');
}

export function hashMerkleNode(leftHex: string, rightHex: string): string {
  if (!SHA256_HEX_PATTERN.test(leftHex) || !SHA256_HEX_PATTERN.test(rightHex)) {
    throw new Error('hashMerkleNode requires 64-character hexadecimal SHA-256 digests');
  }
  const input = Buffer.concat([
    Buffer.from([RFC6962_NODE_DOMAIN_PREFIX]),
    Buffer.from(leftHex, 'hex'),
    Buffer.from(rightHex, 'hex'),
  ]);
  return createHash('sha256').update(input).digest('hex');
}

function computeMerkleTreeHash(leafHashes: readonly string[]): string {
  const count = leafHashes.length;
  if (count === 0) {
    return emptyTreeHash();
  }
  if (count === 1) {
    return leafHashes[0]!;
  }
  const split = largestPowerOfTwoLessThan(count);
  const left = computeMerkleTreeHash(leafHashes.slice(0, split));
  const right = computeMerkleTreeHash(leafHashes.slice(split));
  return hashMerkleNode(left, right);
}

function computeAuditPath(
  leafHashes: readonly string[],
  leafIndex: number
): readonly { readonly hash: string; readonly position: 'left' | 'right' }[] {
  const count = leafHashes.length;
  if (count <= 1) {
    return [];
  }
  const split = largestPowerOfTwoLessThan(count);
  if (leafIndex < split) {
    const subPath = computeAuditPath(leafHashes.slice(0, split), leafIndex);
    const siblingHash = computeMerkleTreeHash(leafHashes.slice(split));
    return [...subPath, { hash: siblingHash, position: 'right' }];
  }
  const subPath = computeAuditPath(leafHashes.slice(split), leafIndex - split);
  const siblingHash = computeMerkleTreeHash(leafHashes.slice(0, split));
  return [...subPath, { hash: siblingHash, position: 'left' }];
}

function computeConsistencySubproof(
  m: number,
  leafHashes: readonly string[],
  isCompleteSubtree: boolean
): string[] {
  const n = leafHashes.length;
  if (m === n) {
    if (isCompleteSubtree) {
      return [];
    }
    return [computeMerkleTreeHash(leafHashes)];
  }
  const split = largestPowerOfTwoLessThan(n);
  if (m <= split) {
    const sub = computeConsistencySubproof(m, leafHashes.slice(0, split), isCompleteSubtree);
    return [...sub, computeMerkleTreeHash(leafHashes.slice(split))];
  }
  const sub = computeConsistencySubproof(m - split, leafHashes.slice(split), false);
  return [...sub, computeMerkleTreeHash(leafHashes.slice(0, split))];
}

function verifyConsistencyProofHashes(
  olderSize: number,
  newerSize: number,
  olderRootHash: string,
  newerRootHash: string,
  proof: readonly string[]
): boolean {
  if (olderSize === 0) {
    return proof.length === 0;
  }
  if (olderSize === newerSize) {
    return proof.length === 0 && olderRootHash === newerRootHash;
  }
  if (olderSize > newerSize || proof.length === 0) {
    return false;
  }

  const nodes = isPowerOfTwo(olderSize) ? [olderRootHash, ...proof] : [...proof];
  let fn = olderSize - 1;
  let sn = newerSize - 1;

  while ((fn & 1) === 1) {
    fn >>= 1;
    sn >>= 1;
  }

  let fr = nodes[0]!;
  let sr = nodes[0]!;

  for (let i = 1; i < nodes.length; i += 1) {
    const sibling = nodes[i]!;
    if (sn === 0) {
      return false;
    }
    if ((fn & 1) === 1 || fn === sn) {
      fr = hashMerkleNode(sibling, fr);
      sr = hashMerkleNode(sibling, sr);
      while (fn !== 0 && (fn & 1) === 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      sr = hashMerkleNode(sr, sibling);
    }
    fn >>= 1;
    sn >>= 1;
  }

  return sn === 0 && fr === olderRootHash && sr === newerRootHash;
}

export interface MerkleAuditTree {
  readonly leafCount: number;
  readonly rootHash: string;
  readonly leafHashes: readonly string[];
  readonly redactedEvents: readonly unknown[];
  readonly rfc6962DomainSeparated: true;
  readonly automatedSelfAccept: false;
  readonly automatedPromotionAllowed: false;
  readonly treeSha256: string;
}

export interface MerkleInclusionProof {
  readonly leafIndex: number;
  readonly treeSize: number;
  readonly leafHash: string;
  readonly rootHash: string;
  readonly auditPath: readonly { readonly hash: string; readonly position: 'left' | 'right' }[];
  readonly automatedSelfAccept: false;
  readonly automatedPromotionAllowed: false;
  readonly proofSha256: string;
}

export interface MerkleInclusionVerificationResult {
  readonly valid: boolean;
  readonly leafHash: string;
  readonly computedRootHash: string;
  readonly expectedRootHash: string;
  readonly reason?: string;
}

export interface MerkleConsistencyResult {
  readonly consistent: boolean;
  readonly olderTreeSize: number;
  readonly newerTreeSize: number;
  readonly olderRootHash: string;
  readonly newerRootHash: string;
  readonly consistencyProof: readonly string[];
  readonly proofHashCount: number;
  readonly automatedSelfAccept: false;
  readonly automatedPromotionAllowed: false;
  readonly verificationSha256: string;
  readonly reason?: string;
}

function buildMerkleAuditTreeFromHashes(leafHashes: string[], leafCount: number): MerkleAuditTree {
  const rootHash = computeMerkleTreeHash(leafHashes);
  const core = {
    leafCount,
    rootHash,
    leafHashes,
    rfc6962DomainSeparated: true as const,
    automatedSelfAccept: false as const,
    automatedPromotionAllowed: false as const,
  };
  return {
    ...core,
    redactedEvents: [],
    treeSha256: sha256Canonical(core),
  };
}

function generateMerkleInclusionProof(
  tree: MerkleAuditTree,
  leafIndex: number
): MerkleInclusionProof {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new RangeError(
      `leafIndex ${String(leafIndex)} is out of bounds for tree size ${String(tree.leafCount)}`
    );
  }
  const auditPath = computeAuditPath(tree.leafHashes, leafIndex);
  const leafHash = tree.leafHashes[leafIndex]!;
  const core = {
    leafIndex,
    treeSize: tree.leafCount,
    leafHash,
    rootHash: tree.rootHash,
    auditPath,
    automatedSelfAccept: false as const,
    automatedPromotionAllowed: false as const,
  };
  return {
    ...core,
    proofSha256: sha256Canonical(core),
  };
}

function verifyMerkleInclusionProof(
  leafPayload: unknown,
  proof: MerkleInclusionProof,
  expectedRootHash: string
): MerkleInclusionVerificationResult {
  const leafHash = hashMerkleLeaf(leafPayload);

  if (!SHA256_HEX_PATTERN.test(expectedRootHash)) {
    return {
      valid: false,
      leafHash,
      computedRootHash: '',
      expectedRootHash,
      reason: 'INVALID_EXPECTED_ROOT_HASH',
    };
  }

  if (proof.leafIndex < 0 || proof.leafIndex >= proof.treeSize) {
    return {
      valid: false,
      leafHash,
      computedRootHash: '',
      expectedRootHash,
      reason: 'LEAF_INDEX_OUT_OF_BOUNDS',
    };
  }

  let currentHash = leafHash;
  for (const step of proof.auditPath) {
    if (!SHA256_HEX_PATTERN.test(step.hash)) {
      return {
        valid: false,
        leafHash,
        computedRootHash: '',
        expectedRootHash,
        reason: 'INVALID_AUDIT_PATH_HASH',
      };
    }
    currentHash =
      step.position === 'left'
        ? hashMerkleNode(step.hash, currentHash)
        : hashMerkleNode(currentHash, step.hash);
  }

  const valid = currentHash === expectedRootHash && leafHash === proof.leafHash;
  return {
    valid,
    leafHash,
    computedRootHash: currentHash,
    expectedRootHash,
    ...(valid ? {} : { reason: 'MERKLE_ROOT_MISMATCH' }),
  };
}

const CognitiveTrace = defineModel('ai.cognitive_trace', {
  table: 'ai_cognitive_traces',
  order: 'created_at asc, id asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    trace_kind: fields.string({ required: true }),
    trace_id: fields.string({ required: true }),
    envelope_json: fields.text({ required: true }),
    envelope_sha256: fields.string({ required: true }),
    payload_sha256: fields.string({ required: true }),
    previous_envelope_hash: fields.string({}),
    merkle_leaf_hash: fields.string({ required: true }),
    merkle_tree_root: fields.string({ required: true }),
    merkle_tree_size: fields.integer({ required: true }),
    created_at: fields.string({ required: true }),
  },
});

function toStoredTrace(row: Record<string, unknown>): StoredCognitiveTrace {
  return {
    id: Number(row.id),
    company_id: Number(row.company_id),
    trace_kind: String(row.trace_kind),
    trace_id: String(row.trace_id),
    envelope_json: String(row.envelope_json),
    envelope_sha256: String(row.envelope_sha256),
    payload_sha256: String(row.payload_sha256),
    previous_envelope_hash:
      row.previous_envelope_hash === null ? null : String(row.previous_envelope_hash),
    merkle_leaf_hash: String(row.merkle_leaf_hash),
    merkle_tree_root: String(row.merkle_tree_root),
    merkle_tree_size: Number(row.merkle_tree_size),
    created_at: String(row.created_at),
  };
}

function computeEnvelopeLeafHash(envelope: CognitiveTraceEnvelope): string {
  return hashMerkleLeaf({
    schemaVersion: envelope.schemaVersion,
    traceKind: envelope.traceKind,
    companyId: envelope.companyId,
    traceId: envelope.traceId,
    createdAtIso: envelope.createdAtIso,
    payload: envelope.payload,
    payloadSha256: envelope.payloadSha256,
    envelopeSha256: envelope.envelopeSha256,
    previousEnvelopeHash: envelope.previousEnvelopeHash,
  });
}

function computeEnvelopeSha256(envelope: Omit<CognitiveTraceEnvelope, 'envelopeSha256'>): string {
  return sha256Canonical(envelope);
}

function serializeCognitiveTrace(options: {
  traceKind: CognitiveTraceKind;
  companyId: string;
  traceId: string;
  createdAtIso: string;
  payload: unknown;
}): {
  schemaVersion: string;
  traceKind: CognitiveTraceKind;
  companyId: string;
  traceId: string;
  createdAtIso: string;
  payloadSha256: string;
  envelopeSha256: string;
} {
  const payloadSha256 = sha256Canonical(options.payload);
  const envelope: Omit<CognitiveTraceEnvelope, 'envelopeSha256'> = {
    schemaVersion: COGNITIVE_TRACE_SCHEMA_VERSION,
    traceKind: options.traceKind,
    companyId: options.companyId,
    traceId: options.traceId,
    createdAtIso: options.createdAtIso,
    payload: options.payload,
    payloadSha256,
    previousEnvelopeHash: undefined,
  };
  const envelopeSha256 = computeEnvelopeSha256(envelope);
  return { ...envelope, envelopeSha256 };
}

export interface AppendTraceOptions<K extends CognitiveTraceKind = CognitiveTraceKind> {
  readonly traceKind: K;
  readonly companyId: number;
  readonly traceId: string;
  readonly payload: unknown;
  readonly createdAtIso?: string;
}

export interface AppendTraceResult {
  readonly trace: StoredCognitiveTrace;
  readonly merkleTree: MerkleAuditTree;
  readonly inclusionProof: MerkleInclusionProof;
}

export async function appendCognitiveTrace<K extends CognitiveTraceKind>(
  db: Knex,
  options: AppendTraceOptions<K>
): Promise<AppendTraceResult> {
  const createdAtIso = options.createdAtIso ?? new Date().toISOString();

  const latest = await db('ai_cognitive_traces')
    .where({ company_id: options.companyId })
    .orderBy('id', 'desc')
    .first(['envelope_sha256', 'merkle_tree_root', 'merkle_tree_size']);

  const previousEnvelopeHash = latest?.envelope_sha256 ?? null;
  const currentTreeSize = Number(latest?.merkle_tree_size ?? 0);
  const currentTreeRoot = latest?.merkle_tree_root ?? emptyTreeHash();

  const serialized = serializeCognitiveTrace({
    traceKind: options.traceKind,
    companyId: String(options.companyId),
    traceId: options.traceId,
    createdAtIso,
    payload: options.payload,
  });

  const envelope: CognitiveTraceEnvelope = {
    schemaVersion: serialized.schemaVersion,
    traceKind: serialized.traceKind,
    companyId: serialized.companyId,
    traceId: serialized.traceId,
    createdAtIso: serialized.createdAtIso,
    payload: options.payload,
    payloadSha256: serialized.payloadSha256,
    envelopeSha256: serialized.envelopeSha256,
    previousEnvelopeHash: previousEnvelopeHash ?? undefined,
  };

  const leafHash = computeEnvelopeLeafHash(envelope);

  const newLeafHashes = [...(await getLeafHashes(db, options.companyId)), leafHash];
  const newTreeRoot = computeMerkleTreeHash(newLeafHashes);
  const newTreeSize = newLeafHashes.length;

  const [inserted] = await db('ai_cognitive_traces').insert(
    {
      company_id: options.companyId,
      trace_kind: options.traceKind,
      trace_id: options.traceId,
      envelope_json: JSON.stringify(envelope),
      envelope_sha256: envelope.envelopeSha256,
      payload_sha256: envelope.payloadSha256,
      previous_envelope_hash: previousEnvelopeHash,
      merkle_leaf_hash: leafHash,
      merkle_tree_root: newTreeRoot,
      merkle_tree_size: newTreeSize,
      created_at: createdAtIso,
    },
    'id'
  );

  const traceRow = await db('ai_cognitive_traces').where({ id: inserted }).first();
  const trace = toStoredTrace(traceRow!);

  const tree = buildMerkleAuditTreeFromHashes(newLeafHashes, newTreeSize);
  const inclusionProof = generateMerkleInclusionProof(tree, newTreeSize - 1);

  return { trace, merkleTree: tree, inclusionProof };
}

async function getLeafHashes(db: Knex, companyId: number): Promise<string[]> {
  const rows = await db('ai_cognitive_traces')
    .where({ company_id: companyId })
    .orderBy('id', 'asc')
    .select('merkle_leaf_hash');
  return rows.map((r) => String(r.merkle_leaf_hash));
}

export interface VerifyTraceOptions {
  readonly companyId: number;
  readonly traceId: string;
  readonly expectedRootHash?: string;
}

export async function verifyCognitiveTrace(
  db: Knex,
  options: VerifyTraceOptions
): Promise<MerkleInclusionVerificationResult> {
  const row = await db('ai_cognitive_traces')
    .where({ company_id: options.companyId, trace_id: options.traceId })
    .first();

  if (!row) {
    return {
      valid: false,
      leafHash: '',
      computedRootHash: '',
      expectedRootHash: options.expectedRootHash ?? '',
      reason: 'TRACE_NOT_FOUND',
    };
  }

  const trace = toStoredTrace(row);
  const envelope = JSON.parse(trace.envelope_json) as CognitiveTraceEnvelope;

  const expectedRoot = options.expectedRootHash ?? trace.merkle_tree_root;
  const leafHashes = await getLeafHashes(db, options.companyId);
  const tree = buildMerkleAuditTreeFromHashes(leafHashes, leafHashes.length);

  const leafIndex = leafHashes.indexOf(trace.merkle_leaf_hash);
  if (leafIndex === -1) {
    return {
      valid: false,
      leafHash: trace.merkle_leaf_hash,
      computedRootHash: '',
      expectedRootHash: expectedRoot,
      reason: 'LEAF_NOT_IN_TREE',
    };
  }

  const proof = generateMerkleInclusionProof(tree, leafIndex);
  return verifyMerkleInclusionProof(envelope.payload, proof, expectedRoot);
}

export interface VerifyChainOptions {
  readonly companyId: number;
  readonly olderSize?: number;
  readonly newerSize?: number;
}

export async function verifyChainConsistency(
  db: Knex,
  options: VerifyChainOptions
): Promise<MerkleConsistencyResult> {
  const leafHashes = await getLeafHashes(db, options.companyId);
  const total = leafHashes.length;

  const olderSize = options.olderSize ?? Math.max(0, total - 1);
  const newerSize = options.newerSize ?? total;

  if (olderSize > newerSize) {
    return {
      consistent: false,
      olderTreeSize: olderSize,
      newerTreeSize: newerSize,
      olderRootHash: '',
      newerRootHash: '',
      consistencyProof: [],
      proofHashCount: 0,
      automatedSelfAccept: false,
      automatedPromotionAllowed: false,
      reason: 'NEWER_TREE_SMALLER_THAN_OLDER',
      verificationSha256: '',
    };
  }

  const olderHashes = leafHashes.slice(0, olderSize);
  const newerHashes = leafHashes.slice(0, newerSize);

  const olderRoot = olderSize === 0 ? emptyTreeHash() : computeMerkleTreeHash(olderHashes);
  const newerRoot = newerSize === 0 ? emptyTreeHash() : computeMerkleTreeHash(newerHashes);

  if (olderSize === newerSize) {
    const core = {
      consistent: olderRoot === newerRoot,
      olderTreeSize: olderSize,
      newerTreeSize: newerSize,
      olderRootHash: olderRoot,
      newerRootHash: newerRoot,
      consistencyProof: [] as readonly string[],
      proofHashCount: 0,
      automatedSelfAccept: false as const,
      automatedPromotionAllowed: false as const,
    };
    return { ...core, verificationSha256: sha256Canonical(core) };
  }

  const consistencyProof = computeConsistencySubproof(olderSize, newerHashes, true);
  const consistent = verifyConsistencyProofHashes(
    olderSize,
    newerSize,
    olderRoot,
    newerRoot,
    consistencyProof
  );

  const core = {
    consistent,
    olderTreeSize: olderSize,
    newerTreeSize: newerSize,
    olderRootHash: olderRoot,
    newerRootHash: newerRoot,
    consistencyProof,
    proofHashCount: consistencyProof.length,
    automatedSelfAccept: false as const,
    automatedPromotionAllowed: false as const,
    ...(consistent ? {} : { reason: 'APPEND_ONLY_CONSISTENCY_VIOLATED' as const }),
  };

  return { ...core, verificationSha256: sha256Canonical(core) };
}

export interface ReplayOptions {
  readonly companyId: number;
  readonly fromIndex?: number;
  readonly toIndex?: number;
  readonly traceKinds?: readonly CognitiveTraceKind[];
}

export interface ReplayResult {
  readonly envelopes: readonly CognitiveTraceEnvelope[];
  readonly merkleTree: MerkleAuditTree;
  readonly verified: boolean;
}

export async function replayCognitiveTraces(
  db: Knex,
  options: ReplayOptions
): Promise<ReplayResult> {
  let query = db('ai_cognitive_traces')
    .where({ company_id: options.companyId })
    .orderBy('id', 'asc');

  if (options.fromIndex !== undefined) {
    query = query.offset(options.fromIndex);
  }
  if (options.toIndex !== undefined) {
    query = query.limit(options.toIndex - (options.fromIndex ?? 0));
  }
  if (options.traceKinds && options.traceKinds.length > 0) {
    query = query.whereIn('trace_kind', options.traceKinds);
  }

  const rows = await query.select('*');
  const traces = rows.map(toStoredTrace);

  const envelopes: CognitiveTraceEnvelope[] = [];
  const leafHashes: string[] = [];

  for (const trace of traces) {
    const envelope = JSON.parse(trace.envelope_json) as CognitiveTraceEnvelope;
    envelopes.push(envelope);
    leafHashes.push(trace.merkle_leaf_hash);
  }

  const tree = buildMerkleAuditTreeFromHashes(leafHashes, leafHashes.length);
  const verified = await verifyChainIntegrity(db, options.companyId, leafHashes.length);

  return { envelopes, merkleTree: tree, verified };
}

async function verifyChainIntegrity(
  db: Knex,
  companyId: number,
  expectedSize: number
): Promise<boolean> {
  const leafHashes = await getLeafHashes(db, companyId);
  if (leafHashes.length !== expectedSize) return false;

  for (let i = 1; i < leafHashes.length; i++) {
    const older = leafHashes.slice(0, i);
    const newer = leafHashes.slice(0, i + 1);
    const olderRoot = computeMerkleTreeHash(older);
    const newerRoot = computeMerkleTreeHash(newer);
    const proof = computeConsistencySubproof(i, newer, true);
    if (!verifyConsistencyProofHashes(i, i + 1, olderRoot, newerRoot, proof)) {
      return false;
    }
  }
  return true;
}

export interface RollbackOptions {
  readonly companyId: number;
  readonly targetSize: number;
}

export interface RollbackResult {
  readonly rolledBack: number;
  readonly newTreeSize: number;
  readonly newTreeRoot: string;
}

export async function rollbackToCheckpoint(
  db: Knex,
  options: RollbackOptions
): Promise<RollbackResult> {
  const currentSize = await db('ai_cognitive_traces')
    .where({ company_id: options.companyId })
    .count('* as count')
    .first()
    .then((r) => Number(r?.count ?? 0));

  if (options.targetSize >= currentSize) {
    return {
      rolledBack: 0,
      newTreeSize: currentSize,
      newTreeRoot: await getCurrentRoot(db, options.companyId),
    };
  }

  const toDelete = currentSize - options.targetSize;
  await db('ai_cognitive_traces')
    .where({ company_id: options.companyId })
    .orderBy('id', 'desc')
    .limit(toDelete)
    .delete();

  const newSize = currentSize - toDelete;
  const newRoot = await getCurrentRoot(db, options.companyId);

  return { rolledBack: toDelete, newTreeSize: newSize, newTreeRoot: newRoot };
}

async function getCurrentRoot(db: Knex, companyId: number): Promise<string> {
  const row = await db('ai_cognitive_traces')
    .where({ company_id: companyId })
    .orderBy('id', 'desc')
    .first('merkle_tree_root');
  return row?.merkle_tree_root ?? emptyTreeHash();
}

export interface GetTraceOptions {
  readonly companyId: number;
  readonly traceId: string;
}

export async function getCognitiveTrace(
  db: Knex,
  options: GetTraceOptions
): Promise<StoredCognitiveTrace | null> {
  const row = await db('ai_cognitive_traces')
    .where({ company_id: options.companyId, trace_id: options.traceId })
    .first();
  return row ? toStoredTrace(row) : null;
}

export interface ListTracesOptions {
  readonly companyId: number;
  readonly traceKinds?: readonly CognitiveTraceKind[];
  readonly limit?: number;
  readonly offset?: number;
}

export async function listCognitiveTraces(
  db: Knex,
  options: ListTracesOptions
): Promise<readonly StoredCognitiveTrace[]> {
  let query = db('ai_cognitive_traces')
    .where({ company_id: options.companyId })
    .orderBy('created_at', 'desc');

  if (options.traceKinds && options.traceKinds.length > 0) {
    query = query.whereIn('trace_kind', options.traceKinds);
  }
  if (options.limit) query = query.limit(options.limit);
  if (options.offset) query = query.offset(options.offset);

  const rows = await query.select('*');
  return rows.map(toStoredTrace);
}

export { CognitiveTrace };
