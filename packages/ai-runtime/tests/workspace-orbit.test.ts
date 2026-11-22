import { describe, expect, it } from 'vitest';
import {
  auditWorkspaceOrbit,
  buildWorkspaceOrbitInventory,
  formatWorkspaceOrbitMarkdown,
} from '../src/workspace-orbit.js';

describe('workspace-orbit (M13.12)', () => {
  it('builds a deterministic inventory and passes audit for clean Control Plane vs Desktop boundaries', () => {
    const inventoryA = buildWorkspaceOrbitInventory({
      repoLabel: 'A-L-L-A-H/mw-xv',
      baseCommit: 'f92978b',
      capturedAt: '2026-11-23T00:00:00.000Z',
      nodes: [
        {
          id: 'apps/board',
          name: '@moonwitness/board',
          path: 'apps/board',
          kind: 'app',
          plane: 'control_plane',
          status: 'healthy',
          owner: 'control-plane-ui',
          dependencies: ['@moonwitness/ui', '@moonwitness/client'],
          capabilities: ['window.__MW_DESKTOP__.detect'],
        },
        {
          id: 'apps/desktop',
          name: '@moonwitness/desktop',
          path: 'apps/desktop',
          kind: 'app',
          plane: 'desktop_execution_plane',
          status: 'healthy',
          owner: 'desktop-harness',
          dependencies: ['@moonwitness/ai-runtime', '@moonwitness/orm'],
          capabilities: ['worktree.sandbox', 'risk_gate.enforce'],
        },
        {
          id: 'packages/local-ai',
          name: '@moonwitness/local-ai',
          path: 'packages/local-ai',
          kind: 'package',
          plane: 'shared_runtime_package',
          status: 'healthy',
          owner: 'local-ai',
          dependencies: ['@moonwitness/types'],
          capabilities: ['k7.retrieval', 'suggestion.generate'],
        },
      ],
      worktrees: [
        {
          worktreeId: 'wt-m13-next',
          path: 'Z:/repo/mw-xv-m13-next',
          branch: 'm13-next',
          headCommit: 'f92978b',
          dirty: false,
          activeLeaseId: 'lease-1',
          companyId: 1,
        },
      ],
      addons: [
        {
          addonName: 'orm-project',
          packagePath: 'packages/orm-project',
          exposesHttpPlugin: true,
          legacyApiRoutePath: null,
          definesOrmModels: true,
        },
      ],
    });

    const inventoryB = buildWorkspaceOrbitInventory({
      repoLabel: 'A-L-L-A-H/mw-xv',
      baseCommit: 'f92978b',
      capturedAt: '2026-11-23T01:00:00.000Z',
      nodes: [...inventoryA.nodes].reverse(),
      worktrees: inventoryA.worktrees,
      addons: inventoryA.addons,
    });

    expect(inventoryA.contentSha256).toBe(inventoryB.contentSha256);
    expect(inventoryA.planeSummary.control_plane).toBe(1);
    expect(inventoryA.planeSummary.desktop_execution_plane).toBe(1);
    expect(inventoryA.planeSummary.shared_runtime_package).toBe(1);

    const report = auditWorkspaceOrbit(inventoryA);
    expect(report.healthy).toBe(true);
    expect(report.advisoryOnly).toBe(true);
    expect(report.findings).toHaveLength(0);

    const markdown = formatWorkspaceOrbitMarkdown(inventoryA, report);
    expect(markdown).toContain('# Workspace Orbit Audit: A-L-L-A-H/mw-xv');
    expect(markdown).toContain(report.reportSha256);
  });

  it('detects cross-plane boundary violations, INV-014 route drift, and worktree lease issues', () => {
    const inventory = buildWorkspaceOrbitInventory({
      repoLabel: 'A-L-L-A-H/mw-xv',
      nodes: [
        {
          id: 'apps/board',
          name: '@moonwitness/board',
          path: 'apps/board',
          kind: 'app',
          plane: 'control_plane',
          status: 'healthy',
          owner: 'control-plane-ui',
          dependencies: ['better-sqlite3', 'node:fs'],
          capabilities: [],
        },
        {
          id: 'apps/desktop',
          name: '@moonwitness/desktop',
          path: 'apps/desktop',
          kind: 'app',
          plane: 'desktop_execution_plane',
          status: 'healthy',
          owner: 'desktop-harness',
          dependencies: [],
          capabilities: ['orm.define_model'],
        },
        {
          id: 'packages/local-ai',
          name: '@moonwitness/local-ai',
          path: 'packages/local-ai',
          kind: 'package',
          plane: 'shared_runtime_package',
          status: 'drifted',
          owner: '',
          dependencies: [],
          capabilities: ['shell.exec'],
          hasCircularDependency: true,
        },
      ],
      worktrees: [
        {
          worktreeId: 'wt-1',
          path: 'Z:/repo/shared-wt',
          branch: 'feat/a',
          headCommit: 'abc1234',
          dirty: true,
          activeLeaseId: null,
        },
        {
          worktreeId: 'wt-2',
          path: 'Z:/repo/shared-wt',
          branch: 'feat/b',
          headCommit: 'abc1234',
          dirty: false,
          activeLeaseId: 'lease-old',
          leaseExpired: true,
        },
      ],
      addons: [
        {
          addonName: 'orm-legacy',
          packagePath: 'packages/orm-legacy',
          exposesHttpPlugin: false,
          legacyApiRoutePath: 'apps/api/src/routes/legacy.routes.ts',
          definesOrmModels: true,
        },
      ],
    });

    const report = auditWorkspaceOrbit(inventory);
    expect(report.healthy).toBe(false);

    const codes = new Set(report.findings.map((f) => f.code));
    expect(codes.has('CONTROL_PLANE_NATIVE_DEP_LEAK')).toBe(true);
    expect(codes.has('DESKTOP_ORM_MODEL_VIOLATION')).toBe(true);
    expect(codes.has('LOCAL_AI_TOOL_BOUNDARY_VIOLATION')).toBe(true);
    expect(codes.has('MISSING_CANONICAL_OWNER')).toBe(true);
    expect(codes.has('CIRCULAR_WORKSPACE_DEPENDENCY')).toBe(true);
    expect(codes.has('INV014_LEGACY_API_ROUTE_DRIFT')).toBe(true);
    expect(codes.has('DUPLICATE_WORKTREE_PATH')).toBe(true);
    expect(codes.has('EXPIRED_WORKTREE_LEASE')).toBe(true);
    expect(codes.has('DIRTY_UNLEASED_WORKTREE')).toBe(true);
  });
});
