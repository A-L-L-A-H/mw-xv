import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLOUD_AGENT_ADR,
  EXPECTED_UPSTREAM,
  FREELMAPI_DATA_VOLUME,
  HARD_CODED_CLOUD_TOKEN,
  VENDOR_ROOT,
  checkBoardSource,
  checkCloudEgressClassification,
  checkDockerIgnore,
  checkProductionCompose,
  checkVendorProvenance,
  checkWorkspaceExclusion,
  classifyForbiddenVendorPath,
  dockerIgnoreExcludesVendor,
  evaluateCloudAgentInvariants,
  findForbiddenVendoredPaths,
  findHardCodedCloudAdapterToken,
  runCloudAgentGateCli,
} from './check-cloud-agent-invariants.mjs';

const UPSTREAM_JSON = JSON.stringify({
  ...EXPECTED_UPSTREAM,
  importedAt: '2026-11-24',
  importMethod: 'git-archive-tracked-files',
  localPatches: [],
});
const MIT_LICENSE = `MIT License\n\nCopyright (c) 2026 Tashfeen Ahmed\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n`;

function codes(violations) {
  return violations.map((violation) => violation.code);
}

test('gate constants pin the ADR, vendored path, volume and retired token', () => {
  assert.equal(CLOUD_AGENT_ADR, 'docs/decisions/0014-freellmapi-cloud-coding-agent.md');
  assert.equal(VENDOR_ROOT, 'vendor/freellmapi');
  assert.equal(FREELMAPI_DATA_VOLUME, 'moonwitness-freellmapi-data');
  assert.equal(HARD_CODED_CLOUD_TOKEN, 'mw-cloud-adapter-secret-token');
  assert.equal(EXPECTED_UPSTREAM.revision, 'cd65d6485788dfc7828f06c1147cdea207b28322');
});

test('vendor provenance requires exact upstream metadata and MIT license', () => {
  assert.deepEqual(checkVendorProvenance(UPSTREAM_JSON, MIT_LICENSE), []);
  assert.ok(codes(checkVendorProvenance(null, MIT_LICENSE)).includes('MISSING_UPSTREAM_METADATA'));
  assert.ok(codes(checkVendorProvenance('{', MIT_LICENSE)).includes('INVALID_UPSTREAM_METADATA'));
  assert.ok(codes(checkVendorProvenance(UPSTREAM_JSON, null)).includes('MISSING_MIT_LICENSE'));

  const drifted = JSON.stringify({ ...JSON.parse(UPSTREAM_JSON), revision: 'deadbeef' });
  assert.ok(
    codes(checkVendorProvenance(drifted, MIT_LICENSE)).includes('UPSTREAM_METADATA_MISMATCH')
  );
});

test('forbidden vendored runtime/build paths are classified', () => {
  assert.equal(classifyForbiddenVendorPath('.git/config'), 'NESTED_GIT_METADATA');
  assert.equal(classifyForbiddenVendorPath('.env'), 'RUNTIME_ENV_FILE');
  assert.equal(classifyForbiddenVendorPath('server/.env.production'), 'RUNTIME_ENV_FILE');
  assert.equal(classifyForbiddenVendorPath('server/data/app.db'), 'SQLITE_RUNTIME_DATA');
  assert.equal(classifyForbiddenVendorPath('server/data/app.db-wal'), 'SQLITE_RUNTIME_DATA');
  assert.equal(classifyForbiddenVendorPath('server/data'), 'VENDORED_SERVER_DATA');
  assert.equal(classifyForbiddenVendorPath('node_modules/x/index.js'), 'VENDORED_DEPENDENCIES');
  assert.equal(classifyForbiddenVendorPath('client/dist/bundle.js'), 'VENDORED_BUILD_OUTPUT');
  assert.equal(classifyForbiddenVendorPath('client/src/data/agent-tools.json'), null);
  assert.equal(classifyForbiddenVendorPath('LICENSE'), null);

  const violations = findForbiddenVendoredPaths([
    'server/data/app.db',
    'client/src/data/agent-tools.json',
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].code, 'SQLITE_RUNTIME_DATA');
});

