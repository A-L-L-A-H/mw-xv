import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
} from '../src/helpdesk-engine.js';

describe('helpdesk-engine', () => {
  const mockPolicies: SlaPolicyLike[] = [
    { id: 1, name: 'P1-All', priority: 'P1', first_response_minutes: 15, resolution_minutes: 240, business_hours_only: false, applies_to_queue: 'all', is_active: true },
    { id: 2, name: 'P2-All', priority: 'P2', first_response_minutes: 60, resolution_minutes: 480, business_hours_only: false, applies_to_queue: 'all', is_active: true },
    { id: 3, name: 'P3-All', priority: 'P3', first_response_minutes: 240, resolution_minutes: 1440, business_hours_only: true, applies_to_queue: 'all', is_active: true },
    { id: 4, name: 'P4-All', priority: 'P4', first_response_minutes: 480, resolution_minutes: 2880, business_hours_only: true, applies_to_queue: 'all', is_active: true },
    { id: 5, name: 'P1-Enterprise', priority: 'P1', first_response_minutes: 10, resolution_minutes: 120, business_hours_only: false, applies_to_queue: 'enterprise', is_active: true },
    { id: 6, name: 'Inactive', priority: 'P1', first_response_minutes: 5, resolution_minutes: 60, business_hours_only: false, applies_to_queue: 'all', is_active: false },
  ];

  const mockRules: EscalationRuleLike[] = [
    { id: 1, name: 'P1 FR Breach', sla_policy: 1, trigger: 'first_response_breach', escalate_after_minutes: 30, escalate_to: 'team_lead', max_escalations: 2, is_active: true },
    { id: 2, name: 'P1 Resolution Breach', sla_policy: 1, trigger: 'resolution_breach', escalate_after_minutes: 60, escalate_to: 'manager', max_escalations: 2, is_active: true },
    { id: 3, name: 'P2 FR Breach', sla_policy: 2, trigger: 'first_response_breach', escalate_after_minutes: 60, escalate_to: 'team_lead', max_escalations: 2, is_active: true },
    { id: 4, name: 'Priority Change', sla_policy: 1, trigger: 'priority_change', escalate_after_minutes: 0, escalate_to: 'on_call', oncall_rotation: 'primary', max_escalations: 1, is_active: true },
    { id: 5, name: 'Reopen', sla_policy: 1, trigger: 'reopen', escalate_after_minutes: 0, escalate_to: 'team_lead', max_escalations: 1, is_active: true },
    { id: 6, name: 'Inactive Rule', sla_policy: 1, trigger: 'first_response_breach', escalate_after_minutes: 30, escalate_to: 'team_lead', max_escalations: 2, is_active: false },
  ];

  const now = '2026-01-15T10:00:00.000Z';

  describe('resolveSlaDeadlines', () => {
    it('returns exact match for priority and queue', () => {
      const input: SlaEvaluateInput = { priority: 'P1', queue: 'enterprise', policies: mockPolicies, nowIso: now };
      const result = resolveSlaDeadlines(input);
      expect(result).not.toBeNull();
      expect(result!.policyId).toBe(5);
      expect(result!.policyName).toBe('P1-Enterprise');
    });

    it('falls back to queue=all when no exact match', () => {
      const input: SlaEvaluateInput = { priority: 'P2', queue: 'technical', policies: mockPolicies, nowIso: now };
      const result = resolveSlaDeadlines(input);
      expect(result).not.toBeNull();
      expect(result!.policyId).toBe(2);
      expect(result!.policyName).toBe('P2-All');
    });

    it('ignores inactive policies', () => {
      const input: SlaEvaluateInput = { priority: 'P1', queue: 'all', policies: mockPolicies, nowIso: now };
      const result = resolveSlaDeadlines(input);
      expect(result).not.toBeNull();
      expect(result!.policyId).toBe(1);
      expect(result!.policyId).not.toBe(6);
    });

    it('returns null when no matching policy', () => {
      const input: SlaEvaluateInput = { priority: 'P1', queue: 'all', policies: [], nowIso: now };
      const result = resolveSlaDeadlines(input);
      expect(result).toBeNull();
    });

    it('calculates correct deadline timestamps', () => {
      const input: SlaEvaluateInput = { priority: 'P1', queue: 'enterprise', policies: mockPolicies, nowIso: now };
      const result = resolveSlaDeadlines(input);
      expect(result).not.toBeNull();
      const frDue = new Date(result!.firstResponseDue).getTime();
      const resDue = new Date(result!.resolutionDue).getTime();
      const base = new Date(now).getTime();
      expect(frDue).toBe(base + 10 * 60_000);
      expect(resDue).toBe(base + 120 * 60_000);
    });

    it('throws on invalid nowIso', () => {
      const input: SlaEvaluateInput = { priority: 'P1', queue: 'all', policies: mockPolicies, nowIso: 'invalid' };
      expect(() => resolveSlaDeadlines(input)).toThrow('Invalid ISO timestamp');
    });
  });

  describe('evaluateSlaState', () => {
    it('reports first response breached when past due and not responded', () => {
      const ticket: TicketLike = {
        priority: 'P1',
        queue: 'enterprise',
        first_response_due_at: '2026-01-15T09:50:00.000Z',
        first_responded_at: null,
        resolution_due_at: '2026-01-15T12:00:00.000Z',
        resolved_at: null,
      };
      const state = evaluateSlaState(ticket, now);
      expect(state.firstResponseBreached).toBe(true);
      expect(state.resolutionBreached).toBe(false);
    });

    it('reports resolution breached when past due and not resolved', () => {
      const ticket: TicketLike = {
        priority: 'P1',
        queue: 'enterprise',
        first_response_due_at: '2026-01-15T09:50:00.000Z',
        first_responded_at: '2026-01-15T09:55:00.000Z',
        resolution_due_at: '2026-01-15T09:00:00.000Z',
        resolved_at: null,
      };
      const state = evaluateSlaState(ticket, now);
      expect(state.firstResponseBreached).toBe(false);
      expect(state.resolutionBreached).toBe(true);
    });

    it('reports no breach when responded before deadline', () => {
      const ticket: TicketLike = {
        priority: 'P1',
        queue: 'enterprise',
        first_response_due_at: '2026-01-15T10:10:00.000Z',
        first_responded_at: '2026-01-15T10:05:00.000Z',
        resolution_due_at: '2026-01-15T12:00:00.000Z',
        resolved_at: null,
      };
      const state = evaluateSlaState(ticket, now);
      expect(state.firstResponseBreached).toBe(false);
      expect(state.resolutionBreached).toBe(false);
      expect(state.minutesRemainingToFirstResponse).toBe(0);
    });

    it('reports no breach when resolved before deadline', () => {
      const ticket: TicketLike = {
        priority: 'P1',
        queue: 'enterprise',
        first_response_due_at: '2026-01-15T09:50:00.000Z',
        first_responded_at: '2026-01-15T09:55:00.000Z',
        resolution_due_at: '2026-01-15T12:00:00.000Z',
        resolved_at: '2026-01-15T11:00:00.000Z',
      };
      const state = evaluateSlaState(ticket, now);
      expect(state.firstResponseBreached).toBe(false);
      expect(state.resolutionBreached).toBe(false);
      expect(state.minutesRemainingToResolution).toBe(0);
    });

    it('returns zero minutes remaining when already breached', () => {
      const ticket: TicketLike = {
        priority: 'P1',
        queue: 'enterprise',
        first_response_due_at: '2026-01-15T09:00:00.000Z',
        first_responded_at: null,
        resolution_due_at: '2026-01-15T09:00:00.000Z',
        resolved_at: null,
      };
      const state = evaluateSlaState(ticket, now);
      expect(state.minutesRemainingToFirstResponse).toBe(0);
      expect(state.minutesRemainingToResolution).toBe(0);
    });

    it('handles missing due dates gracefully', () => {
      const ticket: TicketLike = {
        priority: 'P1',
        queue: 'enterprise',
        first_response_due_at: null,
        resolution_due_at: null,
      };
      const state = evaluateSlaState(ticket, now);
      expect(state.firstResponseBreached).toBe(false);
      expect(state.resolutionBreached).toBe(false);
      expect(state.minutesRemainingToFirstResponse).toBe(0);
      expect(state.minutesRemainingToResolution).toBe(0);
    });

    it('throws on invalid timestamps', () => {
      const ticket: TicketLike = {
        priority: 'P1',
        queue: 'enterprise',
        first_response_due_at: 'invalid',
      };
      expect(() => evaluateSlaState(ticket, now)).toThrow('Invalid ISO timestamp');
    });
  });

  describe('nextEscalation', () => {
    const baseTicket: TicketLike = {
      priority: 'P1',
      queue: 'enterprise',
      sla_policy: 1,
      first_response_due_at: '2026-01-15T09:30:00.000Z',
      resolution_due_at: '2026-01-15T12:00:00.000Z',
      first_responded_at: null,
      resolved_at: null,
      escalation_level: 0,
    };

    it('escalates on first response breach after threshold', () => {
      const decision = nextEscalation(mockRules[0], baseTicket, '2026-01-15T10:05:00.000Z');
      expect(decision.shouldEscalate).toBe(true);
      expect(decision.escalateTo).toBe('team_lead');
      expect(decision.level).toBe(1);
    });

    it('does not escalate before threshold', () => {
      const decision = nextEscalation(mockRules[0], baseTicket, '2026-01-15T09:45:00.000Z');
      expect(decision.shouldEscalate).toBe(false);
    });

    it('does not escalate if rule inactive', () => {
      const decision = nextEscalation(mockRules[5], baseTicket, '2026-01-15T10:05:00.000Z');
      expect(decision.shouldEscalate).toBe(false);
    });

    it('does not escalate if max escalations reached', () => {
      const ticket = { ...baseTicket, escalation_level: 2 };
      const decision = nextEscalation(mockRules[0], ticket, '2026-01-15T10:05:00.000Z');
      expect(decision.shouldEscalate).toBe(false);
    });

    it('escalates on resolution breach', () => {
      const ticket = { ...baseTicket, first_responded_at: '2026-01-15T09:40:00.000Z', resolution_due_at: '2026-01-15T09:00:00.000Z' };
      const decision = nextEscalation(mockRules[1], ticket, '2026-01-15T10:05:00.000Z');
      expect(decision.shouldEscalate).toBe(true);
      expect(decision.escalateTo).toBe('manager');
    });

    it('returns current level when no escalation', () => {
      const ticket = { ...baseTicket, escalation_level: 1 };
      const decision = nextEscalation(mockRules[0], ticket, '2026-01-15T09:45:00.000Z');
      expect(decision.level).toBe(1);
      expect(decision.shouldEscalate).toBe(false);
    });
  });

  describe('suggestAutoReply', () => {
    const articles: KnowledgeArticleLike[] = [
      { ref: 'KB-001', title: 'How to reset password', snippet: 'To reset your password, go to the login page and click forgot password. Enter your email and follow the link.' },
      { ref: 'KB-002', title: 'Billing FAQ', snippet: 'Your invoice is generated monthly. Payment is due within 30 days. Contact billing for disputes.' },
      { ref: 'KB-003', title: 'API Integration', snippet: 'Use the REST API with your API key. Rate limits are 1000 requests per hour. Webhook support available.' },
    ];

    it('returns best matching article with confidence', () => {
      const result = suggestAutoReply('I forgot my password how do I reset it', articles);
      expect(result).not.toBeNull();
      expect(result!.articleRef).toBe('KB-001');
      expect(result!.confidence).toBeGreaterThan(0);
    });

    it('returns null when confidence below threshold', () => {
      const result = suggestAutoReply('xyz unrelated question', articles);
      expect(result).toBeNull();
    });

    it('returns null for empty question', () => {
      const result = suggestAutoReply('', articles);
      expect(result).toBeNull();
    });

    it('returns null for empty articles list', () => {
      const result = suggestAutoReply('password reset', []);
      expect(result).toBeNull();
    });

    it('uses article score when provided', () => {
      const articlesWithScore = articles.map((a, i) => ({ ...a, score: i === 1 ? 0.9 : 0.1 }));
      const result = suggestAutoReply('billing invoice payment', articlesWithScore);
      expect(result).not.toBeNull();
      expect(result!.articleRef).toBe('KB-002');
    });
  });

  describe('computeCsatSummary', () => {
    it('computes summary with all categories', () => {
      const surveys: CsatSurveyLike[] = [
        { responded: true, rating: 5 },
        { responded: true, rating: 5 },
        { responded: true, rating: 4 },
        { responded: true, rating: 3 },
        { responded: true, rating: 2 },
        { responded: false, rating: 4 },
      ];
      const summary = computeCsatSummary(surveys);
      expect(summary.responded).toBe(5);
      expect(summary.average).toBe(3.8);
      expect(summary.promoters).toBe(2);
      expect(summary.passives).toBe(1);
      expect(summary.detractors).toBe(2);
      expect(summary.nps).toBe(0);
    });

    it('returns zeros for no responded surveys', () => {
      const surveys: CsatSurveyLike[] = [
        { responded: false, rating: 5 },
        { responded: false, rating: null },
      ];
      const summary = computeCsatSummary(surveys);
      expect(summary.responded).toBe(0);
      expect(summary.average).toBe(0);
      expect(summary.nps).toBe(0);
    });

    it('handles only promoters', () => {
      const surveys: CsatSurveyLike[] = [
        { responded: true, rating: 5 },
        { responded: true, rating: 5 },
      ];
      const summary = computeCsatSummary(surveys);
      expect(summary.promoters).toBe(2);
      expect(summary.nps).toBe(100);
    });

    it('handles only detractors', () => {
      const surveys: CsatSurveyLike[] = [
        { responded: true, rating: 1 },
        { responded: true, rating: 2 },
      ];
      const summary = computeCsatSummary(surveys);
      expect(summary.detractors).toBe(2);
      expect(summary.nps).toBe(-100);
    });

    it('ignores surveys without rating', () => {
      const surveys: CsatSurveyLike[] = [
        { responded: true, rating: 5 },
        { responded: true, rating: null },
        { responded: true, rating: undefined },
      ];
      const summary = computeCsatSummary(surveys);
      expect(summary.responded).toBe(1);
      expect(summary.average).toBe(5);
    });
  });
});