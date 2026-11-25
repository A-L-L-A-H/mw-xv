import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = path.join(SKILL_DIR, 'scripts', 'swarm-dashboard.mjs');
const TIMESTAMP = '2026-01-02T03:04:05.000Z';

function manifestFixture() {
  return {
    version: 1,
    name: 'Deterministic swarm',
    goal: 'Verify the dashboard CLI',
    startedAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    tasks: [
      {
        id: 'contract',
        title: 'Define the contract',
        status: 'done',
        dependsOn: [],
        owner: 'coordinator',
        files: ['src/contract.ts'],
        summary: 'Publish shared types.',
      },
      {
        id: 'implementation',
        title: 'Implement the slice',
        status: 'ready',
        dependsOn: ['contract'],
        owner: 'worker',
        files: ['src/implementation.ts'],
        summary: 'Implement against the contract.',
      },
    ],
    agents: [
      {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'coordination',
        status: 'done',
        progress: 100,
        taskIds: ['contract'],
      },
      {
        id: 'worker',
        name: 'Worker',
        role: 'implementation',
        status: 'idle',
        progress: 0,
        taskIds: ['implementation'],
      },
    ],
    events: [
      {
        id: 'event-1',
        at: TIMESTAMP,
        type: 'info',
        message: 'Contract completed.',
        agentId: 'coordinator',
        taskId: 'contract',
      },
    ],
  };
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'visual-swarm-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function runCli(args, cwd, scriptPath = SCRIPT_PATH, skillDir = SKILL_DIR) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SWARM_SKILL_DIR: skillDir },
    timeout: 10_000,
    windowsHide: true,
  });
}

function jsonOutput(result) {
  return JSON.parse(result.stdout.trim());
}

function errorOutput(result) {
  assert.equal(result.stdout, '');
  return JSON.parse(result.stderr.trim());
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  return jsonOutput(result);
}

