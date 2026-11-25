import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import {
  WhatsappAccount,
  WhatsappConversation,
  WhatsappGroupCreation,
  WhatsappGroupJoin,
  WhatsappGroupOperation,
} from '../models.js';
import { isRecord } from '@moonwitness/types';
import { sniffMime } from '../runtime/media.js';
import { GowaError } from '../runtime/gowa-client.js';
import { whatsappGatewayRequest } from '../runtime/gateway.js';
import parsePhoneNumberFromString from 'libphonenumber-js/max';
import { whatsappLogErrorContext } from '../runtime/log-redaction.js';
import {
  id,
  parseGroupInviteLink,
  readBoundedAvatar,
  recordWhatsAppAudit,
  requireCompany,
  requireWhatsAppAction,
  stripControlAndBidiChars,
  trustedWhatsAppAvatarUrl,
  whatsappRateLimit,
  type WhatsappRouteParams,
} from '../runtime/route-helpers.js';
import type { WhatsappRouteOptions } from '../runtime/route-helpers.js';

type Params = WhatsappRouteParams;

export function registerWhatsAppGroupRoutes(
  app: FastifyInstance,
  options: WhatsappRouteOptions
): void {
  app.post<{ Body: unknown }>(
    '/whatsapp/groups/invite-preview',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'create')) return;
      const body = isRecord(req.body) ? req.body : null;
      const link = parseGroupInviteLink(body?.link);
      if (!body || Object.keys(body).some((key) => key !== 'link') || !link)
        return reply
          .code(400)
          .send({ success: false, error: 'Enter a valid WhatsApp group invite link' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        const result = await whatsappGatewayRequest<unknown>(
          `/group/info-from-link?link=${encodeURIComponent(link)}`,
          { deviceId: account.gateway_device_id }
        );
        const info = isRecord(result) && isRecord(result.results) ? result.results : result;
        if (
          !isRecord(info) ||
          typeof info.group_id !== 'string' ||
          !/^[^\s@]{1,200}@g\.us$/u.test(info.group_id)
        )
          return reply
            .code(502)
            .send({ success: false, error: 'WhatsApp returned invalid group details' });
        const name =
          typeof info.name === 'string'
            ? stripControlAndBidiChars(info.name).trim().slice(0, 255)
            : '';
        const topicValue =
          typeof info.topic === 'string'
            ? stripControlAndBidiChars(info.topic, true).slice(0, 4000)
            : '';
        const participantCount = Number(info.participant_count);
        return reply.send({
          success: true,
          data: {
            name: name || 'WhatsApp group',
            topic: topicValue || null,
            participant_count:
              Number.isSafeInteger(participantCount) && participantCount >= 0
                ? Math.min(participantCount, 100_000)
                : null,
          },
        });
      } catch (error) {
        req.log.warn({ error: whatsappLogErrorContext(error) }, 'WhatsApp invite preview failed');
        return reply
          .code(502)
          .send({ success: false, error: 'Group invite details could not be loaded' });
      }
    }
  );

  app.post<{ Body: unknown }>(
    '/whatsapp/groups/join',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'create')) return;
      const body = isRecord(req.body) ? req.body : null;
      const link = parseGroupInviteLink(body?.link);
      if (!body || Object.keys(body).some((key) => key !== 'link') || !link)
        return reply
          .code(400)
          .send({ success: false, error: 'Enter a valid WhatsApp group invite link' });
      const rawKey = req.headers['idempotency-key'];
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!/^[\x21-\x7e]{16,128}$/u.test(key))
        return reply
          .code(400)
          .send({ success: false, error: 'A valid Idempotency-Key header is required' });
      const idempotencyHash = createHash('sha256').update(key).digest('hex');
      const requestHash = createHash('sha256').update(link).digest('hex');
      const existing = await WhatsappGroupJoin.query().findOne({
        company_id: companyId,
        idempotency_key: idempotencyHash,
      });
      if (existing) {
        if (existing.request_hash !== requestHash)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency-Key was used for a different request' });
        if (existing.status === 'completed' && existing.group_jid) {
          const conversation = await WhatsappConversation.query().findOne({
            company_id: companyId,
            jid: existing.group_jid,
            is_group: true,
          });
          if (conversation)
            return reply.send({ success: true, data: conversation, replayed: true });
        }
        if (existing.status === 'unknown' && existing.group_jid) {
          const account = await WhatsappAccount.query().findOne({ company_id: companyId });
          if (account?.status === 'connected' && account.gateway_device_id) {
            try {
              await whatsappGatewayRequest<unknown>(
                `/group/participants?group_id=${encodeURIComponent(existing.group_jid)}`,
                { deviceId: account.gateway_device_id }
              );
              const [conversation] = await app.db.transaction(async (trx) => {
                const [joined] = await trx('whatsapp_conversations')
                  .insert({
                    company_id: companyId,
                    account_id: account.id,
                    jid: existing.group_jid,
                    name: existing.group_name || 'WhatsApp group',
                    is_group: true,
                    unread_count: 0,
                    write_date: new Date().toISOString(),
                  })
                  .onConflict(['company_id', 'jid'])
                  .merge({
                    name: existing.group_name || 'WhatsApp group',
                    is_group: true,
                    write_date: new Date().toISOString(),
                  })
                  .returning('*');
                await WhatsappGroupJoin.query(trx)
                  .where({ id: existing.id })
                  .patch({ status: 'completed' });
                await recordWhatsAppAudit(
                  req,
                  'whatsapp.conversation',
                  'group_join_reconciled',
                  Number(joined.id),
                  companyId,
                  trx
                );
                return [joined];
              });
              return reply.send({ success: true, data: conversation, replayed: true });
            } catch {
              // The original result remains unresolved; do not issue another join call.
            }
          }
        }
        return reply.code(409).send({
          success: false,
          error:
            existing.status === 'failed'
              ? 'WhatsApp rejected joining this group; use a new request key after checking the link'
              : 'Group join result is unresolved; retry with the same request key to check safely',
        });
      }
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      let info: Record<string, unknown>;
      try {
        const result = await whatsappGatewayRequest<unknown>(
          `/group/info-from-link?link=${encodeURIComponent(link)}`,
          { deviceId: account.gateway_device_id }
        );
        const value = isRecord(result) && isRecord(result.results) ? result.results : result;
        if (
          !isRecord(value) ||
          typeof value.group_id !== 'string' ||
          !/^[^\s@]{1,200}@g\.us$/u.test(value.group_id)
        )
          return reply
            .code(502)
            .send({ success: false, error: 'WhatsApp returned invalid group details' });
        info = value;
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp group join preview failed'
        );
        return reply
          .code(502)
          .send({ success: false, error: 'Group invite details could not be loaded' });
      }
      const groupJid = typeof info.group_id === 'string' ? info.group_id : '';
      const name =
        typeof info.name === 'string'
          ? stripControlAndBidiChars(info.name).trim().slice(0, 255)
          : 'WhatsApp group';
      const topic =
        typeof info.topic === 'string'
          ? stripControlAndBidiChars(info.topic, true).slice(0, 4000)
          : null;
      const reportedParticipantCount = Number(info.participant_count);
      const participantCount = Number.isSafeInteger(reportedParticipantCount)
        ? Math.max(0, Math.min(reportedParticipantCount, 100_000))
        : null;
      let joinId: number;
      try {
        const operation = await WhatsappGroupJoin.query().insert({
          company_id: companyId,
          idempotency_key: idempotencyHash,
          request_hash: requestHash,
          group_jid: groupJid,
          group_name: name || 'WhatsApp group',
          status: 'started',
        });
        joinId = Number(operation.id);
      } catch (error) {
        const raced = await WhatsappGroupJoin.query().findOne({
          company_id: companyId,
          idempotency_key: idempotencyHash,
        });
        if (raced)
          return reply.code(409).send({
            success: false,
            error:
              'Group join result is unresolved; retry with the same request key to check safely',
          });
        throw error;
      }
      try {
        await whatsappGatewayRequest<unknown>('/group/join-with-link', {
          method: 'POST',
          deviceId: account.gateway_device_id,
          contentType: 'application/json',
          body: JSON.stringify({ link }),
        });
        const now = new Date().toISOString();
        const conversation = await app.db.transaction(async (trx) => {
          const [joined] = await trx('whatsapp_conversations')
            .insert({
              company_id: companyId,
              account_id: account.id,
              jid: groupJid,
              name: name || 'WhatsApp group',
              group_topic: topic,
              group_participant_count: participantCount,
              is_group: true,
              unread_count: 0,
              write_date: now,
            })
            .onConflict(['company_id', 'jid'])
            .merge({
              name: name || 'WhatsApp group',
              group_topic: topic,
              group_participant_count: participantCount,
              is_group: true,
              is_archived: false,
              write_date: now,
            })
            .returning('*');
          await WhatsappGroupJoin.query(trx).where({ id: joinId }).patch({ status: 'completed' });
          await recordWhatsAppAudit(
            req,
            'whatsapp.conversation',
            'group_join',
            Number(joined.id),
            companyId,
            trx
          );
          return joined;
        });
        return reply.code(201).send({
          success: true,
          data: { ...conversation, is_group: Boolean(conversation.is_group) },
        });
      } catch (error) {
        const rejected =
          error instanceof GowaError && error.statusCode >= 400 && error.statusCode < 500;
        await WhatsappGroupJoin.query()
          .where({ id: joinId })
          .patch({ status: rejected ? 'failed' : 'unknown' });
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          rejected ? 'group_join_failed' : 'group_join_unknown',
          joinId,
          companyId
        );
        req.log.warn({ error: whatsappLogErrorContext(error) }, 'WhatsApp group join failed');
        return reply.code(502).send({
          success: false,
          error: rejected
            ? 'WhatsApp rejected the group join'
            : 'Group join result is unknown; retry with the same request key to check safely',
        });
      }
    }
  );

  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/groups',
    whatsappRateLimit(5),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'create')) return;
      const body = isRecord(req.body) ? req.body : null;
      const title = typeof body?.title === 'string' ? body.title.trim() : '';
      const rawParticipants = body?.participants;
      if (
        !body ||
        Object.keys(body).some((key) => !['title', 'participants'].includes(key)) ||
        !title ||
        title.length > 25 ||
        !Array.isArray(rawParticipants) ||
        rawParticipants.length < 1 ||
        rawParticipants.length > 100 ||
        rawParticipants.some((participant) => typeof participant !== 'string')
      )
        return reply.code(400).send({
          success: false,
          error: 'Enter a group name up to 25 characters and 1–100 participant phone numbers',
        });

      const participantNumbers: string[] = [];
      for (const rawParticipant of rawParticipants as string[]) {
        const compactPhone = rawParticipant.trim().replace(/[\s().-]/gu, '');
        const phone = compactPhone.startsWith('+') ? compactPhone.slice(1) : compactPhone;
        const parsed = /^\d+$/u.test(phone) ? parsePhoneNumberFromString(`+${phone}`) : undefined;
        if (!/^[1-9]\d{7,14}$/u.test(phone) || !parsed?.isValid())
          return reply
            .code(400)
            .send({ success: false, error: 'A participant phone number is invalid' });
        participantNumbers.push(parsed.number.slice(1));
      }
      if (new Set(participantNumbers).size !== participantNumbers.length)
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
        .update(JSON.stringify({ title, participants: participantNumbers }))
        .digest('hex');
      const existing = await WhatsappGroupCreation.query().findOne({
        company_id: companyId,
        idempotency_key: idempotencyHash,
      });
      if (existing) {
        if (existing.request_hash !== requestHash)
          return reply
            .code(409)
            .send({ success: false, error: 'Idempotency-Key was used for a different request' });
        if (existing.group_jid && existing.status !== 'failed') {
          let conversation = await WhatsappConversation.query().findOne({
            company_id: companyId,
            jid: existing.group_jid,
            is_group: true,
          });
          if (!conversation && existing.status === 'unknown') {
            const account = await WhatsappAccount.query().findOne({ company_id: companyId });
            if (account) {
              conversation = await app.db.transaction(async (trx) => {
                const [recovered] = await trx('whatsapp_conversations')
                  .insert({
                    company_id: companyId,
                    account_id: account.id,
                    jid: existing.group_jid,
                    name: title,
                    is_group: true,
                    group_participant_count: participantNumbers.length + 1,
                    unread_count: 0,
                    write_date: new Date().toISOString(),
                  })
                  .onConflict(['company_id', 'jid'])
                  .merge({ name: title, is_group: true, write_date: new Date().toISOString() })
                  .returning('*');
                await WhatsappGroupCreation.query(trx).where({ id: existing.id }).patch({
                  status: 'completed',
                });
                await recordWhatsAppAudit(
                  req,
                  'whatsapp.conversation',
                  'group_create_reconciled',
                  Number(recovered.id),
                  companyId,
                  trx
                );
                return recovered;
              });
            }
          }
          if (conversation)
            return reply.send({ success: true, data: conversation, replayed: true });
        }
        return reply.code(409).send({
          success: false,
          error:
            existing.status === 'failed'
              ? 'This group creation failed; use a new idempotency key to retry'
              : 'Group creation is unresolved; check the inbox before retrying',
        });
      }

      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });

      let creationId: number;
      try {
        const creation = await WhatsappGroupCreation.query().insert({
          company_id: companyId,
          idempotency_key: idempotencyHash,
          request_hash: requestHash,
          status: 'started',
        });
        creationId = Number(creation.id);
      } catch (error) {
        const raced = await WhatsappGroupCreation.query().findOne({
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
          error: 'Group creation is unresolved; check the inbox before retrying',
        });
      }

      try {
        const result = await whatsappGatewayRequest<{ group_id?: unknown }>('/group', {
          method: 'POST',
          deviceId: account.gateway_device_id,
          contentType: 'application/json',
          body: JSON.stringify({ title, participants: participantNumbers }),
        });
        const groupJid = typeof result.group_id === 'string' ? result.group_id : '';
        if (!/^[^\s@]{1,200}@g\.us$/u.test(groupJid)) {
          await WhatsappGroupCreation.query()
            .where({ id: creationId })
            .patch({ status: 'unknown' });
          await recordWhatsAppAudit(
            req,
            'whatsapp.group.creation',
            'group_create_unknown',
            creationId,
            companyId
          );
          return reply
            .code(502)
            .send({ success: false, error: 'Group creation result could not be confirmed' });
        }
        await WhatsappGroupCreation.query().where({ id: creationId }).patch({
          status: 'unknown',
          group_jid: groupJid,
        });
        const now = new Date().toISOString();
        const conversation = await app.db.transaction(async (trx) => {
          const [created] = await trx('whatsapp_conversations')
            .insert({
              company_id: companyId,
              account_id: account.id,
              jid: groupJid,
              name: title,
              is_group: true,
              group_participant_count: participantNumbers.length + 1,
              unread_count: 0,
              write_date: now,
            })
            .onConflict(['company_id', 'jid'])
            .merge({ name: title, is_group: true, write_date: now })
            .returning('*');
          await WhatsappGroupCreation.query(trx).where({ id: creationId }).patch({
            status: 'completed',
            group_jid: groupJid,
          });
          await recordWhatsAppAudit(
            req,
            'whatsapp.conversation',
            'group_create',
            Number(created.id),
            companyId,
            trx
          );
          return created;
        });
        return reply.code(201).send({
          success: true,
          data: { ...conversation, is_group: Boolean(conversation.is_group) },
        });
      } catch (error) {
        const definitelyRejected =
          error instanceof GowaError && error.statusCode >= 400 && error.statusCode < 500;
        await WhatsappGroupCreation.query()
          .where({ id: creationId })
          .patch({
            status: definitelyRejected ? 'failed' : 'unknown',
          });
        await recordWhatsAppAudit(
          req,
          'whatsapp.group.creation',
          definitelyRejected ? 'group_create_failed' : 'group_create_unknown',
          creationId,
          companyId
        );
        req.log.warn({ error: whatsappLogErrorContext(error) }, 'WhatsApp group creation failed');
        return reply.code(502).send({
          success: false,
          error: definitelyRejected
            ? 'WhatsApp rejected the group creation request'
            : 'Group creation could not be confirmed; check the inbox before retrying',
        });
      }
    }
  );

  app.get<{ Params: Params }>(
    '/whatsapp/conversations/:id/group',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const [conversation] = await app
        .db('whatsapp_conversations')
        .where({ id: conversationId, company_id: companyId, is_group: true })
        .select(
          'id',
          'account_id',
          'jid',
          'name',
          'group_topic',
          'group_participant_count',
          'group_participants_json',
          'group_metadata_synced_at',
          'group_is_locked',
          'group_is_announce',
          'group_is_ephemeral'
        );
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Group conversation not found' });
      const cleanProviderText = (value: string, max: number) =>
        stripControlAndBidiChars(value, true).slice(0, max);
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account?.gateway_device_id)
        return reply.code(503).send({ success: false, error: 'WhatsApp account is unavailable' });

      const storedParticipants = (): Array<{
        jid: string;
        phone_number: string | null;
        display_name: string | null;
        is_admin: boolean;
        is_super_admin: boolean;
      }> => {
        if (typeof conversation.group_participants_json !== 'string') return [];
        try {
          const value: unknown = JSON.parse(conversation.group_participants_json);
          if (!Array.isArray(value)) return [];
          return value.slice(0, 2000).flatMap((item) => {
            if (
              !isRecord(item) ||
              typeof item.jid !== 'string' ||
              !/^[^\s@\p{Cc}\p{Cf}]{1,200}@(s\.whatsapp\.net|lid)$/u.test(item.jid)
            )
              return [];
            return [
              {
                jid: item.jid,
                phone_number:
                  typeof item.phone_number === 'string' &&
                  /^[^\s@\p{Cc}\p{Cf}]{1,200}@s\.whatsapp\.net$/u.test(item.phone_number)
                    ? item.phone_number
                    : null,
                display_name:
                  typeof item.display_name === 'string'
                    ? cleanProviderText(item.display_name.trim(), 255) || null
                    : null,
                is_admin: item.is_admin === true,
                is_super_admin: item.is_super_admin === true,
              },
            ];
          });
        } catch {
          return [];
        }
      };
      const fallback = () => ({
        name: conversation.name,
        topic: conversation.group_topic ?? null,
        participant_count:
          conversation.group_participant_count === null ||
          conversation.group_participant_count === undefined
            ? null
            : Number(conversation.group_participant_count),
        participants: storedParticipants(),
        is_locked: conversation.group_is_locked ?? null,
        is_announce: conversation.group_is_announce ?? null,
        is_ephemeral: conversation.group_is_ephemeral ?? null,
        avatar_available: true,
        synced_at: conversation.group_metadata_synced_at ?? null,
        stale: true,
      });

      try {
        const groupId = encodeURIComponent(String(conversation.jid));
        const [info, participantResponse] = await Promise.all([
          whatsappGatewayRequest<Record<string, unknown>>(`/group/info?group_id=${groupId}`, {
            deviceId: account.gateway_device_id,
          }),
          whatsappGatewayRequest<Record<string, unknown>>(
            `/group/participants?group_id=${groupId}`,
            {
              deviceId: account.gateway_device_id,
            }
          ),
        ]);
        const infoResult = isRecord(info.results) ? info.results : info;
        const participantResult = isRecord(participantResponse.results)
          ? participantResponse.results
          : participantResponse;
        const rawParticipants = Array.isArray(participantResult.participants)
          ? participantResult.participants
          : [];
        const participants = rawParticipants.slice(0, 2000).flatMap((item) => {
          if (!isRecord(item)) return [];
          const jid =
            typeof item.jid === 'string'
              ? item.jid
              : typeof item.phone_number === 'string'
                ? item.phone_number
                : typeof item.JID === 'string'
                  ? item.JID
                  : '';
          if (!jid || !/^[^\s@\p{Cc}\p{Cf}]{1,200}@(s\.whatsapp\.net|lid)$/u.test(jid)) return [];
          const phone =
            typeof item.phone_number === 'string'
              ? item.phone_number
              : typeof item.PhoneNumber === 'string'
                ? item.PhoneNumber
                : null;
          const name =
            typeof item.display_name === 'string'
              ? item.display_name
              : typeof item.DisplayName === 'string'
                ? item.DisplayName
                : null;
          return [
            {
              jid,
              phone_number:
                phone && /^[^\s@\p{Cc}\p{Cf}]{1,200}@s\.whatsapp\.net$/u.test(phone) ? phone : null,
              display_name: name ? cleanProviderText(name.trim(), 255) || null : null,
              is_admin: item.is_admin === true || item.IsAdmin === true,
              is_super_admin: item.is_super_admin === true || item.IsSuperAdmin === true,
            },
          ];
        });
        const now = new Date().toISOString();
        const name =
          typeof infoResult.name === 'string'
            ? cleanProviderText(infoResult.name.trim(), 255)
            : typeof participantResult.name === 'string'
              ? cleanProviderText(participantResult.name.trim(), 255)
              : conversation.name;
        const topic =
          typeof infoResult.topic === 'string'
            ? cleanProviderText(infoResult.topic, 4000)
            : typeof infoResult.description === 'string'
              ? cleanProviderText(infoResult.description, 4000)
              : null;
        const reportedCount = Number(infoResult.participant_count);
        const count =
          Number.isSafeInteger(reportedCount) && reportedCount >= participants.length
            ? Math.min(reportedCount, 100_000)
            : participants.length;
        await app
          .db('whatsapp_conversations')
          .where({ id: conversationId, company_id: companyId, is_group: true })
          .update({
            name,
            group_topic: topic,
            group_participant_count: count,
            group_participants_json: JSON.stringify(participants),
            group_is_locked:
              typeof infoResult.is_locked === 'boolean' ? infoResult.is_locked : null,
            group_is_announce:
              typeof infoResult.is_announce === 'boolean' ? infoResult.is_announce : null,
            group_is_ephemeral:
              typeof infoResult.is_ephemeral === 'boolean' ? infoResult.is_ephemeral : null,
            group_metadata_synced_at: now,
            write_date: now,
          });
        const freshByPhone = new Map(
          participants.flatMap((participant) => {
            const address = participant.phone_number ?? participant.jid;
            const match = address.match(/^([1-9]\d{7,14})@s\.whatsapp\.net$/u);
            return match ? [[match[1]!, participant] as const] : [];
          })
        );
        const pendingOperations = await WhatsappGroupOperation.query()
          .where({ company_id: companyId, conversation_id: conversationId })
          .whereIn('status', ['started', 'unknown']);
        for (const operation of pendingOperations) {
          let targets: unknown;
          try {
            targets = JSON.parse(operation.participants_json);
          } catch {
            continue;
          }
          if (!Array.isArray(targets)) continue;
          if (operation.action === 'leave') {
            const accountPhone = account.phone_number?.replace(/\D/gu, '') ?? '';
            if (!/^[1-9]\d{7,14}$/u.test(accountPhone)) continue;
            const left = !freshByPhone.has(accountPhone);
            await WhatsappGroupOperation.query()
              .where({ id: operation.id })
              .patch({
                status: left ? 'completed' : 'failed',
                result_json: JSON.stringify({ reconciled: true, left }),
              });
            if (left)
              await app
                .db('whatsapp_conversations')
                .where({ id: conversationId, company_id: companyId, is_group: true })
                .update({ is_archived: true, write_date: new Date().toISOString() });
            await recordWhatsAppAudit(
              req,
              'whatsapp.conversation',
              `group_leave_reconciled_${left ? 'completed' : 'failed'}`,
              conversationId,
              companyId
            );
            continue;
          }
          if (
            targets.length < 1 ||
            targets.some((phone) => typeof phone !== 'string' || !/^[1-9]\d{7,14}$/u.test(phone))
          )
            continue;
          const matched = targets.map((phone: string) => freshByPhone.get(phone));
          const allPresent = matched.every(Boolean);
          const nonePresent = matched.every((participant) => !participant);
          const allAdmins = allPresent && matched.every((participant) => participant?.is_admin);
          const allMembers = allPresent && matched.every((participant) => !participant?.is_admin);
          const achieved =
            (operation.action === 'add' && allPresent) ||
            (operation.action === 'remove' && nonePresent) ||
            (operation.action === 'promote' && allAdmins) ||
            (operation.action === 'demote' && allMembers);
          const notAchieved =
            (operation.action === 'add' && nonePresent) ||
            (operation.action === 'remove' && allPresent) ||
            (operation.action === 'promote' && allMembers) ||
            (operation.action === 'demote' && allAdmins);
          if (!achieved && !notAchieved) continue;
          await WhatsappGroupOperation.query()
            .where({ id: operation.id })
            .patch({
              status: achieved ? 'completed' : 'failed',
              result_json: JSON.stringify({ reconciled: true }),
            });
          await recordWhatsAppAudit(
            req,
            'whatsapp.conversation',
            `group_participants_${operation.action}_reconciled_${achieved ? 'completed' : 'failed'}`,
            conversationId,
            companyId
          );
        }
        const hasPendingGroupOperation = await WhatsappGroupOperation.query()
          .where({ company_id: companyId, conversation_id: conversationId })
          .whereIn('status', ['started', 'unknown'])
          .first();
        return reply.send({
          success: true,
          data: {
            name,
            topic,
            participant_count: count,
            participants,
            is_locked: typeof infoResult.is_locked === 'boolean' ? infoResult.is_locked : null,
            is_announce:
              typeof infoResult.is_announce === 'boolean' ? infoResult.is_announce : null,
            is_ephemeral:
              typeof infoResult.is_ephemeral === 'boolean' ? infoResult.is_ephemeral : null,
            avatar_available: true,
            synced_at: now,
            stale: false,
            pending_operation: Boolean(hasPendingGroupOperation),
          },
        });
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp group metadata refresh failed'
        );
        if (error instanceof GowaError && error.statusCode === 404) {
          const unresolvedLeaves = await WhatsappGroupOperation.query()
            .where({ company_id: companyId, conversation_id: conversationId, action: 'leave' })
            .whereIn('status', ['started', 'unknown']);
          if (unresolvedLeaves.length > 0) {
            await WhatsappGroupOperation.query()
              .whereIn(
                'id',
                unresolvedLeaves.map((operation) => operation.id)
              )
              .patch({
                status: 'completed',
                result_json: JSON.stringify({ reconciled: true, left: true }),
              });
            await app
              .db('whatsapp_conversations')
              .where({ id: conversationId, company_id: companyId, is_group: true })
              .update({ is_archived: true, write_date: new Date().toISOString() });
            await recordWhatsAppAudit(
              req,
              'whatsapp.conversation',
              'group_leave_reconciled_completed',
              conversationId,
              companyId
            );
            return reply.send({
              success: true,
              data: { ...fallback(), pending_operation: false, left: true },
            });
          }
        }
        if (
          conversation.group_metadata_synced_at ||
          conversation.group_participants_json ||
          conversation.group_topic
        ) {
          const pending = await WhatsappGroupOperation.query()
            .where({ company_id: companyId, conversation_id: conversationId })
            .whereIn('status', ['started', 'unknown'])
            .first();
          return reply.send({
            success: true,
            data: { ...fallback(), pending_operation: Boolean(pending) },
          });
        }
        return reply.code(502).send({ success: false, error: 'Group details could not be loaded' });
      }
    }
  );

  app.get<{ Params: Params }>(
    '/whatsapp/conversations/:id/group/avatar',
    whatsappRateLimit(30),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const conversation = await WhatsappConversation.query()
        .findOne({ id: conversationId, company_id: companyId })
        .select('id', 'company_id', 'jid', 'is_group', 'group_avatar_key');
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      if (!conversation.is_group || !/^\d[\d-]{4,79}@g\.us$/u.test(String(conversation.jid)))
        return reply.code(404).send({ success: false, error: 'Group avatar is unavailable' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account?.gateway_device_id)
        return reply.code(503).send({ success: false, error: 'WhatsApp account is unavailable' });
      const [avatarCache] = await app
        .db('whatsapp_conversations')
        .where({ id: conversationId, company_id: companyId, is_group: true })
        .select('group_avatar_picture_id', 'group_avatar_key');
      const sendCachedAvatar = async () => {
        if (typeof avatarCache?.group_avatar_key !== 'string') return null;
        const cached = await options.attachmentStorage.get(avatarCache.group_avatar_key);
        const mime = cached ? sniffMime(cached) : null;
        if (
          !cached ||
          !mime ||
          !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)
        )
          return null;
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          'group_avatar_access',
          conversationId,
          companyId
        );
        reply
          .header('content-type', mime)
          .header('content-length', String(cached.length))
          .header('content-disposition', 'inline')
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox; base-uri 'none'")
          .header('cache-control', 'private, max-age=300')
          .header('vary', 'Authorization, X-Company-Id')
          .send(cached);
        return true;
      };
      try {
        const avatar = await whatsappGatewayRequest<{ url?: unknown; id?: unknown }>(
          `/user/avatar?phone=${encodeURIComponent(String(conversation.jid))}&is_preview=true&is_community=true`,
          { deviceId: account.gateway_device_id }
        );
        const avatarUrl = trustedWhatsAppAvatarUrl(avatar.url);
        const pictureId = typeof avatar.id === 'string' ? avatar.id.slice(0, 255) : null;
        if (pictureId && avatarCache?.group_avatar_picture_id === pictureId) {
          const cached = await sendCachedAvatar();
          if (cached) return cached;
        }
        if (typeof avatar.url === 'string' && avatar.url.length > 0 && !avatarUrl)
          return reply.code(404).send({ success: false, error: 'Group avatar is unavailable' });
        if (!avatarUrl) {
          const cached = await sendCachedAvatar();
          if (cached) return cached;
          return reply.code(404).send({ success: false, error: 'Group avatar is unavailable' });
        }
        const fetchAvatar = options.fetchContactAvatar ?? globalThis.fetch.bind(globalThis);
        const response = await fetchAvatar(avatarUrl, {
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return reply.code(response.status === 404 ? 404 : 502).send({
            success: false,
            error: 'Group avatar could not be loaded',
          });
        }
        const bytes = await readBoundedAvatar(response);
        const mime = sniffMime(bytes);
        if (!mime || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime))
          return reply.code(502).send({ success: false, error: 'Group avatar is invalid' });
        if (pictureId) {
          const newKey = randomUUID();
          await options.attachmentStorage.put(newKey, bytes);
          try {
            await app
              .db('whatsapp_conversations')
              .where({ id: conversationId, company_id: companyId, is_group: true })
              .update({ group_avatar_picture_id: pictureId, group_avatar_key: newKey });
          } catch (error) {
            await options.attachmentStorage.delete(newKey).catch(() => undefined);
            throw error;
          }
          if (
            typeof avatarCache?.group_avatar_key === 'string' &&
            avatarCache.group_avatar_key !== newKey
          )
            await options.attachmentStorage
              .delete(avatarCache.group_avatar_key)
              .catch((error: unknown) => {
                req.log.warn(
                  { error: whatsappLogErrorContext(error) },
                  'Stale WhatsApp group avatar cleanup failed'
                );
              });
        }
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          'group_avatar_access',
          conversationId,
          companyId
        );
        return reply
          .header('content-type', mime)
          .header('content-length', String(bytes.length))
          .header('content-disposition', 'inline')
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox; base-uri 'none'")
          .header('cache-control', 'private, max-age=300')
          .header('vary', 'Authorization, X-Company-Id')
          .send(bytes);
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp group avatar fetch failed'
        );
        const cached = await sendCachedAvatar();
        if (cached) return cached;
        return reply.code(502).send({ success: false, error: 'Group avatar could not be loaded' });
      }
    }
  );
}
