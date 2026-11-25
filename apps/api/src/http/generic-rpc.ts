import type { FastifyReply, FastifyRequest } from 'fastify';
import { databaseErrorCode } from '../database/errors.js';
import type { BaseModel } from '@moonwitness/orm';
import {
  Registry,
  applyDomain,
  describeFields,
  resolveViews,
  validateDomain,
  type Field,
  type FieldMap,
  type Domain,
} from '@moonwitness/orm';
import { assignDefaultCompanyMembership, assignDefaultUserGroup } from '@moonwitness/orm-base';
import { isValidAddonMutation } from '../routes/generic-addon-validation.js';
import {
  asJsonObject,
  isRecord as isObject,
  type JsonObject,
  type JsonValue,
} from '@moonwitness/types';
import type { Transaction } from 'objection';
import { canAccess, canManageBaseUser, sanitizeClientContext } from '../auth/policy.js';
import { getRecordRuleDomain } from '../auth/rules.js';
import { invalidateAuthCacheForModel } from '../plugins/auth.plugin.js';
import { auditSnapshot } from '../routes/generic-audit.js';
import { findReferencesBatch } from '../routes/generic-references.js';
import { RPC_MAX_PAGE_SIZE } from '../routes/generic-query-graph.js';

const SERVER_MANAGED_FIELDS = new Set([
  'id',
  'create_date',
  'write_date',
  'create_uid',
  'write_uid',
]);

export function hasServerManagedFields(value: JsonObject): boolean {
  return Object.keys(value).some((key) => SERVER_MANAGED_FIELDS.has(key));
}

export function errorMessage(error: unknown, fallback: string): string {
  if (databaseErrorCode(error)) return fallback;
  return error instanceof Error ? error.message : fallback;
}

export function parseInteger(value: string | undefined, fallback?: number): number | undefined {
  if (value === undefined || value === '') return fallback;
  if (!/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Resolves a model bound to the request's Environment so audit fields use the caller. */
export function resolveModel(req: FastifyRequest, name: string) {
  return Registry.has(name) ? req.env.get(name) : null;
}

export function parseModelDomain(raw: string | undefined, Model: typeof BaseModel): Domain | null {
  if (!raw) return [];
  try {
    return validateDomain(
      JSON.parse(raw) as unknown,
      new Set(Object.keys(Model.jsonSchema.properties ?? {}))
    );
  } catch {
    return null;
  }
}

export function requireId(value: string, reply: FastifyReply): number | null {
  const id = parseInteger(value);
  if (id === undefined || id < 1) {
    reply.status(400).send({ success: false, error: 'Invalid ID parameter' });
    return null;
  }
  return id;
}

export function modelNotFound(name: string) {
  return {
    success: false,
    error: `Model '${name}' not found`,
  };
}

export function recordNotFound(name: string, id: number) {
  return { success: false, error: `Record #${id} of model '${name}' not found` };
}

export function property(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

export function roleOf(value: unknown): string | undefined {
  const role = property(value, 'role');
  return typeof role === 'string' ? role : undefined;
}

export function resolveFieldTarget(field: Field): typeof BaseModel | undefined {
  const target = field.target;
  if (!target) return undefined;
  if (typeof target === 'function' && !('modelName' in target)) return target();
  return target as typeof BaseModel;
}

export function hasPolymorphicResourceFields(fields: FieldMap): boolean {
  return 'resource_model' in fields && 'resource_id' in fields;
}

export function readExpectedWriteDate(req: FastifyRequest): string | undefined {
  const rawHeader = req.headers['if-match'] ?? req.headers['x-expected-write-date'];
  const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed === '*') return undefined;
  return trimmed.replace(/^W\//u, '').replace(/^"(.*)"$/u, '$1');
}

export async function hasActivePartner(
  modelName: string,
  values: JsonObject,
  current?: BaseModel,
  trx?: Transaction
) {
  if (modelName !== 'base.user') return true;
  const active = values.active ?? current?.active ?? true;
  if (active !== true) return true;
  const rawId = values.partner_id ?? property(current, 'partner_id');
  if (typeof rawId !== 'number') return true;
  const Partner = Registry.get('base.partner');
  const partner = await Partner.query(trx).findById(rawId);
  return partner !== undefined && partner.active !== false;
}

export async function hasCompanyAccess(
  req: FastifyRequest,
  modelName: string,
  values: JsonObject,
  current?: BaseModel,
  trx?: Transaction
): Promise<boolean> {
  const companyId = req.auth?.companyId;
  const modelFields = Registry.get(modelName).fields ?? {};
  const targetCompany = Object.hasOwn(values, 'company_id')
    ? values.company_id
    : property(current, 'company_id');
  const canAssignCompanyMembership =
    modelName === 'base.company_membership' &&
    (req.auth?.role === 'system' || req.auth?.role === 'superadmin');
  if ('company' in modelFields || 'company_id' in modelFields) {
    const currentCompany = property(current, 'company_id');
    if (typeof currentCompany === 'number' && targetCompany === null) return false;
    if (
      targetCompany !== undefined &&
      targetCompany !== null &&
      targetCompany !== companyId &&
      !canAssignCompanyMembership
    )
      return false;
    if (targetCompany === undefined && companyId !== undefined && modelFields.company?.required)
      return false;
  }
  for (const [fieldName, field] of Object.entries(modelFields)) {
    if (field.kind !== 'belongsTo') continue;
    const relationId = Object.hasOwn(values, `${fieldName}_id`)
      ? values[`${fieldName}_id`]
      : Object.hasOwn(values, fieldName)
        ? values[fieldName]
        : property(current, `${fieldName}_id`);
    if (typeof relationId !== 'number' || !Number.isSafeInteger(relationId)) continue;
    const targetModel = resolveFieldTarget(field);
    if (!targetModel) continue;
    const target = await req.env.get(targetModel.modelName).query(trx).findById(relationId);
    if (!target) return false;
    const targetFields = targetModel.fields ?? {};
    if ('company' in targetFields || 'company_id' in targetFields) {
      const relatedCompany = property(target, 'company_id');
      if (relatedCompany !== undefined && relatedCompany !== null && relatedCompany !== companyId)
        return false;
    }
  }
  return isValidAddonMutation(modelName, values, current?.toJSON(), trx);
}

export function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ success: false, error: 'Forbidden' });
}