async function writeManifest(directory, manifest) {
  await writeFile(
    path.join(directory, 'swarm.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

test('help lists every dashboard command from an unrelated working directory', async (t) => {
  const cwd = await temporaryDirectory(t);
  const result = runCli(['--help'], cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage:/);
  for (const command of ['init', 'validate', 'render', 'serve']) {
    assert.match(result.stdout, new RegExp(`node swarm-dashboard\\.mjs ${command}`));
  }
});

test('init creates ignored local state and refuses to overwrite it by default', async (t) => {
  const cwd = await temporaryDirectory(t);
  const directory = path.join(cwd, 'local state');
  const result = runCli(
    [
      'init',
      '--name',
      'Portable swarm',
      '--goal',
      'Coordinate independent work',
      '--dir',
      directory,
    ],
    cwd
  );
  const output = assertSuccess(result);
  const manifestPath = path.join(directory, 'swarm.json');
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original);

  assert.equal(output.ok, true);
  assert.equal(output.dir, directory);
  assert.equal(output.manifest, manifestPath);
  assert.deepEqual(
    { version: manifest.version, name: manifest.name, goal: manifest.goal },
    { version: 1, name: 'Portable swarm', goal: 'Coordinate independent work' }
  );
  assert.deepEqual(manifest.tasks, []);
  assert.deepEqual(manifest.agents, []);
  assert.deepEqual(manifest.events, []);
  assert.equal(await readFile(path.join(directory, '.gitignore'), 'utf8'), '*\n!.gitignore\n');

  const repeated = runCli(
    ['init', '--name', 'Replacement', '--goal', 'Must not overwrite', '--dir', directory],
    cwd
  );
  assert.equal(repeated.status, 1);
  const error = errorOutput(repeated);
  assert.equal(error.ok, false);
  assert.match(error.error, /Refusing to overwrite existing file/);
  assert.equal(await readFile(manifestPath, 'utf8'), original);
});

test('validate accepts a deterministic manifest with tasks, agents, and events', async (t) => {
  const cwd = await temporaryDirectory(t);
  assertSuccess(runCli(['init', '--name', 'Validation', '--goal', 'Validate state'], cwd));
  await writeManifest(path.join(cwd, '.swarm'), manifestFixture());

  const output = assertSuccess(runCli(['validate'], cwd));
  assert.equal(output.ok, true);
  assert.equal(output.valid, true);
  assert.equal(output.manifest, path.join(cwd, '.swarm', 'swarm.json'));
  assert.equal(output.tasks, 2);
  assert.equal(output.agents, 2);
  assert.equal(output.events, 1);
});

test('render writes a self-contained snapshot and escapes script-sensitive state', async (t) => {
  const cwd = await temporaryDirectory(t);
  assertSuccess(runCli(['init', '--name', 'Rendering', '--goal', 'Render state'], cwd));
  const manifest = manifestFixture();
  manifest.name = 'Render <check>';
  manifest.goal = 'Do not inject </script><script>window.injected=true</script>';
  await writeManifest(path.join(cwd, '.swarm'), manifest);

  const outputPath = path.join(cwd, 'rendered dashboard', 'dashboard.html');
  const output = assertSuccess(runCli(['render', '--output', outputPath], cwd));
  const html = await readFile(output.output, 'utf8');

  assert.equal(output.ok, true);
  assert.equal(output.output, outputPath);
  assert.match(html, /<html\b/i);
  assert.ok(html.includes('Render \\u003ccheck\\u003e'));
  assert.ok(html.includes('\\u003c/script\\u003e'));
  assert.ok(!html.includes('window.injected=true</script>'));
  assert.ok(!html.includes('__SWARM_STATE__'));
});

test('validate and render reject malformed JSON without emitting a traceback', async (t) => {
  const cwd = await temporaryDirectory(t);
  assertSuccess(runCli(['init', '--name', 'Malformed', '--goal', 'Reject bad JSON'], cwd));
  await writeFile(path.join(cwd, '.swarm', 'swarm.json'), '{not valid json\n', 'utf8');

  for (const command of ['validate', 'render']) {
    const result = runCli([command], cwd);
    assert.equal(result.status, 1);
    const error = errorOutput(result);
    assert.equal(error.ok, false);
    assert.equal(error.error, 'Manifest must contain valid JSON');
    assert.doesNotMatch(result.stderr, /\n\s+at\s+/);
  }
});

test('validate rejects malformed manifest contracts', async (t) => {
  const cwd = await temporaryDirectory(t);
  assertSuccess(runCli(['init', '--name', 'Invalid contract', '--goal', 'Reject bad state'], cwd));
  const manifest = manifestFixture();
  manifest.tasks[1].dependsOn = ['missing-task'];
  await writeManifest(path.join(cwd, '.swarm'), manifest);

  const result = runCli(['validate'], cwd);
  assert.equal(result.status, 1);
  const error = errorOutput(result);
  assert.equal(error.ok, false);
  assert.match(error.error, /Task implementation references unknown dependency: missing-task/);
});

test('CLI and bundled template work after relocation with spaces in their paths', async (t) => {
  const root = await temporaryDirectory(t);
  const installedSkill = path.join(root, 'installed skills', 'visual swarm');
  const project = path.join(root, 'unrelated project');
  await cp(SKILL_DIR, installedSkill, { recursive: true });
  await mkdir(project, { recursive: true });
  const relocatedScript = path.join(installedSkill, 'scripts', 'swarm-dashboard.mjs');

  const initialized = assertSuccess(
    runCli(
      [
        'init',
        '--name',
        'Relocated',
        '--goal',
        'Remain path independent',
        '--dir',
        'coordination state',
      ],
      project,
      relocatedScript,
      installedSkill
    )
  );
  assert.equal(initialized.dir, path.join(project, 'coordination state'));
  assertSuccess(
    runCli(['validate', '--dir', 'coordination state'], project, relocatedScript, installedSkill)
  );
  const rendered = assertSuccess(
    runCli(['render', '--dir', 'coordination state'], project, relocatedScript, installedSkill)
  );

  assert.equal(rendered.output, path.join(project, 'coordination state', 'dashboard.html'));
  assert.ok((await stat(rendered.output)).isFile());
  await assert.rejects(stat(path.join(installedSkill, 'coordination state')), { code: 'ENOENT' });
});
