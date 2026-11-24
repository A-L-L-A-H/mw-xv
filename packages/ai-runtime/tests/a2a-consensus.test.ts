import { describe, expect, it } from 'vitest';
import { buildMerkleAuditTree, generateMerkleInclusionProof } from '../src/merkle-ledger.js';
import { computeEpistemicCalibration } from '../src/epistemic-calibration.js';
import {
  evaluateA2AConsensus,
  signPeerAttestationPayload,
  type PeerExecutionAttestation,
} from '../src/a2a-consensus.js';

const SECRET_KEY = 'test-swarm-hmac-secret-key-001';

function buildSignedPeer(
  peerId: string,
  proposalId: string,
  vote: 'approve' | 'reject' | 'abstain',
  brierGood: boolean
): PeerExecutionAttestation {
  const payload = { proposalId, peerId, verdict: vote };
  const tree = buildMerkleAuditTree([payload, { extra: 'anchor' }]);
  const proof = generateMerkleInclusionProof(tree, 0);
  const calibrationReport = computeEpistemicCalibration(
    brierGood
      ? [
          { predictedProbability: 0.9, outcome: 1 },
          { predictedProbability: 0.1, outcome: 0 },
          { predictedProbability: 0.85, outcome: 1 },
          { predictedProbability: 0.15, outcome: 0 },
        ]
      : [
          { predictedProbability: 0.95, outcome: 0 },
          { predictedProbability: 0.9, outcome: 0 },
          { predictedProbability: 0.05, outcome: 1 },
        ]
  );

  return {
    peerId,
    proposalId,
    vote,
    attestationPayload: payload,
    signature: {
      algorithm: 'hmac-sha256',
      keyId: 'key-1',
      signatureHex: signPeerAttestationPayload(proposalId, peerId, vote, payload, SECRET_KEY),
      issuedAt: '2026-11-23T00:00:00Z',
    },
    merkleProof: proof,
    expectedMerkleRoot: tree.rootHash,
    calibrationReport,
  };
}

describe('M17.01 a2a-consensus', () => {
  it('reaches calibration-weighted quorum for 3 verified peers and locks automatedPromotionAllowed=false', () => {
    const peers = [
      buildSignedPeer('peer-a', 'prop-1', 'approve', true),
      buildSignedPeer('peer-b', 'prop-1', 'approve', true),
      buildSignedPeer('peer-c', 'prop-1', 'approve', true),
    ];

    const result = evaluateA2AConsensus('prop-1', peers, {
      sharedSecretsByKeyId: { 'key-1': SECRET_KEY },
    });

    expect(result.quorumReached).toBe(true);
    expect(result.decision).toBe('quorum_approved');
    expect(result.verifiedPeerCount).toBe(3);
    expect(result.rejectedPeers).toHaveLength(0);
    expect(result.automatedPromotionAllowed).toBe(false);
    expect(result.automatedSelfMerge).toBe(false);
    expect(result.consensusSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects peers with invalid signature, tampered Merkle proof, or poor calibration', () => {
    const goodPeer = buildSignedPeer('peer-good', 'prop-2', 'approve', true);
    const badSigPeer = {
      ...buildSignedPeer('peer-badsig', 'prop-2', 'approve', true),
      signature: {
        algorithm: 'hmac-sha256' as const,
        keyId: 'key-1',
        signatureHex: '0'.repeat(64),
        issuedAt: '2026-11-23T00:00:00Z',
      },
    };
    const badMerklePeer = {
      ...buildSignedPeer('peer-badmerkle', 'prop-2', 'approve', true),
      expectedMerkleRoot: 'f'.repeat(64),
    };
    const uncalibratedPeer = buildSignedPeer('peer-uncal', 'prop-2', 'approve', false);

    const result = evaluateA2AConsensus(
      'prop-2',
      [goodPeer, badSigPeer, badMerklePeer, uncalibratedPeer],
      {
        sharedSecretsByKeyId: { 'key-1': SECRET_KEY },
      }
    );

    expect(result.quorumReached).toBe(false);
    expect(result.decision).toBe('no_quorum');
    expect(result.verifiedPeerCount).toBe(1);
    const reasons = new Set(result.rejectedPeers.map((r) => r.reason));
    expect(reasons.has('INVALID_SIGNATURE')).toBe(true);
    expect(reasons.has('INVALID_MERKLE_PROOF')).toBe(true);
    expect(reasons.has('POOR_CALIBRATION')).toBe(true);
    expect(result.automatedPromotionAllowed).toBe(false);
  });
});
