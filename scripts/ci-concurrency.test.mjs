import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const pagesWorkflow = readFileSync('.github/workflows/pages.yml', 'utf8');
const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const productionCompose = readFileSync('deploy/compose/docker-compose.production.yml', 'utf8');
const containerSmoke = readFileSync('scripts/smoke-containers.mjs', 'utf8');

test('CI cancels stale runs within the same workflow, event, branch or PR', () => {
  assert.match(
    workflow,
    /group:\s*ci-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.event_name\s*\}\}-\$\{\{\s*github\.event\.pull_request\.number\s*\|\|\s*github\.ref\s*\}\}/u
  );
  assert.match(workflow, /cancel-in-progress:\s*true/u);

  // Push and PR runs for the same commit are distinct concurrency groups: neither
  // cancels the other, while newer commits on the same branch or PR cancel stale
  // runs that would otherwise starve the runner queue.
  const group = (workflowName, eventName, scope) =>
    `ci-${workflowName}-${eventName}-${scope}`;
  assert.notEqual(group('CI', 'push', 'refs/heads/dev'), group('CI', 'pull_request', 'refs/heads/dev'));
  assert.notEqual(group('CI', 'push', 'refs/heads/dev'), group('CI', 'pull_request', '218'));
  assert.notEqual(group('CI', 'pull_request', '218'), group('CI', 'pull_request', '219'));
  assert.equal(group('CI', 'push', 'refs/heads/dev'), group('CI', 'push', 'refs/heads/dev'));
});

test('CI runs quality-and-build, unit-tests, knowledge-gate, and postgres-integration on dev and main', () => {
  assert.match(workflow, /^ {2}pull_request:\r?\n {4}branches: \[dev, main\]$/mu);
  assert.match(workflow, /^ {2}push:\r?\n {4}branches: \[dev, main\]$/mu);
  for (const jobName of [
    'quality-and-build',
    'unit-tests',
    'knowledge-gate',
    'postgres-integration',
  ]) {
    assert.match(workflow, new RegExp(`^ {2}${jobName}:`, 'mu'));
  }
  assert.match(workflow, /pnpm docs:check:built/u);
  assert.match(workflow, /pnpm api:addon:check/u);
  assert.match(workflow, /pnpm test:integration:built/u);
  assert.match(workflow, /node scripts\/knowledge\/run-k-gate\.mjs --json/u);

  if (existsSync('.github/workflows/codeql.yml') && existsSync('.github/workflows/gitleaks.yml')) {
    for (const source of [
      readFileSync('.github/workflows/codeql.yml', 'utf8'),
      readFileSync('.github/workflows/gitleaks.yml', 'utf8'),
    ]) {
      assert.match(source, /^ {2}pull_request:\r?\n {4}branches: \[dev, main\]$/mu);
      assert.match(source, /^ {2}push:\r?\n {4}branches: \[main\]$/mu);
    }
  }
});

test('every CI job declares explicit least-privilege contents: read permissions', () => {
  assert.match(workflow, /^permissions:\r?\n {2}contents: read/mu);
  const jobsSection = workflow.slice(workflow.search(/^jobs:\s*$/mu));
  const jobHeaders = [...jobsSection.matchAll(/^ {2}([a-z0-9_-]+):\s*$/gmu)];
  assert.ok(jobHeaders.length > 0);
  for (const [index, job] of jobHeaders.entries()) {
    const nextJob = jobHeaders[index + 1];
    const jobBody = jobsSection.slice(job.index, nextJob?.index);
    assert.match(jobBody, /^ {4}permissions:/mu, `${job[1]} must declare permissions`);
    assert.match(jobBody, /^ {6}contents: read\s*$/mu, `${job[1]} must allow contents reads`);
    assert.doesNotMatch(jobBody, /^ {6}contents: write\s*$/mu, `${job[1]} must not write contents`);
  }
  const writePermissions = [...workflow.matchAll(/^ {6}([a-z-]+): write\s*$/gmu)].map(
    ([, permission]) => permission
  );
  assert.deepEqual(writePermissions, ['security-events']);
});

test('affected CI selector keeps full validation for shared config and master roadmap changes', () => {
  const selector = readFileSync('scripts/select-affected.mjs', 'utf8');
  assert.match(
    selector,
    /const requiredProjects = \['quality', 'integration', 'browser', 'containers', 'automation', 'ui'\]/u
  );
  assert.match(selector, /'ROADMAP\.md'/u);
  assert.match(selector, /const projects = new Set\(\)/u);
});

test('integration job supplies isolated PostgreSQL test credentials', () => {
  const integrationJob = workflow.match(/ {2}postgres-integration:[\s\S]*$/u)?.[0];
  assert.ok(integrationJob, 'CI should define its postgres-integration job');
  assert.match(integrationJob, /postgres:16-alpine/u);
  assert.match(
    integrationJob,
    /POSTGRES_TEST_URL:\s*postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/moonwitness_test/u
  );
  assert.match(integrationJob, /REQUIRE_POSTGRES_TESTS:\s*'true'/u);
});

test('Pages portal tests build and serve the publication site only once', () => {
  assert.doesNotMatch(pagesWorkflow, /name: Build documentation portal site/u);
  assert.match(pagesWorkflow, /name: Test documentation portal\s+id: docs_portal_tests/u);
  assert.match(pagesWorkflow, /run: pnpm --filter @moonwitness\/docs test/u);
});

test('every caller of the production Compose stack supplies each variable it requires', () => {
  const required = [...productionCompose.matchAll(/\$\{([A-Z0-9_]+):\?[^}]*\}/gu)].map(
    ([, name]) => name
  );
  assert.ok(required.includes('JWT_SECRET'), 'the Compose requirement scan must find real keys');

  const callers = [
    [
      'release verify job',
      releaseWorkflow.match(
        /name: Validate production Compose configuration[\s\S]*?config --quiet/u
      ),
    ],
    [
      'container smoke runner',
      containerSmoke.match(/const composeEnvironment = \{[\s\S]*?\n {2}\};/u),
    ],
  ];
  for (const [label, source] of callers) {
    assert.ok(source, `${label} must keep its Compose variable source in place`);
    for (const name of new Set(required)) {
      assert.match(
        source[0],
        new RegExp(`\\b${name}\\s*:`, 'u'),
        `${label} must define ${name}; Compose interpolation fails before any container starts`
      );
    }
  }
});
