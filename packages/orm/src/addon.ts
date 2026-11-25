import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { Registry } from './registry.js';
import type { BaseModel } from './base.model.js';
import {
  applyModelExtension,
  columnName,
  resolveFieldTarget,
  type DefinedModel,
  type Field,
  type FieldMap,
  type ModelExtension,
} from './model-definition.js';
import {
  planSchemaSync,
  syncModelSchema,
  type ApplySchemaSyncOptions,
  type SchemaDiffPlan,
} from './schema-sync.js';
import {
  registerView,
  registerViewExtension,
  resolveViews,
  restoreViews,
  snapshotViews,
  unregisterModelViews,
  validateViews,
  type ViewDefinition,
  type ViewExtension,
} from './view.js';
import { ConcurrencyConflictError, ValidationError, type Domain } from './types.js';

type AddonModel = typeof BaseModel & { readonly fields: FieldMap };
export interface SeedReference {
  readonly $ref: string;
}
export const ref = (id: string): SeedReference => ({ $ref: id });
type SeedValue = string | number | boolean | null | SeedReference;
type Value<F> = F extends { kind: 'belongsTo' }
  ? SeedReference
  : F extends Field<infer V>
    ? V
    : never;
type SeedValues<F extends FieldMap> = {
  [
    K in keyof F as F[K] extends { required: true }
      ? F[K] extends { default: unknown }
        ? never
        : K
      : never
  ]: Value<F[K]>;
} & {
  [
    K in keyof F as F[K] extends { required: true }
      ? F[K] extends { default: unknown }
        ? K
        : never
      : K
  ]?: Value<F[K]> | null;
};

export interface SeedRecord {
  readonly id: string;
  readonly model: AddonModel;
  readonly values: Readonly<Record<string, SeedValue>>;
}

export function seed<const F extends FieldMap>(
  model: DefinedModel<F>,
  id: string,
  values: SeedValues<NoInfer<F>>
): SeedRecord {
  return { id, model, values };
}

export interface AddonHttpAuthContext {
  readonly userId: number;
  readonly companyId?: number | null;
  readonly role?: string;
  readonly groupPermissions?: unknown;
}

export interface AddonHttpRequestEnv {
  get(modelName: string): {
    readonly fields?: Readonly<Record<string, unknown>>;
    query(): unknown;
  };
}

export interface AddonHttpRequestBase {
  readonly auth?: AddonHttpAuthContext;
  readonly env?: AddonHttpRequestEnv;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly params?: unknown;
  readonly query?: unknown;
  readonly body?: unknown;
}

export interface AddonHttpRequest<
  TGeneric extends {
    Params?: Record<string, string>;
    Querystring?: Record<string, string | undefined>;
    Body?: unknown;
  } = {
    Params: Record<string, string>;
    Querystring: Record<string, string | undefined>;
    Body: unknown;
  },
> extends AddonHttpRequestBase {
  readonly params: TGeneric['Params'] extends undefined
    ? Record<string, string>
    : NonNullable<TGeneric['Params']>;
  readonly query: TGeneric['Querystring'] extends undefined
    ? Record<string, string | undefined>
    : NonNullable<TGeneric['Querystring']>;
  readonly body: TGeneric['Body'];
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly auth?: AddonHttpAuthContext;
  readonly env?: AddonHttpRequestEnv;
}

export interface AddonHttpReply {
  code(statusCode: number): AddonHttpReply;
  header(name: string, value: string): AddonHttpReply;
  send(payload?: unknown): unknown;
}

export type AddonHttpRouteHandler<
  TGeneric extends {
    Params?: Record<string, string>;
    Querystring?: Record<string, string | undefined>;
    Body?: unknown;
  } = {
    Params: Record<string, string>;
    Querystring: Record<string, string | undefined>;
    Body: unknown;
  },
> = (req: AddonHttpRequest<TGeneric>, reply: AddonHttpReply) => unknown | Promise<unknown>;

