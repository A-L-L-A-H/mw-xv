import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  FLEET_STATE_FILE,
  FLEET_STATE_REF,
  buildNextFleetState,
  createGenesisFleetState,
  isMutationAllowed,
  parseFleetState,
  verifyFleetState,
  verifyFleetTransition,
} from './fleet-state.mjs';

const execFileAsync = promisify(execFile);
const ZERO_SHA = '0'.repeat(40);

/** Replace exactly one file in a tree while preserving every other entry. */
export function buildTreeEntries(entries, path, blobSha) {
  const others = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.path !== path);
  return [
    ...others.map((entry) => ({
      path: entry.path,
      mode: entry.mode ?? '100644',
      type: entry.type ?? 'blob',
      sha: entry.sha,
    })),
    { path, mode: '100644', type: 'blob', sha: blobSha },
  ].sort((left, right) => left.path.localeCompare(right.path));
}

/** A compare-and-swap ref update must report the exact expected old value. */
export function verifyCas(commitSha, expectedOldSha, result) {
  if (!/^[a-f0-9]{40}$/u.test(commitSha ?? ''))
    return { applied: false, reason: 'invalid commit SHA' };
  if (expectedOldSha === ZERO_SHA && result?.created !== true)
    return { applied: false, reason: 'ref creation did not succeed' };
  if (expectedOldSha !== ZERO_SHA && result?.updated !== true)
    return { applied: false, reason: 'ref update lost the compare-and-swap race' };
  return { applied: true };
}

/**
 * Read/modify/write the durable FleetState on a protected ref. Every write is
 * a CAS against the previously observed commit; a concurrent change aborts.
 */
export function createFleetStore(adapter) {
  return {
    async read() {
      const reference = await adapter.readRef(FLEET_STATE_REF);
      if (!reference?.sha)
        return {
          state: createGenesisFleetState(),
          commitSha: ZERO_SHA,
          treeEntries: [],
          treeSha: null,
        };
      const commit = await adapter.readCommit(reference.sha);
      const content = await adapter.readBlob(commit.fileSha);
      if (content === null) throw new Error('Fleet state file is missing from the protected ref.');
      return {
        state: parseFleetState(content),
        commitSha: reference.sha,
        treeEntries: commit.treeEntries,
        treeSha: commit.treeSha,
      };
    },
    async write(current, nextState) {
      const observed = await adapter.readRef(FLEET_STATE_REF);
      const observedSha = observed?.sha ?? ZERO_SHA;
      if (observedSha !== current.commitSha)
        throw new Error('Fleet state ref changed while the transition was being prepared.');
      const blobSha = await adapter.createBlob(`${JSON.stringify(nextState, null, 2)}\n`);
      const treeSha = await adapter.createTree(
        current.treeSha,
        buildTreeEntries(current.treeEntries, FLEET_STATE_FILE, blobSha)
      );
      const commitSha = await adapter.createCommit({
        treeSha,
        parents: current.commitSha === ZERO_SHA ? [] : [current.commitSha],
        message: `chore(fleet): ${nextState.paused ? 'pause' : 'resume'} epoch ${nextState.epoch}`,
      });
      const result = await adapter.updateRef(FLEET_STATE_REF, commitSha, current.commitSha);
      const cas = verifyCas(commitSha, current.commitSha, result);
      if (!cas.applied) throw new Error(cas.reason);
      return { commitSha };
    },
  };
}

/** Idempotent pause/resume with post-write verification and run cancellation. */
export async function applyFleetAction(store, adapter, options) {
  const current = await store.read();
  if (!verifyFleetState(current.state).valid) throw new Error('Current fleet state is invalid.');
  if (options.expectEpoch !== undefined && current.state.epoch !== options.expectEpoch)
    throw new Error(`Expected fleet epoch ${options.expectEpoch}, found ${current.state.epoch}.`);
  if (options.action === 'pause') {
    const verdict = isMutationAllowed(current.state, { fleetEpoch: current.state.epoch });
    if (!verdict.allowed && current.state.paused)
      return { changed: false, state: current.state, commitSha: current.commitSha, cancelled: [] };
  } else if (options.action === 'resume' && !current.state.paused) {
    return { changed: false, state: current.state, commitSha: current.commitSha, cancelled: [] };
  }

  const nextState = buildNextFleetState(current.state, options.action, options);
  const transition = verifyFleetTransition(current.state, nextState, options.action);
  if (!transition.valid) throw new Error(transition.reason);
  if (options.dryRun) return { changed: true, dryRun: true, state: nextState };

  const { commitSha } = await store.write(current, nextState);
  const confirmed = await store.read();
  const post = verifyFleetTransition(current.state, confirmed.state, options.action);
  if (!post.valid || confirmed.commitSha !== commitSha)
    throw new Error(
      `Fleet state did not converge after write: ${post.reason ?? 'commit mismatch'}`
    );

  let cancelled = [];
  if (options.action === 'pause' && adapter.listActiveRuns) {
    for (const run of await adapter.listActiveRuns()) {
      await adapter.cancelRun(run.id);
      cancelled.push(run.id);
    }
  }
  return { changed: true, state: confirmed.state, commitSha, cancelled };
}

