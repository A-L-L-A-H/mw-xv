import { sha256Hex } from './canonical-json.js';
import { compareAscii } from './sort-utils.js';
import { createRedactor, type RedactionContext } from './redaction.js';

export type OrbitPlane =
  | 'control_plane'
  | 'desktop_execution_plane'
  | 'shared_domain_addon'
  | 'shared_runtime_package'
  | 'tooling';

export type OrbitNodeKind = 'app' | 'package' | 'addon' | 'worktree';

export type OrbitNodeStatus = 'healthy' | 'degraded' | 'drifted' | 'blocked' | 'unknown';

export type OrbitFindingSeverity = 'error' | 'warning' | 'info';

export interface WorkspaceOrbitNode {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: OrbitNodeKind;
  readonly plane: OrbitPlane;
  readonly status: OrbitNodeStatus;
  readonly owner: string;
  readonly dependencies: readonly string[];
  readonly capabilities: readonly string[];
  readonly hasCircularDependency?: boolean;
}

export interface WorktreeOrbitState {
  readonly worktreeId: string;
  readonly path: string;
  readonly branch: string | null;
  readonly headCommit: string | null;
  readonly dirty: boolean;
  readonly activeLeaseId: string | null;
  readonly leaseExpired?: boolean;
  readonly companyId?: number;
}

export interface AddonBoundaryEntry {
  readonly addonName: string;
  readonly packagePath: string;
  readonly exposesHttpPlugin: boolean;
  readonly legacyApiRoutePath?: string | null;
  readonly definesOrmModels: boolean;
}

export interface WorkspaceOrbitInventoryInput {
  readonly repoLabel: string;
  readonly baseCommit?: string | null;
  readonly capturedAt?: string;
  readonly nodes: readonly WorkspaceOrbitNode[];
  readonly worktrees?: readonly WorktreeOrbitState[];
  readonly addons?: readonly AddonBoundaryEntry[];
  readonly redactor?: RedactionContext;
}

export interface WorkspaceOrbitPlaneSummary {
  readonly control_plane: number;
  readonly desktop_execution_plane: number;
  readonly shared_domain_addon: number;
  readonly shared_runtime_package: number;
  readonly tooling: number;
}

export interface WorkspaceOrbitInventory {
  readonly schemaVersion: 1;
  readonly repoLabel: string;
  readonly baseCommit: string | null;
  readonly capturedAt: string;
  readonly nodes: readonly WorkspaceOrbitNode[];
  readonly worktrees: readonly WorktreeOrbitState[];
  readonly addons: readonly AddonBoundaryEntry[];
  readonly planeSummary: WorkspaceOrbitPlaneSummary;
  readonly contentSha256: string;
  readonly inventorySha256: string;
}

export interface OrbitDriftFinding {
  readonly code: string;
  readonly severity: OrbitFindingSeverity;
  readonly targetId: string;
  readonly plane: OrbitPlane;
  readonly message: string;
}

export interface WorkspaceOrbitAuditPolicy {
  readonly forbidBoardNativeDeps?: boolean;
  readonly forbidDesktopOrmModels?: boolean;
  readonly forbidLocalAiToolCapabilities?: boolean;
  readonly enforceInv014AddonHttpPlugins?: boolean;
  readonly requireCleanUnleasedWorktrees?: boolean;
}

export interface WorkspaceOrbitAuditReport {
  readonly schemaVersion: 1;
  readonly repoLabel: string;
  readonly advisoryOnly: true;
  readonly healthy: boolean;
  readonly planeSummary: WorkspaceOrbitPlaneSummary;
  readonly findings: readonly OrbitDriftFinding[];
  readonly reportSha256: string;
}

const FORBIDDEN_BOARD_DEPS = new Set([
  'better-sqlite3',
  'node-pty',
  'node:fs',
  'node:child_process',
  '@tauri-apps/api',
]);

const FORBIDDEN_LOCAL_AI_CAPABILITIES = new Set([
  'shell.exec',
  'fs.write',
  'worktree.exec',
  'mcp.call',
]);

