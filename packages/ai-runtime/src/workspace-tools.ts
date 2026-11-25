import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue } from '@moonwitness/types';
import type {
  CapabilityGateway,
  RelaxedToolRegistration,
  ToolSideEffectKind,
} from './capability-gateway.js';
import type { RiskTier } from './risk-policy.js';
import { validateDiffScope } from './pcw-verifier.js';
import type { EphemeralSandboxManifest } from './sandbox-runner.js';
import type {
  WorkspaceCheckKind,
  WorkspaceCheckResult,
  WorkspaceDiffResult,
  WorkspaceSandboxClient,
} from './workspace-contract.js';
import { verifyWorkspaceCheck } from './workspace-contract.js';

export const WORKSPACE_TOOLS_VERSION = 1 as const;

export interface WorkspaceToolSpec {
  readonly name: string;
  readonly tier: RiskTier;
  readonly sideEffect: ToolSideEffectKind;
  readonly enabled: boolean;
  readonly capability: string;
}

/** Explicit matrix. R4 is always denied; R3 publication is disabled in this milestone. */
export const WORKSPACE_TOOL_MATRIX: readonly WorkspaceToolSpec[] = Object.freeze([
  {
    name: 'workspace.list',
    tier: 'R0',
    sideEffect: 'read_only',
    enabled: true,
    capability: 'workspace.read@v1',
  },
  {
    name: 'workspace.read',
    tier: 'R0',
    sideEffect: 'read_only',
    enabled: true,
    capability: 'workspace.read@v1',
  },
  {
    name: 'workspace.search',
    tier: 'R0',
    sideEffect: 'read_only',
    enabled: true,
    capability: 'workspace.read@v1',
  },
  {
    name: 'workspace.diff',
    tier: 'R0',
    sideEffect: 'read_only',
    enabled: true,
    capability: 'workspace.read@v1',
  },
  {
    name: 'workspace.apply_patch',
    tier: 'R1',
    sideEffect: 'reversible_write',
    enabled: true,
    capability: 'workspace.patch@v1',
  },
  {
    name: 'workspace.run_check',
    tier: 'R1',
    sideEffect: 'reversible_write',
    enabled: true,
    capability: 'workspace.check@v1',
  },
  {
    name: 'workspace.rollback',
    tier: 'R1',
    sideEffect: 'reversible_write',
    enabled: true,
    capability: 'workspace.patch@v1',
  },
  {
    name: 'workspace.commit_local',
    tier: 'R2',
    sideEffect: 'reversible_write',
    enabled: true,
    capability: 'workspace.commit@v1',
  },
  {
    name: 'workspace.request_publish',
    tier: 'R3',
    sideEffect: 'external_effect',
    enabled: false,
    capability: 'workspace.publish@v1',
  },
]);

const DISABLED_TIERS: ReadonlySet<RiskTier> = new Set(['R3', 'R4']);

export class WorkspaceToolDeniedError extends Error {
  readonly code = 'WORKSPACE_TOOL_DENIED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceToolDeniedError';
  }
}

function assertToolEnabled(name: string): void {
  const spec = WORKSPACE_TOOL_MATRIX.find((item) => item.name === name);
  if (!spec || !spec.enabled || DISABLED_TIERS.has(spec.tier)) {
    throw new WorkspaceToolDeniedError(`Workspace tool "${name}" is disabled or prohibited`);
  }
}

const PATH_PROPERTY = { type: 'string', minLength: 1, maxLength: 1024 } as const;
const RUN_ID_PROPERTY = { type: 'string', minLength: 1, maxLength: 64 } as const;

function objectSchema(properties: Record<string, JsonSchemaNodeLike>, required: readonly string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as never;
}
type JsonSchemaNodeLike = Record<string, unknown>;

function validateScope(allowedPaths: readonly string[], paths: readonly string[]): void {
  if (paths.length === 0) return;
  const result = validateDiffScope([...paths], [...allowedPaths]);
  if (!result.scopeClean) {
    throw new WorkspaceToolDeniedError(
      `Workspace paths outside approved scope: ${result.unsafePaths.join(', ')}`
    );
  }
}

export interface WorkspaceEvidenceBundle {
  readonly runId: string;
  readonly check: WorkspaceCheckKind;
  readonly passed: boolean;
  readonly exitCode: number;
  readonly diffSha256: string;
  readonly verificationSha256: string;
  readonly evidenceSha256: string;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
}

