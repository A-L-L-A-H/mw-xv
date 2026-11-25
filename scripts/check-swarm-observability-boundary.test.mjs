import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(
  new URL('./check-swarm-observability-boundary.mjs', import.meta.url)
);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const CLEAN_PLUGIN = `import { timingSafeEqual } from 'node:crypto';
import { SqlTelemetryStore } from './sql-store.js';
export const observabilityHttpPlugin = async (app, options) => {
  const store = new SqlTelemetryStore(options.db, { closeDb: false });
  app.post('/v1/traces', { config: { public: true } }, async () => ({}));
  app.post('/v1/metrics', { config: { public: true } }, async () => ({}));
  app.post('/v1/logs', { config: { public: true } }, async () => ({}));
  app.post('/v1/qoder', { config: { public: true } }, async () => ({}));
  app.get('/api/observability/summary', async () => ({}));
  app.get('/api/observability/traces', async () => ({}));
  app.get('/api/observability/traces/:traceId', async () => ({}));
  app.get('/api/observability/logs', async () => ({}));
  app.get('/api/observability/metrics', async () => ({}));
  app.get('/api/observability/config', async () => ({}));
};
`;
const CLEAN_MANIFEST = `import { defineAddon } from '@moonwitness/orm';
import { observabilityHttpPlugin } from './http-plugin.js';
export const observabilityAddon = defineAddon({
  name: 'observability',
  httpPlugins: [observabilityHttpPlugin],
  models: [],
});
`;
const CLEAN_REGISTRY = `import { observabilityAddon } from '@moonwitness/orm-observability';
export const API_ADDONS = [
  { name: 'observability', manifest: observabilityAddon },
];
`;
const CLEAN_COMPOSE = `services:
  board:
    x-app-environment: &app_environment
      NODE_ENV: production
  api:
    environment:
      <<: *app_environment
      OBSERVABILITY_INGEST_TOKEN: \${OBSERVABILITY_INGEST_TOKEN:-}
  jobs-worker:
    environment: *app_environment
`;

async function writeFixture(root, relativeFile, content) {
  const absoluteFile = path.join(root, ...relativeFile.split('/'));
  await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
  await fs.writeFile(absoluteFile, content, 'utf8');
}

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mw-swarm-observability-boundary-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const files = {
    'apps/api/src/addons/registry.ts': CLEAN_REGISTRY,
    'apps/api/src/routes/health.routes.ts': `export const health = true;\n`,
    'apps/board/src/page.tsx': `export function Page() { return <main>Mission Control</main>; }\n`,
    'deploy/compose/docker-compose.production.yml': CLEAN_COMPOSE,
    'apps/agent-observability/src/instrumentation.ts': `export const endpoint = '/v1/traces';\n`,
    'apps/agent-observability/src/index.ts': `export * from './instrumentation.js';\n`,
    'apps/agent-observability/package.json': JSON.stringify({
      name: '@moonwitness/agent-observability',
      scripts: { build: 'tsc', typecheck: 'tsc --noEmit', test: 'vitest run' },
      dependencies: { '@opentelemetry/sdk-node': '0.301.2' },
    }),
    'packages/orm-observability/src/http-plugin.ts': CLEAN_PLUGIN,
    'packages/orm-observability/src/manifest.ts': CLEAN_MANIFEST,
    'packages/ui/src/button.tsx': `export function Button() { return <button>Run</button>; }\n`,
  };
  await Promise.all(
    Object.entries(files).map(([file, content]) => writeFixture(root, file, content))
  );
  return root;
}

