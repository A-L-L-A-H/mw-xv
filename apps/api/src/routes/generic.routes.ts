import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import {
  BaseModel,
  Registry,
  describeFields,
  resolveViews,
  getModelMenuInfo,
  validateDomain,
  type Domain,
} from '@moonwitness/orm';
import { assignDefaultCompanyMembership, assignDefaultUserGroup } from '@moonwitness/orm-base';
import {
  asJsonObject,
  isRecord as isObject,
  isJsonValue,
  MAX_ATTACHMENT_BYTES,
  type JsonObject,
  type JsonValue,
} from '@moonwitness/types';
import type { Transaction } from 'objection';
import { canAccess, canManageBaseUser, operationFor, rpcOperation } from '../auth/policy.js';
import {
  ATTACHMENT_MIME_TYPES,
  encodedAttachmentName,
  safeAttachmentName,
  validateAttachmentMagicBytes,
} from '../storage/attachment-validation.js';
import { genericExtendedRoutes } from './generic-extended.routes.js';
import type {
  ActionRequestBody,
  DeleteQueryParams,
  GroupCountQueryParams,
  ModelActionParam,
  ModelIdParam,
  ModelListResponse,
  ModelParam,
  SearchQueryParams,
} from '@moonwitness/types';
import {
  queryGraphIsBounded,
  relationExpression,
  rpcReadIsBounded,
  userGraphAllowed,
} from './generic-query-graph.js';
import { auditSnapshot } from './generic-audit.js';
import { findReference, findReferencesBatch } from './generic-references.js';
import {
  errorMessage,
  executeRpc,
  forbidden,
  hasActivePartner,
  hasCompanyAccess,
  hasServerManagedFields,
  hasValidAccessRule,
  hasValidResourceReference,
  inRequestTransaction,
  modelNotFound,
  parseInteger,
  parseModelDomain,
  property,
  readExpectedWriteDate,
  recordAudit,
  recordNotFound,
  recordOutbox,
  relationConflict,
  requireId,
  resolveModel,
  roleOf,
  rpcUserMutationAllowed,
  scopedRecord,
  userReadScope,
} from '../http/generic-rpc.js';

type RpcEnvelope = {
  jsonrpc?: unknown;
  method?: unknown;
  params?: unknown;
  id?: unknown;
};

interface GenericRoutesOptions {
  attachmentStorage: AttachmentStorage;
}

