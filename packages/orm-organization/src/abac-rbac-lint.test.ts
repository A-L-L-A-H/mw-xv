import { describe, expect, it } from 'vitest';
import { lintAbacRbacPolicies } from './abac-rbac-lint.js';

describe('abac-rbac-lint', () => {
  it('passes clean tenant-scoped policies without issues', () => {
    const report = lintAbacRbacPolicies({
      roles: [
        { name: 'viewer', permissions: ['doc:read'] },
        { name: 'admin', permissions: ['*'], isPrivileged: true },
      ],
      rules: [
        {
          id: 'rule-read-doc',
          effect: 'allow',
          roles: ['viewer'],
          permissions: ['doc:read'],
          resource: 'document',
          companyId: 1,
        },
      ],
      knownPermissions: ['doc:read', '*'],
    });

    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('detects privilege escalation, missing tenant scope, conflicting rules, and orphan permissions', () => {
    const report = lintAbacRbacPolicies({
      roles: [
        { name: 'member', permissions: ['doc:read', 'admin:*'] },
        { name: 'superadmin', permissions: ['*'], isPrivileged: true },
        { name: 'escalator', permissions: ['doc:read'], inherits: ['superadmin'] },
      ],
      rules: [
        {
          id: 'r1',
          effect: 'allow',
          roles: ['member'],
          permissions: ['doc:read'],
          resource: 'document',
        },
        {
          id: 'r2',
          effect: 'deny',
          roles: ['member'],
          permissions: ['doc:read'],
          resource: 'document',
          tenantScope: 'tenant-1',
        },
        {
          id: 'r3',
          effect: 'allow',
          roles: ['member'],
          permissions: ['orphan:perm'],
          resource: 'billing',
          companyId: 42,
        },
      ],
    });

    expect(report.valid).toBe(false);
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain('PRIVILEGE_ESCALATION');
    expect(codes).toContain('MISSING_TENANT_SCOPE');
    expect(codes).toContain('CONFLICTING_RULE');
    expect(codes).toContain('ORPHAN_PERMISSION');
  });
});