function summarizePlanes(nodes: readonly WorkspaceOrbitNode[]): WorkspaceOrbitPlaneSummary {
  let controlPlane = 0;
  let desktopExecutionPlane = 0;
  let sharedDomainAddon = 0;
  let sharedRuntimePackage = 0;
  let tooling = 0;

  for (const node of nodes) {
    switch (node.plane) {
      case 'control_plane':
        controlPlane += 1;
        break;
      case 'desktop_execution_plane':
        desktopExecutionPlane += 1;
        break;
      case 'shared_domain_addon':
        sharedDomainAddon += 1;
        break;
      case 'shared_runtime_package':
        sharedRuntimePackage += 1;
        break;
      case 'tooling':
        tooling += 1;
        break;
    }
  }

  return {
    control_plane: controlPlane,
    desktop_execution_plane: desktopExecutionPlane,
    shared_domain_addon: sharedDomainAddon,
    shared_runtime_package: sharedRuntimePackage,
    tooling,
  };
}

/**
 * Deterministically builds a redacted WorkspaceOrbitInventory across Control Plane,
 * Local-First Desktop Execution Plane, ORM Addons, and Shared Runtime packages.
 */
export function buildWorkspaceOrbitInventory(
  input: WorkspaceOrbitInventoryInput
): WorkspaceOrbitInventory {
  const redactor = input.redactor ?? createRedactor();
  const capturedAt = input.capturedAt ?? new Date(0).toISOString();

  const normalizedNodes: WorkspaceOrbitNode[] = input.nodes
    .map((node) => ({
      id: redactor.redactString(node.id.trim()),
      name: redactor.redactString(node.name.trim()),
      path: redactor.redactString(node.path.trim().replaceAll('\\', '/')),
      kind: node.kind,
      plane: node.plane,
      status: node.status,
      owner: redactor.redactString(node.owner.trim()),
      dependencies: [...node.dependencies]
        .map((dep) => redactor.redactString(dep.trim()))
        .filter((dep) => dep.length > 0)
        .sort(compareAscii),
      capabilities: [...node.capabilities]
        .map((cap) => redactor.redactString(cap.trim()))
        .filter((cap) => cap.length > 0)
        .sort(compareAscii),
      ...(node.hasCircularDependency !== undefined
        ? { hasCircularDependency: node.hasCircularDependency }
        : {}),
    }))
    .sort((a, b) => compareAscii(a.id, b.id));

  const normalizedWorktrees: WorktreeOrbitState[] = (input.worktrees ?? [])
    .map((wt) => ({
      worktreeId: redactor.redactString(wt.worktreeId.trim()),
      path: redactor.redactString(wt.path.trim().replaceAll('\\', '/')),
      branch: wt.branch ? redactor.redactString(wt.branch.trim()) : null,
      headCommit: wt.headCommit ? redactor.redactString(wt.headCommit.trim()) : null,
      dirty: wt.dirty,
      activeLeaseId: wt.activeLeaseId ? redactor.redactString(wt.activeLeaseId.trim()) : null,
      ...(wt.leaseExpired !== undefined ? { leaseExpired: wt.leaseExpired } : {}),
      ...(wt.companyId !== undefined ? { companyId: wt.companyId } : {}),
    }))
    .sort((a, b) => compareAscii(a.worktreeId, b.worktreeId));

  const normalizedAddons: AddonBoundaryEntry[] = (input.addons ?? [])
    .map((addon) => ({
      addonName: redactor.redactString(addon.addonName.trim()),
      packagePath: redactor.redactString(addon.packagePath.trim().replaceAll('\\', '/')),
      exposesHttpPlugin: addon.exposesHttpPlugin,
      legacyApiRoutePath: addon.legacyApiRoutePath
        ? redactor.redactString(addon.legacyApiRoutePath.trim().replaceAll('\\', '/'))
        : null,
      definesOrmModels: addon.definesOrmModels,
    }))
    .sort((a, b) => compareAscii(a.addonName, b.addonName));

  const planeSummary = summarizePlanes(normalizedNodes);
  const contentPayload = {
    schemaVersion: 1 as const,
    repoLabel: redactor.redactString(input.repoLabel.trim()),
    baseCommit: input.baseCommit ? redactor.redactString(input.baseCommit.trim()) : null,
    nodes: normalizedNodes,
    worktrees: normalizedWorktrees,
    addons: normalizedAddons,
    planeSummary,
  };

  const contentSha256 = sha256Hex(JSON.stringify(contentPayload));
  const inventorySha256 = sha256Hex(
    JSON.stringify({
      ...contentPayload,
      capturedAt,
      contentSha256,
    })
  );

  return {
    ...contentPayload,
    capturedAt,
    contentSha256,
    inventorySha256,
  };
}