export function relationConflict(reply: FastifyReply, modelName: string, reference: string) {
  return reply.code(409).send({
    success: false,
    error: `Cannot archive or delete '${modelName}'; it is still referenced by '${reference}'`,
  });
}

export async function recordAudit(
  req: FastifyRequest,
  modelName: string,
  operation: string,
  recordId: number,
  before: unknown,
  after: unknown,
  trx?: Transaction
): Promise<void> {
  if (modelName === 'base.audit_log') return;
  const Model = resolveModel(req, modelName);
  if (!Model) return;
  const previous = auditSnapshot(Model, before);
  const current = auditSnapshot(Model, after);
  const changes: JsonObject = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
      changes[key] = { before: previous[key] ?? null, after: current[key] ?? null };
    }
  }
  const auditModel = req.env.get('base.audit_log');
  const activeTrx = trx ?? req.env.trx;
  await (activeTrx ? auditModel.query(activeTrx) : auditModel.query()).insert({
    model: modelName,
    record_id: recordId,
    operation,
    actor_id: req.auth?.userId ?? null,
    changes: JSON.stringify(changes),
  } as Partial<BaseModel>);
}

export async function recordOutbox(
  req: FastifyRequest,
  modelName: string,
  operation: string,
  recordId: number,
  snapshot: JsonObject,
  trx?: Transaction
): Promise<void> {
  const outbox = req.env.get('base.outbox_event');
  const activeTrx = trx ?? req.env.trx;
  await (activeTrx ? outbox.query(activeTrx) : outbox.query()).insert({
    event_type: `record.${operation}`,
    aggregate_model: modelName,
    aggregate_id: recordId,
    company_id: typeof snapshot.company_id === 'number' ? snapshot.company_id : req.auth?.companyId,
    actor_id: req.auth?.userId ?? null,
    payload: JSON.stringify({ model: modelName, id: recordId, operation, record: snapshot }),
    available_at: new Date().toISOString(),
  } as Partial<BaseModel>);
}

export async function inRequestTransaction<T>(
  req: FastifyRequest,
  callback: (trx: Transaction) => Promise<T>
): Promise<T> {
  const originalEnv = req.env;
  return req.server.db.transaction(async (trx) => {
    const transactionalEnv = originalEnv.withTransaction(trx);
    req.env = transactionalEnv;
    try {
      return await callback(trx);
    } finally {
      req.env = originalEnv;
    }
  });
}

