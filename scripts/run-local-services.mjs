import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { localServiceScripts } from './local-service-scripts.mjs';
import { resolvePackageManager } from './package-manager.mjs';

const mode = process.argv[2];
const selected = localServiceScripts[mode];
if (!selected) throw new Error('Expected dev, start, or start:built');

const packageManager = resolvePackageManager();
if (!packageManager) throw new Error('Unable to resolve pnpm executable');

const colors = ['\x1b[36m', '\x1b[33m', '\x1b[35m', '\x1b[32m', '\x1b[34m'];
const reset = '\x1b[0m';
const processes = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exit(code);
}

function pipePrefixed(stream, prefix, target) {
  if (!stream) return;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', (line) => target.write(`${prefix} ${line}\n`));
}

function startService(packageName, script, index) {
  const shortName =
    packageName === '@moonwitness/board'
      ? 'board'
      : script === 'dev' || script.startsWith('start')
        ? 'api'
        : script;
  const prefix = `${colors[index % colors.length]}[${shortName}]${reset}`;
  const child = spawn(
    packageManager.command,
    [...packageManager.prefixArgs, '--filter', packageName, script],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    }
  );
  processes.push(child);
  pipePrefixed(child.stdout, prefix, process.stdout);
  pipePrefixed(child.stderr, prefix, process.stderr);
  child.on('error', () => stopAll(1));
  child.on('exit', (code, signal) => {
    if (!stopping) stopAll(code ?? (signal ? 1 : 0));
  });
}

async function waitForApiReady(timeoutMs = 30000) {
  const port = process.env.API_PORT || '3000';
  const url = `http://127.0.0.1:${port}/readyz`;
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // API not listening yet.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }
}

process.on('SIGINT', () => stopAll(130));
process.on('SIGTERM', () => stopAll(143));

const backendServices = selected.filter(([pkg]) => pkg !== '@moonwitness/board');
const boardServices = selected.filter(([pkg]) => pkg === '@moonwitness/board');

backendServices.forEach(([packageName, script], index) => {
  startService(packageName, script, index);
});

if (boardServices.length > 0) {
  await waitForApiReady();
  if (!stopping) {
    boardServices.forEach(([packageName, script], index) => {
      startService(packageName, script, backendServices.length + index);
    });
  }
}