async function runGate(root, args = [], { useDefaultRoot = false } = {}) {
  const commandArgs = useDefaultRoot ? args : ['--root', root, ...args];
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT_PATH, ...commandArgs], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { status: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function runJson(root, args = [], options = {}) {
  const result = await runGate(root, ['--json', ...args], options);
  assert.equal(result.stderr, '', 'JSON mode must keep stderr empty');
  return { ...result, report: JSON.parse(result.stdout) };
}

function violationsFor(report, code) {
  return report.violations.filter((violation) => violation.code === code);
}

function assertSortedReport(report) {
  assert.deepEqual(report.checkedFiles, [...report.checkedFiles].sort());
  const keys = report.violations.map(
    (violation) =>
      `${violation.file ?? ''}\0${violation.line ?? 0}\0${violation.code}\0${violation.message}`
  );
  assert.deepEqual(keys, [...keys].sort());
  for (const check of report.checks) {
    assert.deepEqual(check.checkedFiles, [...check.checkedFiles].sort());
    assert.deepEqual(check.skipped, [...check.skipped].sort());
  }
}

test(
  'clean fixture passes JSON and human modes with stable report ordering',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    const json = await runJson(root);
    assert.equal(json.status, 0, json.stdout);
    assert.equal(json.report.ok, true);
    assert.equal(json.report.violationCount, 0);
    assert.equal(json.report.schemaVersion, 1);
    assert.equal(json.report.gate, 'swarm-observability-boundary');
    assert.equal(json.report.rootDir, root);
    assert.deepEqual(
      json.report.checks.map((check) => check.id),
      [
        'scan-integrity',
        'observability-domain-ownership',
        'observability-route-ownership',
        'addon-registration',
        'instrumentation-only-boundary',
        'shared-db-lifecycle',
        'production-credential-scope',
      ]
    );
    assert.ok(json.report.checkedFiles.includes('apps/agent-observability/package.json'));
    assertSortedReport(json.report);

    const human = await runGate(root);
    assert.equal(human.status, 0);
    assert.match(human.stdout, /swarm-observability-boundary: PASS/u);
    assert.match(human.stdout, /files checked/u);
    assert.equal(human.stderr, '');
  }
);

test(
  'second observability model, addon, and store authorities are rejected',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    await writeFixture(
      root,
      'apps/board/src/second-authority.ts',
      `defineModel('observability.trace');
defineAddon({ name: 'observability' });
export class MemoryTelemetryStore {}
`
    );
    const { status, report } = await runJson(root);
    assert.equal(status, 1);
    assert.equal(violationsFor(report, 'SECOND_OBSERVABILITY_MODEL_AUTHORITY').length, 1);
    assert.equal(violationsFor(report, 'SECOND_OBSERVABILITY_ADDON_AUTHORITY').length, 1);
    assert.equal(violationsFor(report, 'SECOND_OBSERVABILITY_STORE_AUTHORITY').length, 1);
    assertSortedReport(report);
  }
);

test(
  'observability API route files and route registrations outside the addon are rejected',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    await writeFixture(
      root,
      'apps/api/src/routes/telemetry.routes.ts',
      `export const routes = [];\n`
    );
    await writeFixture(
      root,
      'apps/api/src/routes/health.routes.ts',
      `export function register(app: { get(path: string, handler: unknown): void }) {
  app.get('/api/observability/summary', async () => 'ok');
}
`
    );
    const { status, report } = await runJson(root);
    assert.equal(status, 1);
    assert.equal(violationsFor(report, 'OBSERVABILITY_API_ROUTE_FILE').length, 1);
    assert.equal(violationsFor(report, 'OBSERVABILITY_ROUTE_OUTSIDE_ADDON').length, 1);
    assert.equal(violationsFor(report, 'OBSERVABILITY_ROUTE_OUTSIDE_ADDON')[0].line, 2);
  }
);

test(
  'the addon must expose the complete canonical HTTP contract',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    await writeFixture(
      root,
      'packages/orm-observability/src/http-plugin.ts',
      CLEAN_PLUGIN.replace(
        "  app.post('/v1/qoder', { config: { public: true } }, async () => ({}));\n",
        ''
      )
    );
    const { status, report } = await runJson(root);
    assert.equal(status, 1);
    const missing = violationsFor(report, 'MISSING_OBSERVABILITY_ROUTE');
    assert.equal(missing.length, 1);
    assert.match(missing[0].message, /POST \/v1\/qoder/u);
  }
);

