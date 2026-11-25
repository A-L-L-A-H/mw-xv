import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(new URL('./check-interactive-session-boundary.mjs', import.meta.url));
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const CLEAN_COMPOSE = `name: moonwitness
services:
  agent-sandbox:
    build: ../../apps/agent-sandbox
    image: moonwitness-agent-sandbox:production
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    # /var/run/docker.sock and ./:/workspace are deliberately forbidden.
    environment:
      NODE_ENV: production
    volumes:
      - agent_sandbox_data:/var/lib/agent-sandbox:rw
      - type: volume
        source: agent_sandbox_data
        target: /var/lib/agent-sandbox-cache
volumes:
  agent_sandbox_data:
`;

async function writeFixture(root, relativeFile, content) {
  const absoluteFile = path.join(root, ...relativeFile.split('/'));
  await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
  await fs.writeFile(absoluteFile, content, 'utf8');
}

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mw-interactive-session-boundary-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const files = {
    'apps/api/src/routes/health.routes.ts': `export const health = { status: 'ok' };\n`,
    'apps/api/src/routes/auth.routes.ts': `export const authSessionRoute = '/auth/session';\n`,
    'apps/board/src/components/cloud/paas-template-data.ts': `// import fs from 'node:fs' is documentation only.\nexport const runtime = 'node:24-alpine';\nexport const example = "import x from 'opencode'";\n`,
    'packages/ui/src/button.tsx': `export function Button() { return <button>Run</button>; }\n`,
    'apps/desktop/src/harness.ts': `import type { PcwOutboxModelName } from './types.js';\nexport interface LocalAiDiscoveredModel { id: string }\nexport interface ModelProfileConfig { id: string }\nexport const issueSession = (id: string) => id;\nexport function installAddons(addons: readonly unknown[]) { return addons; }\nexport const localTables = ['desktop_local_runs', 'desktop_pcw_outbox', 'desktop_pcw_artifacts'];\n`,
    'apps/desktop/src/types.ts': `export type PcwOutboxModelName = 'local' | 'remote';\n`,
    'packages/orm-ai/src/existing-run.ts': `export interface TrustedRunSnapshot { runId: string }\n`,
    'deploy/compose/docker-compose.production.yml': CLEAN_COMPOSE,
  };
  await Promise.all(
    Object.entries(files).map(([relativeFile, content]) => writeFixture(root, relativeFile, content))
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
    (violation) => `${violation.file ?? ''}\0${violation.line ?? 0}\0${violation.code}\0${violation.message}`
  );
  assert.deepEqual(keys, [...keys].sort());
  for (const check of report.checks) {
    assert.deepEqual(check.checkedFiles, [...check.checkedFiles].sort());
    assert.deepEqual(check.skipped, [...check.skipped].sort());
  }
}

test('clean fixture passes JSON and human CLI modes with stable checked files', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  const json = await runJson(root);
  assert.equal(json.status, 0);
  assert.equal(json.report.ok, true);
  assert.equal(json.report.violationCount, 0);
  assert.equal(json.report.schemaVersion, 1);
  assert.equal(json.report.gate, 'interactive-session-boundary');
  assert.equal(json.report.rootDir, root);
  assert.deepEqual(
    json.report.checks.map((check) => check.id),
    [
      'scan-integrity',
      'addon-http-route-boundary',
      'opencode-import-boundary',
      'browser-native-import-boundary',
      'desktop-authority-boundary',
      'production-sandbox-boundary',
    ]
  );
  assert.ok(json.report.checkedFiles.includes('apps/desktop/src/harness.ts'));
  assert.ok(json.report.checkedFiles.includes('deploy/compose/docker-compose.production.yml'));
  assertSortedReport(json.report);

  const human = await runGate(root);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /interactive-session-boundary: PASS/u);
  assert.match(human.stdout, /files checked/u);
  assert.equal(human.stderr, '');
});

test('interactive-session API route filenames are rejected', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(root, 'apps/api/src/routes/interactive-session.routes.ts', `export const routes = [];\n`);
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert.equal(violationsFor(report, 'CUSTOM_INTERACTIVE_SESSION_API_ROUTE_FILE').length, 1);
  assertSortedReport(report);
});

test('interactive-session route literals cannot hide in an allowlisted route file', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'apps/api/src/routes/health.routes.ts',
    `export function register(app: { post(path: string, handler: unknown): void }) {\n  app.post('/api/companies/:companyId/interactive-sessions', async () => 'ok');\n}\n`
  );
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  assert.equal(violationsFor(report, 'CUSTOM_INTERACTIVE_SESSION_API_ROUTE').length, 1);
  assert.equal(violationsFor(report, 'CUSTOM_INTERACTIVE_SESSION_API_ROUTE')[0].line, 2);
});

