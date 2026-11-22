import { describe, expect, it } from 'vitest';
import {
  computeSha256Hex,
  validateDiffScope,
  verifyProofCarryingWork,
  type PcwCheckRecord,
  type PcwEvidenceArtifactInput,
  type PcwVerificationInput,
  type PcwWorkContractSpec,
} from '../src/pcw-verifier.js';

const NOW_MS = Date.parse('2026-11-22T12:00:00.000Z');

function makeContract(): PcwWorkContractSpec {
  return {
    id: 'wc-1',
    companyId: 10,
    code: 'WC-0001',
    assignedAgentId: 'agent-worker',
    riskTier: 'R1',
    dataClassification: 'local_only',
    criteriaLockedAt: '2026-11-22T10:00:00.000Z',
    criteria: [
      {
        id: 'crit-1',
        code: 'AC-1',
        title: 'Unit tests pass',
        verificationMethod: 'automated_test',
        requiredEvidenceType: 'test_log',
        mandatory: true,
        version: 1,
      },
    ],
  };
}

function makeArtifact(): PcwEvidenceArtifactInput {
  const raw = 'all tests passed';
  return {
    id: 'art-1',
    companyId: 10,
    workContractId: 'wc-1',
    acceptanceCriterionId: 'crit-1',
    criterionVersion: 1,
    agentRunId: 'run-1',
    producerAgentId: 'agent-worker',
    artifactKind: 'eval_result',
    storageKey: 'evidence/run-1/test.txt',
    sha256: computeSha256Hex(raw),
    rawContent: raw,
    sizeBytes: Buffer.byteLength(raw, 'utf8'),
    mimeType: 'text/plain',
    sourceSha: 'abc123',
    producedAt: '2026-11-22T11:00:00.000Z',
    verificationStatus: 'checked',
    automatedTestPassed: true,
  };
}