test(
  'addon HTTP registration is required in the manifest and API registry',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    await writeFixture(
      root,
      'packages/orm-observability/src/manifest.ts',
      CLEAN_MANIFEST.replace('httpPlugins: [observabilityHttpPlugin]', 'httpPlugins: []')
    );
    await writeFixture(root, 'apps/api/src/addons/registry.ts', `export const API_ADDONS = [];\n`);
    const { status, report } = await runJson(root);
    assert.equal(status, 1);
    assert.equal(violationsFor(report, 'MISSING_OBSERVABILITY_HTTP_PLUGIN').length, 1);
    assert.equal(violationsFor(report, 'MISSING_API_OBSERVABILITY_ADDON').length, 1);
  }
);

test(
  'instrumentation cannot regain a receiver, listener, queue, database, or server export',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    await writeFixture(
      root,
      'apps/agent-observability/src/server.ts',
      `import fastify from 'fastify';
import Database from 'better-sqlite3';
const app = fastify();
app.listen(4318);
export const database = new Database('telemetry.db');
`
    );
    await writeFixture(
      root,
      'apps/agent-observability/src/index.ts',
      `export * from './server.js';\n`
    );
    await writeFixture(
      root,
      'apps/agent-observability/package.json',
      JSON.stringify({
        scripts: { dev: 'tsx src/server.ts', start: 'node dist/server.js' },
        dependencies: { fastify: '5', knex: '3', bullmq: '5' },
      })
    );
    await writeFixture(
      root,
      'apps/agent-observability/public/index.html',
      `<h1>Second dashboard</h1>\n`
    );
    const { status, report } = await runJson(root);
    assert.equal(status, 1);
    assert.equal(violationsFor(report, 'STANDALONE_OBSERVABILITY_SOURCE').length, 1);
    assert.equal(violationsFor(report, 'INSTRUMENTATION_SERVER_IMPORT').length, 2);
    assert.equal(violationsFor(report, 'INSTRUMENTATION_LISTENER').length, 1);
    assert.equal(violationsFor(report, 'INSTRUMENTATION_SERVER_EXPORT').length, 1);
    assert.equal(violationsFor(report, 'STANDALONE_OBSERVABILITY_SCRIPT').length, 2);
    assert.equal(violationsFor(report, 'INSTRUMENTATION_SERVER_DEPENDENCY').length, 3);
    assert.equal(violationsFor(report, 'STANDALONE_OBSERVABILITY_UI').length, 1);
  }
);

test('the addon cannot own or destroy the shared API database', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'packages/orm-observability/src/http-plugin.ts',
    CLEAN_PLUGIN.replace('{ closeDb: false }', '{ closeDb: true }').replace(
      '  const store = new SqlTelemetryStore(options.db, { closeDb: true });',
      '  const store = new SqlTelemetryStore(options.db, { closeDb: true });\n  options.db.destroy();'
    )
  );
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  assert.equal(violationsFor(report, 'ADDON_OWNS_SHARED_DB_LIFECYCLE').length, 1);
  assert.equal(violationsFor(report, 'ADDON_DESTROYS_SHARED_DB').length, 1);
});

