import { execFile as execFileCallback } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

function validateArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('gh CLI arguments must be an array of strings');
  }
}

/**
 * Execute the GitHub CLI (`gh`) and return stdout, or `null` when `allowFailure` is enabled.
 * @param {string[]} args
 * @param {{
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   encoding?: BufferEncoding,
 *   maxBuffer?: number,
 *   allowFailure?: boolean,
 *   errorMessage?: string,
 *   exec?: (file: string, args: string[], options: object) => Promise<{ stdout: string, stderr?: string }>,
 * }} [options]
 * @returns {Promise<string|null>}
 */
export async function runGh(
  args,
  {
    cwd,
    env,
    encoding = 'utf8',
    maxBuffer = DEFAULT_MAX_BUFFER,
    allowFailure = false,
    errorMessage,
    exec = execFileAsync,
  } = {}
) {
  validateArgs(args);
  const execOptions = {
    encoding,
    maxBuffer,
    env: env ? { ...process.env, ...env } : process.env,
    ...(cwd !== undefined ? { cwd } : {}),
  };
  try {
    const { stdout } = await exec('gh', args, execOptions);
    return stdout;
  } catch (error) {
    if (allowFailure) return null;
    if (errorMessage) {
      throw new Error(errorMessage, { cause: error });
    }
    throw error;
  }
}

/**
 * Execute a `gh` command (defaulting to `gh api`) and parse its JSON stdout.
 * @param {string[]} args
 * @param {{
 *   api?: boolean,
 *   paginate?: boolean,
 *   jsonErrorMessage?: string,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   encoding?: BufferEncoding,
 *   maxBuffer?: number,
 *   allowFailure?: boolean,
 *   errorMessage?: string,
 *   exec?: (file: string, args: string[], options: object) => Promise<{ stdout: string, stderr?: string }>,
 * }} [options]
 * @returns {Promise<unknown>}
 */
export async function ghJson(
  args,
  { api = true, paginate = false, jsonErrorMessage, ...runOptions } = {}
) {
  validateArgs(args);
  if (!api && paginate) {
    throw new Error('paginate option requires api mode');
  }
  const ghArgs = api ? ['api', ...(paginate ? ['--paginate', '--slurp'] : []), ...args] : args;
  const output = await runGh(ghArgs, runOptions);
  if (output === null) return null;
  try {
    return JSON.parse(output);
  } catch (error) {
    if (jsonErrorMessage) {
      throw new Error(jsonErrorMessage, { cause: error });
    }
    throw error;
  }
}
