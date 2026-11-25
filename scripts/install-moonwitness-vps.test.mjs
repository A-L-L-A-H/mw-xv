import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const installerPath = fileURLToPath(new URL('./install-moonwitness-vps.sh', import.meta.url));
const installerSource = readFileSync(installerPath, 'utf8');
const functionNames = [
  'generate_secret',
  'get_env_value',
  'ensure_env_kv',
  'configure_app_env',
  'start_compose_stack',
];

function extractFunction(name) {
  const match = installerSource.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `installer must define ${name}`);
  return match[0];
}

const functionSource = functionNames.map(extractFunction).join('\n\n');

function runFixture(body, initialEnv) {
  const directory = mkdtempSync(join(tmpdir(), 'moonwitness-vps-installer-'));
  const envPath = join(directory, '.env');
  try {
    if (initialEnv !== undefined) {
      writeFileSync(envPath, initialEnv);
      chmodSync(envPath, 0o644);
    }

    const script = `
set -euo pipefail
MW_ENV_FILE="$1"
MW_API_PORT="3000"
MW_BOARD_PORT="4174"
MW_INSTALL_DIR="$2"
log() { :; }
${functionSource}
${body}
`;
    const result = spawnSync(
      'bash',
      ['-c', script, 'moonwitness-vps-fixture', envPath, directory],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SUPERADMIN_LOGIN: undefined,
          SUPERADMIN_INITIAL_PASSWORD: undefined,
        },
        timeout: 10_000,
      }
    );
    assert.equal(result.status, 0, result.stderr);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      contents: readFileSync(envPath, 'utf8'),
      mode: statSync(envPath).mode & 0o777,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function readToken(contents) {
  const matches = [...contents.matchAll(/^AGENT_SANDBOX_TOKEN=(.*)$/gm)];
  assert.equal(matches.length, 1, 'environment must contain exactly one sandbox token entry');
  return matches[0][1];
}

function readObservabilityToken(contents) {
  const matches = [...contents.matchAll(/^OBSERVABILITY_INGEST_TOKEN=(.*)$/gm)];
  assert.equal(matches.length, 1, 'environment must contain exactly one observability token entry');
  return matches[0][1];
}