export interface AddonHttpApp {
  readonly db?: Knex;
  get<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  get<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    options: Readonly<Record<string, unknown>>,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  post<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  post<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    options: Readonly<Record<string, unknown>>,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  put<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  put<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    options: Readonly<Record<string, unknown>>,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  patch<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  patch<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    options: Readonly<Record<string, unknown>>,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  delete<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
  delete<
    TGeneric extends {
      Params?: Record<string, string>;
      Querystring?: Record<string, string | undefined>;
      Body?: unknown;
    } = {
      Params: Record<string, string>;
      Querystring: Record<string, string | undefined>;
      Body: unknown;
    },
  >(
    path: string,
    options: Readonly<Record<string, unknown>>,
    handler: AddonHttpRouteHandler<TGeneric>
  ): unknown;
}

export type AddonHttpAccessOperation = 'read' | 'create' | 'write' | 'unlink' | 'action';

export interface AddonHttpHostContext {
  readonly canAccess?: (
    role: string | undefined,
    modelName: string,
    op: AddonHttpAccessOperation,
    groupGrants?: unknown
  ) => boolean;
  getRecordRuleDomain?(req: AddonHttpRequestBase, modelName: string): Domain | Promise<Domain>;
  readonly hasCompanyAccess?: (
    userId: number,
    companyId: number,
    role: string
  ) => boolean | Promise<boolean>;
  readonly recordAudit?: (
    userId: number,
    model: string,
    recordId: number,
    operation: string,
    changes: Record<string, unknown>
  ) => void | Promise<void>;
  readonly validateModelMutation?: (
    modelName: string,
    payload: Record<string, unknown>,
    trx?: unknown
  ) => boolean | Promise<boolean>;
  readonly [key: string]: unknown;
}

export type AddonHttpPlugin<TApp = AddonHttpApp, TOptions = AddonHttpHostContext> = (
  app: TApp,
  options: TOptions
) => unknown | Promise<unknown>;

export interface AuthenticatedContext {
  readonly userId: number;
  readonly role: string;
  readonly companyId: number;
}

export interface GroupGrant {
  readonly model_name: string;
  readonly read: boolean;
  readonly create: boolean;
  readonly write: boolean;
  readonly unlink: boolean;
}

export interface RequestAuth {
  readonly userId: number;
  readonly role: string;
  readonly companyId?: number;
  readonly groupPermissions?: readonly GroupGrant[];
}

export type ModelAccessOperation = 'read' | 'create' | 'write' | 'unlink';

export interface RequireAuthorizedModelAccessOptions {
  readonly adminOnly?: boolean;
  readonly onDenied?: () => void;
}

