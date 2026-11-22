import type { Role } from '@moonwitness/auth';

export interface AuthContext {
  userId: number;
  role: Role;
  partnerId?: number;
  companyId?: number;
  groupPermissions: readonly GroupModelGrant[];
  groupNames?: readonly string[];
}

/** Operations a role may perform on a model through the generic REST / JSON-RPC API. */
export type Operation = 'read' | 'create' | 'write' | 'unlink' | 'action';

export type ModelAccessPolicyKind =
  'internal' | 'adminOnly' | 'publicRead' | 'readOnlyForUsers' | 'standard';

export interface FieldAclMeta {
  readonly groups?: readonly string[];
  readonly readGroups?: readonly string[];
  readonly writeGroups?: readonly string[];
}

export interface ActionAclDefinition {
  readonly id?: string;
  readonly name?: string;
  readonly allowedGroups?: readonly string[];
  readonly requiredPermission?: Operation;
}

/** Never reachable through the generic API, whatever the role (tokens, sessions, knowledge, ai, ...). */
export const INTERNAL_PREFIXES = [
  'auth.',
  'base.job',
  'base.cron',
  'base.outbox_event',
  'workflow.',
  'knowledge.',
  'ai.',
] as const;

/** Only administrative roles may touch these; ordinary users use dedicated endpoints. */
const ADMIN_ONLY_MODELS = new Set([
  'base.user',
  'base.audit_log',
  'base.access_group',
  'base.group_membership',
  'base.model_access',
  'base.company_membership',
  'base.partner_bank',
]);

const ADMIN_ROLES = new Set(['system', 'superadmin']);

const declarativeModelPolicies = new Map<string, ModelAccessPolicyKind>();

/** Register a declarative access policy for a model (compiled from addon/model metadata). */
export function registerModelAccessPolicy(modelName: string, policy: ModelAccessPolicyKind): void {
  declarativeModelPolicies.set(modelName, policy);
}

export function getModelAccessPolicy(modelName: string): ModelAccessPolicyKind | undefined {
  if (INTERNAL_PREFIXES.some((prefix) => modelName.startsWith(prefix))) return 'internal';
  return declarativeModelPolicies.get(modelName);
}

/**
 * Central authorization rule. Default deny: unknown roles and unknown operations get nothing.
 *
 * - `system`: full access except internal models.
 * - `superadmin`: administers user accounts, but cannot grant or alter the system role.
 * - `user`: read-only on non-administrative models, or granted via groupPermissions.
 */
export interface GroupModelGrant {
  model_name: string;
  read: boolean;
  create: boolean;
  write: boolean;
  unlink: boolean;
}

export function canAccess(
  role: string | undefined,
  modelName: string,
  op: Operation,
  groupGrants: readonly GroupModelGrant[] = []
): boolean {
  // Hard fail-closed guard for internal prefixes (knowledge.*, auth.*, ai.*, etc.)
  if (INTERNAL_PREFIXES.some((prefix) => modelName.startsWith(prefix))) return false;
  const declared = declarativeModelPolicies.get(modelName);
  if (declared === 'internal') return false;

  // WhatsApp mutations must pass the dedicated company-scoped queue/control routes.
  if (modelName.startsWith('whatsapp.') && op !== 'read') return false;
  if (modelName === 'base.audit_log') return ADMIN_ROLES.has(role ?? '') && op === 'read';
  if (role !== undefined && ADMIN_ROLES.has(role)) return true;
  if (role === 'user') {
    if (declared === 'adminOnly' || ADMIN_ONLY_MODELS.has(modelName)) return false;
    if (declared === 'readOnlyForUsers' && op !== 'read') return false;
    if (op === 'read') return true;
    const grantOperation = op === 'action' ? 'write' : op;
    return groupGrants.some((grant) => grant.model_name === modelName && grant[grantOperation]);
  }
  return false;
}

