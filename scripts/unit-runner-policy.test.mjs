import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { unitRunnerChecks } from './unit-runner-policy.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const unitRunner = await readFile(new URL('./run-unit-tests.mjs', import.meta.url), 'utf8');

describe('unit runner CI ownership', () => {
  it('owns every shared contract because CI has a single job', () => {
    assert.deepEqual(
      unitRunnerChecks.map(({ name, args }) => [name, args.join(' ')]),
      [
        ['Board bundle budget contract', 'run test:board-budget'],
        ['Board production bundle budget', 'run board:budget'],
        ['Versioned documentation', 'run test:versioned-docs'],
        ['brand asset contracts', 'run test:assets'],
        ['shared UI token contracts', 'run test:ui'],
      ]
    );
  });

  it('runs those contracts from the job the branch ruleset requires', () => {
    const jobsBlock = workflow.split(/\njobs:\r?\n/u)[1];
    assert.ok(jobsBlock);
    const jobNames = [...jobsBlock.matchAll(/^ {2}([a-z][\w-]+):\r?$/gmu)].map(([_, name]) => name);
    assert.deepEqual(jobNames, [
      'secret-scan',
      'static-analysis',
      'dependency-audit',
      'quality-and-build',
      'unit-tests',
      'knowledge-gate',
      'postgres-integration',
      'dx-test',
      'gate-failure-triage',
      'ci-gate',
    ]);
    assert.match(jobsBlock, /bun run test:unit:built/u);
  });

  it('keeps the asset scripts split the way the checks expect', () => {
    assert.match(
      rootPackage.scripts['test:assets'],
      /test:assets:source && bun run assets:check:docs/u
    );
    assert.match(rootPackage.scripts['test:assets:source'], /export-doc-assets\.test\.mjs/u);
  });

  it('covers every packages/orm-* package with a test script in both run-unit-tests.mjs and test:unit:built', async () => {
    const packageEntries = await readdir(path.join(rootDir, 'packages'), { withFileTypes: true });
    const ormDirs = packageEntries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('orm-'))
      .map((entry) => entry.name)
      .sort();

    const testedOrmPackages = [];
    const untestedOrmPackages = [];

    for (const dir of ormDirs) {
      const manifest = JSON.parse(
        await readFile(path.join(rootDir, 'packages', dir, 'package.json'), 'utf8')
      );
      const testScript = manifest.scripts?.test;
      if (typeof testScript === 'string' && testScript.trim().length > 0) {
        testedOrmPackages.push({
          dir,
          packageName: manifest.name,
          runsTsCheck: testScript.includes('tsconfig.check.json'),
        });
      } else {
        untestedOrmPackages.push(manifest.name);
      }
    }

    // orm-cli is a thin bin wrapper for db:seed and defines no test suite.
    assert.deepEqual(untestedOrmPackages, ['@moonwitness/orm-cli']);

    const suiteBlock = unitRunner.match(/const suites = \[([\s\S]*?)\r?\n\];/u)?.[1];
    assert.ok(suiteBlock, 'run-unit-tests.mjs must declare suites');

    const runnerOrmNames = new Set(
      [...suiteBlock.matchAll(/packageName:\s*'(@moonwitness\/orm-[^']+)'/gu)].map(
        ([, name]) => name
      )
    );
    const builtScript = rootPackage.scripts['test:unit:built'];

    for (const { packageName, runsTsCheck } of testedOrmPackages) {
      assert.ok(
        runnerOrmNames.has(packageName),
        `${packageName} defines a test script and must be included in scripts/run-unit-tests.mjs`
      );
      if (runsTsCheck) {
        assert.match(
          suiteBlock,
          new RegExp(`packageName:\\s*'${packageName}'[^}]*typecheck:\\s*true`, 'u'),
          `${packageName} runs tsconfig.check.json in its test script and must enable typecheck in run-unit-tests.mjs`
        );
      }
      assert.match(
        builtScript,
        new RegExp(`--filter ${packageName}\\s+test\\b`, 'u'),
        `${packageName} must be included in root package.json test:unit:built`
      );
    }
  });
});