/** Deterministic verification bundle; model self-report is never acceptance. */
export async function buildWorkspaceEvidence(params: {
  readonly client: WorkspaceSandboxClient;
  readonly manifest: EphemeralSandboxManifest;
  readonly runId: string;
  readonly check: WorkspaceCheckKind;
}): Promise<WorkspaceEvidenceBundle> {
  const diff: WorkspaceDiffResult = await params.client.diffWorkspace({ runId: params.runId });
  const check: WorkspaceCheckResult = await params.client.executeCheck({
    runId: params.runId,
    check: params.check,
  });
  const verification = verifyWorkspaceCheck(params.manifest, check, diff.unifiedDiff);
  const evidenceSha256 = createHash('sha256')
    .update(
      JSON.stringify({
        runId: params.runId,
        check: params.check,
        checkSha: createHash('sha256')
          .update(
            JSON.stringify({
              exitCode: check.exitCode,
              stdout: check.stdout,
              stderr: check.stderr,
              timedOut: check.timedOut,
              truncated: check.truncated,
            })
          )
          .digest('hex'),
        diffSha256: diff.diffSha256,
        verificationSha256: verification.verificationSha256,
      })
    )
    .digest('hex');
  return {
    runId: params.runId,
    check: params.check,
    passed: verification.passed && diff.scopeClean,
    exitCode: check.exitCode,
    diffSha256: diff.diffSha256,
    verificationSha256: verification.verificationSha256,
    evidenceSha256,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  };
}

export interface WorkspaceToolSetOptions {
  readonly gateway: CapabilityGateway;
  readonly client: WorkspaceSandboxClient;
  readonly allowedPaths: readonly string[];
  readonly ownerAddon?: string;
  readonly maxReadBytes?: number;
}

/**
 * Registers the typed, allowlisted coding tools on an existing gateway.
 * Tools never receive shell commands, host paths, secrets or ORM handles.
 */