async function ghApi(repository, method, path, body) {
  const args = ['api', '--silent', '-X', method];
  let directory;
  try {
    if (body !== undefined) {
      directory = await mkdtemp(join(tmpdir(), 'mw-xv-fleet-'));
      const file = join(directory, 'body.json');
      await writeFile(file, `${JSON.stringify(body)}\n`, 'utf8');
      args.push('--input', file);
    }
    const { stdout } = await execFileAsync('gh', [...args, `repos/${repository}/${path}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout ? JSON.parse(stdout) : {};
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export function createGithubFleetAdapter(repository) {
  return {
    async readRef(ref) {
      const path = `git/ref/${ref.replace('refs/', '')}`;
      try {
        const result = await ghApi(repository, 'GET', path);
        return { sha: result?.object?.sha };
      } catch (error) {
        if (/Could not resolve|Not Found|404/u.test(error?.stderr ?? error?.message ?? ''))
          return null;
        throw error;
      }
    },
    async readCommit(commitSha) {
      const commit = await ghApi(repository, 'GET', `git/commits/${commitSha}`);
      const tree = await ghApi(repository, 'GET', `git/trees/${commit.tree.sha}`);
      const entry = (tree.tree ?? []).find((item) => item.path === FLEET_STATE_FILE);
      if (!entry) return { fileSha: null, treeEntries: tree.tree ?? [], treeSha: commit.tree.sha };
      return { fileSha: entry.sha, treeEntries: tree.tree ?? [], treeSha: commit.tree.sha };
    },
    async readBlob(blobSha) {
      const blob = await ghApi(repository, 'GET', `git/blobs/${blobSha}`);
      return Buffer.from(blob.content ?? '', blob.encoding ?? 'base64').toString('utf8');
    },
    async createBlob(content) {
      const blob = await ghApi(repository, 'POST', 'git/blobs', {
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      return blob.sha;
    },
    async createTree(baseSha, tree) {
      const result = await ghApi(repository, 'POST', 'git/trees', {
        ...(baseSha ? { base_tree: baseSha } : {}),
        tree,
      });
      return result.sha;
    },
    async createCommit({ treeSha, parents, message }) {
      const result = await ghApi(repository, 'POST', 'git/commits', {
        tree: treeSha,
        parents,
        message,
      });
      return result.sha;
    },
    async updateRef(ref, newSha, oldSha) {
      try {
        if (oldSha === ZERO_SHA) {
          await ghApi(repository, 'POST', 'git/refs', { ref, sha: newSha });
          return { created: true };
        }
        await ghApi(repository, 'PATCH', `git/refs/${ref.replace('refs/', '')}`, {
          sha: newSha,
          force: false,
        });
        return { updated: true };
      } catch (error) {
        if (/422|conflict|stale/u.test(error?.stderr ?? error?.message ?? ''))
          return { updated: false };
        throw error;
      }
    },
    async listActiveRuns() {
      const result = await ghApi(repository, 'GET', 'actions/runs?status=in_progress&per_page=100');
      return (result.workflow_runs ?? []).map((run) => ({ id: run.id }));
    },
    async cancelRun(id) {
      await ghApi(repository, 'POST', `actions/runs/${id}/cancel`);
    },
  };
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const positional = process.argv.slice(2);
  const command = positional[0];
  const flags = Object.fromEntries(
    (['probe', 'check'].includes(command) ? positional.slice(1) : positional)
      .map((arg, index, all) =>
        arg.startsWith('--')
          ? [arg.slice(2), all[index + 1]?.startsWith('--') ? 'true' : all[index + 1]]
          : null
      )
      .filter(Boolean)
  );
  try {
    if (!['probe', 'check', 'apply'].includes(command)) {
      throw new Error(
        'Usage: node scripts/fleet-stop.mjs probe --repo <owner/repo> | check --repo <owner/repo> --epoch <n> | apply --repo <owner/repo> --action pause|resume --actor <name> --reason <text>'
      );
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(flags.repo ?? ''))
      throw new Error('--repo must be owner/repo.');
    const adapter = createGithubFleetAdapter(flags.repo);
    if (command === 'probe') {
      const current = await createFleetStore(adapter).read();
      const verdict = verifyFleetState(current.state);
      const allowed = verdict.valid && !current.state.paused;
      process.stdout.write(
        `${JSON.stringify({ allowed, epoch: current.state.epoch, paused: current.state.paused, stateValid: verdict.valid })}\n`
      );
      if (!allowed) process.exitCode = 1;
    } else if (command === 'check') {
      const epoch = Number(flags.epoch);
      if (!Number.isSafeInteger(epoch) || epoch < 1)
        throw new Error('--epoch must be a positive integer.');
      const current = await createFleetStore(adapter).read();
      const verdict = isMutationAllowed(current.state, { fleetEpoch: epoch });
      process.stdout.write(
        `${JSON.stringify({ ...verdict, currentEpoch: current.state.epoch, paused: current.state.paused })}\n`
      );
      if (!verdict.allowed) process.exitCode = 1;
    } else if (command === 'apply') {
      if (!['pause', 'resume'].includes(flags.action))
        throw new Error('--action must be pause or resume.');
      const result = await applyFleetAction(createFleetStore(adapter), adapter, {
        action: flags.action,
        actor: flags.actor,
        reason: flags.reason,
        expectEpoch: flags['expect-epoch'] ? Number(flags['expect-epoch']) : undefined,
        dryRun: flags['dry-run'] === 'true',
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