/** Field-level ACL check for read or write operations. */
export function canAccessField(
  auth: Pick<AuthContext, 'role' | 'groupNames'> | null | undefined,
  fieldMeta: FieldAclMeta | undefined,
  op: 'read' | 'write'
): boolean {
  if (!fieldMeta) return true;
  if (!auth) return false;
  if (ADMIN_ROLES.has(auth.role)) return true;

  const allowed =
    op === 'write'
      ? (fieldMeta.writeGroups ?? fieldMeta.groups)
      : (fieldMeta.readGroups ?? fieldMeta.groups);
  if (!allowed || allowed.length === 0) return true;

  const callerGroups = new Set(auth.groupNames ?? []);
  return allowed.some((group) => callerGroups.has(group));
}

/** Action-level ACL check separating sensitive action execution from generic write. */
export function canExecuteAction(
  auth: Pick<AuthContext, 'role' | 'groupPermissions' | 'groupNames'> | null | undefined,
  modelName: string,
  actionDef?: ActionAclDefinition
): boolean {
  if (!auth) return false;
  if (INTERNAL_PREFIXES.some((prefix) => modelName.startsWith(prefix))) return false;
  if (ADMIN_ROLES.has(auth.role)) return true;

  const requiredOp: Operation = actionDef?.requiredPermission ?? 'action';
  if (!canAccess(auth.role, modelName, requiredOp, auth.groupPermissions)) {
    return false;
  }

  if (actionDef?.allowedGroups && actionDef.allowedGroups.length > 0) {
    const callerGroups = new Set(auth.groupNames ?? []);
    return actionDef.allowedGroups.some((group) => callerGroups.has(group));
  }
  return true;
}

const SAFE_CLIENT_CONTEXT_KEYS = new Set([
  'lang',
  'tz',
  'display_name',
  'view_mode',
  'active_model',
  'active_id',
  'active_ids',
]);

/**
 * Sanitizes client-supplied `context` (MW-SEC-008):
 * - Only allows `default_*` and safe UI keys (`lang`, `tz`, etc.)
 * - Always overwrites security keys (`userId`, `role`, `companyId`, `partnerId`) from `req.auth`
 * - Strips `trx`, `activeTest`, `active_test` so clients cannot bypass active filtering or inject transactions.
 */
export function sanitizeClientContext(
  rawContext: unknown,
  auth: AuthContext | null | undefined
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)) {
    for (const [key, value] of Object.entries(rawContext as Record<string, unknown>)) {
      if (key.startsWith('default_') || SAFE_CLIENT_CONTEXT_KEYS.has(key)) {
        safe[key] = value;
      }
    }
  }
  if (auth) {
    safe.userId = auth.userId;
    safe.role = auth.role;
    if (auth.companyId !== undefined) safe.companyId = auth.companyId;
    if (auth.partnerId !== undefined) safe.partnerId = auth.partnerId;
  }
  return safe;
}

/** Only the system actor may create, promote, modify, or remove system accounts. */
export function canManageBaseUser(
  actorRole: string | undefined,
  operation: Operation,
  currentRole?: string,
  requestedRole?: string
): boolean {
  if (actorRole === 'system') return true;
  if (actorRole !== 'superadmin') return false;
  if (operation === 'read') return true;
  return currentRole !== 'system' && requestedRole !== 'system';
}

/** Maps an HTTP request on `/api/:model...` to the operation it performs. */
export function operationFor(method: string, routeUrl: string): Operation {
  if (routeUrl.endsWith('/action/:method') || routeUrl.endsWith('/action/:actionName'))
    return 'action';
  if (routeUrl.endsWith('/default-get') || routeUrl.endsWith('/onchange')) return 'read';
  switch (method) {
    case 'GET':
    case 'HEAD':
      return 'read';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'write';
    case 'DELETE':
      return 'unlink';
    default:
      return 'action';
  }
}

/** Maps a JSON-RPC `execute_kw` method to the operation it performs, if it is exposed. */
export function rpcOperation(method: string): Operation | null {
  switch (method) {
    case 'search':
    case 'search_read':
    case 'read':
    case 'search_count':
    case 'search_group_count':
    case 'fields_get':
    case 'views_get':
    case 'default_get':
    case 'onchange':
      return 'read';
    case 'create':
      return 'create';
    case 'write':
      return 'write';
    case 'unlink':
      return 'unlink';
    case 'call_action':
      return 'action';
    default:
      return null;
  }
}
