import { spawnSync } from 'node:child_process';
import { existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export function installGitHooks(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;

  if (env.CI === 'true' || env.CI === '1' || env.SKIP_GIT_HOOKS === '1') {
    return { skipped: true, reason: 'CI or SKIP_GIT_HOOKS set' };
  }

  const gitDir = join(cwd, '.git');
  if (!existsSync(gitDir)) {
    return { skipped: true, reason: 'No .git directory found' };
  }

  const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error('Could not configure Git to use the repository hooks path.');
  }

  // Ensure POSIX executable bits on hook scripts if present
  const hooks = ['pre-commit', 'pre-push', 'commit-msg'];
  for (const hook of hooks) {
    const hookPath = join(cwd, '.githooks', hook);
    if (existsSync(hookPath)) {
      try {
        chmodSync(hookPath, 0o755);
      } catch {
        // Ignore chmod failures on non-POSIX / Windows filesystems where it might be a no-op
      }
    }
  }

  return { success: true };
}

// Execute CLI if run directly
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const currentFile = resolve(fileURLToPath(import.meta.url));
const executedFile = resolve(process.argv[1] || '');

if (currentFile === executedFile) {
  try {
    const res = installGitHooks();
    if (res.skipped) {
      console.log(`Git hooks setup skipped: ${res.reason}`);
    } else {
      console.log('Git hooks installed successfully for this checkout.');
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
