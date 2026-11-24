import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRedactor } from './redaction.js';
import {
  verifyMerkleInclusionProof as verifyInclusionProof,
  type MerkleInclusionProof,
} from './merkle-ledger.js';
import {
  computeEpistemicCalibration,
  type EpistemicCalibrationReport,
  type EpistemicPredictionSample,
} from './epistemic-calibration.js';
import { sha256Canonical, toCanonicalJson } from './canonical-json.js';

export type A2AConsensusVote = 'approve' | 'reject' | 'abstain';

export interface PeerAttestationSignature {
  readonly algorithm: 'hmac-sha256';
  readonly keyId: string;
  readonly signatureHex: string;
  readonly issuedAt: string;
}

export interface PeerExecutionAttestation {
  readonly peerId: string;
  readonly proposalId: string;
  readonly vote: A2AConsensusVote;
  readonly attestationPayload: Readonly<Record<string, unknown>>;
  readonly signature: PeerAttestationSignature;
  readonly merkleProof: MerkleInclusionProof;
  readonly expectedMerkleRoot: string;
  readonly calibrationReport?: EpistemicCalibrationReport;
  readonly calibrationSamples?: readonly EpistemicPredictionSample[];
}

export interface A2AConsensusPolicy {
  readonly minVerifiedPeers?: number;
  readonly quorumThresholdBps?: number;
  readonly maxBrierScore?: number;
  readonly maxEce?: number;
  readonly byzantineFaultTolerance?: boolean;
  readonly sharedSecretsByKeyId?: Readonly<Record<string, string>>;
}

export interface RejectedPeerRecord {
  readonly peerId: string;
  readonly reason:
    | 'DUPLICATE_PEER'
    | 'INVALID_SIGNATURE'
    | 'MISSING_KEY'
    | 'INVALID_MERKLE_PROOF'
    | 'UNVERIFIED_CALIBRATION'
    | 'POOR_CALIBRATION';
  readonly detail: string;
}

export interface AcceptedPeerRecord {
  readonly peerId: string;
  readonly vote: A2AConsensusVote;
  readonly brierScore: number;
  readonly ece: number;
  readonly weightBps: number;
}

export interface A2AConsensusResult {
  readonly proposalId: string;
  readonly quorumReached: boolean;
  readonly decision: 'quorum_approved' | 'quorum_rejected' | 'no_quorum';
  readonly totalSubmittedPeers: number;
  readonly verifiedPeerCount: number;
  readonly totalWeightBps: number;
  readonly approveWeightBps: number;
  readonly rejectWeightBps: number;
  readonly abstainWeightBps: number;
  readonly approveRatioBps: number;
  readonly quorumThresholdBps: number;
  readonly acceptedPeers: readonly AcceptedPeerRecord[];
  readonly rejectedPeers: readonly RejectedPeerRecord[];
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly consensusSha256: string;
}

const DEFAULT_MIN_VERIFIED_PEERS = 3;
const DEFAULT_QUORUM_THRESHOLD_BPS = 6667;
const DEFAULT_MAX_BRIER_SCORE = 0.25;
const DEFAULT_MAX_ECE = 0.15;
const HEX_SHA256_REGEX = /^[0-9a-f]{64}$/iu;