export async function scopedRecord(
  req: FastifyRequest,
  model: typeof BaseModel,
  modelName: string,
  id: number,
  activeTest = true,
  transaction?: Transaction
): Promise<BaseModel | null> {
  const scope = await userReadScope(req, modelName);
  const query = applyDomain(model.query(transaction), [...scope, ['id', '=', id]]);
  const record = await query.forUpdate().first();
  if (!record || (activeTest && record.active === false)) return null;
  return record as BaseModel;
}

export async function hasValidResourceReference(
  req: FastifyRequest,
  modelName: string,
  values: JsonObject,
  current?: BaseModel,
  trx?: Transaction
): Promise<boolean> {
  const Model = Registry.get(modelName);
  if (!hasPolymorphicResourceFields(Model.fields ?? {})) return true;
  const resourceModel = Object.hasOwn(values, 'resource_model')
    ? values.resource_model
    : property(current, 'resource_model');
  const resourceId = Object.hasOwn(values, 'resource_id')
    ? values.resource_id
    : property(current, 'resource_id');
  if (resourceModel === undefined && resourceId === undefined) return true;
  if (
    typeof resourceModel !== 'string' ||
    !Registry.has(resourceModel) ||
    !canAccess(req.auth?.role, resourceModel, 'read', req.auth?.groupPermissions) ||
    typeof resourceId !== 'number' ||
    !Number.isSafeInteger(resourceId) ||
    resourceId < 1
  )
    return false;
  const Resource = Registry.get(resourceModel);
  return Boolean(await scopedRecord(req, Resource, resourceModel, resourceId, true, trx));
}

export const PROTECTED_ACCESS_MODELS = new Set([
  'base.user',
  'base.audit_log',
  'base.access_group',
  'base.group_membership',
  'base.model_access',
  'base.company_membership',
  'base.job',
  'base.job_run',
  'base.cron',
  'base.outbox_event',
]);

export function hasValidAccessRule(
  modelName: string,
  values: JsonObject,
  current?: BaseModel
): boolean {
  if (modelName !== 'base.model_access') return true;
  const target = Object.hasOwn(values, 'model_name')
    ? values.model_name
    : property(current, 'model_name');
  return (
    typeof target === 'string' &&
    Registry.has(target) &&
    !PROTECTED_ACCESS_MODELS.has(target) &&
    !target.startsWith('auth.')
  );
}

export async function userReadScope(req: FastifyRequest, modelName: string): Promise<Domain> {
  return getRecordRuleDomain(req, modelName);
}

export async function rpcUserMutationAllowed(
  actorRole: string | undefined,
  model: typeof BaseModel,
  operation: 'create' | 'write' | 'unlink',
  args: JsonValue[]
): Promise<boolean> {
  if (actorRole === 'system') return true;
  if (operation === 'create') {
    const records = Array.isArray(args[0]) ? args[0] : [args[0]];
    for (const item of records) {
      const record = asJsonObject(item);
      if (
        !record ||
        !canManageBaseUser(actorRole, operation, undefined, roleOf(record)) ||
        !(await hasActivePartner(model.modelName, record))
      )
        return false;
    }
    return true;
  }
  const ids =
    typeof args[0] === 'number'
      ? [args[0]]
      : Array.isArray(args[0])
        ? args[0].filter((id): id is number => typeof id === 'number')
        : [];
  const records = await model
    .query()
    .whereIn('id', ids)
    .select('id', 'role', 'partner_id', 'active');
  const values = operation === 'write' ? asJsonObject(args[1]) : null;
  if (
    !records.every((record) =>
      canManageBaseUser(actorRole, operation, roleOf(record), roleOf(values))
    )
  )
    return false;
  if (operation === 'write' && values) {
    for (const record of records) {
      if (!(await hasActivePartner(model.modelName, values, record))) return false;
    }
  }
  return true;
}