/**
 * Validates Control Plane vs Local-First Desktop Execution Plane boundaries,
 * INV-014 addon HTTP plugin rules, worktree lease hygiene, and node health.
 */
export function auditWorkspaceOrbit(
  inventory: WorkspaceOrbitInventory,
  policy?: WorkspaceOrbitAuditPolicy
): WorkspaceOrbitAuditReport {
  const forbidBoardNativeDeps = policy?.forbidBoardNativeDeps ?? true;
  const forbidDesktopOrmModels = policy?.forbidDesktopOrmModels ?? true;
  const forbidLocalAiToolCapabilities = policy?.forbidLocalAiToolCapabilities ?? true;
  const enforceInv014AddonHttpPlugins = policy?.enforceInv014AddonHttpPlugins ?? true;
  const requireCleanUnleasedWorktrees = policy?.requireCleanUnleasedWorktrees ?? true;

  const findings: OrbitDriftFinding[] = [];

  for (const node of inventory.nodes) {
    if (node.owner.trim().length === 0) {
      findings.push({
        code: 'MISSING_CANONICAL_OWNER',
        severity: 'error',
        targetId: node.id,
        plane: node.plane,
        message: `Orbit node "${node.id}" has no declared canonical owner.`,
      });
    }

    if (node.hasCircularDependency) {
      findings.push({
        code: 'CIRCULAR_WORKSPACE_DEPENDENCY',
        severity: 'error',
        targetId: node.id,
        plane: node.plane,
        message: `Orbit node "${node.id}" participates in a circular workspace dependency.`,
      });
    }

    if (node.status === 'blocked' || node.status === 'drifted') {
      findings.push({
        code: 'ORBIT_NODE_UNHEALTHY',
        severity: node.status === 'blocked' ? 'error' : 'warning',
        targetId: node.id,
        plane: node.plane,
        message: `Orbit node "${node.id}" is in "${node.status}" state.`,
      });
    }

    if (forbidBoardNativeDeps && (node.id === 'apps/board' || node.name === '@moonwitness/board')) {
      for (const dep of node.dependencies) {
        if (FORBIDDEN_BOARD_DEPS.has(dep)) {
          findings.push({
            code: 'CONTROL_PLANE_NATIVE_DEP_LEAK',
            severity: 'error',
            targetId: node.id,
            plane: node.plane,
            message: `Control Plane UI "${node.id}" must not import Desktop-only dependency "${dep}".`,
          });
        }
      }
    }

    if (
      forbidDesktopOrmModels &&
      (node.id === 'apps/desktop' || node.name === '@moonwitness/desktop') &&
      node.capabilities.includes('orm.define_model')
    ) {
      findings.push({
        code: 'DESKTOP_ORM_MODEL_VIOLATION',
        severity: 'error',
        targetId: node.id,
        plane: node.plane,
        message:
          'Desktop execution plane must reuse DESKTOP_ADDONS and never define its own ORM models.',
      });
    }

    if (
      forbidLocalAiToolCapabilities &&
      (node.id === 'packages/local-ai' || node.name === '@moonwitness/local-ai')
    ) {
      for (const cap of node.capabilities) {
        if (FORBIDDEN_LOCAL_AI_CAPABILITIES.has(cap)) {
          findings.push({
            code: 'LOCAL_AI_TOOL_BOUNDARY_VIOLATION',
            severity: 'error',
            targetId: node.id,
            plane: node.plane,
            message: `@moonwitness/local-ai must remain tool-free; forbidden capability "${cap}" detected.`,
          });
        }
      }
    }
  }

  if (enforceInv014AddonHttpPlugins) {
    for (const addon of inventory.addons) {
      if (addon.legacyApiRoutePath) {
        findings.push({
          code: 'INV014_LEGACY_API_ROUTE_DRIFT',
          severity: 'error',
          targetId: addon.addonName,
          plane: 'shared_domain_addon',
          message: `Addon "${addon.addonName}" still references legacy route "${addon.legacyApiRoutePath}" instead of manifest.httpPlugins.`,
        });
      }
    }
  }

  const seenWorktreePaths = new Set<string>();
  for (const wt of inventory.worktrees) {
    if (seenWorktreePaths.has(wt.path)) {
      findings.push({
        code: 'DUPLICATE_WORKTREE_PATH',
        severity: 'error',
        targetId: wt.worktreeId,
        plane: 'desktop_execution_plane',
        message: `Duplicate worktree path "${wt.path}" detected for "${wt.worktreeId}".`,
      });
    }
    seenWorktreePaths.add(wt.path);

    if (wt.leaseExpired) {
      findings.push({
        code: 'EXPIRED_WORKTREE_LEASE',
        severity: 'error',
        targetId: wt.worktreeId,
        plane: 'desktop_execution_plane',
        message: `Worktree "${wt.worktreeId}" has an expired lease and must be reclaimed before execution.`,
      });
    }

    if (requireCleanUnleasedWorktrees && wt.dirty && !wt.activeLeaseId) {
      findings.push({
        code: 'DIRTY_UNLEASED_WORKTREE',
        severity: 'warning',
        targetId: wt.worktreeId,
        plane: 'desktop_execution_plane',
        message: `Worktree "${wt.worktreeId}" is dirty without an active lease.`,
      });
    }
  }

  findings.sort((a, b) => {
    const codeCmp = compareAscii(a.code, b.code);
    if (codeCmp !== 0) return codeCmp;
    return compareAscii(a.targetId, b.targetId);
  });

  const healthy = findings.every((finding) => finding.severity !== 'error');
  const payload = {
    schemaVersion: 1 as const,
    repoLabel: inventory.repoLabel,
    advisoryOnly: true as const,
    healthy,
    planeSummary: inventory.planeSummary,
    findings,
  };

  return {
    ...payload,
    reportSha256: sha256Hex(JSON.stringify(payload)),
  };
}

