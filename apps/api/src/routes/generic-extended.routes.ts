import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { Registry, type BaseModel, type Domain } from '@moonwitness/orm';
import type { Transaction } from 'objection';
import { isRecord, type JsonObject } from '@moonwitness/types';
import {
  canAccess,
  canAccessField,
  canExecuteAction,
  sanitizeClientContext,
  type FieldAclMeta,
} from '../auth/policy.js';
import { getRecordRuleDomain } from '../auth/rules.js';
import { actionRegistry } from '../addons/action-menu-registry.js';
import { invalidateAuthCacheForModel } from '../plugins/auth.plugin.js';
import { routeRateLimitConfig } from '../config/rate-limit-policy.js';
import { findReferencesBatch } from './generic-references.js';

const MAX_BULK_IDS = 100;
const SERVER_MANAGED_FIELDS = new Set([
  'id',
  'create_date',
  'write_date',
  'create_uid',
  'write_uid',
]);

interface ModelParam {
  model: string;
}

interface ModelActionNameParam {
  model: string;
  actionName: string;
}

function resolveModel(req: FastifyRequest, name: string) {
  return Registry.has(name) ? req.env.get(name) : undefined;
}

function forbidden(reply: FastifyReply, req: FastifyRequest) {
  return reply.code(403).send({
    success: false,
    error: 'Forbidden',
    code: 'FORBIDDEN',
    requestId: req.id,
  });
}

function validateBulkIds(rawIds: unknown): number[] | null {
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_BULK_IDS) {
    return null;
  }
  const ids: number[] = [];
  for (const item of rawIds) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) return null;
    ids.push(item);
  }
  return Array.from(new Set(ids));
}