export function requireAuth(
  req: AddonHttpRequestBase,
  reply: AddonHttpReply
): AuthenticatedContext | null {
  if (!req.auth) {
    reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  const companyId = req.auth.companyId;
  if (typeof companyId !== 'number' || !Number.isInteger(companyId) || companyId <= 0) {
    reply.code(403).send({ success: false, error: 'Active company is required' });
    return null;
  }
  return {
    userId: req.auth.userId,
    role: req.auth.role ?? 'user',
    companyId,
  };
}

/** Extract authenticated request metadata when a numeric userId is present. */
export function requestAuth(req: AddonHttpRequestBase | object): RequestAuth | null {
  const auth = (req as { auth?: RequestAuth | null } | null | undefined)?.auth;
  return auth && typeof auth.userId === 'number' ? auth : null;
}

/** Parse a route parameter into a positive safe integer id, or null when invalid. */
export function parsePositiveId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Check whether the authenticated caller has the requested model CRUD permission. */
export function hasModelAccess(
  auth: RequestAuth,
  modelName: string,
  op: ModelAccessOperation
): boolean {
  if (auth.role === 'system' || auth.role === 'superadmin') return true;
  if (auth.role !== 'user') return false;
  return (auth.groupPermissions ?? []).some((g) => g.model_name === modelName && g[op] === true);
}

/** Enforce authentication, active positive company context, model ACL, and optional admin role. */
export function requireAuthorizedModelAccess(
  req: AddonHttpRequestBase | object,
  reply: AddonHttpReply,
  modelNames: string | readonly string[],
  op: ModelAccessOperation,
  options?: RequireAuthorizedModelAccessOptions
): { auth: RequestAuth; companyId: number } | null {
  const deny = (statusCode: number, error: string): null => {
    options?.onDenied?.();
    void reply.code(statusCode).send({ success: false, error });
    return null;
  };

  const auth = requestAuth(req);
  if (!auth) {
    return deny(401, 'Authentication required');
  }
  if (!auth.companyId || !Number.isSafeInteger(auth.companyId) || auth.companyId <= 0) {
    return deny(403, 'Active company context required');
  }
  const models = typeof modelNames === 'string' ? [modelNames] : modelNames;
  const allowed = models.some((modelName) => hasModelAccess(auth, modelName, op));
  if (!allowed) {
    return deny(403, `Access denied for ${models.join('|')}:${op}`);
  }
  if (options?.adminOnly && auth.role !== 'system' && auth.role !== 'superadmin') {
    return deny(403, 'Admin role required');
  }
  return { auth, companyId: auth.companyId };
}

/** Require an initialized Knex database handle on an addon HTTP request context. */
export function requireAddonDb(req: AddonHttpRequestBase): Knex {
  const app = req as unknown as { server?: { db?: Knex } };
  const db = app.server?.db;
  if (!db) throw new Error('Database not available on request context');
  return db;
}

export type AddonLifecycleStatus = 'uninstalled' | 'installed' | 'disabled' | 'upgrade_failed';

export interface Addon {
  readonly name: string;
  readonly version: string;
  readonly displayName?: string;
  readonly category?: string;
  readonly summary?: string;
  readonly license?: string;
  readonly autoInstall?: boolean;
  readonly uninstallable?: boolean;
  readonly compatibility?: Readonly<Record<string, string>>;
  readonly depends?: readonly string[];
  readonly models: readonly AddonModel[];
  /** Declarative `extendModel(...)` patches applied in topological addon order before schema sync. */
  readonly extensions?: readonly ModelExtension[];
  readonly data?: readonly SeedRecord[];
  readonly views?: readonly ViewDefinition[];
  /** Declarative `extendView(...)` patches applied in priority order. */
  readonly viewExtensions?: readonly ViewExtension[];
  readonly menus?: readonly AddonMenu[];
  readonly actions?: readonly Record<string, unknown>[];
  readonly security?: Readonly<Record<string, unknown>>;
  /** Optional declarative HTTP plugin entrypoints mounted by the API host adapter. */
  readonly httpPlugins?: readonly AddonHttpPlugin[];
  /** Idempotent database setup run transactionally after addon tables are synchronized. */
  readonly setup?: (transaction: Knex.Transaction) => Promise<void>;
  /** Programmatic, transactional data/schema backfills keyed by the exact prior addon version. */
  readonly upgrade?: Readonly<Record<string, (transaction: Knex.Transaction) => Promise<void>>>;
}

export interface AddonMenu {
  readonly model: string;
  readonly label?: string;
  readonly group: string;
  readonly sequence?: number;
  readonly developmentOnly?: boolean;
}

export interface ModelMenuInfo {
  label?: string;
  group: string;
  sequence: number;
  developmentOnly: boolean;
}

const CORE_ADDONS = new Set(['base', 'auth', 'jobs']);
const modelMenus = new Map<string, ModelMenuInfo>();
const registeredAddons = new Map<string, Addon>();
const appliedExtensions = new WeakSet<ModelExtension>();

export function getModelMenuInfo(model: string): ModelMenuInfo {
  return (
    modelMenus.get(model) ?? {
      group: model.split('.')[0] ?? 'other',
      sequence: 1000,
      developmentOnly: true,
    }
  );
}

export interface AddonDefaultDataPolicyOptions {
  /** Addon names exempt from default seed requirements (e.g. session-token or provider-only addons). */
  readonly exemptAddons?: ReadonlySet<string>;
}

/** Addons that intentionally hold zero demo data for security/provider-only boundaries. */
export const DEFAULT_DATA_EXEMPT_ADDONS: ReadonlySet<string> = new Set(['auth', 'orm-storage']);

/**
 * Enforces that every model-owning addon declares non-empty default seed data (`manifest.data`)
 * with at least one record targeting one of its own declared models (`manifest.models`).
 */
export function assertAddonDefaultDataPolicy(
  addons: readonly Addon[],
  options: AddonDefaultDataPolicyOptions = {}
): void {
  const exemptAddons = options.exemptAddons ?? DEFAULT_DATA_EXEMPT_ADDONS;
  const violations: string[] = [];

  for (const addon of addons) {
    if (exemptAddons.has(addon.name) || addon.models.length === 0) continue;

    const ownModels = new Set(addon.models.map((model) => model.modelName));
    const seeds = addon.data ?? [];
    if (seeds.length === 0) {
      violations.push(
        `Addon '${addon.name}' declares ${addon.models.length} model(s) [${[...ownModels].join(', ')}] but manifest.data is empty`
      );
      continue;
    }

    const ownSeedsCount = seeds.filter((record) => ownModels.has(record.model.modelName)).length;
    if (ownSeedsCount === 0) {
      violations.push(
        `Addon '${addon.name}' declares ${seeds.length} seed record(s) (e.g. access/config) but 0 records targeting its own models [${[...ownModels].join(', ')}]`
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `ORM default data policy violation (${violations.length}):\n- ${violations.join('\n- ')}`
    );
  }
}

export function defineAddon(addon: Addon): Readonly<Addon> {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(addon.version)) {
    throw new Error(`Addon '${addon.name}' must use a semantic version (major.minor.patch)`);
  }
  const models = new Set(addon.models.map((model) => model.modelName));
  const menuModels = new Set<string>();
  for (const menu of addon.menus ?? []) {
    if (!models.has(menu.model))
      throw new Error(`Menu model '${menu.model}' is not in addon '${addon.name}'`);
    if (menuModels.has(menu.model))
      throw new Error(`Duplicate menu model '${menu.model}' in addon '${addon.name}'`);
    if (!menu.group.trim()) throw new Error(`Menu group is required for '${menu.model}'`);
    menuModels.add(menu.model);
  }
  return Object.freeze(addon);
}

interface InstalledAddon {
  name: string;
  version: string;
  status?: AddonLifecycleStatus;
  schema_digest?: string;
  installed_at?: string;
  upgraded_at?: string;
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '*' || trimmed === '') return true;
  if (trimmed.startsWith('>=')) {
    return compareVersions(version, trimmed.slice(2).trim()) >= 0;
  }
  if (trimmed.startsWith('^')) {
    const base = trimmed.slice(1).trim();
    const [bMaj] = base.split('.').map(Number);
    const [vMaj] = version.split('.').map(Number);
    return vMaj === bMaj && compareVersions(version, base) >= 0;
  }
  return compareVersions(version, trimmed) === 0;
}

