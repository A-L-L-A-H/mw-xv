#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { evaluateScanResult, validateExceptions } from '../security-scan-policy.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const knowledgeEntry = new URL('../../packages/knowledge/dist/src/index.js', import.meta.url);
const researchEntry = new URL('../../packages/research/dist/index.js', import.meta.url);

const SECRET_PATTERNS = [
  { id: 'private-key-header', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { id: 'github-pat', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  {
    id: 'runtime-secret-assignment',
    pattern:
      /\b(?:JWT_SECRET|METRICS_TOKEN|WHATSAPP_INTERNAL_TOKEN|WHATSAPP_SESSION_KEY)\s*[:=]\s*['"]?[A-Za-z0-9_+/=-]{24,}['"]?/u,
  },
];

export async function auditCorpusManifests({ manifestsDir, referenceShaDir }) {
  const { validateSourceArtifactManifest } = await import(knowledgeEntry.href);
  const entries = (await readdir(manifestsDir)).filter((name) => name.endsWith('.json')).sort();
  const findings = [];
  let checkedManifests = 0;

  for (const fileName of entries) {
    const filePath = path.join(manifestsDir, fileName);
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !('rights' in parsed) || !('artifact' in parsed)) {
      continue;
    }
    checkedManifests += 1;

    const schemaResult = validateSourceArtifactManifest(parsed);
    if (!schemaResult.valid) {
      findings.push({
        category: 'corpus_rights',
        file: fileName,
        reason: 'invalid_source_artifact_manifest',
        issues: schemaResult.issues,
      });
      continue;
    }

    const rightsState = parsed.rights?.state;
    const pubMode = parsed.publication?.mode;
    if (pubMode === 'source_bytes' && rightsState !== 'permitted') {
      findings.push({
        category: 'corpus_rights',
        file: fileName,
        reason: 'non_permitted_source_bytes',
        detail: `rights.state is "${String(rightsState)}"`,
      });
      continue;
    }

    if (pubMode === 'source_bytes') {
      const allowedUses = Array.isArray(parsed.rights?.allowed_uses)
        ? parsed.rights.allowed_uses
        : [];
      if (!allowedUses.includes('store') || !allowedUses.includes('redistribute_full')) {
        findings.push({
          category: 'corpus_rights',
          file: fileName,
          reason: 'missing_store_or_redistribute_use',
          detail: `allowed_uses=${JSON.stringify(allowedUses)}`,
        });
      }
      const expectedSha = String(parsed.artifact?.sha256 ?? '');
      const expectedBytes = Number(parsed.artifact?.byte_length ?? -1);
      const artifactPath = path.join(referenceShaDir, expectedSha.slice(0, 2), expectedSha);
      try {
        const bytes = await readFile(artifactPath);
        const actualSha = createHash('sha256').update(bytes).digest('hex');
        if (actualSha !== expectedSha || bytes.byteLength !== expectedBytes) {
          findings.push({
            category: 'corpus_integrity',
            file: fileName,
            reason: 'artifact_digest_or_length_mismatch',
            detail: `expected ${expectedSha} (${expectedBytes}B), got ${actualSha} (${bytes.byteLength}B)`,
          });
        }
      } catch (error) {
        findings.push({
          category: 'corpus_integrity',
          file: fileName,
          reason: 'artifact_missing',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { checkedManifests, findings };
}

export async function auditPayloadsForPiiAndSecrets(namedPayloads) {
  const { containsProhibitedMinorIdentifiers } = await import(researchEntry.href);
  const findings = [];

  for (const item of namedPayloads) {
    const piiPaths = containsProhibitedMinorIdentifiers(item.payload);
    if (piiPaths.length > 0) {
      findings.push({
        category: 'pii_or_minor_identifier',
        target: item.name,
        reason: 'prohibited_identifier_paths',
        paths: piiPaths,
      });
    }

    const serialized =
      typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload);
    for (const rule of SECRET_PATTERNS) {
      if (rule.pattern.test(serialized)) {
        findings.push({
          category: 'secret_exposure',
          target: item.name,
          reason: rule.id,
        });
      }
    }
  }

  return findings;
}

export async function auditGitleaksToml(gitleaksTomlPath) {
  const content = await readFile(gitleaksTomlPath, 'utf8');
  const findings = [];
  if (!/\[extend\][\s\S]*?\buseDefault\s*=\s*true\b/u.test(content)) {
    findings.push({
      category: 'secrets_config',
      target: '.gitleaks.toml',
      reason: 'missing_use_default',
    });
  }
  if (!/regexTarget\s*=\s*"line"/u.test(content)) {
    findings.push({
      category: 'secrets_config',
      target: '.gitleaks.toml',
      reason: 'allowlist_must_match_line',
    });
  }
  if (!/id\s*=\s*"moonwitness-runtime-secret"/u.test(content)) {
    findings.push({
      category: 'secrets_config',
      target: '.gitleaks.toml',
      reason: 'missing_runtime_secret_rule',
    });
  }
  return findings;
}

export function auditDependencyFindings({ exitCode = 0, findings = [], exceptions = [], today }) {
  const exceptionErrors = validateExceptions(exceptions, today);
  const scanResult = evaluateScanResult({ exitCode, findings, exceptions });
  return {
    passed: exceptionErrors.length === 0 && scanResult.passed,
    exceptionErrors,
    scanResult,
  };
}

export async function runComplianceAudit({
  rootDir = repositoryRoot,
  extraPayloads = [],
  dependencyInput = { exitCode: 0, findings: [], exceptions: [], today: '2026-11-21' },
} = {}) {
  const manifestsDir = path.join(rootDir, 'corpus/manifests');
  const referenceShaDir = path.join(rootDir, 'corpus/reference/sha256');
  const gitleaksPath = path.join(rootDir, '.gitleaks.toml');
  const benchmarkFixturesPath = path.join(
    rootDir,
    'docs/knowledge/semantics-benchmark-fixtures.json'
  );

  const corpusResult = await auditCorpusManifests({ manifestsDir, referenceShaDir });

  const benchmarkFixtures = JSON.parse(await readFile(benchmarkFixturesPath, 'utf8'));
  const payloadFindings = await auditPayloadsForPiiAndSecrets([
    { name: 'docs/knowledge/semantics-benchmark-fixtures.json', payload: benchmarkFixtures },
    ...extraPayloads,
  ]);
  const gitleaksFindings = await auditGitleaksToml(gitleaksPath);
  const dependencyAudit = auditDependencyFindings(dependencyInput);

  const allFindings = [
    ...corpusResult.findings,
    ...payloadFindings,
    ...gitleaksFindings,
    ...(dependencyAudit.passed ? [] : [{ category: 'dependency_scan', detail: dependencyAudit }]),
  ];

  return {
    passed: allFindings.length === 0,
    checkedManifests: corpusResult.checkedManifests,
    findingCount: allFindings.length,
    findings: allFindings,
  };
}

async function main(args) {
  const report = await runComplianceAudit();
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.passed) {
    process.stdout.write(
      `K9-002 compliance scan passed (${report.checkedManifests} corpus manifests, PII/secrets/policy clean).\n`
    );
  } else {
    process.stderr.write(
      `K9-002 compliance scan failed (${report.findingCount} finding(s)):\n${JSON.stringify(report.findings, null, 2)}\n`
    );
  }
  return report.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