test('installer has valid bash syntax', () => {
  const result = spawnSync('bash', ['-n', installerPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('provisions a high-entropy sandbox token privately without printing it', () => {
  const result = runFixture('configure_app_env');
  const token = readToken(result.contents);

  assert.ok(token.length >= 32, 'sandbox token must be at least 32 characters');
  assert.match(token, /^[A-Za-z0-9]+$/u);
  assert.equal(result.mode, 0o600);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /AGENT_SANDBOX_TOKEN|moonwitness-vps-fixture/u);
});

test('replaces short existing runtime tokens with independent high-entropy values', () => {
  const result = runFixture(
    'configure_app_env',
    'AGENT_SANDBOX_TOKEN=short\nOBSERVABILITY_INGEST_TOKEN=short\nKEEP_ME=yes\n'
  );
  const sandboxToken = readToken(result.contents);
  const observabilityToken = readObservabilityToken(result.contents);

  for (const token of [sandboxToken, observabilityToken]) {
    assert.ok(token.length >= 32, 'short runtime tokens must be replaced');
    assert.notEqual(token, 'short');
    assert.match(token, /^[A-Za-z0-9]+$/u);
  }
  assert.notEqual(sandboxToken, observabilityToken);
  assert.match(result.contents, /^KEEP_ME=yes$/mu);
  assert.equal(result.mode, 0o600);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /OBSERVABILITY_INGEST_TOKEN|AGENT_SANDBOX_TOKEN/u
  );
});

test('provisions an observability ingest token privately without printing it', () => {
  const result = runFixture('configure_app_env');
  const token = readObservabilityToken(result.contents);

  assert.ok(token.length >= 32, 'observability token must be at least 32 characters');
  assert.match(token, /^[A-Za-z0-9]+$/u);
  assert.equal(result.mode, 0o600);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /OBSERVABILITY_INGEST_TOKEN|moonwitness-vps-fixture/u);
});

test('preserves a compliant sandbox token and unrelated environment entries across reruns', () => {
  const retainedToken = 'x'.repeat(48);
  const retainedObservabilityToken = 'o'.repeat(48);
  const initialEnv = `KEEP_ME=yes\nAGENT_SANDBOX_TOKEN=${retainedToken}\nOBSERVABILITY_INGEST_TOKEN=${retainedObservabilityToken}\nCUSTOM=value\n`;
  const first = runFixture('configure_app_env\nconfigure_app_env', initialEnv);
  const second = runFixture('configure_app_env', first.contents);

  assert.equal(readToken(first.contents), retainedToken);
  assert.equal(readObservabilityToken(first.contents), retainedObservabilityToken);
  assert.equal(first.contents, second.contents);
  assert.equal((second.contents.match(/^AGENT_SANDBOX_TOKEN=/gmu) ?? []).length, 1);
  assert.equal((second.contents.match(/^OBSERVABILITY_INGEST_TOKEN=/gmu) ?? []).length, 1);
  assert.match(second.contents, /^KEEP_ME=yes$/mu);
  assert.match(second.contents, /^CUSTOM=value$/mu);
  assert.equal(second.mode, 0o600);
});

test('configures the sandbox token before Compose starts and leaves stack supervision to Compose', () => {
  const main = installerSource.match(/^main\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(main);
  assert.ok(main.indexOf('configure_app_env') < main.indexOf('install_control_plane_service'));
  assert.ok(main.indexOf('configure_app_env') < main.indexOf('start_compose_stack'));
  assert.match(main, /^ {2}start_compose_stack$/mu);

  const installControlPlane = extractFunction('install_control_plane_service');
  const startCompose = extractFunction('start_compose_stack');
  assert.match(installControlPlane, /systemctl enable moonwitness-control-plane\.service/u);
  assert.doesNotMatch(installControlPlane, /systemctl (enable --now|restart|start)/u);
  assert.doesNotMatch(installControlPlane, /^ {4}docker compose/u);
  assert.match(startCompose, /systemctl restart moonwitness-control-plane\.service/u);
  assert.equal(
    (installerSource.match(/systemctl enable --now moonwitness-control-plane\.service/gu) ?? [])
      .length,
    0
  );
});

test('starts the hardened services through the existing production overlay', () => {
  const startCompose = extractFunction('start_compose_stack');
  assert.match(startCompose, /-f "\$\{MW_INSTALL_DIR\}\/deploy\/compose\/docker-compose\.yml"/u);
  assert.match(
    startCompose,
    /-f "\$\{MW_INSTALL_DIR\}\/deploy\/compose\/docker-compose\.production\.yml"/u
  );
  assert.match(startCompose, /--env-file "\$\{MW_ENV_FILE\}"/u);
  assert.match(startCompose, /up -d --build/u);

  const serviceLine = startCompose.match(/up -d --build ([^\n]+)/u)?.[1];
  assert.ok(serviceLine);
  assert.deepEqual(serviceLine.trim().split(/\s+/u), [
    'postgres',
    'api',
    'board',
    'jobs-worker',
    'jobs-scheduler',
    'outbox-worker',
    'agent-sandbox',
  ]);
});

test('does not implicitly enable a sandbox port or Docker socket access', () => {
  assert.doesNotMatch(installerSource, /AGENT_SANDBOX_DOCKER_SOCKET/u);
  assert.doesNotMatch(installerSource, /docker-compose\.agent-sandbox-socket\.yml/u);
  assert.doesNotMatch(installerSource, /docker\.sock/u);
  assert.doesNotMatch(installerSource, /AGENT_SANDBOX_PORT|3020:3020/u);
  assert.doesNotMatch(installerSource, /--privileged/u);
  const sandboxInvocation = extractFunction('start_compose_stack');
  assert.match(sandboxInvocation, /agent-sandbox/u);
  assert.doesNotMatch(sandboxInvocation, /--device[ =]|--cap-add|--network host/u);
});

test('sandbox stays private and fail-closed in the reused production definition', () => {
  const composePath = fileURLToPath(
    new URL('../deploy/compose/docker-compose.production.yml', import.meta.url)
  );
  const composeSource = readFileSync(composePath, 'utf8');
  const sandboxService = composeSource.match(
    /^ {2}agent-sandbox:\n[\s\S]*?(?=^ {2}[a-z][\w-]*:|^volumes:)/m
  )?.[0];
  assert.ok(sandboxService, 'production Compose must define agent-sandbox');
  assert.doesNotMatch(sandboxService, /^\s+ports:/mu);
  assert.doesNotMatch(sandboxService, /docker\.sock|AGENT_SANDBOX_DOCKER_SOCKET/u);
  assert.match(sandboxService, /No Docker socket by default[\s\S]*fail-closed executor/u);
  assert.match(
    sandboxService,
    /AGENT_SANDBOX_TOKEN: \$\{AGENT_SANDBOX_TOKEN:\?Set a private jobs-worker to agent-sandbox token\}/u
  );
});
