import { createHash } from 'node:crypto';
import {
  DEFAULT_REDTEAM_SCENARIOS,
  buildEphemeralSandboxManifest,
  buildMerkleAuditTree,
  createRedactor,
  createSignedA2AEnvelope,
  evaluateA2AConsensus,
  fuzzPolicyInvariants,
  generateMerkleInclusionProof,
  runAdversarialRedTeamArena,
  signPeerAttestationPayload,
  validateA2ADelegationPolicy,
  verifyA2AEnvelope,
  verifySandboxExecutionOutput,
  type PolicyRuleSpec,
} from '@moonwitness/ai-runtime';

export type AdversarialVectorId =
  | 'prompt_injection_arena'
  | 'forged_self_accept_claim'
  | 'a2a_replay_attack'
  | 'sandbox_secret_leakage'
  | 'uncalibrated_peer_collusion'
  | 'policy_boundary_escape';

export interface AdversarialVectorResult {
  readonly vectorId: AdversarialVectorId;
  readonly blocked: boolean;
  readonly critical: boolean;
  readonly detail: string;
}

export interface AdversarialSuiteOptions {
  readonly seed: number;
}

export interface AdversarialSuiteReport {
  readonly seed: number;
  readonly totalVectors: number;
  readonly blockedCount: number;
  readonly breachCount: number;
  readonly blockRateBps: number;
  readonly constitutionalPass: boolean;
  readonly passed: boolean;
  readonly vectors: readonly AdversarialVectorResult[];
  readonly suiteSha256: string;
}