test('OpenCode package and vendored imports are rejected across module syntaxes', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'packages/orm-ai/src/second-control-plane.ts',
    `import { core } from '@opencode/core';\nexport { sdk } from 'opencode';\nconst lazy = import('../../../vendor/opencode/packages/core/src/index.ts');\nconst legacy = require('@opencode-ai/sdk');\nimport { escaped } from '@opencode\\x2fcore';\n// import ignored from '@opencode/comment';\nconst documentation = "require('opencode')";\nconst value = { from: (input: TemplateStringsArray) => input[0] };\nconst tagged = value.from\`opencode\`;\nconst pattern = /import\\('opencode'\\)/;\n`
  );
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  const violations = violationsFor(report, 'OPENCODE_IMPORT');
  assert.equal(violations.length, 5);
  assert.deepEqual(
    violations.map((violation) => violation.line),
    [1, 2, 3, 4, 5]
  );
});

test('Board and shared UI cannot import PTY, Tauri, SQLite, or node runtime modules', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'apps/board/src/native-bridge.ts',
    `import type { spawn } from 'node-pty';\nimport { invoke } from '@tauri-apps/api/core';\nimport Database from 'better-sqlite3';\nimport fs from 'node:fs';\nexport const lazy = import('node:path');\nexport const templated = import(\`node:os\`);\n`
  );
  await writeFixture(root, 'packages/ui/src/desktop-api.ts', `import { app } from 'tauri';\n`);
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  const violations = violationsFor(report, 'BROWSER_NATIVE_IMPORT');
  assert.equal(violations.length, 7);
  for (const specifier of ['node-pty', '@tauri-apps/api/core', 'better-sqlite3', 'node:fs', 'node:path', 'node:os', 'tauri']) {
    assert.ok(violations.some((violation) => violation.message.includes(JSON.stringify(specifier))), specifier);
  }
});

test('Desktop cannot define ORM, session, model, or event authority', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'apps/desktop/src/second-authority.ts',
    `import { defineAddon, defineModel } from '@moonwitness/orm';\ndefineModel('desktop.session');\ndefineAddon({ name: 'desktop' });\nexport class InteractiveSessionStore {}\nexport function createModelRegistry() {}\nconst database = { exec: (statement: string) => statement };\ndatabase.exec(\`CREATE TABLE IF NOT EXISTS interactive_session_events (id text)\`);\n// class ModelRegistry {}\nconst documentation = 'defineModel("ignored")';\n`
  );
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  assert.equal(violationsFor(report, 'DESKTOP_SECOND_AUTHORITY_DEFINITION').length, 2);
  assert.equal(violationsFor(report, 'DESKTOP_SECOND_AUTHORITY_FACTORY').length, 2);
  assert.equal(violationsFor(report, 'DESKTOP_SECOND_AUTHORITY_TABLE').length, 1);
  assert.equal(report.violations.filter((violation) => violation.code.startsWith('DESKTOP_SECOND_AUTHORITY')).length, 5);
});

test('canonical production sandbox rejects Docker sockets, including long syntax', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'deploy/compose/docker-compose.production.yml',
    `services:\n  agent-sandbox:\n    read_only: true\n    volumes:\n      - type: bind\n        source: /var/run/docker.sock\n        target: /run/docker.sock\n        read_only: true\n`
  );
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  assert.ok(violationsFor(report, 'PRODUCTION_SANDBOX_DOCKER_SOCKET').length >= 1);
  assert.ok(violationsFor(report, 'PRODUCTION_SANDBOX_HOST_BIND').length >= 1);
});

test('canonical production sandbox rejects repository, absolute, and unresolved host binds', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'deploy/compose/docker-compose.production.yml',
    `services:\n  agent-sandbox:\n    volumes:\n      - ./:/workspace:ro\n      - /srv/moonwitness:/repo:ro\n      - \${HOST_REPO:-.}:/workspace:ro\n      - type: bind\n        source: C:\\\\repo\n        target: /workspace\n        read_only: true\n      - agent_sandbox_data:/var/lib/agent-sandbox\n`
  );
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  assert.equal(violationsFor(report, 'PRODUCTION_SANDBOX_HOST_BIND').length, 4);
});