test(
  'production Compose scopes the write-only ingest credential to the API',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    const missing = await runJson(root);
    assert.equal(missing.status, 0, missing.stdout);

    await writeFixture(
      root,
      'deploy/compose/docker-compose.production.yml',
      CLEAN_COMPOSE.replace(
        '      OBSERVABILITY_INGEST_TOKEN: ${OBSERVABILITY_INGEST_TOKEN:-}\n',
        ''
      ).replace(
        '      NODE_ENV: production',
        '      NODE_ENV: production\n      OBSERVABILITY_INGEST_TOKEN: ${OBSERVABILITY_INGEST_TOKEN:-}'
      )
    );
    const leaked = await runJson(root);
    assert.equal(leaked.status, 1);
    assert.equal(violationsFor(leaked.report, 'OBSERVABILITY_CREDENTIAL_OUTSIDE_API').length, 1);
    assert.equal(violationsFor(leaked.report, 'MISSING_API_OBSERVABILITY_CREDENTIAL').length, 1);

    await writeFixture(
      root,
      'deploy/compose/docker-compose.production.yml',
      CLEAN_COMPOSE.replace('${OBSERVABILITY_INGEST_TOKEN:-}', '${OBSERVABILITY_INGEST_TOKEN}')
    );
    const required = await runJson(root);
    assert.equal(required.status, 1);
    assert.equal(
      violationsFor(required.report, 'INVALID_OBSERVABILITY_CREDENTIAL_BINDING').length,
      1
    );
  }
);

test('required contract files fail closed when missing', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await fs.rm(path.join(root, 'packages/orm-observability/src/http-plugin.ts'));
  await fs.rm(path.join(root, 'apps/agent-observability/package.json'));
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  assert.equal(violationsFor(report, 'MISSING_REQUIRED_FILE').length, 2);
  assert.equal(violationsFor(report, 'MISSING_OBSERVABILITY_ROUTE').length, 10);
});

test(
  'tests, dependencies, generated output, comments, and non-import strings are ignored',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    const ignoredFiles = {
      'apps/agent-observability/tests/server.test.ts': `import fastify from 'fastify';\n`,
      'apps/agent-observability/dist/server.js': `require('fastify').listen(4318);\n`,
      'apps/board/node_modules/second-authority.ts': `defineModel('observability.trace');\n`,
      'packages/orm-observability/dist/http-plugin.js': `db.destroy();\n`,
      'vendor/opencode/server.ts': `app.post('/v1/traces', () => {});\n`,
      'apps/board/src/authority.spec.ts': `defineAddon({ name: 'observability' });\n`,
    };
    await Promise.all(
      Object.entries(ignoredFiles).map(([file, content]) => writeFixture(root, file, content))
    );
    await writeFixture(
      root,
      'apps/board/src/page.tsx',
      `// defineModel('observability.trace'); app.post('/v1/traces', () => {});
const documentation = "import fastify from 'fastify'";
export function Page() { return <main>{documentation}</main>; }
`
    );
    const { status, report } = await runJson(root);
    assert.equal(status, 0, report.violations.map((item) => item.message).join('\n'));
    for (const ignored of Object.keys(ignoredFiles))
      assert.equal(report.checkedFiles.includes(ignored), false, ignored);
  }
);

test('JSON output is deterministic for repeated evaluation', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'apps/board/src/z-authority.ts',
    `defineModel('observability.trace');\n`
  );
  await writeFixture(root, 'apps/board/src/a-server.ts', `export class MemoryTelemetryStore {}\n`);
  const first = await runJson(root);
  const second = await runJson(root);
  assert.equal(first.status, 1);
  assert.equal(first.stdout, second.stdout);
  assertSortedReport(first.report);
});

test(
  'invalid CLI arguments preserve JSON and human output modes',
  { timeout: 30_000 },
  async (t) => {
    const root = await createFixture(t);
    const unknown = await runJson(root, ['--unknown']);
    assert.equal(unknown.status, 1);
    assert.equal(violationsFor(unknown.report, 'INVALID_ARGUMENTS').length, 1);

    const missingRoot = await runGate(root, ['--root']);
    assert.equal(missingRoot.status, 1);
    assert.equal(missingRoot.stdout, '');
    assert.match(missingRoot.stderr, /Usage:/u);
  }
);

test(
  'current repository passes the single-authority boundary gate',
  { timeout: 60_000 },
  async () => {
    const result = await runJson(REPOSITORY_ROOT, [], { useDefaultRoot: true });
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.report.ok, true);
    assert.equal(result.report.violationCount, 0);
    assert.ok(result.report.checkedFiles.length > 100);
    assertSortedReport(result.report);
  }
);
