/**
 * T41 — Read-only Plan-TaskOS Brain queries.
 *
 * Every operation here opens SQLite with `readonly: true` semantics: no schema
 * initialization, no lease mutation, and no Git writes. All text returned to
 * the MCP surface passes through the SDK redaction membrane.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWorkGraphDag,
  computeMerkleRoot,
  discoverPlans,
  exportSubgraph,
  hybridRecall,
  listActiveLeases,
  openBrainStore,
  queryBlastRadiusImpact,
  redactSensitiveText,
  type BrainStorageDriver,
  type LoadedPlanBundle,
} from '@moonwitness/plan-taskos';

export interface PlanBrainContext {
  readonly repoRoot?: string;
  readonly dbPath?: string;
  readonly openStore?: (dbPath: string) => Promise<BrainStorageDriver | null>;
  readonly discover?: (repoRoot: string) => Promise<readonly LoadedPlanBundle[]>;
  readonly fetchFn?: typeof fetch;
}

export interface PlanStatusResult {
  readonly plans: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly format: string;
    readonly totalTasks: number;
    readonly doneTasks: number;
    readonly waves: ReadonlyArray<{
      readonly id: string;
      readonly title: string;
      readonly done: number;
      readonly total: number;
    }>;
    readonly criticalPath: readonly string[];
    readonly merkleRoot: string | null;
  }>;
  readonly activeLeases: readonly {
    readonly taskUrn: string;
    readonly agentRuntime: string;
    readonly modelTier: string;
    readonly expiresAt: string;
  }[];
  readonly brainAvailable: boolean;
}

const REPO_ROOT = findRepoRoot(path.resolve(path.dirname(fileURLToPath(import.meta.url))));

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir, '../../..');
}

function resolveRepoRoot(raw: string | undefined): string {
  return raw ? path.resolve(raw) : REPO_ROOT;
}

async function openReadOnlyStore(
  dbPath: string,
  context: PlanBrainContext
): Promise<BrainStorageDriver | null> {
  if (!existsSync(dbPath)) return null;
  if (context.openStore) return context.openStore(dbPath);
  return openBrainStore({ dbPath, mode: 'sqlite' });
}

async function readMerkleRoots(store: BrainStorageDriver): Promise<Readonly<Record<string, string>>> {
  try {
    const rows = store.all(
      'SELECT plan_id, merkle_root FROM proof_ledger ORDER BY recorded_at DESC;'
    ) as Array<{ plan_id?: unknown; merkle_root?: unknown }>;
    const roots: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row.plan_id === 'string' && typeof row.merkle_root === 'string') {
        roots[row.plan_id] ??= row.merkle_root;
      }
    }
    return roots;
  } catch {
    return {};
  }
}

export async function readPlanStatus(context: PlanBrainContext = {}): Promise<PlanStatusResult> {
  const repoRoot = resolveRepoRoot(context.repoRoot);
  const dbPath = context.dbPath ?? path.join(repoRoot, '.plan', '.brain', 'taskos.sqlite');
  const discover = context.discover ?? discoverPlans;
  const bundles = await discover(repoRoot);
  const store = await openReadOnlyStore(dbPath, context);
  try {
    const [leases, roots] = store
      ? await Promise.all([listActiveLeases(store), readMerkleRoots(store)])
      : [[], {} as Readonly<Record<string, string>>];
    const plans = bundles.map((bundle) => {
      const tasks = bundle.waves.flatMap((wave) => wave.tasks);
      const dag = buildWorkGraphDag(tasks);
      let leafHashes: string[] = [];
      try {
        const rows = (store?.all(
          'SELECT envelope_sha256 FROM proof_ledger WHERE plan_id = ? ORDER BY recorded_at DESC;',
          bundle.manifest.plan_id
        ) ?? []) as Array<{ envelope_sha256?: unknown }>;
        leafHashes = rows
          .filter((row): row is { envelope_sha256: string } => typeof row.envelope_sha256 === 'string')
          .map((row) => row.envelope_sha256);
      } catch {
        leafHashes = [];
      }
      const computedRoot = leafHashes.length > 0 ? computeMerkleRoot(leafHashes) : null;
      return {
        id: bundle.manifest.plan_id,
        title: bundle.manifest.title,
        format: bundle.format,
        totalTasks: tasks.length,
        doneTasks: tasks.filter((task) => task.lifecycle.status === 'done').length,
        waves: bundle.waves.map((wave) => ({
          id: wave.wave_id,
          title: wave.title,
          done: wave.tasks.filter((task) => task.lifecycle.status === 'done').length,
          total: wave.tasks.length,
        })),
        criticalPath: [...dag.criticalPathIds],
        merkleRoot: computedRoot ?? roots[bundle.manifest.plan_id] ?? null,
      };
    });
    return {
      plans,
      activeLeases: leases.map((lease) => ({
        taskUrn: redactSensitiveText(lease.taskUrn).text,
        agentRuntime: redactSensitiveText(lease.agentRuntime).text,
        modelTier: redactSensitiveText(lease.modelTier).text,
        expiresAt: lease.expiresAt,
      })),
      brainAvailable: Boolean(store),
    };
  } finally {
    store?.close();
  }
}

export interface PlanRecallResult {
  readonly mode: 'lexical_only' | 'hybrid';
  readonly results: ReadonlyArray<{
    readonly urn: string;
    readonly planId: string;
    readonly title: string;
    readonly snippet: string;
    readonly score: number;
    readonly matchType: string;
  }>;
}

export async function readPlanRecall(
  query: string,
  context: PlanBrainContext = {}
): Promise<PlanRecallResult> {
  if (!query.trim()) throw new Error("Missing required argument: 'query'");
  const repoRoot = resolveRepoRoot(context.repoRoot);
  const dbPath = context.dbPath ?? path.join(repoRoot, '.plan', '.brain', 'taskos.sqlite');
  const store = await openReadOnlyStore(dbPath, context);
  if (!store) return { mode: 'lexical_only', results: [] };
  try {
    const outcome = await hybridRecall(store, {
      query,
      limit: 20,
      ...(context.fetchFn ? { fetchFn: context.fetchFn } : {}),
    });
    return {
      mode: outcome.mode,
      results: outcome.results.map((result) => ({
        urn: redactSensitiveText(result.urn).text,
        planId: redactSensitiveText(result.plan_id).text,
        title: redactSensitiveText(result.title).text,
        snippet: redactSensitiveText(result.snippet).text,
        score: result.score,
        matchType: result.matchType,
      })),
    };
  } finally {
    store.close();
  }
}

export type PlanImpactResult = ReturnType<typeof queryBlastRadiusImpact>;

export async function readPlanImpact(
  target: string,
  context: PlanBrainContext = {}
): Promise<PlanImpactResult> {
  if (!target.trim()) throw new Error("Missing required argument: 'target'");
  const repoRoot = resolveRepoRoot(context.repoRoot);
  const dbPath = context.dbPath ?? path.join(repoRoot, '.plan', '.brain', 'taskos.sqlite');
  const store = await openReadOnlyStore(dbPath, context);
  if (!store) {
    return {
      target: redactSensitiveText(target).text,
      impactedTasks: [],
      criticalPathNodes: [],
      linkedAdrs: [],
      linkedWaves: [],
      docRegenerationFlags: [],
      failureEpisodes: [],
    };
  }
  try {
    const impact = queryBlastRadiusImpact(store, target);
    return {
      ...impact,
      target: redactSensitiveText(impact.target).text,
      impactedTasks: impact.impactedTasks.map((task) => ({
        ...task,
        title: redactSensitiveText(task.title).text,
        owner_files: redactSensitiveText(task.owner_files).text,
      })),
      linkedAdrs: impact.linkedAdrs.map((adr) => ({
        urn: redactSensitiveText(adr.urn).text,
        title: redactSensitiveText(adr.title).text,
      })),
      failureEpisodes: impact.failureEpisodes.map((episode) => ({
        ...episode,
        summary: redactSensitiveText(episode.summary).text,
      })),
    };
  } finally {
    store.close();
  }
}

/** Read-only graph projection; retained for consumers that need raw rows. */
export async function readPlanGraph(
  options: { planId?: string; centerUrn?: string },
  context: PlanBrainContext = {}
): Promise<ReturnType<typeof exportSubgraph>> {
  const repoRoot = resolveRepoRoot(context.repoRoot);
  const dbPath = context.dbPath ?? path.join(repoRoot, '.plan', '.brain', 'taskos.sqlite');
  const store = await openReadOnlyStore(dbPath, context);
  if (!store) return { nodes: [], edges: [] };
  try {
    return exportSubgraph(store, options);
  } finally {
    store.close();
  }
}

/** Read-only episodic-memory count used by plan_status diagnostics. */
export async function readEpisodeCount(context: PlanBrainContext = {}): Promise<number> {
  const repoRoot = resolveRepoRoot(context.repoRoot);
  const dbPath = context.dbPath ?? path.join(repoRoot, '.plan', '.brain', 'taskos.sqlite');
  const store = await openReadOnlyStore(dbPath, context);
  if (!store) return 0;
  try {
    const row = store.get('SELECT COUNT(*) AS count FROM episodic_memory;') as { count?: unknown };
    return typeof row?.count === 'number' ? row.count : 0;
  } finally {
    store.close();
  }
}