function sort<T>(
  items: readonly T[],
  key: (item: T) => string,
  dependencies: (item: T) => readonly string[]
): T[] {
  const lookup = new Map(items.map((item) => [key(item), item]));
  if (lookup.size !== items.length) throw new Error('Duplicate addon or model name');
  const visiting = new Set<string>();
  const done = new Set<string>();
  const sorted: T[] = [];
  function visit(name: string) {
    if (done.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular dependency: ${name}`);
    const item = lookup.get(name);
    if (!item) throw new Error(`Missing dependency: ${name}`);
    visiting.add(name);
    for (const dependency of dependencies(item)) visit(dependency);
    visiting.delete(name);
    done.add(name);
    sorted.push(item);
  }
  for (const item of items) visit(key(item));
  return sorted;
}

/**
 * Deterministic topological resolution of workspace addons with compatibility validation.
 */
export function discoverWorkspaceAddons(addons: readonly Addon[]): Addon[] {
  // Sort deterministically by name before topological sort so input order never affects output
  const canonical = [...addons].sort((a, b) => a.name.localeCompare(b.name));
  const ordered = sort(
    canonical,
    (addon) => addon.name,
    (addon) => addon.depends ?? []
  );
  const byName = new Map(ordered.map((a) => [a.name, a]));
  for (const addon of ordered) {
    if (addon.compatibility) {
      for (const [depName, range] of Object.entries(addon.compatibility)) {
        const dep = byName.get(depName);
        if (!dep) {
          throw new Error(
            `Addon '${addon.name}' requires compatible addon '${depName}' (${range})`
          );
        }
        if (!satisfiesRange(dep.version, range)) {
          throw new Error(
            `Addon '${addon.name}' incompatible with '${depName}@${dep.version}' (expected ${range})`
          );
        }
      }
    }
  }
  return ordered;
}

export function computeAddonSchemaDigest(addon: Addon): string {
  const payload = addon.models
    .map((m) => ({
      model: m.modelName,
      table: m.tableName,
      unique: m.uniqueConstraints,
      fields: Object.entries(m.fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, f]) => ({
          k,
          kind: f.kind,
          required: Boolean(f.required),
          unique: Boolean(f.unique),
          index: Boolean(f.index),
          values: f.values,
          onDelete: f.onDelete,
          store: Boolean(f.store),
        })),
    }))
    .sort((a, b) => a.model.localeCompare(b.model));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

function resolveAddonsAndModels(addons: readonly Addon[]): {
  ordered: Addon[];
  models: AddonModel[];
  nextMenus: Map<string, ModelMenuInfo>;
  data: SeedRecord[];
} {
  const ordered = discoverWorkspaceAddons(addons);
  const nextMenus = new Map<string, ModelMenuInfo>();
  for (const addon of ordered) {
    for (const menu of addon.menus ?? []) {
      if (nextMenus.has(menu.model)) throw new Error(`Duplicate addon menu model: ${menu.model}`);
      nextMenus.set(menu.model, {
        ...(menu.label ? { label: menu.label } : {}),
        group: menu.group,
        sequence: menu.sequence ?? 1000,
        developmentOnly: menu.developmentOnly ?? false,
      });
    }
  }

  const allModels = ordered.flatMap((addon) => [...addon.models]);
  const modelByName = new Map(allModels.map((m) => [m.modelName, m]));

  // Apply declarative model extensions in topological addon order (idempotent per extension object)
  for (const addon of ordered) {
    for (const ext of addon.extensions ?? []) {
      const target = modelByName.get(ext.target);
      if (!target) {
        throw new Error(
          `Extension target model not found: ${ext.target} (in addon '${addon.name}')`
        );
      }
      if (!appliedExtensions.has(ext)) {
        applyModelExtension(target, ext);
        appliedExtensions.add(ext);
      }
    }
  }

  const models = sort(
    allModels,
    (model) => model.modelName,
    (model) =>
      Object.values(model.fields).flatMap((field) => {
        if (field.kind !== 'belongsTo') return [];
        const targetModel = resolveFieldTarget(field.target);
        return targetModel && targetModel.modelName !== model.modelName
          ? [targetModel.modelName]
          : [];
      })
  );

  if (new Set(models.map((model) => model.tableName)).size !== models.length) {
    throw new Error('Duplicate addon table');
  }

  const data = ordered.flatMap((addon) => [...(addon.data ?? [])]);
  const seedIds = new Set<string>();
  for (const record of data) {
    if (!models.includes(record.model)) {
      throw new Error(`Seed model not installed: ${record.model.modelName}`);
    }
    if (seedIds.has(record.id)) {
      throw new Error(`Duplicate external data ID: ${record.id}`);
    }
    seedIds.add(record.id);
  }

  return { ordered, models, nextMenus, data };
}

interface ExternalRecord {
  id: string;
  model: string;
  record_id: number;
}
interface Identity {
  id: number;
}

async function installData(db: Knex.Transaction, data: readonly SeedRecord[]) {
  if (!(await db.schema.hasTable('_orm_data'))) {
    await db.schema.createTable('_orm_data', (table) => {
      table.string('id').primary();
      table.string('model').notNullable();
      table.integer('record_id').notNullable();
      table.unique(['model', 'record_id']);
    });
  }
  const pending = new Map(data.map((record) => [record.id, record]));
  if (pending.size !== data.length) throw new Error('Duplicate external data ID');
  const resolving = new Set<string>();
  async function resolveValues(
    record: SeedRecord
  ): Promise<Record<string, string | number | boolean | null>> {
    const values: Record<string, string | number | boolean | null> = {};
    for (const [name, value] of Object.entries(record.values)) {
      const field = record.model.fields[name];
      if (!field) throw new Error(`Unknown seed field: ${record.model.modelName}.${name}`);
      if (typeof value === 'object' && value !== null && '$ref' in value) {
        const linked = await ensure(value.$ref);
        const targetModel = resolveFieldTarget(field.target);
        if (targetModel?.modelName !== linked.model)
          throw new Error(`Invalid relation for ${record.id}.${name}`);
        values[columnName(name, field)] = linked.record_id;
      } else if (field.kind === 'json') {
        values[columnName(name, field)] =
          typeof value === 'object' || Array.isArray(value)
            ? JSON.stringify(value ?? null)
            : (value as string | number | boolean | null);
      } else values[columnName(name, field)] = value as string | number | boolean | null;
    }
    return values;
  }
  async function ensure(id: string): Promise<ExternalRecord> {
    const known = await db<ExternalRecord>('_orm_data').where({ id }).first();
    const record = pending.get(id);
    if (known) {
      if (record && known.model !== record.model.modelName)
        throw new Error(`Data ID ${id} changed model`);
      if (
        record &&
        !(await db<Identity>(record.model.tableName).where({ id: known.record_id }).first())
      ) {
        throw new Error(`Seed record ${id} was deleted; restore it explicitly`);
      }
      if (record) {
        const defaults = await resolveValues(record);
        for (const [field, value] of Object.entries(defaults)) {
          const current = await db<Identity & Record<string, unknown>>(record.model.tableName)
            .where({ id: known.record_id })
            .select(field)
            .first();
          if (current?.[field] === null || current?.[field] === undefined) {
            await db(record.model.tableName)
              .where({ id: known.record_id })
              .whereNull(field)
              .update({ [field]: value, write_date: new Date() });
          }
        }
      }
      return known;
    }
    if (!record) throw new Error(`Unknown data reference: ${id}`);
    if (resolving.has(id)) throw new Error(`Circular data reference: ${id}`);
    resolving.add(id);
    const values = await resolveValues(record);
    let existing: Identity | undefined;
    const adopt = (match: Identity | undefined) => {
      if (existing && match && existing.id !== match.id)
        throw new Error(`Conflicting seed identity: ${id}`);
      existing = match ?? existing;
    };
    for (const [name, field] of Object.entries(record.model.fields)) {
      const value = values[columnName(name, field)];
      if (!field.unique || value === undefined || value === null || field.kind === 'belongsTo')
        continue;
      const match = await db<Identity>(record.model.tableName)
        .where(columnName(name, field), value)
        .first('id');
      adopt(match);
    }
    for (const constraint of record.model.uniqueConstraints) {
      const columns = constraint.map((name) => columnName(name, record.model.fields[name]!));
      const identity = Object.fromEntries(columns.map((column) => [column, values[column]]));
      if (Object.values(identity).some((value) => value === undefined || value === null)) continue;
      const match = await db<Identity>(record.model.tableName).where(identity).first('id');
      adopt(match);
    }
    const created = existing ?? (await record.model.query(db).insertAndFetch(values));
    const identity = { id, model: record.model.modelName, record_id: created.id };
    const mappedRecord = await db<ExternalRecord>('_orm_data')
      .where({ model: identity.model, record_id: identity.record_id })
      .first('id');
    if (!mappedRecord) await db<ExternalRecord>('_orm_data').insert(identity);
    resolving.delete(id);
    return identity;
  }
  for (const record of data) await ensure(record.id);
}

/** Compute a dry-run SchemaDiffPlan for a set of addons without mutating the database. */
export async function planAddonsSchemaSync(
  db: Knex,
  addons: readonly Addon[]
): Promise<SchemaDiffPlan> {
  const { models } = resolveAddonsAndModels(addons);
  return planSchemaSync(db, models);
}

/** Register addon metadata in-memory (models, extensions, views, menus) without DDL/seed. */
export async function registerAddons(db: Knex, addons: readonly Addon[]): Promise<void> {
  const { ordered, models, nextMenus } = resolveAddonsAndModels(addons);

  for (const model of models) {
    model.knex(db);
    Registry.register(model);
  }
  for (const addon of ordered) {
    registeredAddons.set(addon.name, addon);
    for (const view of addon.views ?? []) {
      if (!models.some((model) => model.modelName === view.model)) {
        throw new Error(`View model not installed: ${view.model}`);
      }
      registerView({ ...view, addonName: addon.name });
    }
    for (const viewExt of addon.viewExtensions ?? []) {
      if (!models.some((model) => model.modelName === viewExt.model)) {
        throw new Error(`View extension model not installed: ${viewExt.model}`);
      }
      registerViewExtension({ ...viewExt, addonName: viewExt.addonName ?? addon.name });
    }
  }
  // Cross-addon view validation
  for (const model of models) {
    validateViews(model, resolveViews(model));
  }
  modelMenus.clear();
  for (const [name, menu] of nextMenus) modelMenus.set(name, menu);
}

/** Install an ordered set of addons atomically; restart preserves user-edited seed values. */
export async function installAddons(
  db: Knex,
  addons: readonly Addon[],
  options: ApplySchemaSyncOptions = {}
): Promise<void> {
  const registrySnapshot = Registry.snapshot();
  const viewsSnapshot = snapshotViews();
  const menusSnapshot = new Map(modelMenus);

  try {
    const { ordered, models, nextMenus, data } = resolveAddonsAndModels(addons);

    await db.transaction(async (trx) => {
      if (db.client.config.client === 'pg') {
        await trx.raw('select pg_advisory_xact_lock(?, hashtext(?))', [
          1297564238,
          'moonwitness.addon.install',
        ]);
      }

      for (const model of models) {
        await syncModelSchema(trx, model, options);
      }

      if (!(await trx.schema.hasTable('_orm_addons'))) {
        await trx.schema.createTable('_orm_addons', (table) => {
          table.string('name').primary();
          table.string('version').notNullable();
          table.string('status').notNullable().defaultTo('installed');
          table.string('schema_digest').nullable();
          table.timestamp('installed_at').notNullable().defaultTo(trx.fn.now());
          table.timestamp('upgraded_at').notNullable().defaultTo(trx.fn.now());
        });
      } else {
        if (!(await trx.schema.hasColumn('_orm_addons', 'status'))) {
          await trx.schema.alterTable('_orm_addons', (table) => {
            table.string('status').notNullable().defaultTo('installed');
          });
        }
        if (!(await trx.schema.hasColumn('_orm_addons', 'schema_digest'))) {
          await trx.schema.alterTable('_orm_addons', (table) => {
            table.string('schema_digest').nullable();
          });
        }
      }

      for (const addon of ordered) {
        const installed = await trx<InstalledAddon>('_orm_addons')
          .where({ name: addon.name })
          .first();
        if (installed && compareVersions(addon.version, installed.version) < 0) {
          throw new Error(
            `Addon downgrade rejected for '${addon.name}': ${installed.version} -> ${addon.version}`
          );
        }
        if (installed && compareVersions(addon.version, installed.version) > 0 && addon.upgrade) {
          const applicableVersions = Object.keys(addon.upgrade)
            .filter(
              (fromVersion) =>
                compareVersions(fromVersion, installed.version) >= 0 &&
                compareVersions(fromVersion, addon.version) < 0
            )
            .sort(compareVersions);
          for (const fromVersion of applicableVersions) {
            await addon.upgrade[fromVersion]?.(trx);
          }
        }
      }

      for (const addon of ordered) await addon.setup?.(trx);
      await installData(trx, data);

      for (const addon of ordered) {
        const digest = computeAddonSchemaDigest(addon);
        await trx<InstalledAddon>('_orm_addons')
          .insert({
            name: addon.name,
            version: addon.version,
            status: 'installed',
            schema_digest: digest,
          })
          .onConflict('name')
          .merge({
            version: addon.version,
            status: 'installed',
            schema_digest: digest,
            upgraded_at: trx.fn.now(),
          });
      }
    });

    for (const model of models) {
      model.knex(db);
      Registry.register(model);
    }
    for (const addon of ordered) {
      registeredAddons.set(addon.name, addon);
      for (const view of addon.views ?? []) {
        if (!models.some((model) => model.modelName === view.model)) {
          throw new Error(`View model not installed: ${view.model}`);
        }
        registerView({ ...view, addonName: addon.name });
      }
      for (const viewExt of addon.viewExtensions ?? []) {
        if (!models.some((model) => model.modelName === viewExt.model)) {
          throw new Error(`View extension model not installed: ${viewExt.model}`);
        }
        registerViewExtension({ ...viewExt, addonName: viewExt.addonName ?? addon.name });
      }
    }
    for (const model of models) {
      validateViews(model, resolveViews(model));
    }
    modelMenus.clear();
    for (const [name, menu] of nextMenus) modelMenus.set(name, menu);
  } catch (err) {
    // Atomic in-memory rollback on any install/upgrade failure
    Registry.restore(registrySnapshot);
    restoreViews(viewsSnapshot);
    modelMenus.clear();
    for (const [name, menu] of menusSnapshot) modelMenus.set(name, menu);
    throw err;
  }
}

/** Enable a previously disabled addon. */
export async function enableAddon(db: Knex, name: string): Promise<void> {
  const row = await db<InstalledAddon>('_orm_addons').where({ name }).first();
  if (!row) {
    throw new ValidationError(`Addon '${name}' is not installed`);
  }
  await db<InstalledAddon>('_orm_addons')
    .where({ name })
    .update({ status: 'installed', upgraded_at: db.fn.now() });
}

/** Disable an installed addon, blocking core addons and addons with active dependents. */
export async function disableAddon(db: Knex, name: string): Promise<void> {
  if (CORE_ADDONS.has(name)) {
    throw new ConcurrencyConflictError(`Core addon '${name}' cannot be disabled`);
  }
  const row = await db<InstalledAddon>('_orm_addons').where({ name }).first();
  if (!row) {
    throw new ValidationError(`Addon '${name}' is not installed`);
  }
  const activeInstalled = await db<InstalledAddon>('_orm_addons')
    .where({ status: 'installed' })
    .select('name');
  const activeNames = new Set(activeInstalled.map((r) => r.name));
  for (const [otherName, otherAddon] of registeredAddons) {
    if (otherName !== name && activeNames.has(otherName) && otherAddon.depends?.includes(name)) {
      throw new ConcurrencyConflictError(
        `Cannot disable addon '${name}': active addon '${otherName}' depends on it`
      );
    }
  }
  await db<InstalledAddon>('_orm_addons')
    .where({ name })
    .update({ status: 'disabled', upgraded_at: db.fn.now() });
}

/** Safely uninstall an addon, detaching runtime registrations and metadata. */
export async function uninstallAddon(
  db: Knex,
  name: string,
  options: { purgeData?: boolean } = {}
): Promise<void> {
  if (CORE_ADDONS.has(name)) {
    throw new ConcurrencyConflictError(`Core addon '${name}' cannot be uninstalled`);
  }
  const addon = registeredAddons.get(name);
  if (addon?.uninstallable === false) {
    throw new ConcurrencyConflictError(`Addon '${name}' is marked non-uninstallable`);
  }
  const activeInstalled = await db<InstalledAddon>('_orm_addons')
    .where({ status: 'installed' })
    .select('name');
  const activeNames = new Set(activeInstalled.map((r) => r.name));
  for (const [otherName, otherAddon] of registeredAddons) {
    if (otherName !== name && activeNames.has(otherName) && otherAddon.depends?.includes(name)) {
      throw new ConcurrencyConflictError(
        `Cannot uninstall addon '${name}': active addon '${otherName}' depends on it`
      );
    }
  }

  const modelNames = addon ? addon.models.map((m) => m.modelName) : [];

  await db.transaction(async (trx) => {
    if (modelNames.length > 0 && (await trx.schema.hasTable('_orm_data'))) {
      await trx('_orm_data').whereIn('model', modelNames).delete();
    }
    if (options.purgeData && addon) {
      for (const model of [...addon.models].reverse()) {
        if (await trx.schema.hasTable(model.tableName)) {
          await trx.schema.dropTable(model.tableName);
        }
      }
    }
    if (await trx.schema.hasTable('_orm_addons')) {
      await trx('_orm_addons').where({ name }).delete();
    }
  });

  if (addon) {
    for (const model of addon.models) {
      Registry.unregister(model.modelName);
      unregisterModelViews(model.modelName);
      modelMenus.delete(model.modelName);
    }
    registeredAddons.delete(name);
  }
}
