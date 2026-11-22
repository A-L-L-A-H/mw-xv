import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReadOnlyRepoInspector,
  buildRepoSnapshot,
  createRedactor,
  detectCapabilityOverlap,
  toOverlapArtifactPayload,
} from '../src/index.js';

const tempDirs: string[] = [];

function createFixtureRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mw-overlap-test-'));
  tempDirs.push(dir);

  mkdirSync(path.join(dir, 'packages/billing/src'), { recursive: true });
  mkdirSync(path.join(dir, 'packages/legacy-sync/src'), { recursive: true });
  mkdirSync(path.join(dir, 'packages/partial-sync/src'), { recursive: true });
  mkdirSync(path.join(dir, 'packages/conflict-mod/src'), { recursive: true });
  mkdirSync(path.join(dir, 'docs'), { recursive: true });

  writeFileSync(
    path.join(dir, 'packages/billing/package.json'),
    JSON.stringify({
      name: '@moonwitness/billing',
      version: '1.0.0',
      scripts: { 'test:billing': 'vitest run' },
    }),
    'utf8'
  );
  writeFileSync(
    path.join(dir, 'packages/billing/src/index.ts'),
    'export function generateBillingInvoice() { return true; }\n',
    'utf8'
  );
  writeFileSync(
    path.join(dir, 'docs/billing.md'),
    '# Billing Invoicing\n\nSupports automated billing invoice calculation.\n',
    'utf8'
  );

  writeFileSync(
    path.join(dir, 'packages/legacy-sync/package.json'),
    JSON.stringify({ name: '@moonwitness/legacy-sync', version: '0.1.0' }),
    'utf8'
  );
  writeFileSync(
    path.join(dir, 'packages/legacy-sync/src/index.ts'),
    '// @deprecated legacy sync engine\nexport const legacySync = true;\n',
    'utf8'
  );

  writeFileSync(
    path.join(dir, 'packages/partial-sync/src/index.ts'),
    'export const partialSyncStub = true;\n',
    'utf8'
  );

  writeFileSync(
    path.join(dir, 'packages/conflict-mod/src/index.ts'),
    '// WARNING: conflicting duplicate_authority handler\nexport const conflictHandler = true;\n',
    'utf8'
  );

  writeFileSync(
    path.join(dir, 'docs/secrets-note.md'),
    '# Ops Notes\n\nAuthorization: Bearer super-secret-token-999999\n',
    'utf8'
  );

  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('detectCapabilityOverlap (M13.03)', () => {
  it('classifies all 6 capability states deterministically with redacted evidence and produced report artifact', async () => {
    const repoDir = createFixtureRepo();
    const redactor = createRedactor(['super-secret-token-999999']);
    const inspector = new ReadOnlyRepoInspector({
      rootDir: repoDir,
      allowlistedPaths: ['packages', 'docs'],
      redactor,
    });
    const snapshot = await buildRepoSnapshot(inspector, {
      gitRevision: { headCommit: 'abc1234', branch: 'dev', dirty: false },
      rootLabel: 'fixture-repo',
      capturedAt: '2026-11-22T00:00:00.000Z',
      redactor,
    });

    const input = {
      companyId: 1,
      repoSnapshot: snapshot,
      inspector,
      redactor,
      existingTasks: [
        {
          id: 'task-dup-1',
          code: 'TASK-0099',
          title: 'Build notification webhook dispatcher',
          status: 'in_progress' as const,
          scopePaths: ['packages/notifications'],
        },
        {
          id: 'task-conf-1',
          code: 'TASK-0100',
          title: 'Conflicting authority handler rewrite',
          description: 'Conflicting duplicate_authority handler',
          status: 'todo' as const,
          scopePaths: ['packages/conflict-mod'],
        },
      ],
      requirements: [
        {
          id: 'REQ-IMPL',
          title: 'Billing invoice generator',
          description: 'Billing invoice calculation package with tests and documentation',
          keywords: ['billing', 'invoice'],
          targetPaths: ['packages/billing', 'docs/billing.md'],
        },
        {
          id: 'REQ-PARTIAL',
          title: 'Partial sync adapter',
          description: 'Stubbed partial sync helper',
          keywords: ['partialSyncStub'],
          targetPaths: ['packages/partial-sync/src'],
        },
        {
          id: 'REQ-MISSING',
          title: 'Quantum telemetry satellite relay',
          description: 'Nonexistent spacecraft orbital downlink module',
          keywords: ['orbital_downlink_xz99'],
          targetPaths: ['packages/quantum-orbital'],
        },
        {
          id: 'REQ-OVERLAP',
          title: 'Notification webhook dispatcher',
          description: 'Deliver webhook events for notifications',
          keywords: ['webhook', 'dispatcher', 'notifications'],
          targetPaths: ['packages/notifications'],
        },
        {
          id: 'REQ-CONFLICT',
          title: 'Conflict handler ownership',
          description: 'Resolve handler module ownership',
          keywords: ['conflictHandler'],
          targetPaths: ['packages/conflict-mod'],
        },
        {
          id: 'REQ-DEPRECATED',
          title: 'Legacy sync connector',
          description: 'Deprecated legacy sync engine',
          keywords: ['legacySync', 'deprecated'],
          targetPaths: ['packages/legacy-sync'],
        },
      ],
    };

    const reportA = await detectCapabilityOverlap({
      ...input,
      capturedAt: '2026-11-22T10:00:00.000Z',
    });
    const reportB = await detectCapabilityOverlap({
      ...input,
      capturedAt: '2026-11-22T11:00:00.000Z',
    });

    expect(reportA.advisoryOnly).toBe(true);
    expect(reportA.automatedMutationsAllowed).toBe(false);
    expect(reportA.contentSha256).toBe(reportB.contentSha256);
    expect(reportA.reportSha256).not.toBe(reportB.reportSha256);
    expect(reportA.summary).toEqual({
      implemented: 1,
      partial: 1,
      missing: 1,
      overlapping: 1,
      conflicting: 1,
      deprecated: 1,
    });

    const byId = new Map(reportA.findings.map((f) => [f.requirementId, f]));
    expect(byId.get('REQ-IMPL')?.status).toBe('implemented');
    expect(byId.get('REQ-IMPL')?.likelyOwners).toContain('packages/billing');
    expect(byId.get('REQ-PARTIAL')?.status).toBe('partial');
    expect(byId.get('REQ-MISSING')?.status).toBe('missing');
    expect(byId.get('REQ-OVERLAP')?.status).toBe('overlapping');
    expect(byId.get('REQ-OVERLAP')?.duplicateTaskIds).toContain('task-dup-1');
    expect(byId.get('REQ-CONFLICT')?.status).toBe('conflicting');
    expect(byId.get('REQ-DEPRECATED')?.status).toBe('deprecated');

    // Secret values in docs/code never survive redaction.
    expect(JSON.stringify(reportA)).not.toContain('super-secret-token-999999');

    const artifact = toOverlapArtifactPayload(reportA);
    expect(artifact.artifactKind).toBe('report');
    expect(artifact.mimeType).toBe('application/json');
    expect(artifact.verificationStatus).toBe('produced');
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.sizeBytes).toBeGreaterThan(0);
  });
});
