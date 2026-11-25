import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { WhatsappAccount, WhatsappConversation, WhatsappGroupOperation } from '../models.js';
import { isRecord } from '@moonwitness/types';
import { GowaError } from '../runtime/gowa-client.js';
import { whatsappGatewayRequest } from '../runtime/gateway.js';
import parsePhoneNumberFromString from 'libphonenumber-js/max';
import { whatsappLogErrorContext } from '../runtime/log-redaction.js';
import {
  id,
  recordWhatsAppAudit,
  requireCompany,
  requireWhatsAppAction,
  whatsappRateLimit,
  type WhatsappRouteParams,
} from '../runtime/route-helpers.js';

type Params = WhatsappRouteParams;

export function registerWhatsAppGroupManagementRoutes(app: FastifyInstance): void {
  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/group/settings',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const body = req.body;
      if (
        !isRecord(body) ||
        Object.keys(body).length !== 2 ||
        !['setting', 'enabled'].every((key) => key in body) ||
        (body.setting !== 'locked' && body.setting !== 'announce') ||
        typeof body.enabled !== 'boolean'
      )
        return reply.code(400).send({ success: false, error: 'Invalid group setting' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
        is_group: true,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Group conversation not found' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });

      const setting = body.setting;
      const enabled = body.enabled;
      const field = setting === 'locked' ? 'group_is_locked' : 'group_is_announce';
      try {
        await whatsappGatewayRequest<unknown>(
          setting === 'locked' ? '/group/locked' : '/group/announce',
          {
            method: 'POST',
            deviceId: account.gateway_device_id,
            contentType: 'application/json',
            body: JSON.stringify({
              group_id: conversation.jid,
              [setting]: enabled,
            }),
          }
        );
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp group setting update failed'
        );
        return reply
          .code(502)
          .send({ success: false, error: 'Group setting could not be confirmed' });
      }
      const now = new Date().toISOString();
      await app
        .db('whatsapp_conversations')
        .where({ id: conversationId, company_id: companyId, is_group: true })
        .update({ [field]: enabled, group_metadata_synced_at: now, write_date: now });
      await recordWhatsAppAudit(
        req,
        'whatsapp.conversation',
        `group_${setting}_${enabled ? 'enabled' : 'disabled'}`,
        conversationId,
        companyId
      );
      return reply.send({ success: true, data: { setting, enabled } });
    }
  );

  app.post<{ Params: Params & { action: string }; Body: unknown }>(
    '/whatsapp/conversations/:id/group/participants/:action',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const groupActions = ['add', 'remove', 'promote', 'demote'] as const;
      if (!(groupActions as readonly string[]).includes(req.params.action))
        return reply.code(404).send({ success: false, error: 'Group action not found' });
      const action = req.params.action as (typeof groupActions)[number];
      const body = isRecord(req.body) ? req.body : null;
      const rawParticipants = body?.participants;
      if (
        !body ||
        Object.keys(body).some((key) => key !== 'participants') ||
        !Array.isArray(rawParticipants) ||
        rawParticipants.length < 1 ||
        rawParticipants.length > 100 ||
        rawParticipants.some((participant) => typeof participant !== 'string')
      )
        return reply.code(400).send({
          success: false,
          error: 'Provide 1–100 participant phone numbers',
        });

      const participants: string[] = [];
      for (const raw of rawParticipants as string[]) {
        const compactPhone = raw.trim().replace(/[\s().-]/gu, '');
        const phone = compactPhone.startsWith('+') ? compactPhone.slice(1) : compactPhone;
        const parsed = /^\d+$/u.test(phone) ? parsePhoneNumberFromString(`+${phone}`) : undefined;
        if (!/^[1-9]\d{7,14}$/u.test(phone) || !parsed?.isValid())
          return reply
            .code(400)
            .send({ success: false, error: 'A participant phone number is invalid' });
        participants.push(parsed.number.slice(1));
      }
      if (new Set(participants).size !== participants.length)
        return reply
          .code(400)
          .send({ success: false, error: 'Participant phone numbers must be unique' });

      const idempotencyHeader = req.headers['idempotency-key'];
      const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : '';
      if (!/^[\x21-\x7e]{16,128}$/u.test(idempotencyKey))
        return reply
          .code(400)
          .send({ success: false, error: 'A valid Idempotency-Key header is required' });
      const idempotencyHash = createHash('sha256').update(idempotencyKey).digest('hex');
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ conversationId, action, participants }))
        .digest('hex');
      const existing = await WhatsappGroupOperation.query().findOne({
        company_id: companyId,
        idempotency_key: idempotencyHash,
      });
      if (existing) {
        if (existing.request_hash !== requestHash)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency-Key was used for a different request' });
        if (existing.status === 'completed') {
          let results: unknown;
          try {
            results = JSON.parse(existing.result_json ?? '[]');
          } catch {
            results = [];
          }
          return reply.send({
            success: true,
            data: { status: 'completed', results },
            replayed: true,
          });
        }
        return reply.code(409).send({
          success: false,
          error:
            existing.status === 'failed'
              ? 'This group action failed; use a new request key after checking group details'
              : 'Group action result is unresolved; refresh group details before taking another action',
        });
      }

      const [conversation] = await app
        .db('whatsapp_conversations')
        .where({ id: conversationId, company_id: companyId, is_group: true })
        .select('id', 'account_id', 'jid');
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Group conversation not found' });
      const unresolvedOperations = await WhatsappGroupOperation.query()
        .where({ company_id: companyId, conversation_id: conversationId })
        .whereIn('status', ['started', 'unknown']);
      const requestedNumbers = new Set(participants);
      const overlapsUnresolved = unresolvedOperations.some((operation) => {
        if (operation.action === 'leave') return true;
        try {
          const prior: unknown = JSON.parse(operation.participants_json);
          return Array.isArray(prior) && prior.some((phone) => requestedNumbers.has(String(phone)));
        } catch {
          return true;
        }
      });
      if (overlapsUnresolved)
        return reply.code(409).send({
          success: false,
          error: 'A previous group action is unresolved; refresh group details before retrying',
        });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });

      let operationId: number;
      try {
        const operation = await WhatsappGroupOperation.query().insert({
          company_id: companyId,
          conversation_id: conversationId,
          idempotency_key: idempotencyHash,
          request_hash: requestHash,
          action,
          participants_json: JSON.stringify(participants),
          status: 'started',
        });
        operationId = Number(operation.id);
      } catch (error) {
        const raced = await WhatsappGroupOperation.query().findOne({
          company_id: companyId,
          idempotency_key: idempotencyHash,
        });
        if (!raced) throw error;
        if (raced.request_hash !== requestHash)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency-Key was used for a different request' });
        return reply.code(409).send({
          success: false,
          error:
            'Group action result is unresolved; refresh group details before taking another action',
        });
      }

      const upstreamPath =
        action === 'add' ? '/group/participants' : `/group/participants/${action}`;
      try {
        const results = await whatsappGatewayRequest<unknown>(upstreamPath, {
          method: 'POST',
          deviceId: account.gateway_device_id,
          contentType: 'application/json',
          body: JSON.stringify({ group_id: conversation.jid, participants }),
        });
        const confirmed =
          Array.isArray(results) &&
          results.length === participants.length &&
          results.every((item) => isRecord(item) && item.status === 'success');
        if (!confirmed) {
          await WhatsappGroupOperation.query()
            .where({ id: operationId })
            .patch({ status: 'unknown' });
          await recordWhatsAppAudit(
            req,
            'whatsapp.conversation',
            `group_participants_${action}_unknown`,
            conversationId,
            companyId
          );
          return reply.code(502).send({
            success: false,
            error:
              'Group action result could not be confirmed; refresh group details before retrying',
          });
        }
        const safeResults = results.map((item) => ({
          participant: typeof item.participant === 'string' ? item.participant : null,
          status: 'success',
        }));
        await app.db.transaction(async (trx) => {
          await WhatsappGroupOperation.query(trx)
            .where({ id: operationId })
            .patch({
              status: 'completed',
              result_json: JSON.stringify(safeResults),
            });
          await trx('whatsapp_conversations')
            .where({ id: conversationId, company_id: companyId, is_group: true })
            .update({ group_metadata_synced_at: null, write_date: new Date().toISOString() });
          await recordWhatsAppAudit(
            req,
            'whatsapp.conversation',
            `group_participants_${action}`,
            conversationId,
            companyId,
            trx
          );
        });
        return reply.send({ success: true, data: { status: 'completed', results: safeResults } });
      } catch (error) {
        const definitelyRejected =
          error instanceof GowaError && error.statusCode >= 400 && error.statusCode < 500;
        await WhatsappGroupOperation.query()
          .where({ id: operationId })
          .patch({ status: definitelyRejected ? 'failed' : 'unknown' });
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          `group_participants_${action}_${definitelyRejected ? 'failed' : 'unknown'}`,
          conversationId,
          companyId
        );
        req.log.warn({ error: whatsappLogErrorContext(error) }, 'WhatsApp group action failed');
        return reply.code(502).send({
          success: false,
          error: definitelyRejected
            ? 'WhatsApp rejected the group action'
            : 'Group action result is unknown; refresh group details before retrying',
        });
      }
    }
  );

  app.get<{ Params: Params }>(
    '/whatsapp/conversations/:id/group/invite-link',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const [conversation] = await app
        .db('whatsapp_conversations')
        .where({ id: conversationId, company_id: companyId, is_group: true })
        .select('jid');
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Group conversation not found' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        const groupId = encodeURIComponent(String(conversation.jid));
        const result = await whatsappGatewayRequest<unknown>(
          `/group/invite-link?group_id=${groupId}`,
          {
            deviceId: account.gateway_device_id,
          }
        );
        const value = isRecord(result) && isRecord(result.results) ? result.results : result;
        const inviteLink = isRecord(value) ? value.invite_link : null;
        if (typeof inviteLink !== 'string')
          return reply
            .code(502)
            .send({ success: false, error: 'WhatsApp returned an invalid invite link' });
        const parsed = new URL(inviteLink);
        if (
          parsed.protocol !== 'https:' ||
          parsed.hostname !== 'chat.whatsapp.com' ||
          parsed.username ||
          parsed.password ||
          !/^\/[A-Za-z0-9_-]{8,}$/u.test(parsed.pathname)
        )
          return reply
            .code(502)
            .send({ success: false, error: 'WhatsApp returned an invalid invite link' });
        return reply.send({ success: true, data: { invite_link: parsed.toString() } });
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp group invite link failed'
        );
        return reply
          .code(502)
          .send({ success: false, error: 'Group invite link could not be loaded' });
      }
    }
  );

  app.post<{ Params: Params }>(
    '/whatsapp/conversations/:id/group/invite-link/reset',
    whatsappRateLimit(3),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const [conversation] = await app
        .db('whatsapp_conversations')
        .where({ id: conversationId, company_id: companyId, is_group: true })
        .select('jid');
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Group conversation not found' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        const groupId = encodeURIComponent(String(conversation.jid));
        const result = await whatsappGatewayRequest<unknown>(
          `/group/invite-link?group_id=${groupId}&reset=true`,
          { deviceId: account.gateway_device_id }
        );
        const value = isRecord(result) && isRecord(result.results) ? result.results : result;
        const inviteLink = isRecord(value) ? value.invite_link : null;
        if (typeof inviteLink !== 'string')
          return reply
            .code(502)
            .send({ success: false, error: 'WhatsApp returned an invalid invite link' });
        const parsed = new URL(inviteLink);
        if (
          parsed.protocol !== 'https:' ||
          parsed.hostname !== 'chat.whatsapp.com' ||
          parsed.username ||
          parsed.password ||
          !/^\/[A-Za-z0-9_-]{8,}$/u.test(parsed.pathname)
        )
          return reply
            .code(502)
            .send({ success: false, error: 'WhatsApp returned an invalid invite link' });
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          'group_invite_link_reset',
          conversationId,
          companyId
        );
        return reply.send({ success: true, data: { invite_link: parsed.toString() } });
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp group invite link reset failed'
        );
        return reply
          .code(502)
          .send({ success: false, error: 'Group invite link could not be reset' });
      }
    }
  );

  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/group/leave',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const body = isRecord(req.body) ? req.body : {};
      if (Object.keys(body).length > 0)
        return reply
          .code(400)
          .send({ success: false, error: 'This action does not accept a body' });
      const rawKey = req.headers['idempotency-key'];
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!/^[\x21-\x7e]{16,128}$/u.test(key))
        return reply
          .code(400)
          .send({ success: false, error: 'A valid Idempotency-Key header is required' });
      const idempotencyHash = createHash('sha256').update(key).digest('hex');
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ conversationId, action: 'leave' }))
        .digest('hex');
      const existing = await WhatsappGroupOperation.query().findOne({
        company_id: companyId,
        idempotency_key: idempotencyHash,
      });
      if (existing) {
        if (existing.request_hash !== requestHash)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency-Key was used for a different request' });
        if (existing.status === 'completed')
          return reply.send({ success: true, data: { left: true }, replayed: true });
        return reply.code(409).send({
          success: false,
          error:
            existing.status === 'failed'
              ? 'WhatsApp rejected leaving the group; refresh group details before retrying'
              : 'Leave result is unresolved; refresh group details before another action',
        });
      }
      const [conversation] = await app
        .db('whatsapp_conversations')
        .where({ id: conversationId, company_id: companyId, is_group: true })
        .select('jid');
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Group conversation not found' });
      const pending = await WhatsappGroupOperation.query()
        .where({ company_id: companyId, conversation_id: conversationId })
        .whereIn('status', ['started', 'unknown']);
      if (pending.length > 0)
        return reply.code(409).send({
          success: false,
          error: 'A previous group action is unresolved; refresh group details first',
        });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });

      let operationId: number;
      try {
        const operation = await WhatsappGroupOperation.query().insert({
          company_id: companyId,
          conversation_id: conversationId,
          idempotency_key: idempotencyHash,
          request_hash: requestHash,
          action: 'leave',
          participants_json: '[]',
          status: 'started',
        });
        operationId = Number(operation.id);
      } catch (error) {
        const raced = await WhatsappGroupOperation.query().findOne({
          company_id: companyId,
          idempotency_key: idempotencyHash,
        });
        if (raced?.request_hash === requestHash)
          return reply.code(409).send({
            success: false,
            error: 'Leave result is unresolved; refresh group details first',
          });
        if (raced)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency-Key was used for a different request' });
        throw error;
      }
      try {
        await whatsappGatewayRequest<unknown>('/group/leave', {
          method: 'POST',
          deviceId: account.gateway_device_id,
          contentType: 'application/json',
          body: JSON.stringify({ group_id: conversation.jid }),
        });
        await app.db.transaction(async (trx) => {
          await WhatsappGroupOperation.query(trx)
            .where({ id: operationId })
            .patch({ status: 'completed', result_json: JSON.stringify({ left: true }) });
          await trx('whatsapp_conversations')
            .where({ id: conversationId, company_id: companyId, is_group: true })
            .update({ is_archived: true, write_date: new Date().toISOString() });
          await recordWhatsAppAudit(
            req,
            'whatsapp.conversation',
            'group_leave_completed',
            conversationId,
            companyId,
            trx
          );
        });
        return reply.send({ success: true, data: { left: true } });
      } catch (error) {
        const rejected =
          error instanceof GowaError && error.statusCode >= 400 && error.statusCode < 500;
        await WhatsappGroupOperation.query()
          .where({ id: operationId })
          .patch({ status: rejected ? 'failed' : 'unknown' });
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          `group_leave_${rejected ? 'failed' : 'unknown'}`,
          conversationId,
          companyId
        );
        req.log.warn({ error: whatsappLogErrorContext(error) }, 'WhatsApp leave group failed');
        return reply.code(502).send({
          success: false,
          error: rejected
            ? 'WhatsApp rejected the leave request'
            : 'Leave result is unknown; refresh group details before retrying',
        });
      }
    }
  );
}
