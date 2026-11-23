import { deepEqual, equal, ok } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { auditReleaseProvenance, jobBlock } from './check-release-provenance.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = await readFile(path.join(repositoryRoot, '.github/workflows/release.yml'), 'utf8');

test('release workflow satisfies the provenance policy', () => {
  deepEqual(auditReleaseProvenance(workflow), []);
});

test('jobBlock isolates a single job and tolerates CRLF workflows', () => {
  const windowsWorkflow = workflow.replaceAll('\n', '\r\n');
  ok(jobBlock(windowsWorkflow, 'attest-artifact').includes('actions/attest@'));
  equal(jobBlock(workflow, 'not-a-job'), '');
});

test('provenance policy rejects publication before attestation', () => {
  const findings = auditReleaseProvenance(
    workflow.replace('needs: [verify, attest-artifact]', 'needs: verify')
  );
  ok(findings.some((finding) => /publish must depend on attest-artifact/u.test(finding)));
});

test('provenance policy rejects unverified attestation subjects', () => {
  const findings = auditReleaseProvenance(
    workflow
      .replace(/ {6}subject-path:/u, '      not-subject-path:')
      .replace('sha256sum --check', 'echo skipped')
  );
  ok(findings.some((finding) => /verify file digests before creating provenance/u.test(finding)));
  ok(
    findings.some((finding) => /release transport and SBOM files must be attested/u.test(finding))
  );
});

test('provenance policy rejects missing SBOM or digest attestations', () => {
  const findings = auditReleaseProvenance(workflow.replaceAll(/ {6}sbom-path:[^\n]*\n/gu, ''));
  ok(findings.some((finding) => /image build provenance and both SPDX SBOMs/u.test(finding)));
});

test('provenance policy rejects an unpinned action', () => {
  const findings = auditReleaseProvenance(
    workflow.replace(
      'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      'uses: actions/checkout@v7'
    )
  );
  ok(findings.some((finding) => /unpinned actions/u.test(finding)));
});

test('provenance policy requires blocking vulnerability scans', () => {
  const findings = auditReleaseProvenance(workflow.replaceAll("exit-code: '1'", "exit-code: '0'"));
  ok(findings.some((finding) => /blocking CRITICAL vulnerability scans/u.test(finding)));
});
