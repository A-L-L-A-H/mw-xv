import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { env, execPath, platform } from 'node:process';

/** Resolve the bun executable for both direct CLI use and CI shell invocations. */
export function resolvePackageManager(environment = env, operatingSystem = platform) {
  const cli = environment.npm_execpath;
  if (typeof cli === 'string' && cli.length > 0 && existsSync(cli)) {
    const lower = cli.toLowerCase();
    if (lower.endsWith('.exe') || lower.endsWith('bun')) {
      return { command: cli, prefixArgs: [], shell: false };
    }
    return { command: execPath, prefixArgs: [cli], shell: false };
  }

  // Always use bun - pnpm has been fully migrated
  let command = 'bun';
  let shell = false;
  if (operatingSystem === 'win32') {
    for (const candidate of ['bun.exe', 'bun.cmd']) {
      const located = spawnSync('where.exe', [candidate], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const resolved =
        located.status === 0
          ? located.stdout
              .split(/\r?\n/u)
              .map((path) => path.trim())
              .find((path) => path.length > 0 && existsSync(path))
          : undefined;
      if (resolved) {
        command = resolved;
        shell = resolved.toLowerCase().endsWith('.cmd');
        break;
      }
    }
  }
  const probe = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    shell,
  });
  if (probe.status !== 0 || probe.error) return undefined;
  return { command, prefixArgs: [], shell };
}
