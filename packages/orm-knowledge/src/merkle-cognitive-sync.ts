import { createHash } from 'node:crypto';

export interface CognitiveNode {
  readonly id: string;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly lamportClock: number;
  readonly peerId: string;
  readonly deleted?: boolean;
}

export interface CognitiveGraphSnapshot {
  readonly peerId: string;
  readonly nodes: ReadonlyMap<string, CognitiveNode>;
}

export interface MerkleProofStep {
  readonly position: 'left' | 'right';
  readonly hash: string;
}

export interface MerkleProof {
  readonly leafHash: string;
  readonly rootHash: string;
  readonly steps: readonly MerkleProofStep[];
}

export interface MerkleTree {
  readonly rootHash: string;
  readonly leafHashes: ReadonlyMap<string, string>;
  readonly levels: readonly (readonly string[])[];
  readonly orderedIds: readonly string[];
}

export interface CognitiveGraphDelta {
  readonly sourcePeerId: string;
  readonly targetPeerId: string;
  readonly missingInTarget: readonly CognitiveNode[];
  readonly newerInSource: readonly CognitiveNode[];
  readonly identicalCount: number;
}

export interface MergeResult {
  readonly merged: CognitiveGraphSnapshot;
  readonly appliedNodeIds: readonly string[];
  readonly conflictCount: number;
  readonly rootHash: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function hashCognitiveNode(node: CognitiveNode): string {
  return sha256Hex(
    canonicalStringify({
      id: node.id,
      kind: node.kind,
      payload: node.payload,
      lamportClock: node.lamportClock,
      peerId: node.peerId,
      deleted: Boolean(node.deleted),
    }),
  );
}

export function buildMerkleTree(nodes: ReadonlyMap<string, CognitiveNode>): MerkleTree {
  const orderedIds = Array.from(nodes.keys()).sort();
  const leafHashes = new Map<string, string>();

  if (orderedIds.length === 0) {
    const emptyRoot = sha256Hex('EMPTY_COGNITIVE_MERKLE_TREE');
    return {
      rootHash: emptyRoot,
      leafHashes,
      levels: [[emptyRoot]],
      orderedIds: [],
    };
  }

  const leaves: string[] = [];
  for (const id of orderedIds) {
    const node = nodes.get(id);
    if (node) {
      const hash = hashCognitiveNode(node);
      leafHashes.set(id, hash);
      leaves.push(hash);
    }
  }

  const levels: string[][] = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left;
      next.push(sha256Hex(`${left}:${right}`));
    }
    levels.push(next);
    current = next;
  }

  return {
    rootHash: current[0]!,
    leafHashes,
    levels,
    orderedIds,
  };
}

export function generateMerkleProof(tree: MerkleTree, nodeId: string): MerkleProof | null {
  const index = tree.orderedIds.indexOf(nodeId);
  if (index === -1) {
    return null;
  }

  const leafHash = tree.leafHashes.get(nodeId);
  if (!leafHash) {
    return null;
  }

  const steps: MerkleProofStep[] = [];
  let currentIndex = index;

  for (let levelIndex = 0; levelIndex < tree.levels.length - 1; levelIndex += 1) {
    const level = tree.levels[levelIndex]!;
    const isRightNode = currentIndex % 2 === 1;
    const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
    const siblingHash = siblingIndex < level.length ? level[siblingIndex]! : level[currentIndex]!;

    steps.push({
      position: isRightNode ? 'left' : 'right',
      hash: siblingHash,
    });

    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    leafHash,
    rootHash: tree.rootHash,
    steps,
  };
}

export function verifyMerkleProof(proof: MerkleProof): boolean {
  let computed = proof.leafHash;
  for (const step of proof.steps) {
    computed =
      step.position === 'left'
        ? sha256Hex(`${step.hash}:${computed}`)
        : sha256Hex(`${computed}:${step.hash}`);
  }
  return computed === proof.rootHash;
}

function compareNodePrecedence(a: CognitiveNode, b: CognitiveNode): number {
  if (a.lamportClock !== b.lamportClock) {
    return a.lamportClock - b.lamportClock;
  }
  if (a.peerId !== b.peerId) {
    return a.peerId < b.peerId ? -1 : 1;
  }
  const hashA = hashCognitiveNode(a);
  const hashB = hashCognitiveNode(b);
  if (hashA === hashB) {
    return 0;
  }
  return hashA < hashB ? -1 : 1;
}

export function diffCognitiveGraphs(
  source: CognitiveGraphSnapshot,
  target: CognitiveGraphSnapshot,
): CognitiveGraphDelta {
  const missingInTarget: CognitiveNode[] = [];
  const newerInSource: CognitiveNode[] = [];
  let identicalCount = 0;

  const sortedIds = Array.from(source.nodes.keys()).sort();
  for (const id of sortedIds) {
    const sourceNode = source.nodes.get(id);
    if (!sourceNode) {
      continue;
    }
    const targetNode = target.nodes.get(id);
    if (!targetNode) {
      missingInTarget.push(sourceNode);
      continue;
    }
    const sourceHash = hashCognitiveNode(sourceNode);
    const targetHash = hashCognitiveNode(targetNode);
    if (sourceHash === targetHash) {
      identicalCount += 1;
    } else if (compareNodePrecedence(sourceNode, targetNode) > 0) {
      newerInSource.push(sourceNode);
    }
  }

  return {
    sourcePeerId: source.peerId,
    targetPeerId: target.peerId,
    missingInTarget,
    newerInSource,
    identicalCount,
  };
}

export function mergeCognitiveGraphs(
  local: CognitiveGraphSnapshot,
  remote: CognitiveGraphSnapshot,
  mergedPeerId: string = local.peerId,
): MergeResult {
  const mergedNodes = new Map<string, CognitiveNode>(local.nodes);
  const appliedNodeIds: string[] = [];
  let conflictCount = 0;

  const remoteIds = Array.from(remote.nodes.keys()).sort();
  for (const id of remoteIds) {
    const remoteNode = remote.nodes.get(id);
    if (!remoteNode) {
      continue;
    }
    const localNode = mergedNodes.get(id);
    if (!localNode) {
      mergedNodes.set(id, remoteNode);
      appliedNodeIds.push(id);
      continue;
    }

    const localHash = hashCognitiveNode(localNode);
    const remoteHash = hashCognitiveNode(remoteNode);
    if (localHash === remoteHash) {
      continue;
    }

    conflictCount += 1;
    if (compareNodePrecedence(remoteNode, localNode) > 0) {
      mergedNodes.set(id, remoteNode);
      appliedNodeIds.push(id);
    }
  }

  const merged: CognitiveGraphSnapshot = {
    peerId: mergedPeerId,
    nodes: mergedNodes,
  };
  const tree = buildMerkleTree(mergedNodes);

  return {
    merged,
    appliedNodeIds,
    conflictCount,
    rootHash: tree.rootHash,
  };
}