function stripServerManaged(values: JsonObject): JsonObject {
  const cleaned: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    if (!SERVER_MANAGED_FIELDS.has(key)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export const genericExtendedRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/:model/default-get (MW-API-003, MW-SEC-008)
  fastify.post<{
    Params: ModelParam;
    Body: { fields?: string[]; context?: Record<string, unknown> };
  }>(
    '/api/:model/default-get',
    {
      schema: {
        tags: ['ORM'],
        summary: 'Compute default field values for a model',
      },
    },
    async (req, reply) => {
      const modelName = req.params.model;
      if (!canAccess(req.auth?.role, modelName, 'read', req.auth?.groupPermissions)) {
        return forbidden(reply, req);
      }
      const Model = resolveModel(req, modelName);
      if (!Model) {
        return reply.code(404).send({
          success: false,
          error: `Model '${modelName}' not found`,
          code: 'MODEL_NOT_FOUND',
          requestId: req.id,
        });
      }

      const body = isRecord(req.body) ? req.body : {};
      const requestedFields = Array.isArray(body.fields)
        ? body.fields.filter((f): f is string => typeof f === 'string')
        : Object.keys(Model.fields ?? {});
      const safeContext = sanitizeClientContext(body.context, req.auth);

      const defaults: Record<string, unknown> = {};
      const modelWithDefaultGet = Model as typeof BaseModel & {
        defaultGet?: (
          fields: string[],
          ctx: Record<string, unknown>
        ) => Promise<Record<string, unknown>> | Record<string, unknown>;
      };

      if (typeof modelWithDefaultGet.defaultGet === 'function') {
        const computed = await modelWithDefaultGet.defaultGet(requestedFields, safeContext);
        Object.assign(defaults, computed);
      } else {
        const fieldMap = Model.fields ?? {};
        for (const fieldName of requestedFields) {
          const field = fieldMap[fieldName] as (FieldAclMeta & { default?: unknown }) | undefined;
          if (!field || !canAccessField(req.auth, field, 'read')) continue;
          const ctxKey = `default_${fieldName}`;
          if (ctxKey in safeContext) {
            defaults[fieldName] = safeContext[ctxKey];
          } else if (field.default !== undefined) {
            defaults[fieldName] =
              typeof field.default === 'function'
                ? (field.default as () => unknown)()
                : field.default;
          }
        }
      }

      // Filter by field-level read ACL
      const fieldMap = Model.fields ?? {};
      const filtered: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(defaults)) {
        const field = fieldMap[key] as FieldAclMeta | undefined;
        if (canAccessField(req.auth, field, 'read')) {
          filtered[key] = val;
        }
      }

      return { success: true, data: filtered, requestId: req.id };
    }
  );

  // POST /api/:model/onchange (MW-API-003, MW-SEC-008)
  fastify.post<{
    Params: ModelParam;
    Body: {
      values?: JsonObject;
      changedFields?: string[];
      context?: Record<string, unknown>;
    };
  }>(
    '/api/:model/onchange',
    {
      schema: {
        tags: ['ORM'],
        summary: 'Evaluate model onchange handlers for draft form values',
      },
    },
    async (req, reply) => {
      const modelName = req.params.model;
      if (!canAccess(req.auth?.role, modelName, 'read', req.auth?.groupPermissions)) {
        return forbidden(reply, req);
      }
      const Model = resolveModel(req, modelName);
      if (!Model) {
        return reply.code(404).send({
          success: false,
          error: `Model '${modelName}' not found`,
          code: 'MODEL_NOT_FOUND',
          requestId: req.id,
        });
      }

      const body = isRecord(req.body) ? req.body : {};
      const rawValues = isRecord(body.values) ? stripServerManaged(body.values as JsonObject) : {};
      const changedFields = Array.isArray(body.changedFields)
        ? body.changedFields.filter((f): f is string => typeof f === 'string')
        : Object.keys(rawValues);
      const safeContext = sanitizeClientContext(body.context, req.auth);

      const modelWithOnchange = Model as typeof BaseModel & {
        onchange?: (
          values: JsonObject,
          changedFields: string[],
          ctx: Record<string, unknown>
        ) =>
          | Promise<{ values?: Record<string, unknown>; warning?: unknown }>
          | {
              values?: Record<string, unknown>;
              warning?: unknown;
            };
      };

      let resultValues: Record<string, unknown> = {};
      let warning: unknown = undefined;
      if (typeof modelWithOnchange.onchange === 'function') {
        const res = await modelWithOnchange.onchange(rawValues, changedFields, safeContext);
        if (res?.values) resultValues = res.values;
        if (res?.warning) warning = res.warning;
      }

      const fieldMap = Model.fields ?? {};
      const filteredValues: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(resultValues)) {
        const field = fieldMap[key] as FieldAclMeta | undefined;
        if (canAccessField(req.auth, field, 'read')) {
          filteredValues[key] = val;
        }
      }

      return {
        success: true,
        data: {
          values: filteredValues,
          ...(warning !== undefined ? { warning } : {}),
        },
        requestId: req.id,
      };
    }
  );

  // PATCH /api/:model/bulk (MW-API-007)
  fastify.patch<{
    Params: ModelParam;
    Body: { ids: number[]; values: JsonObject };
  }>(
    '/api/:model/bulk',
    {
      config: routeRateLimitConfig('bulkMutation'),
      schema: {
        tags: ['ORM'],
        summary: 'Transactionally update up to 100 records of a model',
      },
    },
    async (req, reply) => {
      const modelName = req.params.model;
      if (!canAccess(req.auth?.role, modelName, 'write', req.auth?.groupPermissions)) {
        return forbidden(reply, req);
      }
      const Model = resolveModel(req, modelName);
      if (!Model) {
        return reply.code(404).send({
          success: false,
          error: `Model '${modelName}' not found`,
          code: 'MODEL_NOT_FOUND',
          requestId: req.id,
        });
      }

      const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
      const ids = validateBulkIds(body.ids);
      if (!ids) {
        return reply.code(400).send({
          success: false,
          error: `ids must be a non-empty array of positive integers (max ${MAX_BULK_IDS})`,
          code: 'INVALID_BULK_IDS',
          requestId: req.id,
        });
      }
      if (!isRecord(body.values)) {
        return reply.code(400).send({
          success: false,
          error: 'values must be a JSON object',
          code: 'INVALID_VALUES',
          requestId: req.id,
        });
      }

      const values = stripServerManaged(body.values as JsonObject);
      const fieldMap = Model.fields ?? {};
      for (const key of Object.keys(values)) {
        const field = fieldMap[key] as FieldAclMeta | undefined;
        if (!canAccessField(req.auth, field, 'write')) {
          return forbidden(reply, req);
        }
      }

      const scopeDomain: Domain = await getRecordRuleDomain(req, modelName);
      const updated = await Model.transaction(async (trx: Transaction) => {
        const scoped = await Model.search([['id', 'in', ids], ...scopeDomain], {
          activeTest: false,
        });
        if (scoped.length !== ids.length) {
          throw Object.assign(new Error('One or more records were not found or access denied'), {
            statusCode: 403,
            code: 'BULK_ACCESS_DENIED',
          });
        }
        const results: unknown[] = [];
        for (const record of scoped) {
          const patched = await record.$query(trx).patchAndFetch(values);
          results.push(patched);
        }
        return results;
      });

      invalidateAuthCacheForModel(modelName);
      return {
        success: true,
        data: updated,
        meta: { count: updated.length },
        requestId: req.id,
      };
    }
  );

  // DELETE /api/:model/bulk (MW-API-007, MW-PERF-002)
  fastify.delete<{
    Params: ModelParam;
    Body: { ids: number[] };
  }>(
    '/api/:model/bulk',
    {
      config: routeRateLimitConfig('bulkMutation'),
      schema: {
        tags: ['ORM'],
        summary: 'Transactionally delete up to 100 records with batched reference checks',
      },
    },
    async (req, reply) => {
      const modelName = req.params.model;
      if (!canAccess(req.auth?.role, modelName, 'unlink', req.auth?.groupPermissions)) {
        return forbidden(reply, req);
      }
      const Model = resolveModel(req, modelName);
      if (!Model) {
        return reply.code(404).send({
          success: false,
          error: `Model '${modelName}' not found`,
          code: 'MODEL_NOT_FOUND',
          requestId: req.id,
        });
      }

      const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
      const ids = validateBulkIds(body.ids);
      if (!ids) {
        return reply.code(400).send({
          success: false,
          error: `ids must be a non-empty array of positive integers (max ${MAX_BULK_IDS})`,
          code: 'INVALID_BULK_IDS',
          requestId: req.id,
        });
      }

      const scopeDomain: Domain = await getRecordRuleDomain(req, modelName);
      await Model.transaction(async (trx: Transaction) => {
        const scoped = await Model.search([['id', 'in', ids], ...scopeDomain], {
          activeTest: false,
        });
        if (scoped.length !== ids.length) {
          throw Object.assign(new Error('One or more records were not found or access denied'), {
            statusCode: 403,
            code: 'BULK_ACCESS_DENIED',
          });
        }
        const conflicts = await findReferencesBatch(modelName, ids, false, trx);
        if (conflicts.size > 0) {
          const [conflictId, refModel] = Array.from(conflicts.entries())[0]!;
          throw Object.assign(
            new Error(`Cannot delete ${modelName}#${conflictId}: still referenced by ${refModel}`),
            {
              statusCode: 409,
              code: 'RELATION_CONFLICT',
            }
          );
        }
        await Model.query(trx).delete().whereIn('id', ids);
      });

      invalidateAuthCacheForModel(modelName);
      return {
        success: true,
        data: { deletedIds: ids, count: ids.length },
        requestId: req.id,
      };
    }
  );

  // POST /api/:model/action/:actionName (MW-ACT-002, MW-SEC-004)
  fastify.post<{
    Params: ModelActionNameParam;
    Body: { ids?: number[]; args?: unknown[]; context?: Record<string, unknown> };
  }>(
    '/api/:model/action/:actionName',
    {
      config: routeRateLimitConfig('bulkMutation'),
      schema: {
        tags: ['ORM'],
        summary: 'Execute a registered or model-level action on a batch of records (max 100)',
      },
    },
    async (req, reply) => {
      const { model: modelName, actionName } = req.params;
      const actionDef =
        actionRegistry.get(actionName) ?? actionRegistry.get(`${modelName}.${actionName}`);
      if (!canExecuteAction(req.auth, modelName, actionDef)) {
        return forbidden(reply, req);
      }
      const Model = resolveModel(req, modelName);
      if (!Model) {
        return reply.code(404).send({
          success: false,
          error: `Model '${modelName}' not found`,
          code: 'MODEL_NOT_FOUND',
          requestId: req.id,
        });
      }

      const body = isRecord(req.body) ? req.body : {};
      const ids = body.ids !== undefined ? validateBulkIds(body.ids) : [];
      if (ids === null) {
        return reply.code(400).send({
          success: false,
          error: `ids must be an array of positive integers (max ${MAX_BULK_IDS})`,
          code: 'INVALID_BULK_IDS',
          requestId: req.id,
        });
      }

      const scopeDomain: Domain = await getRecordRuleDomain(req, modelName);
      const args = Array.isArray(body.args) ? body.args : [];
      const handlerName = actionDef?.handler ?? actionName;

      const results = await Model.transaction(async () => {
        if (ids.length === 0) {
          const modelMethod = (Model as unknown as Record<string, unknown>)[handlerName];
          if (typeof modelMethod !== 'function') {
            throw Object.assign(new Error(`Action '${actionName}' not found on '${modelName}'`), {
              statusCode: 404,
              code: 'ACTION_NOT_FOUND',
            });
          }
          return (modelMethod as (...a: unknown[]) => Promise<unknown>).apply(Model, args);
        }

        const scoped = await Model.search([['id', 'in', ids], ...scopeDomain], {
          activeTest: false,
        });
        if (scoped.length !== ids.length) {
          throw Object.assign(new Error('One or more records were not found or access denied'), {
            statusCode: 403,
            code: 'BULK_ACCESS_DENIED',
          });
        }
        const out: unknown[] = [];
        for (const record of scoped) {
          const method = (record as unknown as Record<string, unknown>)[handlerName];
          if (typeof method !== 'function') {
            throw Object.assign(new Error(`Action '${actionName}' not found on '${modelName}'`), {
              statusCode: 404,
              code: 'ACTION_NOT_FOUND',
            });
          }
          out.push(await (method as (...a: unknown[]) => Promise<unknown>).apply(record, args));
        }
        return out;
      });

      invalidateAuthCacheForModel(modelName);
      return { success: true, data: results, requestId: req.id };
    }
  );
};
