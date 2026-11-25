import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { WhatsappAccount, WhatsappConversation } from '../models.js';
import { isRecord } from '@moonwitness/types';
import { safeMime, sniffMime } from '../runtime/media.js';
import { whatsappGatewayRequest } from '../runtime/gateway.js';
import parsePhoneNumberFromString from 'libphonenumber-js/max';
import { whatsappLogErrorContext } from '../runtime/log-redaction.js';
import {
  classifyGoWaMessageType,
  id,
  INBOX_SYNC_MAX_MESSAGES_PER_POLL,
  INBOX_SYNC_PAGE_SIZE,
  mediaDefaultMime,
  providerTimestamp,
  readBoundedAvatar,
  recordWhatsAppAudit,
  requireCompany,
  requireWhatsAppAction,
  trustedWhatsAppAvatarUrl,
  whatsappRateLimit,
  type WhatsappRouteParams,
} from '../runtime/route-helpers.js';
import type { WhatsappRouteOptions } from '../runtime/route-helpers.js';

type Params = WhatsappRouteParams;

export function registerWhatsAppConversationRoutes(
  app: FastifyInstance,
  options: WhatsappRouteOptions
): void {
  app.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      search?: string;
      archived?: string;
      unread?: string;
      label_id?: string;
      queue?: string;
      team_id?: string;
      work_state?: string;
    };
  }>('/whatsapp/conversations', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const archived = req.query.archived === 'true';
    const unreadOnly = req.query.unread === 'true';
    const labelId = req.query.label_id === undefined ? undefined : id(req.query.label_id);
    const teamId = req.query.team_id === undefined ? undefined : id(req.query.team_id);
    const queue = req.query.queue ?? 'all';
    const workState = req.query.work_state ?? 'all';
    if (req.query.archived !== undefined && !['true', 'false'].includes(req.query.archived)) {
      return reply.code(400).send({ success: false, error: 'Archived must be true or false' });
    }
    if (req.query.unread !== undefined && !['true', 'false'].includes(req.query.unread)) {
      return reply.code(400).send({ success: false, error: 'Unread must be true or false' });
    }
    if (req.query.label_id !== undefined && !labelId) {
      return reply.code(400).send({ success: false, error: 'Invalid label ID' });
    }
    if (!['all', 'mine', 'unassigned'].includes(queue)) {
      return reply.code(400).send({ success: false, error: 'Invalid queue filter' });
    }
    if (req.query.team_id !== undefined && !teamId) {
      return reply.code(400).send({ success: false, error: 'Invalid team ID' });
    }
    if (!['all', 'open', 'closed'].includes(workState)) {
      return reply.code(400).send({ success: false, error: 'Invalid work state' });
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return reply.code(400).send({ success: false, error: 'Limit must be between 1 and 100' });
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
      return reply.code(400).send({ success: false, error: 'Offset must be between 0 and 10000' });
    }
    if (search.length > 100) {
      return reply
        .code(400)
        .send({ success: false, error: 'Search must be 100 characters or fewer' });
    }
    const account = await WhatsappAccount.query().findOne({ company_id: companyId });
    if (!account?.gateway_device_id) return { success: true, data: [] };
    const providerLimit = offset === 0 ? Math.max(100, limit) : limit;
    const upstream = await whatsappGatewayRequest<{ data?: Array<Record<string, unknown>> }>(
      `/chats?limit=${providerLimit}&offset=${offset}&archived=${archived}`,
      { deviceId: account.gateway_device_id }
    );
    const chats = new Map((upstream.data ?? []).map((chat) => [chat.jid, chat]));
    if (search) {
      const matchingChats = await whatsappGatewayRequest<{ data?: Array<Record<string, unknown>> }>(
        `/chats?limit=100&offset=0&archived=${archived}&search=${encodeURIComponent(search)}`,
        { deviceId: account.gateway_device_id }
      );
      for (const chat of matchingChats.data ?? []) chats.set(chat.jid, chat);
    }
    const primaryChats = [...(upstream.data ?? [])].slice(0, limit);
    const primaryJids = primaryChats
      .map((chat) => (typeof chat.jid === 'string' ? chat.jid : ''))
      .filter((jid) => /^[^\s@]{1,200}@(s\.whatsapp\.net|g\.us|lid)$/u.test(jid));
    const existingPreviewRows = primaryJids.length
      ? await app
          .db('whatsapp_conversations')
          .select(
            'id',
            'jid',
            'last_message',
            'last_message_at',
            'last_message_sync_at',
            'history_sync_offset'
          )
          .where({ company_id: companyId })
          .whereIn('jid', primaryJids)
      : [];
    const existingPreviewByJid = new Map(existingPreviewRows.map((row) => [String(row.jid), row]));
    const conversationRows = [...chats.values()].flatMap((chat) => {
      const jid = typeof chat.jid === 'string' ? chat.jid : '';
      if (!/^[^\s@]{1,200}@(s\.whatsapp\.net|g\.us|lid)$/u.test(jid)) return [];
      const lastMessageAt = providerTimestamp(chat.last_message_time);
      return [
        {
          company_id: companyId,
          account_id: account.id,
          jid,
          name: typeof chat.name === 'string' && chat.name ? chat.name.slice(0, 255) : jid,
          is_group: jid.endsWith('@g.us'),
          is_archived: chat.archived === true,
          unread_count: 0,
          last_message_at: lastMessageAt,
        },
      ];
    });
    if (conversationRows.length) {
      await app
        .db('whatsapp_conversations')
        .insert(conversationRows)
        .onConflict(['company_id', 'jid'])
        .merge({
          name: app.db.raw('excluded.name'),
          is_group: app.db.raw('excluded.is_group'),
          is_archived: app.db.raw('excluded.is_archived'),
          last_message_at: app.db.raw(
            'CASE WHEN whatsapp_conversations.last_message_at IS NULL OR excluded.last_message_at > whatsapp_conversations.last_message_at THEN excluded.last_message_at ELSE whatsapp_conversations.last_message_at END'
          ),
          write_date: new Date().toISOString(),
        });
    }
    const chatsNeedingPreview = primaryChats.filter((chat) => {
      const jid = typeof chat.jid === 'string' ? chat.jid : '';
      if (!primaryJids.includes(jid)) return false;
      const providerTime = providerTimestamp(chat.last_message_time);
      if (!providerTime) return false;
      const existing = existingPreviewByJid.get(jid);
      const syncedTime = providerTimestamp(existing?.last_message_sync_at);
      return (
        Number(existing?.history_sync_offset ?? 0) > 0 ||
        !syncedTime ||
        Date.parse(providerTime) > Date.parse(syncedTime)
      );
    });
    const conversationIdByJid = new Map(
      existingPreviewRows.map((row) => [String(row.jid), Number(row.id)])
    );
    const missingConversationJids = chatsNeedingPreview
      .map((chat) => String(chat.jid))
      .filter((jid) => !conversationIdByJid.has(jid));
    if (missingConversationJids.length) {
      const insertedRows = await app
        .db('whatsapp_conversations')
        .select('id', 'jid')
        .where({ company_id: companyId })
        .whereIn('jid', missingConversationJids);
      for (const row of insertedRows) conversationIdByJid.set(String(row.jid), Number(row.id));
    }
    let previewIndex = 0;
    const previewWorkers = Array.from(
      { length: Math.min(4, chatsNeedingPreview.length) },
      async () => {
        while (previewIndex < chatsNeedingPreview.length) {
          const chat = chatsNeedingPreview[previewIndex++]!;
          const jid = String(chat.jid);
          try {
            const conversationId = conversationIdByJid.get(jid);
            if (!conversationId) continue;
            const latest = await whatsappGatewayRequest<{ data?: Array<Record<string, unknown>> }>(
              `/chat/${encodeURIComponent(jid)}/messages?limit=${INBOX_SYNC_PAGE_SIZE}&offset=0`,
              { deviceId: account.gateway_device_id! }
            );
            const synchronizedMessages = [...(latest.data ?? [])];
            const previousSyncTime = providerTimestamp(
              existingPreviewByJid.get(jid)?.last_message_sync_at
            );
            const existingHistoryOffset = Number(
              existingPreviewByJid.get(jid)?.history_sync_offset ?? 0
            );
            let nextHistoryOffset = 0;
            let historySyncComplete = true;
            if (previousSyncTime && synchronizedMessages.length === INBOX_SYNC_PAGE_SIZE) {
              let offset = existingHistoryOffset || INBOX_SYNC_PAGE_SIZE;
              let fetchedThisPoll = 0;
              for (
                ;
                fetchedThisPoll < INBOX_SYNC_MAX_MESSAGES_PER_POLL;
                offset += INBOX_SYNC_PAGE_SIZE
              ) {
                const page = await whatsappGatewayRequest<{
                  data?: Array<Record<string, unknown>>;
                }>(
                  `/chat/${encodeURIComponent(jid)}/messages?limit=${INBOX_SYNC_PAGE_SIZE}&offset=${offset}`,
                  { deviceId: account.gateway_device_id! }
                );
                const pageMessages = page.data ?? [];
                synchronizedMessages.push(...pageMessages);
                fetchedThisPoll += pageMessages.length;
                const oldestTimestamp = pageMessages.reduce<string | null>((oldest, item) => {
                  const timestamp = providerTimestamp(item.timestamp);
                  return timestamp && (!oldest || Date.parse(timestamp) < Date.parse(oldest))
                    ? timestamp
                    : oldest;
                }, null);
                if (pageMessages.length < INBOX_SYNC_PAGE_SIZE) break;
                if (oldestTimestamp && Date.parse(oldestTimestamp) <= Date.parse(previousSyncTime))
                  break;
                if (fetchedThisPoll >= INBOX_SYNC_MAX_MESSAGES_PER_POLL) {
                  historySyncComplete = false;
                  nextHistoryOffset = offset + INBOX_SYNC_PAGE_SIZE;
                  break;
                }
              }
            }
            const latestMessage = (latest.data ?? []).reduce<{
              item: Record<string, unknown>;
              timestamp: string;
            } | null>((current, item) => {
              const timestamp = providerTimestamp(item.timestamp);
              return timestamp &&
                (!current || Date.parse(timestamp) > Date.parse(current.timestamp))
                ? { item, timestamp }
                : current;
            }, null);
            const providerTime = providerTimestamp(chat.last_message_time);
            if (!latestMessage) {
              if (providerTime) {
                await app
                  .db('whatsapp_conversations')
                  .where({ company_id: companyId, jid })
                  .update({
                    last_message_sync_at: providerTime,
                    write_date: new Date().toISOString(),
                  });
              }
              continue;
            }
            const recentMessages = new Map<string, Record<string, unknown>>();
            for (const item of synchronizedMessages) {
              if (typeof item.id !== 'string' || !item.id) continue;
              const timestamp = providerTimestamp(item.timestamp);
              if (!timestamp) continue;
              const fromMe = item.is_from_me === true;
              const typeInfo = classifyGoWaMessageType(
                item.media_type,
                item.view_once === true || item.is_view_once === true
              );
              const messageType = typeInfo.messageType;
              recentMessages.set(item.id, {
                company_id: companyId,
                account_id: account.id,
                conversation_id: conversationId,
                external_id: item.id.slice(0, 255),
                direction: fromMe ? 'outbound' : 'inbound',
                message_type: messageType,
                provider_type: typeInfo.providerType,
                content:
                  typeInfo.providerType === 'view_once'
                    ? 'View-once media'
                    : typeof item.content === 'string'
                      ? item.content.slice(0, 8000)
                      : '',
                status: fromMe ? 'sent' : 'received',
                media_mime_type:
                  !typeInfo.providerType && item.mime_type !== undefined
                    ? safeMime(item.mime_type)
                    : typeInfo.providerType
                      ? null
                      : mediaDefaultMime(messageType),
                media_file_name:
                  !typeInfo.providerType && typeof item.filename === 'string'
                    ? item.filename.slice(0, 255)
                    : !typeInfo.providerType && typeof item.file_name === 'string'
                      ? item.file_name.slice(0, 255)
                      : null,
                sender_display_name:
                  typeof item.sender_display_name === 'string'
                    ? item.sender_display_name.trim().slice(0, 255)
                    : typeof item.from_name === 'string'
                      ? item.from_name.trim().slice(0, 255)
                      : null,
                sender_jid:
                  typeof item.sender === 'string'
                    ? item.sender.slice(0, 255)
                    : typeof item.sender_jid === 'string'
                      ? item.sender_jid.slice(0, 255)
                      : null,
                create_date: timestamp,
              });
            }
            const recentMessageRows = [...recentMessages.values()];
            for (let index = 0; index < recentMessageRows.length; index += 25) {
              await app
                .db('whatsapp_messages')
                .insert(recentMessageRows.slice(index, index + 25))
                .onConflict(['company_id', 'external_id'])
                .merge(['content', 'status', 'provider_type', 'write_date']);
            }
            const latestTypeInfo = classifyGoWaMessageType(
              latestMessage.item.media_type,
              latestMessage.item.view_once === true || latestMessage.item.is_view_once === true
            );
            const latestWasDeleted =
              typeof latestMessage.item.id === 'string' &&
              Boolean(
                await app
                  .db('whatsapp_messages')
                  .select('id')
                  .where({
                    company_id: companyId,
                    external_id: latestMessage.item.id,
                    is_deleted: true,
                  })
                  .first()
              );
            const preview = latestWasDeleted
              ? 'This message was deleted'
              : latestTypeInfo.providerType === 'view_once'
                ? 'View-once media'
                : typeof latestMessage.item.content === 'string' && latestMessage.item.content
                  ? latestMessage.item.content.slice(0, 8_000)
                  : `[${latestTypeInfo.providerType ?? latestTypeInfo.messageType}]`;
            await app
              .db('whatsapp_conversations')
              .where({ company_id: companyId, jid })
              .where((builder) =>
                builder
                  .whereNull('last_message_at')
                  .orWhere('last_message_at', '<=', latestMessage.timestamp)
              )
              .update({
                last_message: preview,
                last_message_at: latestMessage.timestamp,
                write_date: new Date().toISOString(),
              });
            if (providerTime) {
              await app
                .db('whatsapp_conversations')
                .where({ company_id: companyId, jid })
                .update({
                  ...(historySyncComplete ? { last_message_sync_at: providerTime } : {}),
                  history_sync_offset: historySyncComplete ? 0 : nextHistoryOffset,
                  write_date: new Date().toISOString(),
                });
            }
          } catch (error) {
            req.log.warn(
              { error: whatsappLogErrorContext(error) },
              'WhatsApp conversation preview refresh failed'
            );
          }
        }
      }
    );
    await Promise.all(previewWorkers);
    const query = WhatsappConversation.query().where({
      company_id: companyId,
      is_archived: archived,
    });
    if (labelId) {
      const label = await app
        .db('whatsapp_labels')
        .where({ id: labelId, company_id: companyId })
        .first();
      if (!label) return reply.code(404).send({ success: false, error: 'Label not found' });
      query.whereIn(
        'id',
        app
          .db('whatsapp_conversation_labels')
          .select('conversation_id')
          .where({ company_id: companyId, label_id: labelId })
      );
    }
    if (queue === 'mine') query.where('assigned_user_id', req.auth!.userId);
    if (queue === 'unassigned') query.whereNull('assigned_user_id').whereNull('assigned_team_id');
    if (teamId) {
      const team = await app
        .db('organization_teams')
        .where({ id: teamId, company_id: companyId })
        .first();
      if (!team) return reply.code(404).send({ success: false, error: 'Team not found' });
      query.where('assigned_team_id', teamId);
    }
    if (workState !== 'all') query.where('work_state', workState);
    const readCursorTimestampSql =
      app.db.client.config.client === 'pg'
        ? 'read_cursor.last_read_at::timestamptz'
        : 'read_cursor.last_read_at';
    const unreadMessages = () =>
      app
        .db('whatsapp_messages as unread_message')
        .select(app.db.raw('1'))
        .whereRaw('unread_message.conversation_id = whatsapp_conversations.id')
        .whereRaw('unread_message.company_id = whatsapp_conversations.company_id')
        .where('unread_message.direction', 'inbound')
        .whereNotExists(
          app
            .db('whatsapp_conversation_reads as read_cursor')
            .select(app.db.raw('1'))
            .whereRaw('read_cursor.conversation_id = unread_message.conversation_id')
            .whereRaw('read_cursor.company_id = unread_message.company_id')
            .where('read_cursor.user_id', req.auth!.userId)
            .where((builder) =>
              builder
                .whereRaw(`unread_message.create_date < ${readCursorTimestampSql}`)
                .orWhereRaw(
                  `(unread_message.create_date = ${readCursorTimestampSql} AND unread_message.id <= read_cursor.last_read_message_id)`
                )
            )
        );
    if (unreadOnly) query.whereExists(unreadMessages());
    if (search) {
      const pattern = `%${search.toLocaleLowerCase()}%`;
      query.where((builder) =>
        builder
          .whereRaw('LOWER(name) LIKE ?', [pattern])
          .orWhereRaw('LOWER(jid) LIKE ?', [pattern])
          .orWhereExists(
            app
              .db('whatsapp_messages')
              .select(app.db.raw('1'))
              .whereRaw('whatsapp_messages.conversation_id = whatsapp_conversations.id')
              .whereRaw('LOWER(whatsapp_messages.content) LIKE ?', [pattern])
          )
      );
    }
    const conversations = await query
      .orderBy('is_pinned', 'desc')
      .orderBy('last_message_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset);
    const conversationIds = conversations.map((conversation) => conversation.id);
    const assignmentRows = conversationIds.length
      ? await app
          .db('whatsapp_conversations as conversation')
          .leftJoin('company_memberships as assigned_membership', function joinMember() {
            this.on('assigned_membership.user_id', '=', 'conversation.assigned_user_id').andOn(
              'assigned_membership.company_id',
              '=',
              'conversation.company_id'
            );
          })
          .leftJoin('users as assigned_agent', 'assigned_agent.id', 'assigned_membership.user_id')
          .leftJoin('organization_teams as assigned_team', function joinTeam() {
            this.on('assigned_team.id', '=', 'conversation.assigned_team_id').andOn(
              'assigned_team.company_id',
              '=',
              'conversation.company_id'
            );
          })
          .select(
            'conversation.id as conversation_id',
            'assigned_membership.user_id as assigned_user_id',
            'assigned_agent.login as assigned_user_name',
            'assigned_team.id as assigned_team_id',
            'assigned_team.name as assigned_team_name'
          )
          .where({ 'conversation.company_id': companyId })
          .whereIn('conversation.id', conversationIds)
      : [];
    const assignmentsByConversation = new Map(
      assignmentRows.map((row) => [Number(row.conversation_id), row])
    );
    const labelRows = conversationIds.length
      ? await app
          .db('whatsapp_conversation_labels as conversation_label')
          .join('whatsapp_labels as label', function joinLabel() {
            this.on('label.id', '=', 'conversation_label.label_id').andOn(
              'label.company_id',
              '=',
              'conversation_label.company_id'
            );
          })
          .select('conversation_label.conversation_id', 'label.id', 'label.name', 'label.color')
          .where({ 'conversation_label.company_id': companyId })
          .whereIn('conversation_label.conversation_id', conversationIds)
      : [];
    const labelsByConversation = new Map<
      number,
      Array<{ id: number; name: string; color: string }>
    >();
    for (const label of labelRows) {
      const current = labelsByConversation.get(Number(label.conversation_id)) ?? [];
      current.push({ id: Number(label.id), name: label.name, color: label.color });
      labelsByConversation.set(Number(label.conversation_id), current);
    }
    const unreadRows = conversationIds.length
      ? await app
          .db('whatsapp_messages as unread_message')
          .leftJoin('whatsapp_conversation_reads as read_cursor', function joinReadCursor() {
            this.on('read_cursor.company_id', '=', 'unread_message.company_id')
              .andOn('read_cursor.conversation_id', '=', 'unread_message.conversation_id')
              .andOn('read_cursor.user_id', '=', app.db.raw('?', [req.auth!.userId]));
          })
          .select('unread_message.conversation_id')
          .count({ unread_count: 'unread_message.id' })
          .where('unread_message.company_id', companyId)
          .whereIn('unread_message.conversation_id', conversationIds)
          .where('unread_message.direction', 'inbound')
          .where((builder) =>
            builder
              .whereNull('read_cursor.id')
              .orWhereRaw(`unread_message.create_date > ${readCursorTimestampSql}`)
              .orWhereRaw(
                `(unread_message.create_date = ${readCursorTimestampSql} AND unread_message.id > read_cursor.last_read_message_id)`
              )
          )
          .groupBy('unread_message.conversation_id')
      : [];
    const unreadCountByConversation = new Map(
      (unreadRows as Array<{ conversation_id: number; unread_count: number | string }>).map(
        (row) => [Number(row.conversation_id), Number(row.unread_count)]
      )
    );
    return {
      success: true,
      data: conversations.map((conversation) => ({
        ...conversation,
        assigned_user_name:
          assignmentsByConversation.get(conversation.id)?.assigned_user_name ?? null,
        assigned_team_name:
          assignmentsByConversation.get(conversation.id)?.assigned_team_name ?? null,
        unread_count: unreadCountByConversation.get(conversation.id) ?? 0,
        labels: labelsByConversation.get(conversation.id) ?? [],
      })),
    };
  });

  app.post<{ Body: unknown }>(
    '/whatsapp/contacts/check',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'create')) return;
      const body = isRecord(req.body) ? req.body : null;
      const rawPhone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      const compactPhone = rawPhone.replace(/[\s().-]/gu, '');
      const phone = compactPhone.startsWith('+') ? compactPhone.slice(1) : compactPhone;
      const parsedPhone = /^\d+$/u.test(phone)
        ? parsePhoneNumberFromString(`+${phone}`)
        : undefined;
      if (
        !body ||
        Object.keys(body).some((key) => key !== 'phone') ||
        !/^[1-9]\d{7,14}$/u.test(phone) ||
        !parsedPhone?.isValid()
      )
        return reply.code(400).send({
          success: false,
          error: 'Enter a valid international phone number (8–15 digits)',
        });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected' || !account.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        const check = await whatsappGatewayRequest<{ is_on_whatsapp?: unknown }>(
          `/user/check?phone=${encodeURIComponent(parsedPhone.number.slice(1))}`,
          { deviceId: account.gateway_device_id }
        );
        if (typeof check.is_on_whatsapp !== 'boolean')
          return reply
            .code(502)
            .send({ success: false, error: 'WhatsApp number could not be verified' });
        return reply.send({
          success: true,
          data: { phone: parsedPhone.number, is_on_whatsapp: check.is_on_whatsapp },
        });
      } catch (error) {
        req.log.warn({ error: whatsappLogErrorContext(error) }, 'WhatsApp number check failed');
        return reply
          .code(502)
          .send({ success: false, error: 'WhatsApp number could not be verified' });
      }
    }
  );

  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/archive',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      const archived = body?.archived;
      if (!conversationId || typeof archived !== 'boolean' || Object.keys(body ?? {}).length !== 1)
        return reply.code(400).send({ success: false, error: 'Invalid archive request' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account?.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        await whatsappGatewayRequest(`/chat/${encodeURIComponent(conversation.jid)}/archive`, {
          method: 'POST',
          deviceId: account.gateway_device_id,
          contentType: 'application/json',
          body: JSON.stringify({ archived }),
        });
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp conversation archive request failed'
        );
        return reply
          .code(502)
          .send({ success: false, error: 'Could not update conversation archive' });
      }
      const updated = await app.db.transaction(async (trx) => {
        await WhatsappConversation.query(trx)
          .where({ id: conversationId, company_id: companyId })
          .patch({ is_archived: archived, write_date: new Date().toISOString() });
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          archived ? 'archive' : 'unarchive',
          conversationId,
          companyId,
          trx
        );
        return WhatsappConversation.query(trx).findOne({
          id: conversationId,
          company_id: companyId,
        });
      });
      return { success: true, data: updated };
    }
  );

  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/pin',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      const pinned = body?.pinned;
      if (!conversationId || typeof pinned !== 'boolean' || Object.keys(body ?? {}).length !== 1)
        return reply.code(400).send({ success: false, error: 'Invalid pin request' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account?.gateway_device_id)
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      try {
        await whatsappGatewayRequest(`/chat/${encodeURIComponent(conversation.jid)}/pin`, {
          method: 'POST',
          deviceId: account.gateway_device_id,
          contentType: 'application/json',
          body: JSON.stringify({ pinned }),
        });
      } catch (error) {
        req.log.warn(
          { error: whatsappLogErrorContext(error) },
          'WhatsApp conversation pin request failed'
        );
        return reply.code(502).send({ success: false, error: 'Could not update conversation pin' });
      }
      const updated = await app.db.transaction(async (trx) => {
        await WhatsappConversation.query(trx)
          .where({ id: conversationId, company_id: companyId })
          .patch({ is_pinned: pinned, write_date: new Date().toISOString() });
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          pinned ? 'pin' : 'unpin',
          conversationId,
          companyId,
          trx
        );
        return WhatsappConversation.query(trx).findOne({
          id: conversationId,
          company_id: companyId,
        });
      });
      return { success: true, data: updated };
    }
  );

  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations',
    whatsappRateLimit(10),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'create')) return;
      const body = isRecord(req.body) ? req.body : null;
      const phone = typeof body?.phone === 'string' ? body.phone.replace(/^\+/u, '') : '';
      if (
        !body ||
        !/^[1-9]\d{7,14}$/u.test(phone) ||
        Object.keys(body).some((key) => !['phone', 'name'].includes(key)) ||
        (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 255))
      )
        return reply
          .code(400)
          .send({ success: false, error: 'Enter a phone number with country code (8–15 digits)' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account || account.status !== 'connected')
        return reply.code(409).send({ success: false, error: 'WhatsApp account is not connected' });
      const [conversation] = await app
        .db('whatsapp_conversations')
        .insert({
          company_id: companyId,
          account_id: account.id,
          jid: `${phone}@s.whatsapp.net`,
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `+${phone}`,
          is_group: false,
          unread_count: 0,
        })
        .onConflict(['company_id', 'jid'])
        .merge({ write_date: new Date().toISOString() })
        .returning('*');
      return reply.code(201).send({ success: true, data: conversation });
    }
  );

  app.get<{
    Params: Params;
    Querystring: { limit?: string; offset?: string };
  }>('/whatsapp/conversations/:id/notes', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const conversationId = id(req.params.id);
    if (!conversationId)
      return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
    const conversation = await WhatsappConversation.query().findOne({
      id: conversationId,
      company_id: companyId,
    });
    if (!conversation)
      return reply.code(404).send({ success: false, error: 'Conversation not found' });
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      return reply.code(400).send({ success: false, error: 'Limit must be between 1 and 100' });
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5_000)
      return reply.code(400).send({ success: false, error: 'Offset must be between 0 and 5000' });
    const data = await app
      .db('whatsapp_internal_notes as note')
      .leftJoin('users as author', 'author.id', 'note.user_id')
      .select(
        'note.id',
        'note.conversation_id',
        'note.user_id',
        'note.body',
        'note.create_date',
        'author.login as author_name'
      )
      .where({ 'note.company_id': companyId, 'note.conversation_id': conversationId })
      .orderBy('note.create_date', 'desc')
      .orderBy('note.id', 'desc')
      .limit(limit)
      .offset(offset);
    return { success: true, data: data.reverse() };
  });

  app.post<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/notes',
    whatsappRateLimit(30),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      const noteBody = typeof body?.content === 'string' ? body.content.trim() : '';
      if (
        !conversationId ||
        !body ||
        Object.keys(body).some((key) => key !== 'content') ||
        noteBody.length < 1 ||
        noteBody.length > 4_000
      )
        return reply
          .code(400)
          .send({ success: false, error: 'Note must contain 1–4000 characters' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      const note = await app.db.transaction(async (trx) => {
        const [created] = await trx('whatsapp_internal_notes')
          .insert({
            company_id: companyId,
            conversation_id: conversationId,
            user_id: req.auth!.userId,
            body: noteBody,
          })
          .returning(['id', 'conversation_id', 'user_id', 'body', 'create_date']);
        await recordWhatsAppAudit(
          req,
          'whatsapp.internal_note',
          'create',
          Number(created.id),
          companyId,
          trx
        );
        const author = await trx('users').select('login').where({ id: req.auth!.userId }).first();
        return { ...created, author_name: author?.login ?? `User ${req.auth!.userId}` };
      });
      return reply.code(201).send({ success: true, data: note });
    }
  );

  app.get<{ Params: Params }>(
    '/whatsapp/conversations/:id/contact',
    whatsappRateLimit(30),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      if (conversation.is_group) {
        return reply.send({
          success: true,
          data: { name: conversation.name, phone_number: null, verified_name: null, status: null },
        });
      }
      const phoneMatch = String(conversation.jid).match(/^(\d{5,20})@s\.whatsapp\.net$/u);
      if (!phoneMatch) {
        return reply.send({
          success: true,
          data: { name: conversation.name, phone_number: null, verified_name: null, status: null },
        });
      }
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account?.gateway_device_id)
        return reply.code(503).send({ success: false, error: 'WhatsApp account is unavailable' });
      const [profileResult, avatarResult] = await Promise.allSettled([
        whatsappGatewayRequest<Record<string, unknown>>(
          `/user/info?phone=${encodeURIComponent(conversation.jid)}`,
          { deviceId: account.gateway_device_id }
        ),
        whatsappGatewayRequest<{ url?: unknown; id?: unknown }>(
          `/user/avatar?phone=${encodeURIComponent(conversation.jid)}&is_preview=true`,
          { deviceId: account.gateway_device_id }
        ),
      ]);
      const profile = profileResult.status === 'fulfilled' ? profileResult.value : {};
      const avatar = avatarResult.status === 'fulfilled' ? avatarResult.value : {};
      const profileSyncedAt =
        profileResult.status === 'fulfilled' ? new Date().toISOString() : null;
      const verifiedName =
        typeof profile.verified_name === 'string' ? profile.verified_name.slice(0, 255) : null;
      const contactStatus =
        typeof profile.status === 'string' ? profile.status.slice(0, 2000) : null;
      const pictureId = typeof avatar.id === 'string' ? avatar.id.slice(0, 255) : null;
      if (profileSyncedAt || pictureId) {
        const profileUpdate: Record<string, string> = {};
        if (verifiedName) profileUpdate.contact_verified_name = verifiedName;
        if (contactStatus) profileUpdate.contact_status = contactStatus;
        if (pictureId) profileUpdate.contact_picture_id = pictureId;
        if (profileSyncedAt) profileUpdate.contact_profile_synced_at = profileSyncedAt;
        if (Object.keys(profileUpdate).length > 0)
          await app
            .db('whatsapp_conversations')
            .where({ id: conversationId, company_id: companyId })
            .update(profileUpdate);
      }
      return reply.send({
        success: true,
        data: {
          name: conversation.name,
          phone_number: phoneMatch[1],
          verified_name: verifiedName ?? conversation.contact_verified_name ?? null,
          status: contactStatus ?? conversation.contact_status ?? null,
          picture_id: pictureId ?? conversation.contact_picture_id ?? null,
          avatar_available:
            trustedWhatsAppAvatarUrl(avatar.url) !== null ||
            Boolean(conversation.contact_avatar_key),
          synced_at: profileSyncedAt ?? conversation.contact_profile_synced_at ?? null,
        },
      });
    }
  );

  app.get<{ Params: Params }>(
    '/whatsapp/conversations/:id/contact/avatar',
    whatsappRateLimit(30),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      const conversationId = id(req.params.id);
      if (!conversationId)
        return reply.code(400).send({ success: false, error: 'Invalid conversation ID' });
      const conversation = await WhatsappConversation.query()
        .findOne({
          id: conversationId,
          company_id: companyId,
        })
        .select(
          'id',
          'company_id',
          'jid',
          'is_group',
          'contact_avatar_picture_id',
          'contact_avatar_key'
        );
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      const phoneMatch = String(conversation.jid).match(/^(\d{5,20})@s\.whatsapp\.net$/u);
      if (conversation.is_group || !phoneMatch)
        return reply.code(404).send({ success: false, error: 'Contact avatar is unavailable' });
      const account = await WhatsappAccount.query().findOne({ company_id: companyId });
      if (!account?.gateway_device_id)
        return reply.code(503).send({ success: false, error: 'WhatsApp account is unavailable' });
      const [avatarCache] = await app
        .db('whatsapp_conversations')
        .where({ id: conversationId, company_id: companyId })
        .select('contact_avatar_picture_id', 'contact_avatar_key');
      const sendCachedAvatar = async () => {
        if (typeof avatarCache?.contact_avatar_key !== 'string') return null;
        const cached = await options.attachmentStorage.get(avatarCache.contact_avatar_key);
        const cachedMime = cached ? sniffMime(cached) : null;
        if (
          !cached ||
          !cachedMime ||
          !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(cachedMime)
        )
          return null;
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          'contact_avatar_access',
          conversationId,
          companyId
        );
        reply
          .header('content-type', cachedMime)
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
          `/user/avatar?phone=${encodeURIComponent(conversation.jid)}&is_preview=true`,
          { deviceId: account.gateway_device_id }
        );
        const avatarUrl = trustedWhatsAppAvatarUrl(avatar.url);
        const pictureId = typeof avatar.id === 'string' ? avatar.id.slice(0, 255) : null;
        if (
          pictureId &&
          avatarCache?.contact_avatar_picture_id === pictureId &&
          typeof avatarCache.contact_avatar_key === 'string'
        ) {
          const cached = await sendCachedAvatar();
          if (cached) return cached;
        }
        if (typeof avatar.url === 'string' && avatar.url.length > 0 && !avatarUrl)
          return reply.code(404).send({ success: false, error: 'Contact avatar is unavailable' });
        if (!avatarUrl) {
          const cached = await sendCachedAvatar();
          if (cached) return cached;
          return reply.code(404).send({ success: false, error: 'Contact avatar is unavailable' });
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
            error: 'Contact avatar could not be loaded',
          });
        }
        const bytes = await readBoundedAvatar(response);
        const mime = sniffMime(bytes);
        if (!mime || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime))
          return reply.code(502).send({ success: false, error: 'Contact avatar is invalid' });
        if (pictureId) {
          const newKey = randomUUID();
          await options.attachmentStorage.put(newKey, bytes);
          try {
            await app
              .db('whatsapp_conversations')
              .where({ id: conversationId, company_id: companyId })
              .update({
                contact_picture_id: pictureId,
                contact_avatar_picture_id: pictureId,
                contact_avatar_key: newKey,
              });
          } catch (error) {
            await options.attachmentStorage.delete(newKey).catch(() => undefined);
            throw error;
          }
          if (conversation.contact_avatar_key && conversation.contact_avatar_key !== newKey)
            await options.attachmentStorage
              .delete(conversation.contact_avatar_key)
              .catch((error: unknown) => {
                req.log.warn(
                  { error: whatsappLogErrorContext(error) },
                  'Stale WhatsApp contact avatar cleanup failed'
                );
              });
        }
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          'contact_avatar_access',
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
          'WhatsApp contact avatar fetch failed'
        );
        const cached = await sendCachedAvatar();
        if (cached) return cached;
        return reply
          .code(502)
          .send({ success: false, error: 'Contact avatar could not be loaded' });
      }
    }
  );
}