export function registerWorkspaceTools(options: WorkspaceToolSetOptions): readonly string[] {
  const { gateway, client, allowedPaths } = options;
  const ownerAddon = options.ownerAddon ?? 'ai-runtime';
  const maxReadBytes = options.maxReadBytes ?? 256 * 1024;
  const registered: string[] = [];

  const register = (tool: RelaxedToolRegistration<JsonObject, JsonValue>): void => {
    assertToolEnabled(tool.name);
    gateway.registerTool({
      ...tool,
      ownerAddon,
      version: 1,
    });
    registered.push(tool.name);
  };

  register({
    name: 'workspace.list',
    riskTier: 'R0',
    capability: 'workspace.read@v1',
    sideEffect: 'read_only',
    dataClassification: 'cloud_eligible',
    description: 'List bounded paths from the curated cloud-eligible worktree.',
    inputSchema: objectSchema({ runId: RUN_ID_PROPERTY, path: PATH_PROPERTY }, ['runId']),
    execute: async (args) => {
      if (typeof args.path === 'string') validateScope(allowedPaths, [args.path]);
      const result = await client.listWorkspace({
        runId: String(args.runId),
        ...(typeof args.path === 'string' ? { path: args.path } : {}),
      });
      validateScope(allowedPaths, result.paths);
      return { paths: result.paths } as unknown as JsonValue;
    },
  });

  register({
    name: 'workspace.read',
    riskTier: 'R0',
    capability: 'workspace.read@v1',
    sideEffect: 'read_only',
    dataClassification: 'cloud_eligible',
    maxOutputBytes: maxReadBytes,
    description: 'Bounded handle read from an approved worktree path.',
    inputSchema: objectSchema(
      {
        runId: RUN_ID_PROPERTY,
        path: PATH_PROPERTY,
        offset: { type: 'integer', minimum: 0, maximum: 16_777_216 },
        maxBytes: { type: 'integer', minimum: 1_024, maximum: maxReadBytes },
      },
      ['runId', 'path']
    ),
    execute: async (args) => {
      validateScope(allowedPaths, [String(args.path)]);
      const result = await client.readWorkspaceFile({
        runId: String(args.runId),
        path: String(args.path),
        ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
        ...(typeof args.maxBytes === 'number' ? { maxBytes: args.maxBytes } : {}),
      });
      return {
        path: result.path,
        content: result.content,
        sizeBytes: result.sizeBytes,
        truncated: result.truncated,
      } as unknown as JsonValue;
    },
  });

  register({
    name: 'workspace.search',
    riskTier: 'R0',
    capability: 'workspace.read@v1',
    sideEffect: 'read_only',
    dataClassification: 'cloud_eligible',
    description: 'Bounded literal search across approved worktree files.',
    inputSchema: objectSchema(
      {
        runId: RUN_ID_PROPERTY,
        query: { type: 'string', minLength: 1, maxLength: 256 },
        path: PATH_PROPERTY,
      },
      ['runId', 'query']
    ),
    execute: async (args) => {
      const query = String(args.query);
      const basePath = typeof args.path === 'string' ? args.path : '.';
      validateScope(allowedPaths, [basePath]);
      const listing = await client.listWorkspace({ runId: String(args.runId), path: basePath });
      const matches: { path: string; line: number; snippet: string }[] = [];
      for (const filePath of listing.paths.slice(0, 200)) {
        validateScope(allowedPaths, [filePath]);
        const file = await client.readWorkspaceFile({
          runId: String(args.runId),
          path: filePath,
          maxBytes: Math.min(maxReadBytes, 65_536),
        });
        const lines = file.content.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
          if (!lines[index].includes(query)) continue;
          matches.push({
            path: filePath,
            line: index + 1,
            snippet: lines[index].slice(0, 512),
          });
          if (matches.length >= 100) return { matches } as unknown as JsonValue;
        }
      }
      return { matches } as unknown as JsonValue;
    },
  });

  register({
    name: 'workspace.apply_patch',
    riskTier: 'R1',
    capability: 'workspace.patch@v1',
    sideEffect: 'reversible_write',
    idempotent: true,
    dataClassification: 'cloud_eligible',
    description: 'Structured bounded patch; no shell and no arbitrary host path.',
    inputSchema: objectSchema(
      {
        runId: RUN_ID_PROPERTY,
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          items: objectSchema(
            {
              type: { type: 'string', enum: ['write', 'append'] },
              path: PATH_PROPERTY,
              content: { type: 'string', maxLength: 524_288 },
            },
            ['type', 'path', 'content']
          ),
        },
      },
      ['runId', 'operations']
    ),
    execute: async (args) => {
      const operations = args.operations as unknown as readonly {
        readonly type: 'write' | 'append';
        readonly path: string;
        readonly content: string;
      }[];
      validateScope(
        allowedPaths,
        operations.map((operation) => operation.path)
      );
      const result = await client.applyWorkspacePatch({
        runId: String(args.runId),
        operations,
      });
      return { files: result.files } as unknown as JsonValue;
    },
  });

  register({
    name: 'workspace.run_check',
    riskTier: 'R1',
    capability: 'workspace.check@v1',
    sideEffect: 'reversible_write',
    dataClassification: 'cloud_eligible',
    description: 'Execute one fixed allowlisted check template inside the sandbox.',
    inputSchema: objectSchema(
      {
        runId: RUN_ID_PROPERTY,
        check: {
          type: 'string',
          enum: [
            'node-test',
            'pnpm-test',
            'pnpm-typecheck',
            'pnpm-lint',
            'pnpm-build',
            'vitest-run',
            'tsc-noemit',
          ],
        },
        cwd: PATH_PROPERTY,
      },
      ['runId', 'check']
    ),
    execute: async (args) => {
      if (typeof args.cwd === 'string') validateScope(allowedPaths, [args.cwd]);
      const result = await client.executeCheck({
        runId: String(args.runId),
        check: args.check as WorkspaceCheckKind,
        ...(typeof args.cwd === 'string' ? { cwd: args.cwd } : {}),
      });
      return {
        check: result.check,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
        stdout: result.stdout,
        stderr: result.stderr,
      } as unknown as JsonValue;
    },
  });

  register({
    name: 'workspace.diff',
    riskTier: 'R0',
    capability: 'workspace.read@v1',
    sideEffect: 'read_only',
    dataClassification: 'cloud_eligible',
    description: 'Redacted bounded unified diff with scope enforcement.',
    inputSchema: objectSchema({ runId: RUN_ID_PROPERTY }, ['runId']),
    execute: async (args) => {
      const result = await client.diffWorkspace({ runId: String(args.runId) });
      validateScope(
        allowedPaths,
        result.files.map((file) => file.path)
      );
      return {
        files: result.files,
        unifiedDiff: result.unifiedDiff,
        diffSha256: result.diffSha256,
        scopeClean: result.scopeClean,
      } as unknown as JsonValue;
    },
  });

  register({
    name: 'workspace.rollback',
    riskTier: 'R1',
    capability: 'workspace.patch@v1',
    sideEffect: 'reversible_write',
    idempotent: true,
    dataClassification: 'cloud_eligible',
    description: 'Discard worktree changes or restore a captured snapshot.',
    inputSchema: objectSchema({ runId: RUN_ID_PROPERTY, snapshotId: RUN_ID_PROPERTY }, ['runId']),
    execute: async (args) => {
      const result = await client.rollbackWorkspace({
        runId: String(args.runId),
        ...(typeof args.snapshotId === 'string' ? { snapshotId: args.snapshotId } : {}),
      });
      return { status: result.status, headCommit: result.headCommit } as unknown as JsonValue;
    },
  });

  register({
    name: 'workspace.commit_local',
    riskTier: 'R2',
    capability: 'workspace.commit@v1',
    sideEffect: 'reversible_write',
    requiresConfirmation: true,
    dataClassification: 'cloud_eligible',
    description: 'Local-only commit; no push, merge or deployment.',
    inputSchema: objectSchema(
      { runId: RUN_ID_PROPERTY, message: { type: 'string', minLength: 1, maxLength: 512 } },
      ['runId', 'message']
    ),
    execute: async (args) => {
      const result = await client.commitLocal({
        runId: String(args.runId),
        message: String(args.message),
      });
      return {
        commitSha: result.commitSha,
        files: result.files,
        pushed: result.pushed,
      } as unknown as JsonValue;
    },
  });

  return registered;
}

/** Guard for callers that assemble tool sets dynamically from model output. */
export function isWorkspaceToolAllowed(name: string): boolean {
  const spec = WORKSPACE_TOOL_MATRIX.find((item) => item.name === name);
  return spec !== undefined && spec.enabled && !DISABLED_TIERS.has(spec.tier);
}
