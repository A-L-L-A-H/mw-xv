import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { argv, env, execPath, exit, platform } from 'node:process';
import { resolvePackageManager } from './package-manager.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const TODO_DIR = path.join(ROOT, 'apps', 'todo');
const WEB_DIR = path.join(TODO_DIR, 'web');
const BIN_NAME = platform === 'win32' ? 'moonwitness-dx.exe' : 'moonwitness-dx';
const RELEASE_BIN = path.join(TODO_DIR, 'target', 'release', BIN_NAME);

function runSync(command, args, options = {}) {
  const res = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...env, ...options.env },
    shell: false,
    ...options,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    exit(res.status ?? 1);
  }
}

function runPnpm(args) {
  const pm = resolvePackageManager();
  if (!pm) throw new Error('Unable to locate pnpm');
  runSync(pm.command, [...pm.prefixArgs, ...args]);
}

function buildUiAndWeb() {
  console.log('==> Building @moonwitness/ui');
  runPnpm(['--filter', '@moonwitness/ui', 'build']);

  console.log('==> Typechecking apps/todo/web');
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  runSync(execPath, [tscBin, '-p', path.join(WEB_DIR, 'tsconfig.json'), '--noEmit']);

  console.log('==> Building apps/todo/web bundle');
  const viteBin = path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  runSync(execPath, [viteBin, 'build'], { cwd: WEB_DIR });
}

function buildRust({ release = true } = {}) {
  console.log(`==> Building moonwitness-dx (${release ? 'release' : 'debug'})`);
  const args = ['build', '--manifest-path', path.join(TODO_DIR, 'Cargo.toml')];
  if (release) args.push('--release');
  runSync('cargo', args);
}

function runE2e() {
  const apiPort = env.MW_E2E_API_PORT ?? '4249';
  const e2eHome = path.join(os.tmpdir(), `mw-dx-e2e-${apiPort}`);
  fs.rmSync(e2eHome, { recursive: true, force: true });
  fs.mkdirSync(e2eHome, { recursive: true });

  console.log(`==> Running Playwright E2E against ${RELEASE_BIN}`);
  const pwCli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  runSync(execPath, [pwCli, 'test', '--config=apps/todo/web/playwright.config.ts'], {
    env: { MW_E2E_API_PORT: apiPort, MOONWITNESS_DX_HOME: e2eHome },
  });
}

