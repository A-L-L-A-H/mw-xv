import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  auditCorpusManifests,
  auditDependencyFindings,
  auditGitleaksToml,
  auditPayloadsForPiiAndSecrets,
  runComplianceAudit,
} from './verify-compliance-scan.mjs';

describe('K9-002 source license, PII, secrets, and dependency compliance scan', () => {
  it('passes on the pinned live repository corpus manifests, synthetic fixtures, and .gitleaks.toml', async () => {
    const report = await runComplianceAudit();
    assert.equal(report.passed, true);
    assert.equal(report.checkedManifests, 2);
    assert.deepEqual(report.findings, []);
  });

  it('fails closed on unknown/restricted rights manifests and corrupted artifact bytes', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mw-k9-002-rights-'));
    try {
      const manifestsDir = path.join(tmpDir, 'manifests');
      const refDir = path.join(tmpDir, 'sha256');
      await mkdir(manifestsDir, { recursive: true });
      await mkdir(refDir, { recursive: true });

      const badManifest = {
        schema_version: 1,
        source_id: 'mw:source:bad-fixture',
        edition_id: 'mw:edition:bad-fixture-v1',
        locale: 'en-US',
        artifact: {
          representation: 'source_bytes',
          media_type: 'text/plain; charset=utf-8',
          sha256: 'a'.repeat(64),
          byte_length: 12,
        },
        rights: {
          state: 'unknown',
          allowed_uses: ['read_analyze'],
          reviewer: 'bjo163',
          decision_date: '2026-11-21',
          evidence_ref: 'synthetic:bad',
          scope: 'Bad unknown rights fixture.',
        },
        attribution: {
          text: 'Synthetic',
          display_locations: ['synthetic'],
        },
        complaint_process_owner: 'bjo163',
        publication: { mode: 'source_bytes' },
      };
      await writeFile(path.join(manifestsDir, 'bad.json'), JSON.stringify(badManifest), 'utf8');

      const result = await auditCorpusManifests({ manifestsDir, referenceShaDir: refDir });
      assert.ok(result.findings.length > 0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects deliberate PII/minor identifiers, hardcoded secrets, weakened gitleaks config, and CRITICAL dependency findings', async () => {
    const piiAndSecrets = await auditPayloadsForPiiAndSecrets([
      {
        name: 'deliberate-bad-pii-fixture',
        payload: {
          child_name: 'Synthetic Minor Name',
          guardian_email: 'guardian@example.invalid',
        },
      },
      {
        name: 'deliberate-bad-secret-fixture',
        payload: 'JWT_SECRET=0123456789abcdef0123456789abcdef',
      },
    ]);
    assert.equal(
      piiAndSecrets.some((item) => item.category === 'pii_or_minor_identifier'),
      true
    );
    assert.equal(
      piiAndSecrets.some((item) => item.category === 'secret_exposure'),
      true
    );

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mw-k9-002-gitleaks-'));
    try {
      const badToml = path.join(tmpDir, '.gitleaks.toml');
      await writeFile(badToml, '[extend]\nuseDefault = false\n', 'utf8');
      const gitleaksFindings = await auditGitleaksToml(badToml);
      assert.equal(gitleaksFindings.length, 3);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    const depBlocked = auditDependencyFindings({
      exitCode: 0,
      findings: [{ id: 'CVE-2026-9999', severity: 'CRITICAL', target: 'workspace' }],
      exceptions: [],
      today: '2026-11-21',
    });
    assert.equal(depBlocked.passed, false);
  });
});