test('vendor cannot join the workspace or main Docker context', () => {
  assert.deepEqual(
    checkWorkspaceExclusion(JSON.stringify({ workspaces: ['packages/*', 'apps/*'] })),
    []
  );
  assert.ok(
    codes(checkWorkspaceExclusion(JSON.stringify({ workspaces: ['vendor/freellmapi'] }))).includes(
      'VENDOR_IN_PNPM_WORKSPACE'
    )
  );
  assert.ok(
    codes(checkWorkspaceExclusion('packages: ["apps/*", "vendor/*"]')).includes(
      'VENDOR_IN_PNPM_WORKSPACE'
    )
  );
  assert.deepEqual(checkDockerIgnore('node_modules\ndist\nvendor/\n'), []);
  assert.equal(dockerIgnoreExcludesVendor('vendor/'), true);
  assert.equal(dockerIgnoreExcludesVendor('vendor/\n!vendor/freellmapi/UPSTREAM.json'), false);
  assert.ok(codes(checkDockerIgnore('node_modules\n')).includes('VENDOR_NOT_DOCKER_IGNORED'));
});

const COMPOSE = `services:
  freellmapi:
    build:
      context: ./vendor/freellmapi
    image: moonwitness-freellmapi:production
    environment:
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
    volumes:
      - freellmapi_data:/app/server/data
  agent-sandbox:
    build: ./apps/agent-sandbox
    volumes:
      - agent_sandbox_data:/var/lib/agent-sandbox
volumes:
  freellmapi_data:
    name: moonwitness-freellmapi-data
  agent_sandbox_data:
`;

test('production Compose accepts internal services with named volumes and no Docker socket', () => {
  const result = checkProductionCompose(COMPOSE);
  assert.deepEqual(result.violations, []);
});

test('production Compose rejects published gateway or sandbox ports', () => {
  const withPort = COMPOSE.replace(
    '    image: moonwitness-freellmapi:production',
    '    image: moonwitness-freellmapi:production\n    ports:\n      - "3001:3001"'
  );
  assert.ok(
    codes(checkProductionCompose(withPort).violations).includes('PRODUCTION_SERVICE_PUBLISHED_PORT')
  );
});

test('production Compose rejects any Docker socket and host repository mounts', () => {
  const rootlessSocket = COMPOSE.replace(
    '      - agent_sandbox_data:/var/lib/agent-sandbox',
    '      - agent_sandbox_data:/var/lib/agent-sandbox\n      - type: bind\n        source: /run/user/1000/docker.sock\n        target: /run/user/1000/docker.sock\n        read_only: true'
  );
  assert.ok(
    codes(checkProductionCompose(rootlessSocket).violations).includes(
      'PRODUCTION_SERVICE_DOCKER_SOCKET'
    )
  );

  const rootSocket = COMPOSE.replace(
    '      - agent_sandbox_data:/var/lib/agent-sandbox',
    '      - agent_sandbox_data:/var/lib/agent-sandbox\n      - type: bind\n        source: /var/run/docker.sock\n        target: /var/run/docker.sock\n        read_only: true'
  );
  assert.ok(
    codes(checkProductionCompose(rootSocket).violations).includes(
      'PRODUCTION_SERVICE_DOCKER_SOCKET'
    )
  );

  const hostMount = COMPOSE.replace(
    '      - agent_sandbox_data:/var/lib/agent-sandbox',
    '      - ./:/workspace:ro\n      - agent_sandbox_data:/var/lib/agent-sandbox'
  );
  assert.ok(
    codes(checkProductionCompose(hostMount).violations).includes('PRODUCTION_SERVICE_HOST_MOUNT')
  );
});