test('production compatibility Compose is checked too', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(
    root,
    'deploy/compose/docker-compose.prd.yml',
    `include:\n  - docker-compose.production.yml\nservices:\n  agent-sandbox:\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n`
  );
  const { status, report } = await runJson(root);
  assert.equal(status, 1);
  const socket = violationsFor(report, 'PRODUCTION_SANDBOX_DOCKER_SOCKET')[0];
  assert.equal(socket.file, 'deploy/compose/docker-compose.prd.yml');
});

test('vendor, dependencies, generated output, fixtures, and test files are ignored', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  const ignoredFiles = {
    'vendor/opencode/packages/core/src/index.ts': `import 'opencode';\n`,
    'apps/board/node_modules/opencode/index.ts': `import 'node:fs';\n`,
    'apps/board/dist/native.js': `import 'node-pty';\n`,
    'packages/ui/dist/bundle.ts': `import 'better-sqlite3';\n`,
    'apps/desktop/.git/second-authority.ts': `defineAddon({});\n`,
    'apps/api/src/routes/fixtures/interactive-session.routes.ts': `export const routes = [];\n`,
    'apps/board/src/components/__fixtures__/native.ts': `import 'node:path';\n`,
    'apps/desktop/src/authority.spec.ts': `defineModel('bad');\n`,
    'packages/ui/tests/native.test.ts': `import 'node:os';\n`,
  };
  await Promise.all(Object.entries(ignoredFiles).map(([file, content]) => writeFixture(root, file, content)));
  await fs.symlink(
    path.join(root, 'vendor/opencode/packages/core/src/index.ts'),
    path.join(root, 'apps/board/node_modules/opencode-link.ts')
  );

  const { status, report } = await runJson(root);
  assert.equal(status, 0);
  assert.equal(report.violationCount, 0);
  for (const ignoredFile of Object.keys(ignoredFiles)) {
    assert.equal(report.checkedFiles.includes(ignoredFile), false, ignoredFile);
  }
  assert.equal(report.checkedFiles.includes('apps/board/node_modules/opencode-link.ts'), false);
});

test('missing canonical Compose and unresolved aliases fail closed', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await fs.rm(path.join(root, 'deploy/compose/docker-compose.production.yml'));
  const missing = await runJson(root);
  assert.equal(missing.status, 1);
  assert.equal(violationsFor(missing.report, 'MISSING_PRODUCTION_COMPOSE').length, 1);

  await writeFixture(
    root,
    'deploy/compose/docker-compose.production.yml',
    `x-sandbox: &sandbox\n  volumes:\n    - ./:/workspace\nservices:\n  agent-sandbox:\n    <<: *sandbox\n`
  );
  const alias = await runJson(root);
  assert.equal(alias.status, 1);
  assert.ok(violationsFor(alias.report, 'UNRESOLVED_COMPOSE_ALIAS').length >= 1);
});

test('JSON and violation ordering are deterministic for the same fixture', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  await writeFixture(root, 'apps/board/src/z-native.ts', `import fs from 'node:path';\n`);
  await writeFixture(root, 'apps/desktop/src/a-authority.ts', `defineAddon({});\n`);
  await writeFixture(root, 'apps/api/src/routes/z-interactive-session.routes.ts', `export const routes = [];\n`);
  await writeFixture(
    root,
    'deploy/compose/docker-compose.production.yml',
    `services:\n  agent-sandbox:\n    volumes:\n      - ./:/workspace\n      - /var/run/docker.sock:/var/run/docker.sock\n`
  );

  const first = await runJson(root);
  const second = await runJson(root);
  assert.equal(first.status, 1);
  assert.equal(first.stdout, second.stdout);
  assertSortedReport(first.report);
});

test('invalid CLI arguments return nonzero and preserve the selected output mode', { timeout: 30_000 }, async (t) => {
  const root = await createFixture(t);
  const unknown = await runJson(root, ['--unknown']);
  assert.equal(unknown.status, 1);
  assert.equal(violationsFor(unknown.report, 'INVALID_ARGUMENTS').length, 1);

  const missingRoot = await runGate(root, ['--root']);
  assert.equal(missingRoot.status, 1);
  assert.equal(missingRoot.stdout, '');
  assert.match(missingRoot.stderr, /Usage:/u);
});

test('current repository passes the boundary gate through the default CLI root', { timeout: 60_000 }, async () => {
  const result = await runJson(REPOSITORY_ROOT, [], { useDefaultRoot: true });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.violationCount, 0);
  assert.ok(result.report.checkedFiles.length > 100);
  assertSortedReport(result.report);
});