async function runMcpIntegrationTest() {
  console.log(`==> Verifying MCP stdio JSON-RPC tools against ${RELEASE_BIN}`);
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-mcp-e2e-'));
  const proc = spawn(RELEASE_BIN, ['--home', tmpHome, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buf = '';
  const pending = new Map();
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));

  let nextId = 1;
  const req = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, { resolve });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method, params) =>
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

  try {
    const init = await req('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dx-mcp-verifier', version: '1.0.0' },
    });
    assert.equal(init.result.serverInfo.name, 'moonwitness-dx');
    notify('notifications/initialized', {});

    const list = await req('tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    for (const expected of [
      'task_claim',
      'task_checklist_toggle',
      'task_submit_review',
      'brain_quick_capture',
      'wiki_lookup',
      'global_search',
    ]) {
      assert(names.includes(expected), `Missing MCP tool: ${expected}`);
    }

    const callTool = async (name, args) => {
      const res = await req('tools/call', { name, arguments: args });
      assert(!res.error, JSON.stringify(res.error));
      return { isError: !!res.result.isError, text: res.result.content[0].text };
    };

    let r = await callTool('create_project', { slug: 'demo', name: 'Demo' });
    assert(!r.isError, r.text);
    r = await callTool('create_task', {
      project: 'demo',
      title: 'Live MCP Pipeline Task',
      code: 'LIVE-1',
      acceptance_criteria: [{ id: 'AC-1', text: 'Pass live stdio test', done: false }],
    });
    assert(!r.isError, r.text);
    r = await callTool('task_claim', { id: 'demo#1' });
    assert(!r.isError && r.text.includes('status: doing'), r.text);
    r = await callTool('task_checklist_toggle', { id: 'demo#1', ac_id: 'AC-1', done: true });
    assert(!r.isError && r.text.includes('Toggled AC-1'), r.text);
    r = await callTool('task_submit_review', { id: 'demo#1', commit_sha: 'deadbeef', evidence_path: 'e2e.log' });
    assert(!r.isError && r.text.includes('status: review'), r.text);
    r = await callTool('brain_quick_capture', {
      slug: 'wiki/live-mcp',
      layer: 'wiki',
      title: 'Live MCP Wiki',
      body: 'LiveMcpSearchToken inside Second Brain.',
      tags: 'mcp,live',
      project: 'demo',
      linked_tasks: ['LIVE-1'],
    });
    assert(!r.isError && r.text.includes('wiki/live-mcp'), r.text);
    r = await callTool('wiki_lookup', { query: 'wiki/live-mcp' });
    assert(!r.isError && r.text.includes('LiveMcpSearchToken'), r.text);
    r = await callTool('global_search', { query: 'LiveMcpSearchToken' });
    assert(!r.isError && r.text.includes('wiki/live-mcp'), r.text);
    r = await callTool('global_search', { query: 'Live MCP Pipeline Task' });
    assert(!r.isError && r.text.includes('Live MCP Pipeline Task'), r.text);
    console.log(`==> MCP stdio integration OK (${names.length} tools)`);
  } finally {
    proc.kill();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function runDev(extraArgs) {
  runPnpm(['--filter', '@moonwitness/ui', 'build']);
  const apiPort = env.MW_API_PORT ?? '4242';
  const webPort = env.MW_WEB_PORT ?? '5173';

  console.log(`==> Starting moonwitness-dx dev (API :${apiPort}, Web :${webPort})`);
  const apiProc = spawn(
    'cargo',
    ['run', '--manifest-path', path.join(TODO_DIR, 'Cargo.toml'), '--', '--port', apiPort, '--no-open', ...extraArgs],
    { cwd: TODO_DIR, stdio: 'inherit', env: { ...env } }
  );

  const viteBin = path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const webProc = spawn(execPath, [viteBin, '--port', webPort], {
    cwd: WEB_DIR,
    stdio: 'inherit',
    env: { ...env, MW_E2E_API_PORT: apiPort, MW_E2E_WEB_PORT: webPort },
  });

  const shutdown = (code = 0) => {
    apiProc.kill();
    webProc.kill();
    exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  apiProc.on('exit', (code) => shutdown(code ?? 0));
  webProc.on('exit', (code) => shutdown(code ?? 0));
}

const [, , cmd = 'build', ...rest] = argv;

switch (cmd) {
  case 'build':
    buildUiAndWeb();
    buildRust({ release: true });
    console.log(`==> Ready: ${RELEASE_BIN}`);
    break;
  case 'start':
    if (!rest.includes('--no-build')) {
      buildUiAndWeb();
      buildRust({ release: true });
    }
    {
      const passArgs = rest.filter((a) => a !== '--no-build' && a !== '--');
      const finalArgs = passArgs.length > 0 ? passArgs : ['--port', env.MW_API_PORT ?? '4242'];
      console.log(`==> Launching ${RELEASE_BIN} ${finalArgs.join(' ')}`);
      runSync(RELEASE_BIN, finalArgs);
    }
    break;
  case 'dev':
    runDev(rest.filter((a) => a !== '--'));
    break;
  case 'e2e':
    buildUiAndWeb();
    buildRust({ release: true });
    runE2e();
    break;
  case 'test':
    buildUiAndWeb();
    console.log('==> Running cargo test');
    runSync('cargo', ['test', '--manifest-path', path.join(TODO_DIR, 'Cargo.toml')]);
    buildRust({ release: true });
    runE2e();
    await runMcpIntegrationTest();
    console.log('==> All moonwitness-dx checks passed');
    break;
  default:
    console.error('Usage: node scripts/dx.mjs <build|dev|start|e2e|test>');
    exit(1);
}
