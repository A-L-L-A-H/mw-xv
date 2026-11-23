import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repositoryRoot, '.github/workflows/release.yml');

export function jobBlock(source, name) {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) return '';
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-zA-Z0-9_-]+:$/u.test(line)
  );
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n');
}

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

export function auditReleaseProvenance(source) {
  const normalized = source.replace(/\r\n/gu, '\n');
  const findings = [];
  const require = (condition, message) => {
    if (!condition) findings.push(message);
  };

  const verify = jobBlock(normalized, 'verify');
  const attest = jobBlock(normalized, 'attest-artifact');
  const publish = jobBlock(normalized, 'publish');

  require(Boolean(verify), 'release.yml must define a verify job');
  require(Boolean(attest), 'release.yml must define an attest-artifact job');
  require(Boolean(publish), 'release.yml must define a publish job');

  require(/^ {6}attestations:\s+write$/mu.test(verify) &&
    /^ {6}id-token:\s+write$/mu.test(
      verify
    ), 'verify job needs attestations: write and id-token: write');
  require(/^ {6}attestations:\s+write$/mu.test(attest) &&
    /^ {6}id-token:\s+write$/mu.test(
      attest
    ), 'attest-artifact job needs attestations: write and id-token: write');
  const needs = /^ {4}needs:(?<value>.*)$/mu.exec(publish);
  require(Boolean(needs) &&
    (/attest-artifact/u.test(needs?.groups?.value ?? '') ||
      /^ {6}-\s+attest-artifact\s*$/mu.test(
        publish.slice(publish.indexOf(needs?.[0] ?? ''))
      )), 'publish must depend on attest-artifact so publication cannot precede provenance');

  require(attest.includes(
    'verify-release-artifact-identity.mjs'
  ), 'attest-artifact must verify the exact artifact identity before attesting');
  require(attest.includes('sha256sum --check') &&
    attest.indexOf('sha256sum --check') <
      attest.indexOf(
        'Attest the exact release transport'
      ), 'attest-artifact must verify file digests before creating provenance');
  require(/^[ \t]+subject-path:/mu.test(attest) &&
    countMatches(attest, /uses:\s*actions\/attest@/gu) >=
      1, 'release transport and SBOM files must be attested with actions/attest');

  require(/uses:\s*actions\/attest@[0-9a-f]{40}\s+#\s*v\d/u.test(attest) &&
    /uses:\s*actions\/attest@[0-9a-f]{40}\s+#\s*v\d/u.test(
      publish
    ), 'all actions/attest references must be immutable pinned revisions with version comments');
  require(countMatches(publish, /uses:\s*actions\/attest@/gu) >= 4 &&
    /subject-digest:/u.test(publish) &&
    /sbom-path:/u.test(
      publish
    ), 'publish must attest image build provenance and both SPDX SBOMs by digest');

  require(countMatches(verify, /uses:\s*aquasecurity\/trivy-action@[0-9a-f]{40}\s+#\s*v\d/gu) >=
    2 &&
    countMatches(verify, /severity:\s+CRITICAL\s*$/gmu) >= 2 &&
    countMatches(verify, /exit-code:\s*'1'/gu) >=
      2, 'verify must gate both release images on blocking CRITICAL vulnerability scans');

  const unpinned = [];
  for (const [index, line] of normalized.split(/\r?\n/u).entries()) {
    const match = /^\s*(?:-\s*)?uses:\s*(?<value>.*?)\s*$/u.exec(line);
    if (!match?.groups) continue;
    const reference = match.groups.value;
    if (reference.startsWith('./')) continue;
    const [action, revision = ''] = reference.split(/\s+#\s*/u, 1)[0].split('@');
    if (!action?.includes('/') || !/^[0-9a-f]{40}$/u.test(revision)) {
      unpinned.push(`line ${index + 1}: ${reference}`);
    }
  }
  require(unpinned.length === 0, `release workflow has unpinned actions: ${unpinned.join(', ')}`);

  return findings;
}

async function main() {
  const source = await readFile(workflowPath, 'utf8');
  const findings = auditReleaseProvenance(source);
  if (findings.length > 0) {
    for (const finding of findings) process.stderr.write(`ERROR: ${finding}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Release provenance policy is valid.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Unable to validate release provenance policy.\n');
    process.exitCode = 1;
  });
}