test('production Compose requires the FreeLLMAPI data volume', () => {
  const noVolume = COMPOSE.replace('      - freellmapi_data:/app/server/data\n', '');
  assert.ok(
    codes(checkProductionCompose(noVolume).violations).includes('FREELMAPI_DATA_VOLUME_MISSING')
  );
  const undeclared = COMPOSE.replace('    name: moonwitness-freellmapi-data\n', '');
  assert.ok(
    codes(checkProductionCompose(undeclared).violations).includes(
      'FREELMAPI_DATA_VOLUME_UNDECLARED'
    )
  );
});

test('Board cannot import ORM, runtime, filesystem, Docker, PTY or MW_AI secrets', () => {
  const safe = `import { Button } from '@moonwitness/ui';\nexport function Page() { return null; }\n`;
  assert.deepEqual(checkBoardSource('apps/board/src/page.tsx', safe), []);

  for (const source of [
    `import { something } from '@moonwitness/orm';`,
    `import { x } from '@moonwitness/ai-runtime';`,
    `import fs from 'node:fs';`,
    `import cp from 'node:child_process';`,
    `import Docker from 'dockerode';`,
    `import pty from 'node-pty';`,
    `const key = process.env.MW_AI_FREELLM_KEY;`,
  ]) {
    assert.ok(checkBoardSource('apps/board/src/page.tsx', source).length > 0, source);
  }
});

test('FreeLLMAPI must be classified as cloud egress before deployment-zone override', () => {
  const good = `export function isProviderCloudEgress(provider, deploymentZone) {
  if (provider.kind === 'freellmapi') return true;
  if (deploymentZone !== undefined) return deploymentZone === 'cloud';
  return provider.kind === 'openai';
}`;
  assert.deepEqual(checkCloudEgressClassification(good), []);
  const missing = `export function isProviderCloudEgress(provider, deploymentZone) {
  if (deploymentZone !== undefined) return deploymentZone === 'cloud';
  return provider.kind === 'openai';
}`;
  assert.ok(codes(checkCloudEgressClassification(missing)).includes('FREELMAPI_NOT_CLOUD_EGRESS'));
  assert.ok(codes(checkCloudEgressClassification(null)).includes('MISSING_CLASSIFICATION_ROUTER'));
});

test('retired hard-coded cloud-adapter token is detected', () => {
  assert.deepEqual(findHardCodedCloudAdapterToken('const a = 1;'), []);
  assert.deepEqual(findHardCodedCloudAdapterToken(`x = '${HARD_CODED_CLOUD_TOKEN}';`), [
    { line: 1, column: 6 },
  ]);
});

test('gate CLI reports success and structured JSON failures', async () => {
  const lines = [];
  const exit = await runCloudAgentGateCli([], {
    rootDir: process.cwd(),
    writeStdout: (text) => lines.push(text),
    writeStderr: (text) => lines.push(text),
  });
  assert.equal(exit, 0);
  assert.match(lines.join(''), /Cloud coding-agent invariants passed/u);

  const badArgs = [];
  const badExit = await runCloudAgentGateCli(['--json', '--bogus'], {
    rootDir: process.cwd(),
    writeStdout: (text) => badArgs.push(text),
    writeStderr: (text) => badArgs.push(text),
  });
  assert.equal(badExit, 1);
  assert.equal(JSON.parse(badArgs.join('')).violations[0].code, 'INVALID_ARGUMENTS');
});

test('evaluateCloudAgentInvariants inspects a temporary tree fail-closed', async () => {
  const result = await evaluateCloudAgentInvariants({
    rootDir: '/tmp/mw-nonexistent-cloud-agent-root',
  });
  assert.equal(result.ok, false);
  assert.ok(result.violationCount >= 1);
  assert.ok(codes(result.violations).includes('MISSING_REQUIRED_FILE'));
});

test('repository tree passes the full gate', async () => {
  const result = await evaluateCloudAgentInvariants({ rootDir: process.cwd() });
  assert.equal(result.ok, true, JSON.stringify(result.violations, null, 2));
  assert.equal(result.checkCount, 9);
  assert.equal(result.violationCount, 0);
});
