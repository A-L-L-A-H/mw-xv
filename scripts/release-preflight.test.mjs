import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const rootPackage = JSON.parse(await read('../package.json'));
const workflow = await read('../.github/workflows/ci.yml');
const releasePreflight = await read('./release-preflight.mjs');
const unitRunner = await read('./run-unit-tests.mjs');
const qualityJob = workflow.slice(
  workflow.indexOf('  quality-and-build:'),
  workflow.indexOf('  unit-tests:')
);

const boundaryContracts = [
  {
    name: 'interactive-session',
    releaseName: 'Interactive-session',
    script: 'interactive-session:boundary:check',
    suite: 'scripts/check-interactive-session-boundary.test.mjs',
    gate: 'scripts/check-interactive-session-boundary.mjs',
  },
  {
    name: 'swarm-observability',
    releaseName: 'Swarm observability',
    script: 'swarm-observability:boundary:check',
    suite: 'scripts/check-swarm-observability-boundary.test.mjs',
    gate: 'scripts/check-swarm-observability-boundary.mjs',
  },
];

test('root scripts run each ADR boundary fixture suite before its repository gate', () => {
  for (const { script, suite, gate } of boundaryContracts) {
    assert.equal(
      rootPackage.scripts[script],
      `node --test ${suite} && node ${gate}`,
      `${script} must preserve the ADR suite-then-gate verification order`
    );
  }
});

test('quality CI executes both ADR boundary suites and gates', () => {
  for (const { script } of boundaryContracts) {
    assert.ok(qualityJob.includes(`bun run ${script}`), `quality-and-build must run ${script}`);
  }
});

test('release preflight runs both ADR boundary suites and repository gates', () => {
  const normalizedPreflight = releasePreflight.replace(/\s+/gu, '');
  for (const { releaseName, suite, gate } of boundaryContracts) {
    const normalizedName = releaseName.replace(/\s+/gu, '');
    const suiteLabel = `'${normalizedName}ADRboundarysuite'`;
    const gateLabel = `'${normalizedName}ADRboundarygate'`;
    const suiteIndex = normalizedPreflight.indexOf(suiteLabel);
    const gateIndex = normalizedPreflight.indexOf(gateLabel);
    assert.ok(suiteIndex >= 0, `release preflight must declare the ${releaseName} suite`);
    assert.ok(gateIndex >= 0, `release preflight must declare the ${releaseName} gate`);
    assert.ok(normalizedPreflight.includes(`['--test','${suite}']`));
    assert.ok(normalizedPreflight.includes(`['${gate}']`));
    assert.ok(
      suiteIndex < gateIndex,
      `${releaseName} release checks must run the fixture suite before the repository gate`
    );
  }
});

test('agent observability tests run in both active unit CI paths', () => {
  assert.match(
    rootPackage.scripts['test:unit:built'],
    /bun --filter @moonwitness\/agent-observability test\b/u,
    'the unit-tests job invokes test:unit:built and must include instrumentation tests'
  );
  assert.match(
    unitRunner,
    /name:\s*'agent-observability',\s*packageName:\s*'@moonwitness\/agent-observability'/u,
    'test:unit:ci must retain its agent observability suite'
  );
  assert.match(
    rootPackage.scripts['test:unit:built'],
    /bun run test:release-preflight\b/u,
    'active unit CI must run the release gate wiring policy'
  );
});
