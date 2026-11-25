import { BASIS_POINTS_TOTAL, MILLISECONDS_PER_MINUTE } from '@moonwitness/types';

export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type TicketQueue = 'technical' | 'billing' | 'general' | 'enterprise';

export interface SlaPolicyLike {
  id: number;
  name: string;
  priority: string;
  first_response_minutes: number;
  resolution_minutes: number;
  business_hours_only?: boolean;
  applies_to_queue: TicketQueue | 'all';
  is_active?: boolean;
}

export interface SlaDeadlineResult {
  policyId: number;
  policyName: string;
  firstResponseDue: string;
  resolutionDue: string;
  breachPeriodNote: string;
}

export interface SlaEvaluateInput {
  priority: TicketPriority;
  queue: TicketQueue;
  policies: SlaPolicyLike[];
  nowIso: string;
}

export interface TicketLike {
  priority: string;
  queue: string;
  sla_policy?: number | null;
  first_response_due_at?: string | null;
  resolution_due_at?: string | null;
  first_responded_at?: string | null;
  resolved_at?: string | null;
  sla_breached?: boolean;
  escalation_level?: number;
}

export interface SlaState {
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  minutesRemainingToFirstResponse: number;
  minutesRemainingToResolution: number;
}

export interface EscalationRuleLike {
  id: number;
  name: string;
  sla_policy: number;
  trigger: 'first_response_breach' | 'resolution_breach' | 'priority_change' | 'reopen';
  escalate_after_minutes: number;
  escalate_to: 'team_lead' | 'on_call' | 'manager' | 'vendor';
  oncall_rotation?: string | null;
  max_escalations: number;
  is_active?: boolean;
}

export interface EscalationDecision {
  shouldEscalate: boolean;
  escalateTo: EscalationRuleLike['escalate_to'] | null;
  level: number;
}

export interface KnowledgeArticleLike {
  ref: string;
  title: string;
  snippet: string;
  score?: number;
}

export interface AutoReplySuggestion {
  articleRef: string;
  suggestionText: string;
  confidence: number;
}

export interface CsatSurveyLike {
  responded: boolean;
  rating?: number | null;
}

export interface CsatSummary {
  responded: number;
  average: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number;
}

const AUTO_REPLY_MIN_CONFIDENCE = 0.15;

function addMinutes(iso: string, minutes: number): string {
  const base = new Date(iso).getTime();
  if (Number.isNaN(base)) throw new Error(`Invalid ISO timestamp: ${iso}`);
  return new Date(base + minutes * MILLISECONDS_PER_MINUTE).toISOString();
}

function diffMinutes(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to))
    throw new Error('Invalid ISO timestamp in SLA computation');
  return Math.floor((from - to) / MILLISECONDS_PER_MINUTE);
}

export function resolveSlaDeadlines(input: SlaEvaluateInput): SlaDeadlineResult | null {
  const active = input.policies.filter((p) => p.is_active !== false);
  const exact = active.find(
    (p) => p.priority === input.priority && p.applies_to_queue === input.queue
  );
  const fallback = active.find(
    (p) => p.priority === input.priority && p.applies_to_queue === 'all'
  );
  const policy = exact ?? fallback;
  if (!policy) return null;

  return {
    policyId: policy.id,
    policyName: policy.name,
    firstResponseDue: addMinutes(input.nowIso, policy.first_response_minutes),
    resolutionDue: addMinutes(input.nowIso, policy.resolution_minutes),
    breachPeriodNote:
      `First response due within ${policy.first_response_minutes} minutes, ` +
      `resolution due within ${policy.resolution_minutes} minutes ` +
      `(priority ${policy.priority}, queue ${policy.applies_to_queue}` +
      `${policy.business_hours_only ? ', business hours only' : ''}).`,
  };
}

