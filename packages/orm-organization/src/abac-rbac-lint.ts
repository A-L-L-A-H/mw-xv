export type PolicyEffect = 'allow' | 'deny';

export interface AbacCondition {
  readonly attribute: string;
  readonly operator: 'eq' | 'neq' | 'in' | 'not_in' | 'exists';
  readonly value?: unknown;
}

export interface AccessPolicyRule {
  readonly id: string;
  readonly effect: PolicyEffect;
  readonly roles?: readonly string[];
  readonly permissions: readonly string[];
  readonly resource: string;
  readonly tenantScope?: string | null;
  readonly companyId?: number | string | null;
  readonly conditions?: readonly AbacCondition[];
}

export interface RoleDefinition {
  readonly name: string;
  readonly permissions: readonly string[];
  readonly inherits?: readonly string[];
  readonly isPrivileged?: boolean;
}

export type LintSeverity = 'error' | 'warning';

export type LintIssueCode =
  | 'PRIVILEGE_ESCALATION'
  | 'ORPHAN_PERMISSION'
  | 'CONFLICTING_RULE'
  | 'MISSING_TENANT_SCOPE';

export interface PolicyLintIssue {
  readonly code: LintIssueCode;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly ruleIds?: readonly string[];
  readonly role?: string;
  readonly permission?: string;
}

export interface PolicyLintInput {
  readonly roles: readonly RoleDefinition[];
  readonly rules: readonly AccessPolicyRule[];
  readonly knownPermissions?: readonly string[];
  readonly privilegedPermissions?: readonly string[];
}

export interface PolicyLintReport {
  readonly valid: boolean;
  readonly issues: readonly PolicyLintIssue[];
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
  };
}

const DEFAULT_PRIVILEGED_PERMISSIONS = new Set<string>([
  '*',
  'admin:*',
  'system:root',
  'iam:escalate',
  'iam:admin',
]);

function hasTenantScope(rule: AccessPolicyRule): boolean {
  if (typeof rule.tenantScope === 'string' && rule.tenantScope.trim().length > 0) {
    return true;
  }
  if (rule.companyId !== null && rule.companyId !== undefined && String(rule.companyId).trim().length > 0) {
    return true;
  }
  return (rule.conditions ?? []).some(
    (c) => c.attribute === 'tenantId' || c.attribute === 'companyId',
  );
}

function setsOverlap(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || a.length === 0 || !b || b.length === 0) {
    return true;
  }
  const setB = new Set(b);
  return a.some((item) => setB.has(item));
}

function resourcesOverlap(a: string, b: string): boolean {
  return a === b || a === '*' || b === '*';
}

export function lintAbacRbacPolicies(input: PolicyLintInput): PolicyLintReport {
  const issues: PolicyLintIssue[] = [];
  const privilegedSet = new Set(input.privilegedPermissions ?? DEFAULT_PRIVILEGED_PERMISSIONS);
  const roleMap = new Map(input.roles.map((r) => [r.name, r]));

  // 1. Check privilege escalation in roles
  for (const role of input.roles) {
    if (!role.isPrivileged) {
      for (const perm of role.permissions) {
        if (privilegedSet.has(perm) || perm === '*') {
          issues.push({
            code: 'PRIVILEGE_ESCALATION',
            severity: 'error',
            role: role.name,
            permission: perm,
            message: `Non-privileged role "${role.name}" grants privileged permission "${perm}".`,
          });
        }
      }
      for (const parentName of role.inherits ?? []) {
        const parent = roleMap.get(parentName);
        if (parent?.isPrivileged) {
          issues.push({
            code: 'PRIVILEGE_ESCALATION',
            severity: 'error',
            role: role.name,
            message: `Non-privileged role "${role.name}" inherits from privileged role "${parentName}".`,
          });
        }
      }
    }
  }

  // 2. Check missing tenant/company scope on rules
  for (const rule of input.rules) {
    if (!hasTenantScope(rule)) {
      issues.push({
        code: 'MISSING_TENANT_SCOPE',
        severity: 'error',
        ruleIds: [rule.id],
        message: `Policy rule "${rule.id}" is missing tenant/company scope.`,
      });
    }
  }

  // 3. Check conflicting allow/deny rules
  for (let i = 0; i < input.rules.length; i++) {
    for (let j = i + 1; j < input.rules.length; j++) {
      const a = input.rules[i]!;
      const b = input.rules[j]!;
      if (a.effect === b.effect) {
        continue;
      }
      if (!resourcesOverlap(a.resource, b.resource)) {
        continue;
      }
      if (!setsOverlap(a.permissions, b.permissions)) {
        continue;
      }
      if (!setsOverlap(a.roles, b.roles)) {
        continue;
      }
      issues.push({
        code: 'CONFLICTING_RULE',
        severity: 'error',
        ruleIds: [a.id, b.id],
        message: `Conflicting ${a.effect}/${b.effect} rules "${a.id}" and "${b.id}" on resource "${a.resource}".`,
      });
    }
  }

  // 4. Check orphan permissions
  const rolePermissions = new Set<string>();
  for (const role of input.roles) {
    for (const perm of role.permissions) {
      rolePermissions.add(perm);
    }
  }

  const knownSet = input.knownPermissions ? new Set(input.knownPermissions) : null;
  for (const rule of input.rules) {
    for (const perm of rule.permissions) {
      if (perm === '*') {
        continue;
      }
      if (!rolePermissions.has(perm)) {
        issues.push({
          code: 'ORPHAN_PERMISSION',
          severity: 'warning',
          ruleIds: [rule.id],
          permission: perm,
          message: `Permission "${perm}" in rule "${rule.id}" is not granted by any role.`,
        });
      } else if (knownSet && !knownSet.has(perm)) {
        issues.push({
          code: 'ORPHAN_PERMISSION',
          severity: 'warning',
          ruleIds: [rule.id],
          permission: perm,
          message: `Permission "${perm}" in rule "${rule.id}" is not in knownPermissions.`,
        });
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return {
    valid: errors === 0,
    issues,
    summary: { errors, warnings },
  };
}