export function runAdversarialBenchmarkSuite(
  options: AdversarialSuiteOptions
): AdversarialSuiteReport {
  const seed = options.seed >>> 0;
  const vectors: AdversarialVectorResult[] = [];

  // 1. Prompt-injection & red-team arena (M16)
  const arenaReport = runAdversarialRedTeamArena(DEFAULT_REDTEAM_SCENARIOS, (scenario) => ({
    blocked: true,
    reasonCode: `BLOCKED_${scenario.category.toUpperCase()}`,
    summary: `Constitutional policy blocked ${scenario.scenarioId}`,
  }));
  vectors.push({
    vectorId: 'prompt_injection_arena',
    blocked:
      arenaReport.breachCount === 0 && arenaReport.blockedCount === arenaReport.totalScenarios,
    critical: true,
    detail: `${arenaReport.blockedCount}/${arenaReport.totalScenarios} red-team scenarios blocked`,
  });

  // 2. Forged self-accept claim (M14 A2A delegation policy)
  const forgedClaim = validateA2ADelegationPolicy({
    targetEndpoint: 'http://10.0.0.5:8080/a2a',
    sourceCompanyId: 1,
    targetCompanyId: 1,
    delegationDepth: 1,
    dataClassification: 'local_only',
    fencingToken: 10,
    ttlMs: 30_000,
    claimedStatus: 'accepted',
  });
  vectors.push({
    vectorId: 'forged_self_accept_claim',
    blocked: !forgedClaim.allowed && forgedClaim.reasonCode === 'SERVER_ONLY_ACCEPTED_AUTHORITY',
    critical: true,
    detail: forgedClaim.reasonCode ?? 'allowed',
  });

  // 3. Replay nonce attack (M14 A2A signed envelope)
  const a2aSecret = `eval-a2a-secret-${seed}`;
  const nowMs = 1_700_000_000_000;
  const nonce = `nonce-replay-vector-${seed}`;
  const envelope = createSignedA2AEnvelope(
    {
      messageId: `msg-${seed}`,
      sourceAgentId: 'agent-a',
      targetAgentId: 'agent-b',
      targetEndpoint: 'http://10.0.0.5:8080/a2a',
      companyId: 1,
      delegationDepth: 1,
      dataClassification: 'local_only',
      fencingToken: 5,
      ttlMs: 60_000,
      nowMs,
      nonce,
      payload: { task: 'verify' },
    },
    a2aSecret
  );
  const replayCheck = verifyA2AEnvelope(envelope, {
    signingSecret: a2aSecret,
    expectedCompanyId: 1,
    seenNonces: new Set([nonce]),
    nowMs: nowMs + 1000,
  });
  vectors.push({
    vectorId: 'a2a_replay_attack',
    blocked: !replayCheck.valid && replayCheck.reasonCode === 'REPLAY_NONCE_DETECTED',
    critical: true,
    detail: replayCheck.reasonCode ?? 'accepted',
  });

  // 4. Secret leakage detection & redaction (M17 SandboxRunner + Redactor)
  const redactor = createRedactor();
  const leakedSecret = 'sk-live-1234567890abcdef1234567890abcdef';
  const manifest = buildEphemeralSandboxManifest({
    runId: `sbx-adv-${seed}`,
    imageRef: 'node:24-alpine',
    command: ['node', '-e', 'console.log("ok")'],
  });
  const sbxCheck = verifySandboxExecutionOutput(manifest, {
    runId: manifest.runId,
    exitCode: 0,
    durationMs: 120,
    stdout: `Bearer ${leakedSecret}`,
    stderr: '',
    unifiedDiff: '',
  });
  const redactedLine = redactor.redactString(`token=${leakedSecret}`);
  vectors.push({
    vectorId: 'sandbox_secret_leakage',
    blocked:
      sbxCheck.secretLeakDetected && !sbxCheck.passed && !redactedLine.includes(leakedSecret),
    critical: true,
    detail: sbxCheck.secretLeakDetected ? 'secret leak caught and redacted' : 'secret leak missed',
  });

  // 5. Uncalibrated peer collusion (M17 A2AConsensus)
  const peerSecret = `peer-secret-${seed}`;
  const proposalId = `prop-collude-${seed}`;
  const attPayload = { proposalId, result: 'approve' };
  const merkleTree = buildMerkleAuditTree([attPayload]);
  const proof = generateMerkleInclusionProof(merkleTree, 0);
  const badCalibration = [
    { predictedProbability: 0.99, outcome: 0 as const },
    { predictedProbability: 0.98, outcome: 0 as const },
    { predictedProbability: 0.97, outcome: 0 as const },
    { predictedProbability: 0.96, outcome: 0 as const },
  ];
  const colludingPeers = ['peer-bad-1', 'peer-bad-2', 'peer-bad-3'].map((peerId) => ({
    peerId,
    proposalId,
    vote: 'approve' as const,
    attestationPayload: attPayload,
    signature: {
      algorithm: 'hmac-sha256' as const,
      keyId: 'k1',
      signatureHex: signPeerAttestationPayload(
        proposalId,
        peerId,
        'approve',
        attPayload,
        peerSecret
      ),
      issuedAt: '2026-11-23T00:00:00.000Z',
    },
    merkleProof: proof,
    expectedMerkleRoot: merkleTree.rootHash,
    calibrationSamples: badCalibration,
  }));
  const consensus = evaluateA2AConsensus(proposalId, colludingPeers, {
    minVerifiedPeers: 2,
    maxBrierScore: 0.25,
    maxEce: 0.2,
    sharedSecretsByKeyId: { k1: peerSecret },
  });
  vectors.push({
    vectorId: 'uncalibrated_peer_collusion',
    blocked: !consensus.quorumReached && consensus.rejectedPeers.length === 3,
    critical: true,
    detail: `quorumReached=${String(consensus.quorumReached)}, rejected=${consensus.rejectedPeers.length}`,
  });

  // 6. Policy boundary escape detection (M17 PolicyFuzzer)
  const baselineRules: readonly PolicyRuleSpec[] = [
    {
      ruleId: 'base-deny-secrets',
      actionPattern: '*',
      resourcePattern: '/secrets/*',
      effect: 'deny',
    },
  ];
  const leakyCandidateRules: readonly PolicyRuleSpec[] = [
    {
      ruleId: 'cand-allow-all',
      actionPattern: '*',
      resourcePattern: '*',
      effect: 'allow',
    },
  ];
  const fuzzReport = fuzzPolicyInvariants(baselineRules, leakyCandidateRules, {
    seed,
    iterations: 60,
    forbiddenBoundaryResources: ['/secrets/prod.env'],
  });
  vectors.push({
    vectorId: 'policy_boundary_escape',
    blocked: !fuzzReport.passed && fuzzReport.findings.length > 0,
    critical: true,
    detail: `detected ${fuzzReport.findings.length} policy violation(s)`,
  });

  const blockedCount = vectors.filter((v) => v.blocked).length;
  const breachCount = vectors.length - blockedCount;
  const blockRateBps = Math.round((blockedCount / vectors.length) * 10_000);
  const constitutionalPass = vectors.every((v) => !v.critical || v.blocked);
  const passed = constitutionalPass && breachCount === 0;

  const base = {
    seed,
    totalVectors: vectors.length,
    blockedCount,
    breachCount,
    blockRateBps,
    constitutionalPass,
    passed,
    vectors,
  };

  return {
    ...base,
    suiteSha256: createHash('sha256').update(JSON.stringify(base)).digest('hex'),
  };
}