export async function executeRpc(
  model: typeof BaseModel,
  method: string,
  args: JsonValue[],
  kwargs: Record<string, JsonValue>,
  readScope: Domain,
  req: FastifyRequest,
  trx?: Transaction
): Promise<JsonValue> {
  const [first, second] = args;
  const domain = [...(Array.isArray(first) ? (first as Domain) : []), ...readScope];
  switch (method) {
    case 'search_read': {
      const relationGraph = typeof kwargs.with === 'string' ? kwargs.with : undefined;
      return (await model.search_read(domain, {
        ...(kwargs as Parameters<typeof model.search_read>[1]),
        limit: (kwargs.limit as number | undefined) ?? RPC_MAX_PAGE_SIZE,
        ...(relationGraph ? { withGraphFetched: relationGraph } : {}),
      } as Parameters<typeof model.search_read>[1])) as JsonValue;
    }
    case 'search':
      return (
        await model.search(domain, {
          ...(kwargs as Parameters<typeof model.search>[1]),
          limit: (kwargs.limit as number | undefined) ?? RPC_MAX_PAGE_SIZE,
        } as Parameters<typeof model.search>[1])
      ).map((record) => record.id);
    case 'create': {
      const values = first;
      if (values === undefined || !(Array.isArray(values) || asJsonObject(values)))
        throw new Error('create expects an object or array of objects');
      const inputs = (Array.isArray(values) ? values : [values]).map(asJsonObject);
      if (
        inputs.some((record) => record === null) ||
        !(
          await Promise.all(
            inputs.map((record) =>
              record
                ? Promise.all([
                    hasCompanyAccess(req, model.modelName, record, undefined, trx),
                    hasValidResourceReference(req, model.modelName, record, undefined, trx),
                  ]).then((results) => results.every(Boolean))
                : false
            )
          )
        ).every(Boolean)
      )
        throw new Error('Invalid related record reference');
      if (
        model.modelName === 'base.model_access' &&
        inputs.some((record) => !record || !hasValidAccessRule(model.modelName, record))
      )
        throw new Error('Access rules cannot target protected or uninstalled models');
      const created = await model.create(values as JsonObject | JsonObject[], { transaction: trx });
      const records = Array.isArray(created) ? created : [created];
      if (model.modelName === 'base.user') {
        for (const record of records) {
          if (roleOf(record) === 'user') await assignDefaultUserGroup(record.id, trx);
          await assignDefaultCompanyMembership(record.id, trx);
        }
      }
      for (const record of records) {
        await recordAudit(req, model.modelName, 'create', record.id, null, record);
        await recordOutbox(
          req,
          model.modelName,
          'created',
          record.id,
          auditSnapshot(model, record)
        );
      }
      return Array.isArray(created) ? created.map((record) => record.id) : created.id;
    }
    case 'write': {
      const ids =
        typeof first === 'number'
          ? first
          : Array.isArray(first)
            ? first.filter((id): id is number => typeof id === 'number')
            : [];
      const values = asJsonObject(second);
      if (values === null) throw new Error('write expects IDs and an object of values');
      const idList = Array.isArray(ids) ? ids : [ids];
      const visible = await model.search([...readScope, ['id', 'in', idList]], {
        limit: idList.length,
        transaction: trx,
      });
      if (visible.length !== idList.length) throw new Error('Record not found');
      const before = await model.query(trx).whereIn('id', idList);
      for (const record of before) {
        if (!(await hasCompanyAccess(req, model.modelName, values, record, trx)))
          throw new Error('Company access denied');
        if (!hasValidAccessRule(model.modelName, values, record)) {
          throw new Error('Access rules cannot target protected or uninstalled models');
        }
      }
      if (values.active === false) {
        const conflicts = await findReferencesBatch(
          model.modelName,
          before.map((record) => record.id),
          model.modelName === 'base.partner',
          trx
        );
        for (const record of before) {
          const reference = conflicts.get(record.id);
          if (reference) throw new Error(`Record is still used by '${reference}'`);
        }
      }
      for (const record of before) {
        if (!(await hasValidResourceReference(req, model.modelName, values, record, trx))) {
          throw new Error('Invalid related record reference');
        }
      }
      const written = await model.write(ids, values, { transaction: trx });
      const after = await model.query(trx).whereIn('id', idList);
      const afterById = new Map(after.map((record) => [record.id, record]));
      for (const record of before) {
        const updated = afterById.get(record.id);
        if (updated) {
          await recordAudit(req, model.modelName, 'write', record.id, record, updated);
          await recordOutbox(
            req,
            model.modelName,
            'updated',
            record.id,
            auditSnapshot(model, updated)
          );
        }
      }
      return written;
    }
    case 'unlink': {
      const ids =
        typeof first === 'number'
          ? first
          : Array.isArray(first)
            ? first.filter((id): id is number => typeof id === 'number')
            : [];
      const idList = Array.isArray(ids) ? ids : [ids];
      const visible = await model.search([...readScope, ['id', 'in', idList]], {
        limit: idList.length,
        transaction: trx,
      });
      if (visible.length !== idList.length) throw new Error('Record not found');
      const before = await model.query(trx).whereIn('id', idList);
      const conflicts = await findReferencesBatch(
        model.modelName,
        before.map((record) => record.id),
        model.modelName === 'base.partner',
        trx
      );
      for (const record of before) {
        const reference = conflicts.get(record.id);
        if (reference) throw new Error(`Record is still used by '${reference}'`);
      }
      const unlinked = await model.unlink(ids, false, { transaction: trx });
      const after = await model.query(trx).whereIn('id', idList);
      const afterById = new Map(after.map((record) => [record.id, record]));
      for (const record of before)
        await recordAudit(
          req,
          model.modelName,
          'archive',
          record.id,
          record,
          afterById.get(record.id) ?? null
        );
      for (const record of before)
        await recordOutbox(
          req,
          model.modelName,
          'archived',
          record.id,
          auditSnapshot(model, afterById.get(record.id) ?? record)
        );
      return unlinked;
    }
    case 'read': {
      const ids = Array.isArray(args[0])
        ? (args[0] as unknown[]).filter(
            (v): v is number => typeof v === 'number' && Number.isInteger(v)
          )
        : [];
      const fields = Array.isArray(kwargs.fields)
        ? (kwargs.fields as unknown[]).filter((f): f is string => typeof f === 'string')
        : undefined;
      if (ids.length === 0) return [];
      const scope = await userReadScope(req, model.modelName);
      return (await model.search_read([['id', 'in', ids], ...scope], {
        fields,
        activeTest: false,
      })) as unknown as JsonValue;
    }
    case 'search_count': {
      const rawDomain = (args[0] ?? []) as Domain;
      validateDomain(rawDomain, new Set(Object.keys(model.fields ?? {})));
      const scope = await userReadScope(req, model.modelName);
      const query = applyDomain(model.query(trx), [...rawDomain, ...scope]);
      const result = (await query.count('* as count').first()) as unknown as
        { count?: number | string } | undefined;
      return Number(result?.count ?? 0);
    }
    case 'fields_get': {
      return describeFields(model) as unknown as JsonValue;
    }
    case 'views_get': {
      return resolveViews(model) as unknown as JsonValue;
    }
    case 'default_get': {
      const requestedFields = Array.isArray(args[0])
        ? (args[0] as unknown[]).filter((f): f is string => typeof f === 'string')
        : Object.keys(model.fields ?? {});
      const safeCtx = sanitizeClientContext(kwargs.context, req.auth);
      const defaults: Record<string, unknown> = {};
      const fieldMap = model.fields ?? {};
      for (const fieldName of requestedFields) {
        const field = fieldMap[fieldName] as { default?: unknown } | undefined;
        if (!field) continue;
        const ctxKey = `default_${fieldName}`;
        if (ctxKey in safeCtx) {
          defaults[fieldName] = safeCtx[ctxKey];
        } else if (field.default !== undefined) {
          defaults[fieldName] =
            typeof field.default === 'function'
              ? (field.default as () => unknown)()
              : field.default;
        }
      }
      return defaults as unknown as JsonValue;
    }
    case 'onchange': {
      return { values: {} };
    }
    case 'call_action': {
      const ids = Array.isArray(args[0])
        ? (args[0] as unknown[]).filter(
            (v): v is number => typeof v === 'number' && Number.isInteger(v)
          )
        : [];
      const actionName = typeof args[1] === 'string' ? args[1] : '';
      const actionArgs = Array.isArray(args[2]) ? args[2] : [];
      if (!actionName) throw new Error('Action name is required');
      const scope = await userReadScope(req, model.modelName);
      const records = await model.search([['id', 'in', ids], ...scope], { activeTest: false });
      const results: unknown[] = [];
      for (const rec of records) {
        const fn = (rec as unknown as Record<string, unknown>)[actionName];
        if (typeof fn !== 'function') throw new Error(`Action '${actionName}' not found`);
        results.push(await (fn as (...a: unknown[]) => Promise<unknown>).apply(rec, actionArgs));
      }
      invalidateAuthCacheForModel(model.modelName);
      return results as unknown as JsonValue;
    }
    default:
      throw new Error(`Method '${method}' is not exposed`);
  }
}