function makeBaseInput(overrides: Partial<PcwVerificationInput> = {}): PcwVerificationInput {
  return {
    contract: makeContract(),
    artifacts: [makeArtifact()],
    reviewerDecision: {
      reviewerActorId: 'agent-reviewer',
      reviewerType: 'agent',
      reviewerRunId: 'run-rev-1',
      decision: 'approved',
      rationale: 'Verified test output and digest.',
      decidedAt: '2026-11-22T11:30:00.000Z',
    },
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe('validateDiffScope', () => {
  it('accepts clean relative paths inside allowed prefixes and normalizes slashes', () => {
    const result = validateDiffScope(
      ['./packages\\ai-runtime\\src\\pcw-verifier.ts', 'packages/ai-runtime/tests/foo.test.ts'],
      ['packages/ai-runtime/src/', './packages/ai-runtime/tests']
    );
    expect(result.scopeClean).toBe(true);
    expect(result.unsafePaths).toEqual([]);
    expect(result.outOfScopeFiles).toEqual([]);
    expect(result.checkedFiles).toEqual([
      'packages/ai-runtime/src/pcw-verifier.ts',
      'packages/ai-runtime/tests/foo.test.ts',
    ]);
  });

  it('rejects out-of-scope and forbidden paths', () => {
    const result = validateDiffScope(
      ['packages/ai-runtime/src/pcw-verifier.ts', 'packages/api/src/server.ts', 'package.json'],
      ['.'],
      ['packages/api', 'package.json']
    );
    expect(result.scopeClean).toBe(false);
    expect(result.unsafePaths).toEqual([]);
    expect(result.outOfScopeFiles).toEqual(['package.json', 'packages/api/src/server.ts']);
  });

  it('flags empty, traversal, absolute, .git, .env, and key/secret paths as both unsafe and out-of-scope', () => {
    const result = validateDiffScope(
      [
        '',
        '../escape.ts',
        '/etc/passwd',
        'C:\\Windows\\System32\\drivers\\etc\\hosts',
        '.git/config',
        'packages/ai-runtime/.env.local',
        'certs/server.pem',
        'keys/private.key',
        'ssh/id_rsa',
        'config/secrets.json',
        'config/credentials.yaml',
      ],
      ['.']
    );
    expect(result.scopeClean).toBe(false);
    expect(result.unsafePaths.length).toBe(11);
    expect(result.outOfScopeFiles).toEqual(result.unsafePaths);
  });

  it('treats empty allowedScopePaths as out-of-scope for any file', () => {
    const result = validateDiffScope(['packages/ai-runtime/src/index.ts'], []);
    expect(result.scopeClean).toBe(false);
    expect(result.outOfScopeFiles).toEqual(['packages/ai-runtime/src/index.ts']);
  });
});

describe('verifyProofCarryingWork M13.05 checkMatrix and diffScope', () => {
  it('preserves backwards compatibility when checks and diffScope are omitted', () => {
    const report = verifyProofCarryingWork(makeBaseInput());
    expect(report.accepted).toBe(true);
    expect(report.checkMatrix).toBeUndefined();
    expect(report.diffScope).toBeUndefined();
  });

  it('accepts passing mandatory checks and skipped optional checks with reason', () => {
    const checks: PcwCheckRecord[] = [
      { code: 'build', status: 'pass', mandatory: true, exitCode: 0, durationMs: 1200 },
      { code: 'e2e', status: 'skipped', mandatory: false, reason: 'No UI files changed' },
    ];
    const report = verifyProofCarryingWork(
      makeBaseInput({
        checks,
        changedFiles: ['packages/ai-runtime/src/pcw-verifier.ts'],
        allowedScopePaths: ['packages/ai-runtime/src'],
      })
    );
    expect(report.accepted).toBe(true);
    expect(report.checkMatrix).toEqual({
      total: 2,
      passed: 1,
      failed: 0,
      skipped: 1,
      notApplicable: 0,
      notRun: 0,
      records: checks,
    });
    expect(report.diffScope?.scopeClean).toBe(true);
  });

  it('rejects skipped or not_applicable checks without reason', () => {
    const report = verifyProofCarryingWork(
      makeBaseInput({
        checks: [
          { code: 'lint', status: 'skipped', mandatory: false, reason: '   ' },
          { code: 'db', status: 'not_applicable', mandatory: false },
        ],
      })
    );
    expect(report.accepted).toBe(false);
    expect(report.rejectionReasons.filter((r) => r.code === 'MISSING_SKIP_REASON')).toHaveLength(2);
  });

  it('rejects mandatory fail, skipped, not_run, and non-mandatory fail', () => {
    const report = verifyProofCarryingWork(
      makeBaseInput({
        checks: [
          { code: 'unit', status: 'fail' },
          { code: 'typecheck', status: 'skipped', reason: 'timeout' },
          { code: 'security', status: 'not_run' },
          { code: 'optional-bench', status: 'fail', mandatory: false },
        ],
      })
    );
    expect(report.accepted).toBe(false);
    expect(
      report.rejectionReasons.filter((r) => r.code === 'MANDATORY_CHECK_NOT_PASSED')
    ).toHaveLength(4);
  });

  it('allows mandatory not_applicable only when humanSignoff is approved with rationale', () => {
    const checks: PcwCheckRecord[] = [
      {
        code: 'db-migration',
        status: 'not_applicable',
        mandatory: true,
        reason: 'Pure runtime change',
      },
    ];

    const rejected = verifyProofCarryingWork(makeBaseInput({ checks }));
    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectionReasons.some((r) => r.code === 'MANDATORY_CHECK_NOT_PASSED')).toBe(
      true
    );

    const accepted = verifyProofCarryingWork(
      makeBaseInput({
        checks,
        humanSignoff: {
          userId: 'human-approver',
          approved: true,
          rationale: 'Confirmed no DB schema touched',
          signedAt: '2026-11-22T11:45:00.000Z',
        },
      })
    );
    expect(accepted.accepted).toBe(true);
  });

  it('rejects out-of-scope diffs and changes reportSha256 deterministically', () => {
    const clean = verifyProofCarryingWork(
      makeBaseInput({
        changedFiles: ['packages/ai-runtime/src/pcw-verifier.ts'],
        allowedScopePaths: ['packages/ai-runtime/src'],
      })
    );
    const dirty = verifyProofCarryingWork(
      makeBaseInput({
        changedFiles: ['packages/ai-runtime/src/pcw-verifier.ts', '.env'],
        allowedScopePaths: ['packages/ai-runtime/src'],
      })
    );
    expect(clean.accepted).toBe(true);
    expect(dirty.accepted).toBe(false);
    expect(dirty.rejectionReasons.some((r) => r.code === 'OUT_OF_SCOPE_DIFF_DETECTED')).toBe(true);
    expect(dirty.reportSha256).not.toBe(clean.reportSha256);
  });
});