export function evaluateSlaState(ticket: TicketLike, nowIso: string): SlaState {
  const firstResponded = Boolean(ticket.first_responded_at);
  const resolved = Boolean(ticket.resolved_at);

  const firstResponseBreached =
    !firstResponded &&
    Boolean(ticket.first_response_due_at) &&
    diffMinutes(nowIso, ticket.first_response_due_at as string) > 0;

  const resolutionBreached =
    !resolved &&
    Boolean(ticket.resolution_due_at) &&
    diffMinutes(nowIso, ticket.resolution_due_at as string) > 0;

  const minutesRemainingToFirstResponse =
    firstResponded || !ticket.first_response_due_at
      ? 0
      : Math.max(0, diffMinutes(ticket.first_response_due_at as string, nowIso));

  const minutesRemainingToResolution =
    resolved || !ticket.resolution_due_at
      ? 0
      : Math.max(0, diffMinutes(ticket.resolution_due_at as string, nowIso));

  return {
    firstResponseBreached,
    resolutionBreached,
    minutesRemainingToFirstResponse,
    minutesRemainingToResolution,
  };
}

export function nextEscalation(
  rule: EscalationRuleLike,
  ticket: TicketLike,
  nowIso: string
): EscalationDecision {
  const level = ticket.escalation_level ?? 0;
  if (rule.is_active === false) return { shouldEscalate: false, escalateTo: null, level };
  if (level >= rule.max_escalations) return { shouldEscalate: false, escalateTo: null, level };

  const state = evaluateSlaState(ticket, nowIso);
  const breachedAt =
    rule.trigger === 'first_response_breach'
      ? state.firstResponseBreached
        ? ticket.first_response_due_at
        : null
      : rule.trigger === 'resolution_breach'
        ? state.resolutionBreached
          ? ticket.resolution_due_at
          : null
        : null;

  if (!breachedAt) return { shouldEscalate: false, escalateTo: null, level };

  const minutesSinceBreach = diffMinutes(nowIso, breachedAt);
  if (minutesSinceBreach < rule.escalate_after_minutes) {
    return { shouldEscalate: false, escalateTo: null, level };
  }

  return { shouldEscalate: true, escalateTo: rule.escalate_to, level: level + 1 };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

export function suggestAutoReply(
  question: string,
  articles: KnowledgeArticleLike[]
): AutoReplySuggestion | null {
  const tokens = new Set(tokenize(question));
  if (tokens.size === 0) return null;

  let best: { article: KnowledgeArticleLike; score: number } | null = null;
  for (const article of articles) {
    const haystack = tokenize(`${article.title} ${article.snippet}`);
    const haystackSet = new Set(haystack);
    let overlap = 0;
    for (const token of tokens) {
      if (haystackSet.has(token)) overlap += 1;
    }
    const score = overlap / tokens.size;
    const combined = article.score !== undefined ? (score + article.score) / 2 : score;
    if (!best || combined > best.score) {
      best = { article, score: combined };
    }
  }

  if (!best || best.score < AUTO_REPLY_MIN_CONFIDENCE) return null;
  return {
    articleRef: best.article.ref,
    suggestionText: best.article.snippet,
    confidence: Math.round(best.score * BASIS_POINTS_TOTAL) / BASIS_POINTS_TOTAL,
  };
}

export function computeCsatSummary(surveys: CsatSurveyLike[]): CsatSummary {
  const respondedSurveys = surveys.filter((s) => s.responded && typeof s.rating === 'number');
  const responded = respondedSurveys.length;
  if (responded === 0) {
    return { responded: 0, average: 0, promoters: 0, passives: 0, detractors: 0, nps: 0 };
  }

  const total = respondedSurveys.reduce((sum, s) => sum + (s.rating as number), 0);
  const average = Math.round((total / responded) * 100) / 100;
  const promoters = respondedSurveys.filter((s) => (s.rating as number) >= 5).length;
  const passives = respondedSurveys.filter((s) => (s.rating as number) === 4).length;
  const detractors = respondedSurveys.filter((s) => (s.rating as number) <= 3).length;
  const nps = Math.round(((promoters - detractors) / responded) * 100);

  return { responded, average, promoters, passives, detractors, nps };
}