export const genericRoutes: FastifyPluginAsync<GenericRoutesOptions> = async (fastify, options) => {
  await fastify.register(genericExtendedRoutes);

  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body)
  );

  // Single authorization point for every /api/:model route; handlers stay policy-free.
  fastify.addHook('preHandler', async (req, reply) => {
    const model = (req.params as { model?: string } | undefined)?.model;
    if (!model) return;
    const operation = operationFor(req.method, req.routeOptions.url ?? '');
    if (!canAccess(req.auth?.role, model, operation, req.auth?.groupPermissions)) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    if (model === 'base.attachment' && operation === 'create') {
      return reply.code(400).send({ success: false, error: 'Use the attachment upload endpoint' });
    }
    if (
      model === 'base.attachment' &&
      operation === 'write' &&
      req.routeOptions.url !== '/api/:model/:id/action/:method'
    ) {
      return reply.code(400).send({ success: false, error: 'Attachment metadata is immutable' });
    }
  });

  fastify.post<{
    Querystring: { resource_model?: string; resource_id?: string; name?: string };
    Body: Buffer;
  }>(
    '/api/base.attachment/upload',
    {
      bodyLimit: MAX_ATTACHMENT_BYTES,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!canAccess(req.auth?.role, 'base.attachment', 'create', req.auth?.groupPermissions))
        return forbidden(reply);
      const { resource_model: resourceModel, resource_id: rawResourceId } = req.query;
      const resourceId = parseInteger(rawResourceId);
      const name = safeAttachmentName(req.query.name);
      const mimeHeader = req.headers['x-file-mime'];
      const rawMime = (Array.isArray(mimeHeader) ? mimeHeader[0] : mimeHeader)
        ?.trim()
        .toLowerCase();
      const mimetype = rawMime && ATTACHMENT_MIME_TYPES.has(rawMime) ? rawMime : null;
      if (
        !resourceModel ||
        !Registry.has(resourceModel) ||
        resourceId === undefined ||
        resourceId < 1 ||
        !name ||
        !mimetype
      ) {
        return reply.code(400).send({ success: false, error: 'Invalid attachment metadata' });
      }
      if (!canAccess(req.auth?.role, resourceModel, 'read', req.auth?.groupPermissions)) {
        return reply.code(404).send({ success: false, error: 'Record not found' });
      }
      const resource = await scopedRecord(
        req,
        resolveModel(req, resourceModel) ?? BaseModel,
        resourceModel,
        resourceId
      );
      if (!resource) return reply.code(404).send({ success: false, error: 'Record not found' });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        return reply.code(400).send({ success: false, error: 'Attachment must not be empty' });
      if (req.body.length > MAX_ATTACHMENT_BYTES)
        return reply.code(413).send({ success: false, error: 'Attachment exceeds 10 MiB limit' });
      if (!validateAttachmentMagicBytes(req.body, mimetype))
        return reply.code(400).send({
          success: false,
          error: 'Attachment content does not match declared MIME type',
          code: 'INVALID_MIME_SIGNATURE',
          requestId: req.id,
        });

      const key = randomUUID();
      const checksum = createHash('sha256').update(req.body).digest('hex');
      let persisted = false;
      try {
        await options.attachmentStorage.put(key, req.body);
        persisted = true;
        const record = await inRequestTransaction(req, async (trx) => {
          const AttachmentModel = req.env.get('base.attachment');
          const created = await AttachmentModel.create(
            {
              name,
              resource_model: resourceModel,
              resource_id: resourceId,
              mimetype,
              size_bytes: req.body.length,
              storage_key: key,
              checksum,
            } as JsonObject,
            { transaction: trx }
          );
          const createdRecord = Array.isArray(created) ? created[0] : created;
          if (!createdRecord) throw new Error('Attachment metadata was not created');
          await recordAudit(
            req,
            'base.attachment',
            'create',
            createdRecord.id,
            null,
            createdRecord,
            trx
          );
          await recordOutbox(
            req,
            'base.attachment',
            'created',
            createdRecord.id,
            auditSnapshot(AttachmentModel, createdRecord),
            trx
          );
          return createdRecord;
        });
        return reply.code(201).send({ success: true, data: record });
      } catch (error) {
        if (persisted) {
          await options.attachmentStorage.delete(key).catch((cleanupError) => {
            req.log.error(
              { err: cleanupError, storageKey: key },
              'Failed to compensate attachment upload'
            );
          });
        } else {
          req.log.error({ err: error }, 'Attachment storage upload failed');
          return reply
            .code(503)
            .send({ success: false, error: 'Attachment storage is temporarily unavailable' });
        }
        throw error;
      }
    }
  );

  fastify.get<{ Params: ModelIdParam }>('/api/base.attachment/:id/download', async (req, reply) => {
    if (!canAccess(req.auth?.role, 'base.attachment', 'read', req.auth?.groupPermissions))
      return forbidden(reply);
    const id = requireId(req.params.id, reply);
    if (id === null) return;
    const Model = req.env.get('base.attachment');
    const attachment = await scopedRecord(req, Model, 'base.attachment', id);
    if (!attachment) return reply.code(404).send({ success: false, error: 'Attachment not found' });
    const resourceModel = property(attachment, 'resource_model');
    const resourceId = property(attachment, 'resource_id');
    if (
      typeof resourceModel !== 'string' ||
      !Registry.has(resourceModel) ||
      typeof resourceId !== 'number' ||
      !Number.isSafeInteger(resourceId) ||
      resourceId < 1
    ) {
      return reply.code(404).send({ success: false, error: 'Attachment not found' });
    }
    if (!canAccess(req.auth?.role, resourceModel, 'read', req.auth?.groupPermissions)) {
      return reply.code(404).send({ success: false, error: 'Attachment not found' });
    }
    const resource = await scopedRecord(
      req,
      resolveModel(req, resourceModel) ?? BaseModel,
      resourceModel,
      resourceId
    );
    if (!resource) return reply.code(404).send({ success: false, error: 'Attachment not found' });
    const key = property(attachment, 'storage_key');
    const name = property(attachment, 'name');
    const mimetype = property(attachment, 'mimetype');
    if (typeof key !== 'string' || typeof name !== 'string' || typeof mimetype !== 'string')
      return reply.code(404).send({ success: false, error: 'Attachment content not found' });
    try {
      const content = await options.attachmentStorage.get(key);
      if (!content)
        return reply.code(404).send({ success: false, error: 'Attachment content not found' });
      reply
        .header('Content-Type', mimetype)
        .header('Content-Length', content.length)
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodedAttachmentName(name)}`
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store');
      return reply.send(content);
    } catch (error) {
      req.log.error({ err: error }, 'Attachment storage download failed');
      return reply
        .code(503)
        .send({ success: false, error: 'Attachment storage is temporarily unavailable' });
    }
  });

  fastify.get<{ Reply: ModelListResponse }>('/api/models', async (req) => ({
    success: true,
    models: Registry.getNames()
      .filter((name) => canAccess(req.auth?.role, name, 'read', req.auth?.groupPermissions))
      .map((name) => ({
        model: name,
        table: Registry.get(name).tableName,
        menu: getModelMenuInfo(name),
      })),
  }));

  /** What the caller may do on a model; drives which buttons a UI shows. */
  const permissionsFor = (req: FastifyRequest, model: string) => ({
    read: canAccess(req.auth?.role, model, 'read', req.auth?.groupPermissions),
    create: canAccess(req.auth?.role, model, 'create', req.auth?.groupPermissions),
    write: canAccess(req.auth?.role, model, 'write', req.auth?.groupPermissions),
    unlink: canAccess(req.auth?.role, model, 'unlink', req.auth?.groupPermissions),
  });

  const actionPermissionFor = (req: FastifyRequest, model: string) =>
    canAccess(req.auth?.role, model, 'action', req.auth?.groupPermissions);

  /** Field metadata with readonly forced on when the caller cannot write. */
  const fieldsFor = (req: FastifyRequest, model: string) => {
    const writable = canAccess(req.auth?.role, model, 'write', req.auth?.groupPermissions);
    return describeFields(Registry.get(model))
      .filter((field) => model !== 'base.attachment' || field.name !== 'storage_key')
      .map((field) => (writable ? field : { ...field, readonly: true }));
  };

  fastify.get<{ Params: ModelParam }>('/api/:model/fields', async (req, reply) => {
    if (!Registry.has(req.params.model))
      return reply.status(404).send(modelNotFound(req.params.model));
    return {
      success: true,
      model: req.params.model,
      permissions: permissionsFor(req, req.params.model),
      fields: fieldsFor(req, req.params.model),
    };
  });

  fastify.get<{ Params: ModelParam }>('/api/:model/views', async (req, reply) => {
    if (!Registry.has(req.params.model))
      return reply.status(404).send(modelNotFound(req.params.model));
    const views = resolveViews(Registry.get(req.params.model));
    const actions = actionPermissionFor(req, req.params.model) ? (views.actions ?? []) : [];
    return {
      success: true,
      ...views,
      actions,
      permissions: permissionsFor(req, req.params.model),
      fields: fieldsFor(req, req.params.model),
    };
  });

  fastify.get<{ Params: ModelParam; Querystring: GroupCountQueryParams }>(
    '/api/:model/group-count',
    async (req, reply) => {
      const Model = resolveModel(req, req.params.model);
      if (!Model) return reply.status(404).send(modelNotFound(req.params.model));
      const domain = parseModelDomain(req.query.domain, Model);
      if (!domain) {
        return reply
          .code(400)
          .send({ success: false, error: 'Invalid domain; expected a JSON domain array' });
      }
      if (!req.query.group_by || req.query.group_by.length > 512) {
        return reply.code(400).send({ success: false, error: 'group_by is required' });
      }
      const groupBy = req.query.group_by.split(',').map((field) => field.trim());
      const limit = parseInteger(req.query.limit, 100);
      const offset = parseInteger(req.query.offset, 0);
      if (limit === undefined || limit < 1 || limit > 500) {
        return reply.code(400).send({ success: false, error: 'limit must be 1–500' });
      }
      if (offset === undefined || offset < 0 || offset > 10_000) {
        return reply.code(400).send({ success: false, error: 'offset must be 0–10000' });
      }
      try {
        const scope = await userReadScope(req, req.params.model);
        const page = await Model.search_group_count([...domain, ...scope], groupBy, {
          limit,
          offset,
        });
        return { success: true, model: req.params.model, groupBy, ...page };
      } catch (error) {
        const validationError = isObject(error) && error.statusCode === 400;
        return reply.code(validationError ? 400 : 500).send({
          success: false,
          error: validationError
            ? errorMessage(error, 'Invalid grouped-count request')
            : errorMessage(error, 'Unable to group records'),
        });
      }
    }
  );

  fastify.get<{ Params: ModelParam; Querystring: SearchQueryParams }>(
    '/api/:model',
    async (req, reply) => {
      const Model = resolveModel(req, req.params.model);
      if (!Model) return reply.status(404).send(modelNotFound(req.params.model));

      const domain = parseModelDomain(req.query.domain, Model);
      if (!domain) {
        return reply
          .status(400)
          .send({ success: false, error: 'Invalid domain; expected a JSON domain array' });
      }

      const limit = parseInteger(req.query.limit, 80);
      const offset = parseInteger(req.query.offset, 0);
      const cursor = parseInteger(req.query.cursor);
      const cursorMode = req.query.cursor !== undefined;
      if (
        limit === undefined ||
        limit < 1 ||
        limit > 500 ||
        offset === undefined ||
        offset < 0 ||
        (cursorMode && (cursor === undefined || cursor < 0 || offset > 0))
      ) {
        return reply.status(400).send({
          success: false,
          error:
            'limit must be 1–500; offset and cursor must be non-negative and cannot be combined',
        });
      }
      if (cursorMode && req.query.order && req.query.order.trim().toLowerCase() !== 'id asc') {
        return reply.code(400).send({
          success: false,
          error: 'cursor pagination requires ascending id order',
        });
      }
      const fields = req.query.fields
        ?.split(',')
        .map((field) => field.trim())
        .filter(Boolean);
      if (fields && fields.length > 100) {
        return reply
          .code(400)
          .send({ success: false, error: 'At most 100 fields may be selected' });
      }
      if ((req.query.with?.length ?? 0) > 512 || (req.query.order?.length ?? 0) > 512) {
        return reply.code(400).send({ success: false, error: 'Query expression is too long' });
      }
      if (!queryGraphIsBounded(req.query.with)) {
        return reply
          .code(400)
          .send({ success: false, error: 'Relation graph exceeds maximum depth' });
      }
      const options = {
        fields,
        limit: cursorMode && limit > 0 ? limit + 1 : limit,
        offset: cursorMode ? undefined : offset,
        order: cursorMode ? 'id asc' : req.query.order,
        withGraphFetched: relationExpression(req.query.with),
      };
      const scope = await userReadScope(req, req.params.model);
      if (!userGraphAllowed(req.auth?.role, req.params.model, req.query.with))
        return reply.code(403).send({ success: false, error: 'Forbidden relation graph' });
      const cursorDomain = cursorMode ? ([['id', '>', cursor]] as Domain) : [];
      const [pageRecords, total] = await Promise.all([
        Model.search_read([...domain, ...scope, ...cursorDomain], options),
        req.query.count === 'true'
          ? Model.search_count([...domain, ...scope])
          : Promise.resolve(undefined),
      ]);
      const hasMore = cursorMode && limit > 0 && pageRecords.length > limit;
      const records = hasMore ? pageRecords.slice(0, limit) : pageRecords;
      return {
        success: true,
        model: req.params.model,
        count: records.length,
        total,
        nextCursor: hasMore ? records.at(-1)?.id : undefined,
        data: records,
      };
    }
  );

  fastify.get<{ Params: ModelIdParam; Querystring: { with?: string } }>(
    '/api/:model/:id',
    async (req, reply) => {
      const Model = resolveModel(req, req.params.model);
      if (!Model) return reply.status(404).send(modelNotFound(req.params.model));
      const id = requireId(req.params.id, reply);
      if (id === null) return;
      if (!queryGraphIsBounded(req.query.with))
        return reply
          .code(400)
          .send({ success: false, error: 'Relation graph exceeds maximum depth' });
      if (!userGraphAllowed(req.auth?.role, req.params.model, req.query.with))
        return reply.code(403).send({ success: false, error: 'Forbidden relation graph' });
      const scope = await userReadScope(req, req.params.model);
      if (req.auth?.role === 'user' || scope.length > 0) {
        const [record] = await Model.search_read([...scope, ['id', '=', id]], {
          limit: 1,
          withGraphFetched: relationExpression(req.query.with),
        });
        if (!record) return reply.status(404).send(recordNotFound(req.params.model, id));
        return { success: true, model: req.params.model, data: record };
      }
      const record = await Model.browse(id, {
        withGraphFetched: relationExpression(req.query.with),
      });
      if (!record) return reply.status(404).send(recordNotFound(req.params.model, id));
      return { success: true, model: req.params.model, data: record };
    }
  );

  fastify.post<{ Params: ModelParam; Body: unknown }>('/api/:model', async (req, reply) => {
    const Model = resolveModel(req, req.params.model);
    if (!Model) return reply.status(404).send(modelNotFound(req.params.model));
    const body = req.body;
    const values = Array.isArray(body) ? body.map(asJsonObject) : [asJsonObject(body)];
    if (values.some((value) => value === null))
      return reply
        .status(400)
        .send({ success: false, error: 'Request body must be a JSON object or array of objects' });
    const inputRecords = values as JsonObject[];
    if (inputRecords.some(hasServerManagedFields))
      return reply
        .status(400)
        .send({ success: false, error: 'Identity and audit fields are managed by the server' });
    if (
      req.params.model === 'base.user' &&
      !inputRecords.every((value) =>
        canManageBaseUser(req.auth?.role, 'create', undefined, roleOf(value))
      )
    )
      return forbidden(reply);
    for (const value of inputRecords) {
      if (!(await hasCompanyAccess(req, req.params.model, value))) {
        return reply.code(403).send({ success: false, error: 'Company access denied' });
      }
      if (!hasValidAccessRule(req.params.model, value)) {
        return reply.code(400).send({
          success: false,
          error: 'Access rules cannot target protected or uninstalled models',
        });
      }
      if (!(await hasValidResourceReference(req, req.params.model, value))) {
        return reply.code(400).send({
          success: false,
          error: 'A valid installed model record is required for resource_model and resource_id',
        });
      }
    }
    for (const value of inputRecords) {
      if (!(await hasActivePartner(req.params.model, value)))
        return reply
          .code(409)
          .send({ success: false, error: 'An active user requires an active partner' });
    }
    const created = await inRequestTransaction(req, async (trx) => {
      for (const value of inputRecords) {
        if (!(await hasCompanyAccess(req, req.params.model, value, undefined, trx)))
          throw Object.assign(new Error('Company access denied'), { statusCode: 403 });
        if (!(await hasValidResourceReference(req, req.params.model, value, undefined, trx)))
          throw Object.assign(new Error('A valid installed model record is required'), {
            statusCode: 400,
          });
        if (!(await hasActivePartner(req.params.model, value, undefined, trx)))
          throw Object.assign(new Error('An active user requires an active partner'), {
            statusCode: 409,
          });
      }
      const result = await Model.create(
        Array.isArray(body) ? (values as JsonObject[]) : (values[0] as JsonObject),
        { transaction: trx }
      );
      for (const record of Array.isArray(result) ? result : [result]) {
        if (req.params.model === 'base.user') {
          if (roleOf(record) === 'user') await assignDefaultUserGroup(record.id, trx);
          await assignDefaultCompanyMembership(record.id, trx);
        }
        const snapshot = auditSnapshot(Model, record);
        await recordAudit(req, req.params.model, 'create', record.id, null, record, trx);
        await recordOutbox(req, req.params.model, 'created', record.id, snapshot, trx);
      }
      return result;
    });
    return reply.status(201).send({ success: true, model: req.params.model, data: created });
  });

  const updateHandler = async (
    req: FastifyRequest<{ Params: ModelIdParam; Body: unknown }>,
    reply: FastifyReply
  ) => {
    const Model = resolveModel(req, req.params.model);
    if (!Model) return reply.status(404).send(modelNotFound(req.params.model));
    const id = requireId(req.params.id, reply);
    if (id === null) return;
    const record = await scopedRecord(req, Model, req.params.model, id);
    if (!record) return reply.status(404).send(recordNotFound(req.params.model, id));
    const expectedWriteDate = readExpectedWriteDate(req);
    if (expectedWriteDate !== undefined && String(record.write_date ?? '') !== expectedWriteDate) {
      return reply.code(409).send({
        success: false,
        error: 'Record was modified by another request; reload and retry',
      });
    }
    const values = asJsonObject(req.body);
    if (values === null)
      return reply
        .status(400)
        .send({ success: false, error: 'Request body must be a JSON object' });
    if (hasServerManagedFields(values))
      return reply
        .status(400)
        .send({ success: false, error: 'Identity and audit fields are managed by the server' });
    if (!(await hasCompanyAccess(req, req.params.model, values, record)))
      return reply.code(403).send({ success: false, error: 'Company access denied' });
    if (!(await hasValidResourceReference(req, req.params.model, values, record))) {
      return reply.code(400).send({
        success: false,
        error: 'A valid installed model record is required for resource_model and resource_id',
      });
    }
    if (!hasValidAccessRule(req.params.model, values, record)) {
      return reply.code(400).send({
        success: false,
        error: 'Access rules cannot target protected or uninstalled models',
      });
    }
    if (
      req.params.model === 'base.user' &&
      !canManageBaseUser(req.auth?.role, 'write', roleOf(record), roleOf(values))
    )
      return forbidden(reply);
    if (!(await hasActivePartner(req.params.model, values, record)))
      return reply
        .code(409)
        .send({ success: false, error: 'An active user requires an active partner' });
    if (values.active === false) {
      const reference = await findReference(
        req.params.model,
        id,
        req.params.model === 'base.partner'
      );
      if (reference) return relationConflict(reply, req.params.model, reference);
    }
    const updated = await inRequestTransaction(req, async (trx) => {
      const locked = await scopedRecord(req, Model, req.params.model, id, true, trx);
      if (!locked) return null;
      if (
        expectedWriteDate !== undefined &&
        String(locked.write_date ?? '') !== expectedWriteDate
      ) {
        throw Object.assign(new Error('Record was modified by another request; reload and retry'), {
          statusCode: 409,
        });
      }
      if (!(await hasCompanyAccess(req, req.params.model, values, locked, trx))) return null;
      if (!(await hasValidResourceReference(req, req.params.model, values, locked, trx)))
        throw Object.assign(new Error('A valid installed model record is required'), {
          statusCode: 400,
        });
      if (!(await hasActivePartner(req.params.model, values, locked, trx)))
        throw Object.assign(new Error('An active user requires an active partner'), {
          statusCode: 409,
        });
      if (values.active === false) {
        const reference = await findReference(
          req.params.model,
          id,
          req.params.model === 'base.partner',
          trx
        );
        if (reference)
          throw Object.assign(new Error(`Cannot archive: still referenced by '${reference}'`), {
            statusCode: 409,
          });
      }
      const before = locked.toJSON();
      await Model.write(id, values, { transaction: trx });
      const next = (await Model.browse(id, { transaction: trx })) as BaseModel | null;
      if (!next) return null;
      const snapshot = auditSnapshot(Model, next);
      await recordAudit(req, req.params.model, 'write', id, before, next, trx);
      await recordOutbox(req, req.params.model, 'updated', id, snapshot, trx);
      return next;
    });
    if (!updated) return reply.status(404).send(recordNotFound(req.params.model, id));
    return { success: true, model: req.params.model, data: updated };
  };
  fastify.put<{ Params: ModelIdParam; Body: unknown }>('/api/:model/:id', updateHandler);
  fastify.patch<{ Params: ModelIdParam; Body: unknown }>('/api/:model/:id', updateHandler);

  fastify.delete<{ Params: ModelIdParam; Querystring: DeleteQueryParams }>(
    '/api/:model/:id',
    async (req, reply) => {
      const Model = resolveModel(req, req.params.model);
      if (!Model) return reply.status(404).send(modelNotFound(req.params.model));
      const id = requireId(req.params.id, reply);
      if (id === null) return;
      const record = await scopedRecord(req, Model, req.params.model, id);
      if (!record) return reply.status(404).send(recordNotFound(req.params.model, id));
      if (
        req.params.model === 'base.user' &&
        !canManageBaseUser(req.auth?.role, 'unlink', roleOf(record))
      )
        return forbidden(reply);
      const hardDelete = req.query.hard === 'true';
      const deletion = await inRequestTransaction(req, async (trx) => {
        const transactionalModel = resolveModel(req, req.params.model);
        if (!transactionalModel) return { missing: true as const };
        const locked = await scopedRecord(
          req,
          transactionalModel,
          req.params.model,
          id,
          false,
          trx
        );
        if (!locked) return { missing: true as const };
        if (
          req.params.model === 'base.user' &&
          !canManageBaseUser(req.auth?.role, 'unlink', roleOf(locked))
        )
          return { forbidden: true as const };
        const before = locked.toJSON();
        const reference = await findReference(
          req.params.model,
          id,
          !hardDelete && req.params.model === 'base.partner',
          trx
        );
        if (reference) return { reference };
        await locked.remove(hardDelete, { transaction: trx });
        await recordAudit(
          req,
          req.params.model,
          hardDelete ? 'delete' : 'archive',
          id,
          before,
          hardDelete ? null : locked,
          trx
        );
        await recordOutbox(
          req,
          req.params.model,
          hardDelete ? 'deleted' : 'archived',
          id,
          auditSnapshot(transactionalModel, hardDelete ? before : locked),
          trx
        );
        const storageKey =
          hardDelete && req.params.model === 'base.attachment'
            ? property(locked, 'storage_key')
            : undefined;
        return { deleted: true as const, storageKey };
      });
      if ('missing' in deletion)
        return reply.status(404).send(recordNotFound(req.params.model, id));
      if ('forbidden' in deletion) return forbidden(reply);
      if ('reference' in deletion && typeof deletion.reference === 'string')
        return relationConflict(reply, req.params.model, deletion.reference);
      if (typeof deletion.storageKey === 'string') {
        await options.attachmentStorage.delete(deletion.storageKey).catch((error) => {
          req.log.error(
            { err: error, storageKey: deletion.storageKey },
            'Attachment object cleanup failed'
          );
        });
      }
      return {
        success: true,
        model: req.params.model,
        message: hardDelete
          ? `Record #${id} permanently deleted`
          : `Record #${id} archived (active: false)`,
      };
    }
  );

  fastify.post<{ Params: ModelActionParam; Body: ActionRequestBody }>(
    '/api/:model/:id/action/:method',
    async (req, reply) => {
      const Model = resolveModel(req, req.params.model);
      if (!Model) return reply.status(404).send(modelNotFound(req.params.model));
      const id = requireId(req.params.id, reply);
      if (id === null) return;
      const record = await scopedRecord(
        req,
        Model,
        req.params.model,
        id,
        req.params.method !== 'action_unarchive'
      );
      if (!record) return reply.status(404).send(recordNotFound(req.params.model, id));
      if (
        req.params.model === 'base.user' &&
        !canManageBaseUser(req.auth?.role, 'action', roleOf(record))
      )
        return forbidden(reply);
      if (!Model.exposedActions.includes(req.params.method)) {
        return reply
          .status(400)
          .send({ success: false, error: `Action '${req.params.method}' is not exposed` });
      }
      if (!req.params.method.startsWith('action_')) {
        return reply
          .status(400)
          .send({ success: false, error: `Action '${req.params.method}' is invalid` });
      }
      const actionResult = await inRequestTransaction(req, async (trx) => {
        const transactionalModel = resolveModel(req, req.params.model);
        if (!transactionalModel) return { missing: true as const };
        const locked = await scopedRecord(
          req,
          transactionalModel,
          req.params.model,
          id,
          req.params.method !== 'action_unarchive',
          trx
        );
        if (!locked) return { missing: true as const };
        if (
          req.params.model === 'base.user' &&
          !canManageBaseUser(req.auth?.role, 'action', roleOf(locked))
        )
          return { forbidden: true as const };
        if (req.params.method === 'action_archive') {
          const reference = await findReference(
            req.params.model,
            id,
            req.params.model === 'base.partner',
            trx
          );
          if (reference) return { reference };
        }
        if (
          req.params.model === 'base.user' &&
          req.params.method === 'action_unarchive' &&
          !(await hasActivePartner('base.user', { active: true }, locked, trx))
        )
          return { inactivePartner: true as const };
        const before = locked.toJSON();
        const action = locked[req.params.method as keyof BaseModel];
        if (typeof action !== 'function') return { invalid: true as const };
        const result: unknown = await Reflect.apply(action, locked, []);
        const snapshot = auditSnapshot(transactionalModel, locked);
        await recordAudit(req, req.params.model, req.params.method, id, before, locked, trx);
        await recordOutbox(req, req.params.model, req.params.method, id, snapshot, trx);
        return { record: locked, result };
      });
      if ('missing' in actionResult)
        return reply.status(404).send(recordNotFound(req.params.model, id));
      if ('forbidden' in actionResult) return forbidden(reply);
      if ('reference' in actionResult && typeof actionResult.reference === 'string')
        return relationConflict(reply, req.params.model, actionResult.reference);
      if ('inactivePartner' in actionResult)
        return reply
          .code(409)
          .send({ success: false, error: 'An active user requires an active partner' });
      if ('invalid' in actionResult)
        return reply
          .status(400)
          .send({ success: false, error: `Action '${req.params.method}' is invalid` });
      const jsonResult = isJsonValue(actionResult.result)
        ? actionResult.result
        : (actionResult.record.toJSON() as JsonValue);
      return {
        success: true,
        model: req.params.model,
        id,
        method: req.params.method,
        result: jsonResult,
      };
    }
  );

  fastify.post<{ Body: unknown }>('/jsonrpc', async (req, reply) => {
    const body: unknown = req.body;
    const envelope: RpcEnvelope = isObject(body) ? body : {};
    const id =
      typeof envelope.id === 'string' || typeof envelope.id === 'number' || envelope.id === null
        ? envelope.id
        : null;
    const params = isObject(envelope.params) ? envelope.params : {};
    const rpcError = (code: number, message: string) => ({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
    if (
      envelope.method !== 'call' ||
      params.service !== 'object' ||
      params.method !== 'execute_kw' ||
      !Array.isArray(params.args)
    ) {
      return reply.status(400).send(rpcError(-32600, 'Invalid JSON-RPC Request'));
    }
    const [modelName, method, rawArgs, rawKwargs] = params.args;
    if (typeof modelName !== 'string' || typeof method !== 'string')
      return reply.status(400).send(rpcError(-32602, 'Invalid execute_kw arguments'));
    const Model = resolveModel(req, modelName);
    if (!Model) return reply.send(rpcError(-32000, `Model '${modelName}' not found`));
    const required = rpcOperation(method);
    if (
      modelName === 'base.attachment' &&
      (required === 'create' || required === 'write' || required === 'unlink')
    ) {
      return reply.send(rpcError(-32003, 'Use the attachment content endpoints'));
    }
    if (required && !canAccess(req.auth?.role, modelName, required, req.auth?.groupPermissions)) {
      return reply.status(403).send(rpcError(-32003, 'Forbidden'));
    }
    const args = Array.isArray(rawArgs) && rawArgs.every(isJsonValue) ? rawArgs : [];
    const kwargs = asJsonObject(rawKwargs) ?? {};
    const rpcMutationValues =
      required === 'create'
        ? (Array.isArray(args[0]) ? args[0] : [args[0]]).map(asJsonObject)
        : required === 'write'
          ? [asJsonObject(args[1])]
          : [];
    if (rpcMutationValues.some((value) => value !== null && hasServerManagedFields(value)))
      return reply.send(rpcError(-32602, 'Identity and audit fields are managed by the server'));
    if (required === 'read' && (method === 'search_read' || method === 'search')) {
      try {
        validateDomain(args[0] ?? [], new Set(Object.keys(Model.jsonSchema.properties ?? {})));
      } catch {
        return reply.send(rpcError(-32602, 'Invalid search domain'));
      }
    }
    const requestedGraph = typeof kwargs.with === 'string' ? kwargs.with : undefined;
    if (required === 'read' && !queryGraphIsBounded(requestedGraph))
      return reply.send(rpcError(-32602, 'Relation graph exceeds maximum depth'));
    const scope =
      required === 'read' || required === 'write' || required === 'unlink'
        ? await userReadScope(req, modelName)
        : [];
    if (required === 'read' && !rpcReadIsBounded(method, args, kwargs))
      return reply.send(rpcError(-32602, 'Read query exceeds configured limits'));
    if (required === 'read' && !userGraphAllowed(req.auth?.role, modelName, requestedGraph))
      return reply.status(403).send(rpcError(-32003, 'Forbidden relation graph'));
    if (
      modelName === 'base.user' &&
      (required === 'create' || required === 'write' || required === 'unlink') &&
      !(await rpcUserMutationAllowed(req.auth?.role, Model, required, args))
    )
      return reply.status(403).send(rpcError(-32003, 'Forbidden'));
    if (required === 'create' && modelName === 'base.model_access') {
      const values = asJsonObject(args[0]);
      if (!values || !hasValidAccessRule(modelName, values))
        return reply.send(
          rpcError(-32602, 'Access rules cannot target protected or uninstalled models')
        );
    }
    if (required === 'unlink') {
      const rawIds = args[0];
      const ids =
        typeof rawIds === 'number'
          ? [rawIds]
          : Array.isArray(rawIds)
            ? rawIds.filter((value): value is number => typeof value === 'number')
            : [];
      const conflicts = await findReferencesBatch(modelName, ids, modelName === 'base.partner');
      for (const id of ids) {
        const reference = conflicts.get(id);
        if (reference)
          return reply.status(409).send(rpcError(-32009, `Record is still used by '${reference}'`));
      }
    }
    if (required === 'write' && kwargs.active === false) {
      const rawIds = args[0];
      const ids =
        typeof rawIds === 'number'
          ? [rawIds]
          : Array.isArray(rawIds)
            ? rawIds.filter((value): value is number => typeof value === 'number')
            : [];
      const conflicts = await findReferencesBatch(modelName, ids, modelName === 'base.partner');
      for (const id of ids) {
        const reference = conflicts.get(id);
        if (reference)
          return reply.status(409).send(rpcError(-32009, `Record is still used by '${reference}'`));
      }
    }
    try {
      const executionKwargs = requestedGraph
        ? { ...kwargs, with: relationExpression(requestedGraph) ?? requestedGraph }
        : kwargs;
      const execute = (trx?: Transaction) =>
        executeRpc(Model, method, args, executionKwargs, scope, req, trx);
      const result =
        required === 'read'
          ? await execute()
          : await inRequestTransaction(req, (trx) => execute(trx));
      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    } catch (error) {
      return reply.send(rpcError(-32601, errorMessage(error, 'Execution error')));
    }
  });
};
