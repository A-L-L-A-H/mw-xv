import type { Knex } from 'knex';
import {
  requireAddonDb,
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AuthenticatedContext,
} from '@moonwitness/orm';
import {
  SlaPolicy,
  SupportTicket,
  TicketMessage,
  EscalationRule,
  KnowledgeDeflection,
  CsatSurvey,
} from './models/index.js';
import { Company, Partner, User } from '@moonwitness/orm-base';
import {
  resolveSlaDeadlines,
  evaluateSlaState,
  nextEscalation,
  suggestAutoReply,
  computeCsatSummary,
  type SlaPolicyLike,
  type SlaEvaluateInput,
  type TicketLike,
  type EscalationRuleLike,
  type KnowledgeArticleLike,
  type CsatSurveyLike,
} from './helpdesk-engine.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadSlaPolicies(db: Knex, companyId: number): Promise<SlaPolicyLike[]> {
  return db('helpdesk_sla_policies')
    .where({ company_id: companyId })
    .select(
      'id',
      'name',
      'priority',
      'first_response_minutes',
      'resolution_minutes',
      'business_hours_only',
      'applies_to_queue',
      'is_active'
    );
}

function loadEscalationRules(db: Knex, companyId: number): Promise<EscalationRuleLike[]> {
  return db('helpdesk_escalation_rules as er')
    .join('helpdesk_sla_policies as sp', 'er.sla_policy_id', 'sp.id')
    .where('sp.company_id', companyId)
    .select(
      'er.id',
      'er.name',
      'er.sla_policy_id as sla_policy',
      'er.trigger',
      'er.escalate_after_minutes',
      'er.escalate_to',
      'er.oncall_rotation',
      'er.max_escalations',
      'er.is_active'
    );
}

