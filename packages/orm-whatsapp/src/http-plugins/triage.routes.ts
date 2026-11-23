import type { FastifyInstance } from 'fastify';
import { WhatsappConversation } from '../models.js';
import { isRecord } from '@moonwitness/types';
import {
  id,
  recordWhatsAppAudit,
  requireCompany,
  requireWhatsAppAction,
  whatsappRateLimit,
  type WhatsappRouteParams,
} from '../runtime/route-helpers.js';

type Params = WhatsappRouteParams;

export function registerWhatsAppTriageRoutes(app: FastifyInstance): void {
  app.get('/whatsapp/labels', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const data = await app
      .db('whatsapp_labels')
      .select('id', 'name', 'color')
      .where({ company_id: companyId })
      .orderBy('name', 'asc')
      .orderBy('id', 'asc');
    return { success: true, data };
  });

  app.get('/whatsapp/agents', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const members = await app
      .db('company_memberships as company_member')
      .join('users as agent', 'agent.id', 'company_member.user_id')
      .leftJoin(
        'organization_memberships as organization_member',
        function joinOrganizationMember() {
          this.on('organization_member.company_id', '=', 'company_member.company_id').andOn(
            'organization_member.user_id',
            '=',
            'company_member.user_id'
          );
        }
      )
      .leftJoin('organization_teams as team', function joinTeam() {
        this.on('team.id', '=', 'organization_member.team_id').andOn(
          'team.company_id',
          '=',
          'company_member.company_id'
        );
      })
      .select('agent.id', 'agent.login', 'team.id as team_id', 'team.name as team_name')
      .where('company_member.company_id', companyId)
      .whereNot('agent.role', 'system')
      .orderBy('agent.login', 'asc');
    const teams = await app
      .db('organization_teams')
      .select('id', 'name')
      .where({ company_id: companyId })
      .orderBy('name', 'asc');
    return {
      success: true,
      data: {
        members: members.map((member) => ({
          id: Number(member.id),
          login: member.login,
          team_id: member.team_id === null ? null : Number(member.team_id),
          team_name: member.team_name ?? null,
        })),
        teams: teams.map((team) => ({ id: Number(team.id), name: team.name })),
      },
    };
  });

  app.put<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/assignment',
    whatsappRateLimit(30),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      const assignedUserId = body?.assigned_user_id;
      const assignedTeamId = body?.assigned_team_id;
      if (
        !conversationId ||
        !body ||
        Object.keys(body).length !== 2 ||
        !Object.hasOwn(body, 'assigned_user_id') ||
        !Object.hasOwn(body, 'assigned_team_id') ||
        (assignedUserId !== null &&
          (!Number.isSafeInteger(assignedUserId) || Number(assignedUserId) < 1)) ||
        (assignedTeamId !== null &&
          (!Number.isSafeInteger(assignedTeamId) || Number(assignedTeamId) < 1))
      )
        return reply.code(400).send({ success: false, error: 'Invalid conversation assignment' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      if (assignedUserId !== null) {
        const membership = await app
          .db('company_memberships')
          .where({ company_id: companyId, user_id: assignedUserId })
          .first();
        if (!membership)
          return reply.code(404).send({ success: false, error: 'Assigned agent not found' });
      }
      if (assignedTeamId !== null) {
        const team = await app
          .db('organization_teams')
          .where({ company_id: companyId, id: assignedTeamId })
          .first();
        if (!team)
          return reply.code(404).send({ success: false, error: 'Assigned team not found' });
      }
      if (assignedUserId !== null && assignedTeamId !== null) {
        const teamMember = await app
          .db('organization_memberships')
          .where({
            company_id: companyId,
            user_id: assignedUserId,
            team_id: assignedTeamId,
          })
          .first();
        if (!teamMember)
          return reply
            .code(400)
            .send({ success: false, error: 'Agent is not a member of that team' });
      }
      const assigned = {
        assigned_user_id: assignedUserId === null ? null : Number(assignedUserId),
        assigned_team_id: assignedTeamId === null ? null : Number(assignedTeamId),
        write_date: new Date().toISOString(),
      };
      await app.db.transaction(async (trx) => {
        await WhatsappConversation.query(trx)
          .where({ id: conversationId, company_id: companyId })
          .patch(assigned);
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          'assignment.update',
          conversationId,
          companyId,
          trx
        );
      });
      return { success: true, data: { id: conversationId, ...assigned } };
    }
  );

  app.put<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/state',
    whatsappRateLimit(30),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      const workState = body?.work_state;
      if (
        !conversationId ||
        !body ||
        Object.keys(body).length !== 1 ||
        !['open', 'closed'].includes(String(workState))
      )
        return reply.code(400).send({ success: false, error: 'Invalid conversation work state' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      await app.db.transaction(async (trx) => {
        await WhatsappConversation.query(trx)
          .where({ id: conversationId, company_id: companyId })
          .patch({
            work_state: workState as 'open' | 'closed',
            write_date: new Date().toISOString(),
          });
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          `state.${workState}`,
          conversationId,
          companyId,
          trx
        );
      });
      return { success: true, data: { id: conversationId, work_state: workState } };
    }
  );

  app.post<{ Body: unknown }>('/whatsapp/labels', whatsappRateLimit(30), async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
    const body = isRecord(req.body) ? req.body : null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const color = typeof body?.color === 'string' ? body.color : '#f1d340';
    if (
      !body ||
      Object.keys(body).some((key) => !['name', 'color'].includes(key)) ||
      name.length < 1 ||
      name.length > 40 ||
      !/^#[0-9a-f]{6}$/iu.test(color)
    )
      return reply.code(400).send({ success: false, error: 'Invalid label name or color' });
    const normalizedName = name.toLocaleLowerCase();
    const inserted = await app
      .db('whatsapp_labels')
      .insert({
        company_id: companyId,
        name,
        normalized_name: normalizedName,
        color: color.toLowerCase(),
      })
      .onConflict(['company_id', 'normalized_name'])
      .ignore()
      .returning(['id', 'name', 'color']);
    const label = inserted[0];
    if (!label) return reply.code(409).send({ success: false, error: 'Label already exists' });
    await recordWhatsAppAudit(req, 'whatsapp.label', 'create', Number(label.id), companyId);
    return reply.code(201).send({ success: true, data: label });
  });

  app.delete<{ Params: Params }>('/whatsapp/labels/:id', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
    const labelId = id(req.params.id);
    if (!labelId) return reply.code(400).send({ success: false, error: 'Invalid label ID' });
    const label = await app
      .db('whatsapp_labels')
      .where({ id: labelId, company_id: companyId })
      .first();
    if (!label) return reply.code(404).send({ success: false, error: 'Label not found' });
    await app.db.transaction(async (trx) => {
      await trx('whatsapp_conversation_labels')
        .where({ company_id: companyId, label_id: labelId })
        .delete();
      await trx('whatsapp_labels').where({ id: labelId, company_id: companyId }).delete();
      await recordWhatsAppAudit(req, 'whatsapp.label', 'delete', labelId, companyId, trx);
    });
    return { success: true, data: { id: labelId } };
  });

  app.put<{ Params: Params; Body: unknown }>(
    '/whatsapp/conversations/:id/labels',
    whatsappRateLimit(30),
    async (req, reply) => {
      const companyId = requireCompany(req, reply);
      if (!companyId) return;
      if (!requireWhatsAppAction(req, reply, 'whatsapp.conversation', 'write')) return;
      const conversationId = id(req.params.id);
      const body = isRecord(req.body) ? req.body : null;
      const labelIds = body?.label_ids;
      if (
        !conversationId ||
        !body ||
        Object.keys(body).length !== 1 ||
        !Array.isArray(labelIds) ||
        labelIds.length > 20 ||
        labelIds.some((value) => !Number.isSafeInteger(value) || Number(value) < 1) ||
        new Set(labelIds).size !== labelIds.length
      )
        return reply.code(400).send({ success: false, error: 'Invalid conversation labels' });
      const conversation = await WhatsappConversation.query().findOne({
        id: conversationId,
        company_id: companyId,
      });
      if (!conversation)
        return reply.code(404).send({ success: false, error: 'Conversation not found' });
      const labels = labelIds.length
        ? await app
            .db('whatsapp_labels')
            .select('id', 'name', 'color')
            .where({ company_id: companyId })
            .whereIn('id', labelIds as number[])
        : [];
      if (labels.length !== labelIds.length)
        return reply.code(404).send({ success: false, error: 'One or more labels were not found' });
      await app.db.transaction(async (trx) => {
        await trx('whatsapp_conversation_labels')
          .where({ company_id: companyId, conversation_id: conversationId })
          .delete();
        if (labels.length)
          await trx('whatsapp_conversation_labels').insert(
            labels.map((label) => ({
              company_id: companyId,
              conversation_id: conversationId,
              label_id: label.id,
            }))
          );
        await recordWhatsAppAudit(
          req,
          'whatsapp.conversation',
          'labels.update',
          conversationId,
          companyId,
          trx
        );
      });
      return { success: true, data: labels };
    }
  );
}