export function signPeerAttestationPayload(
  proposalId: string,
  peerId: string,
  vote: A2AConsensusVote,
  attestationPayload: Readonly<Record<string, unknown>>,
  secret: string
): string {
  const canonical = toCanonicalJson({
    proposalId,
    peerId,
    vote,
    attestationPayload,
  });
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

function verifyHmacSignature(attestation: PeerExecutionAttestation, secret: string): boolean {
  if (
    attestation.signature.algorithm !== 'hmac-sha256' ||
    !HEX_SHA256_REGEX.test(attestation.signature.signatureHex)
  ) {
    return false;
  }
  const expectedHex = signPeerAttestationPayload(
    attestation.proposalId,
    attestation.peerId,
    attestation.vote,
    attestation.attestationPayload,
    secret
  );
  const actualBuf = Buffer.from(attestation.signature.signatureHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(actualBuf, expectedBuf);
}

function computeCalibrationWeightBps(brierScore: number, ece: number): number {
  const brierQuality = Math.max(0, 1 - Math.min(1, brierScore));
  const eceQuality = Math.max(0, 1 - Math.min(1, ece));
  const combined = 0.6 * brierQuality + 0.4 * eceQuality;
  return Math.max(100, Math.min(10_000, Math.round(combined * 10_000)));
}

export function evaluateA2AConsensus(
  proposalId: string,
  attestations: readonly PeerExecutionAttestation[],
  policy: A2AConsensusPolicy = {}
): A2AConsensusResult {
  const redactor = createRedactor();
  const minVerifiedPeers = Math.max(
    1,
    Math.floor(policy.minVerifiedPeers ?? DEFAULT_MIN_VERIFIED_PEERS)
  );
  const quorumThresholdBps = Math.max(
    5001,
    Math.min(10_000, Math.round(policy.quorumThresholdBps ?? DEFAULT_QUORUM_THRESHOLD_BPS))
  );
  const maxBrierScore = policy.maxBrierScore ?? DEFAULT_MAX_BRIER_SCORE;
  const maxEce = policy.maxEce ?? DEFAULT_MAX_ECE;
  const secrets = policy.sharedSecretsByKeyId ?? {};

  const seenPeers = new Set<string>();
  const acceptedPeers: AcceptedPeerRecord[] = [];
  const rejectedPeers: RejectedPeerRecord[] = [];

  for (const attestation of attestations) {
    const safePeerId = redactor.redactString(attestation.peerId);
    if (seenPeers.has(safePeerId)) {
      rejectedPeers.push({
        peerId: safePeerId,
        reason: 'DUPLICATE_PEER',
        detail: 'Duplicate peer attestation ignored for Byzantine safety.',
      });
      continue;
    }
    seenPeers.add(safePeerId);

    const secret = secrets[attestation.signature.keyId];
    if (!secret) {
      rejectedPeers.push({
        peerId: safePeerId,
        reason: 'MISSING_KEY',
        detail: `No verification key registered for keyId ${redactor.redactString(attestation.signature.keyId)}.`,
      });
      continue;
    }

    if (!verifyHmacSignature(attestation, secret)) {
      rejectedPeers.push({
        peerId: safePeerId,
        reason: 'INVALID_SIGNATURE',
        detail: 'HMAC-SHA256 attestation signature verification failed.',
      });
      continue;
    }

    const merkleCheck = verifyInclusionProof(
      attestation.attestationPayload,
      attestation.merkleProof,
      attestation.expectedMerkleRoot
    );
    if (!merkleCheck.valid) {
      rejectedPeers.push({
        peerId: safePeerId,
        reason: 'INVALID_MERKLE_PROOF',
        detail: `RFC 6962 Merkle inclusion proof failed: ${merkleCheck.reason ?? 'ROOT_MISMATCH'}.`,
      });
      continue;
    }

    const calibrationReport =
      attestation.calibrationReport ??
      (attestation.calibrationSamples && attestation.calibrationSamples.length > 0
        ? computeEpistemicCalibration(attestation.calibrationSamples)
        : undefined);

    if (!calibrationReport || calibrationReport.sampleCount === 0) {
      rejectedPeers.push({
        peerId: safePeerId,
        reason: 'UNVERIFIED_CALIBRATION',
        detail: 'Peer lacks epistemic calibration telemetry.',
      });
      continue;
    }

    if (calibrationReport.brierScore > maxBrierScore || calibrationReport.ece > maxEce) {
      rejectedPeers.push({
        peerId: safePeerId,
        reason: 'POOR_CALIBRATION',
        detail: `Peer calibration outside bounds (brier=${calibrationReport.brierScore}, ece=${calibrationReport.ece}).`,
      });
      continue;
    }

    const weightBps = computeCalibrationWeightBps(
      calibrationReport.brierScore,
      calibrationReport.ece
    );
    acceptedPeers.push({
      peerId: safePeerId,
      vote: attestation.vote,
      brierScore: calibrationReport.brierScore,
      ece: calibrationReport.ece,
      weightBps,
    });
  }

  const approveWeightBps = acceptedPeers
    .filter((p) => p.vote === 'approve')
    .reduce((sum, p) => sum + p.weightBps, 0);
  const rejectWeightBps = acceptedPeers
    .filter((p) => p.vote === 'reject')
    .reduce((sum, p) => sum + p.weightBps, 0);
  const abstainWeightBps = acceptedPeers
    .filter((p) => p.vote === 'abstain')
    .reduce((sum, p) => sum + p.weightBps, 0);
  const totalWeightBps = approveWeightBps + rejectWeightBps + abstainWeightBps;
  const votingWeightBps = approveWeightBps + rejectWeightBps;

  const approveRatioBps =
    votingWeightBps > 0 ? Math.round((approveWeightBps / votingWeightBps) * 10_000) : 0;
  const rejectRatioBps =
    votingWeightBps > 0 ? Math.round((rejectWeightBps / votingWeightBps) * 10_000) : 0;

  const enoughPeers = acceptedPeers.length >= minVerifiedPeers;
  const approvedQuorum = enoughPeers && approveRatioBps >= quorumThresholdBps;
  const rejectedQuorum = enoughPeers && rejectRatioBps >= quorumThresholdBps;

  const decision: A2AConsensusResult['decision'] = approvedQuorum
    ? 'quorum_approved'
    : rejectedQuorum
      ? 'quorum_rejected'
      : 'no_quorum';

  const core = {
    proposalId: redactor.redactString(proposalId),
    quorumReached: approvedQuorum || rejectedQuorum,
    decision,
    totalSubmittedPeers: attestations.length,
    verifiedPeerCount: acceptedPeers.length,
    totalWeightBps,
    approveWeightBps,
    rejectWeightBps,
    abstainWeightBps,
    approveRatioBps,
    quorumThresholdBps,
    acceptedPeers,
    rejectedPeers,
    automatedPromotionAllowed: false as const,
    automatedSelfMerge: false as const,
  };

  return {
    ...core,
    consensusSha256: sha256Canonical(core),
  };
}