export const helpdeskHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/helpdesk/tickets', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { subject, priority, channel, queue, customerId, companyId, sourceRef, tags, notes } =
      req.body;

    if (!subject || !customerId || !companyId) {
      return reply
        .code(400)
        .send({ success: false, error: 'subject, customerId, companyId are required' });
    }

    try {
      const db = requireAddonDb(req);
      const now = new Date().toISOString();

      const policies = await loadSlaPolicies(db, auth.companyId);
      const deadlineInput: SlaEvaluateInput = {
        priority: (priority as 'P1' | 'P2' | 'P3' | 'P4') ?? 'P4',
        queue: (queue as 'technical' | 'billing' | 'general' | 'enterprise') ?? 'general',
        policies,
        nowIso: now,
      };
      const deadlineResult = resolveSlaDeadlines(deadlineInput);

      const ticketNo = `HD-${Date.now().toString(36).toUpperCase()}`;
      const [ticketId] = await db('helpdesk_support_tickets')
        .insert({
          ticket_no: ticketNo,
          subject: subject as string,
          status: 'new',
          priority: (priority as string) ?? 'P4',
          channel: (channel as string) ?? 'web',
          queue: (queue as string) ?? 'general',
          customer_id: Number(customerId),
          company_id: Number(companyId),
          sla_policy_id: deadlineResult?.policyId ?? null,
          first_response_due_at: deadlineResult?.firstResponseDue ?? null,
          resolution_due_at: deadlineResult?.resolutionDue ?? null,
          sla_breached: false,
          escalation_level: 0,
          source_ref: sourceRef as string | undefined,
          tags: tags as string | undefined,
          notes: notes as string | undefined,
          create_date: now,
          write_date: now,
        })
        .returning('id');

      const ticket = await db('helpdesk_support_tickets').where({ id: ticketId }).first();
      return reply.code(201).send({ success: true, data: ticket, sla: deadlineResult });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/helpdesk/tickets/:id/messages', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const ticketId = Number(req.params.id);
    const { direction, authorId, body, createdVia } = req.body;

    if (!direction || !body) {
      return reply.code(400).send({ success: false, error: 'direction and body are required' });
    }

    try {
      const db = requireAddonDb(req);
      const now = new Date().toISOString();

      const ticket = await db('helpdesk_support_tickets').where({ id: ticketId }).first();
      if (!ticket) {
        return reply.code(404).send({ success: false, error: 'Ticket not found' });
      }

      const [messageId] = await db('helpdesk_ticket_messages')
        .insert({
          ticket_id: ticketId,
          direction: direction as string,
          author_id: authorId ? Number(authorId) : null,
          body: body as string,
          created_via: (createdVia as string) ?? 'agent',
          created_at: now,
        })
        .returning('id');

      const message = await db('helpdesk_ticket_messages').where({ id: messageId }).first();

      if (direction === 'inbound' && !ticket.first_responded_at) {
        await db('helpdesk_support_tickets').where({ id: ticketId }).update({
          first_responded_at: now,
          status: 'open',
          write_date: now,
        });
      }

      return reply.code(201).send({ success: true, data: message });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/helpdesk/tickets/:id/transition', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const ticketId = Number(req.params.id);
    const { status } = req.body;

    if (!status) {
      return reply.code(400).send({ success: false, error: 'status is required' });
    }

    const validStatuses = ['new', 'open', 'pending', 'on_hold', 'resolved', 'closed'];
    if (!validStatuses.includes(status as string)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    try {
      const db = requireAddonDb(req);
      const now = new Date().toISOString();

      const ticket = await db('helpdesk_support_tickets').where({ id: ticketId }).first();
      if (!ticket) {
        return reply.code(404).send({ success: false, error: 'Ticket not found' });
      }

      const updates: Record<string, unknown> = { status, write_date: now };
      if (status === 'resolved' && !ticket.resolved_at) {
        updates.resolved_at = now;
      }
      if (status === 'closed' && !ticket.resolved_at) {
        updates.resolved_at = now;
      }

      await db('helpdesk_support_tickets').where({ id: ticketId }).update(updates);
      const updated = await db('helpdesk_support_tickets').where({ id: ticketId }).first();

      return reply.code(200).send({ success: true, data: updated });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/helpdesk/sla/evaluate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { priority, queue, nowIso } = req.body as {
      priority: string;
      queue: string;
      nowIso?: string;
    };

    if (!priority || !queue) {
      return reply.code(400).send({ success: false, error: 'priority and queue are required' });
    }

    try {
      const db = requireAddonDb(req);
      const policies = await loadSlaPolicies(db, auth.companyId);
      const input: SlaEvaluateInput = {
        priority: priority as 'P1' | 'P2' | 'P3' | 'P4',
        queue: queue as 'technical' | 'billing' | 'general' | 'enterprise',
        policies,
        nowIso: nowIso ?? new Date().toISOString(),
      };
      const result = resolveSlaDeadlines(input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/helpdesk/escalation/check', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { ticketId, nowIso } = req.body as { ticketId: number; nowIso?: string };

    if (!ticketId) {
      return reply.code(400).send({ success: false, error: 'ticketId is required' });
    }

    try {
      const db = requireAddonDb(req);
      const ticket = await db('helpdesk_support_tickets')
        .where({ id: Number(ticketId) })
        .first();
      if (!ticket) {
        return reply.code(404).send({ success: false, error: 'Ticket not found' });
      }

      if (!ticket.sla_policy_id) {
        return reply.code(200).send({
          success: true,
          data: {
            shouldEscalate: false,
            escalateTo: null,
            level: ticket.escalation_level ?? 0,
            reason: 'No SLA policy attached',
          },
        });
      }

      const rules = await loadEscalationRules(db, auth.companyId);
      const applicable = rules.filter(
        (r) => r.sla_policy === ticket.sla_policy_id && r.is_active !== false
      );
      const now = nowIso ?? new Date().toISOString();

      const ticketLike: TicketLike = {
        priority: ticket.priority,
        queue: ticket.queue,
        sla_policy: ticket.sla_policy_id,
        first_response_due_at: ticket.first_response_due_at,
        resolution_due_at: ticket.resolution_due_at,
        first_responded_at: ticket.first_responded_at,
        resolved_at: ticket.resolved_at,
        sla_breached: ticket.sla_breached,
        escalation_level: ticket.escalation_level,
      };

      for (const rule of applicable) {
        const decision = nextEscalation(rule, ticketLike, now);
        if (decision.shouldEscalate) {
          await db('helpdesk_support_tickets').where({ id: ticketId }).update({
            escalation_level: decision.level,
            write_date: now,
          });
          return reply
            .code(200)
            .send({ success: true, data: { ...decision, ruleId: rule.id, ruleName: rule.name } });
        }
      }

      return reply.code(200).send({
        success: true,
        data: {
          shouldEscalate: false,
          escalateTo: null,
          level: ticket.escalation_level ?? 0,
          reason: 'No escalation triggered',
        },
      });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/helpdesk/knowledge/deflect', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { question, articles } = req.body;

    if (!question) {
      return reply.code(400).send({ success: false, error: 'question is required' });
    }

    try {
      const articleList: KnowledgeArticleLike[] = Array.isArray(articles) ? articles : [];
      const suggestion = suggestAutoReply(question as string, articleList);
      return reply.code(200).send({ success: true, data: suggestion });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/helpdesk/csat/submit', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { ticketId, rating, comment } = req.body;

    if (!ticketId || rating === undefined) {
      return reply.code(400).send({ success: false, error: 'ticketId and rating are required' });
    }

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return reply.code(400).send({ success: false, error: 'rating must be integer 1-5' });
    }

    try {
      const db = requireAddonDb(req);
      const now = new Date().toISOString();

      const ticket = await db('helpdesk_support_tickets')
        .where({ id: Number(ticketId) })
        .first();
      if (!ticket) {
        return reply.code(404).send({ success: false, error: 'Ticket not found' });
      }

      const npsCategory = rating >= 5 ? 'promoter' : rating === 4 ? 'passive' : 'detractor';

      const [surveyId] = await db('helpdesk_csat_surveys')
        .insert({
          ticket_id: Number(ticketId),
          rating,
          comment: comment as string | undefined,
          surveyed_at: now,
          responded: true,
          nps_category: npsCategory,
        })
        .returning('id');

      const survey = await db('helpdesk_csat_surveys').where({ id: surveyId }).first();
      return reply.code(201).send({ success: true, data: survey });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.get('/api/helpdesk/csat/summary', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    try {
      const db = requireAddonDb(req);
      const surveys = await db('helpdesk_csat_surveys as cs')
        .join('helpdesk_support_tickets as t', 'cs.ticket_id', 't.id')
        .where('t.company_id', auth.companyId)
        .select('cs.responded', 'cs.rating');

      const summary = computeCsatSummary(surveys as CsatSurveyLike[]);
      return reply.code(200).send({ success: true, data: summary });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};

export const httpPlugin = helpdeskHttpPlugin;