/**
 * Renders a deterministic Markdown report for a WorkspaceOrbitInventory and its audit report.
 */
export function formatWorkspaceOrbitMarkdown(
  inventory: WorkspaceOrbitInventory,
  report: WorkspaceOrbitAuditReport
): string {
  const lines: string[] = [
    `# Workspace Orbit Audit: ${inventory.repoLabel}`,
    '',
    `- **Base Commit:** \`${inventory.baseCommit ?? 'unknown'}\``,
    `- **Healthy:** \`${String(report.healthy)}\` (advisoryOnly=\`true\`)`,
    `- **Inventory SHA-256:** \`${inventory.contentSha256}\``,
    `- **Report SHA-256:** \`${report.reportSha256}\``,
    '',
    '## Plane Summary',
    '',
    `| Plane | Nodes |`,
    `| --- | ---: |`,
    `| control_plane | ${report.planeSummary.control_plane} |`,
    `| desktop_execution_plane | ${report.planeSummary.desktop_execution_plane} |`,
    `| shared_domain_addon | ${report.planeSummary.shared_domain_addon} |`,
    `| shared_runtime_package | ${report.planeSummary.shared_runtime_package} |`,
    `| tooling | ${report.planeSummary.tooling} |`,
    '',
    '## Findings',
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('- None. All inspected orbit boundaries are clean.');
  } else {
    for (const finding of report.findings) {
      lines.push(
        `- **[${finding.severity.toUpperCase()}] \`${finding.code}\`** (\`${finding.targetId}\` / \`${finding.plane}\`): ${finding.message}`
      );
    }
  }

  return lines.join('\n');
}
