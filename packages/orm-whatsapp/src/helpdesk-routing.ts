import { MILLISECONDS_PER_MINUTE } from '@moonwitness/types';
import { buildWhatsappHelpdeskSeed } from './seed.js';
import type {
  WhatsappHelpdeskCategory,
  WhatsappHelpdeskChannel,
  WhatsappHelpdeskEscalationPolicy,
  WhatsappHelpdeskPriority,
  WhatsappHelpdeskRoutingQueue,
  WhatsappHelpdeskSlaPolicy,
} from './seed.js';

export interface WhatsappHelpdeskScheduledMoment {
  readonly utcTimestamp: string;
}

export interface WhatsappHelpdeskTicketIntent {
  readonly templateCode: string;
}

export type WhatsappHelpdeskInboundDirection = 'inbound' | 'outbound';

export interface WhatsappHelpdeskInboundMessage {
  readonly externalId: string;
  readonly direction: WhatsappHelpdeskInboundDirection;
  readonly content: string;
  readonly senderJid: string;
  readonly sentAt: string;
  readonly providerType?: string | null;
}

export interface WhatsappHelpdeskInboundThread {
  readonly threadId: string;
  readonly companyId: number;
  readonly jid: string;
  readonly name: string;
  readonly contactJid?: string | null;
  readonly assignedUserId?: number | null;
  readonly assignedTeamId?: number | null;
  readonly workState?: string | null;
  readonly messages: readonly WhatsappHelpdeskInboundMessage[];
}

export interface WhatsappHelpdeskTicketRequest {
  readonly thread: WhatsappHelpdeskInboundThread;
  readonly channel: WhatsappHelpdeskChannel;
  readonly locale?: 'id-ID';
  readonly requestedPriority?: WhatsappHelpdeskPriority;
  readonly requestedCategory?: WhatsappHelpdeskCategory;
  readonly createdAt: string;
}

export interface WhatsappHelpdeskCategoryScore {
  readonly category: WhatsappHelpdeskCategory;
  readonly score: number;
  readonly matchedPatterns: readonly string[];
}

export interface WhatsappHelpdeskClassification {
  readonly category: WhatsappHelpdeskCategory;
  readonly priority: WhatsappHelpdeskPriority;
  readonly scores: readonly WhatsappHelpdeskCategoryScore[];
  readonly matchedTemplateCodes: readonly string[];
  readonly rationale: string;
}

export interface WhatsappHelpdeskSlaTimer {
  readonly policyId: string;
  readonly calendar: WhatsappHelpdeskSlaPolicy['calendar'];
  readonly startedAt: string;
  readonly firstResponseDueAt: string;
  readonly resolutionDueAt: string;
  readonly responseMinutes: number;
  readonly resolutionMinutes: number;
}

export interface WhatsappHelpdeskEscalationStep {
  readonly policyId: string;
  readonly level: number;
  readonly afterMinutes: number;
  readonly dueAt: string;
  readonly targetQueueId: string;
  readonly targetQueueCode: string;
  readonly targetQueueName: string;
  readonly notifyRoles: readonly string[];
  readonly severity: 'warning' | 'critical';
}

export interface WhatsappHelpdeskTicket {
  readonly code: string;
  readonly source: 'whatsapp';
  readonly channel: WhatsappHelpdeskChannel;
  readonly status: 'open';
  readonly category: WhatsappHelpdeskCategory;
  readonly priority: WhatsappHelpdeskPriority;
  readonly subject: string;
  readonly description: string;
  readonly locale: 'id-ID';
  readonly createdAt: string;
  readonly companyId: number;
  readonly threadId: string;
  readonly contact: {
    readonly jid: string;
    readonly name: string;
    readonly senderJid: string;
  };
  readonly assignment: {
    readonly queueId: string;
    readonly queueCode: string;
    readonly queueName: string;
    readonly team: string;
    readonly assignedUserId: number | null;
    readonly assignedTeamId: number | null;
  };
  readonly classification: WhatsappHelpdeskClassification;
  readonly sla: WhatsappHelpdeskSlaTimer;
  readonly escalations: readonly WhatsappHelpdeskEscalationStep[];
  readonly sourceMessageIds: readonly string[];
}

export interface WhatsappHelpdeskTicketPlan {
  readonly ticket: WhatsappHelpdeskTicket;
  readonly queue: WhatsappHelpdeskRoutingQueue;
  readonly slaPolicy: WhatsappHelpdeskSlaPolicy;
  readonly escalationPolicy: WhatsappHelpdeskEscalationPolicy;
}

export interface WhatsappHelpdeskEscalationDecision {
  readonly ticketCode: string;
  readonly fromQueueId: string;
  readonly toQueueId: string;
  readonly toQueueCode: string;
  readonly toQueueName: string;
  readonly level: number;
  readonly severity: 'warning' | 'critical';
  readonly dueAt: string;
  readonly evaluatedAt: string;
  readonly isDue: boolean;
  readonly notifyRoles: readonly string[];
  readonly reason: string;
}

const URGENT_PATTERNS: readonly string[] = [
  'phishing',
  'penipuan',
  'dibobol',
  'kebocoran data',
  'data bocor',
  'aktivitas tidak sah',
  'kode otp bukan saya',
  'riba',
  'gagal bayar',
  'transaction failed',
  'tidak bisa login',
];
const HIGH_IMPACT_PATTERNS: readonly string[] = [
  'refund',
  'qris',
  'tagihan',
  'invoice',
  'resi',
  'pengiriman',
  'akad',
  'zakat',
  'wakaf',
  'gangguan',
  'error',
  'timeout',
];

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('id-ID').replace(/\s+/gu, ' ').trim();
}

function assertIsoTimestamp(value: string, fieldName: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !value.endsWith('Z')) {
    throw new Error(`${fieldName} must be a valid ISO 8601 UTC timestamp`);
  }
  return parsed;
}

function containsPattern(haystack: string, pattern: string): boolean {
  const normalizedPattern = normalizeText(pattern);
  if (!normalizedPattern.includes(' ')) {
    return haystack.includes(normalizedPattern);
  }
  return haystack.split(' ').includes(normalizedPattern);
}

function collectInboundMessages(
  thread: WhatsappHelpdeskInboundThread
): readonly WhatsappHelpdeskInboundMessage[] {
  const inbound = thread.messages.filter((message) => message.direction === 'inbound');
  if (inbound.length === 0) {
    throw new Error(`WhatsApp thread ${thread.threadId} has no inbound messages`);
  }
  return inbound;
}

function findTemplateCodes(category: WhatsappHelpdeskCategory, content: string): readonly string[] {
  const normalized = normalizeText(content);
  return buildWhatsappHelpdeskSeed()
    .templates.filter((template) => {
      if (template.category !== category) {
        return false;
      }
      return template.body
        .replace(/\{[a-z_]+\}/gu, ' ')
        .split(' ')
        .filter((token) => token.length >= 5)
        .some((token) => containsPattern(normalized, token));
    })
    .map((template) => template.code);
}

export function classifyWhatsappHelpdeskIntent(
  input: Pick<
    WhatsappHelpdeskTicketRequest,
    'thread' | 'channel' | 'requestedPriority' | 'requestedCategory'
  >
): WhatsappHelpdeskClassification {
  const inbound = collectInboundMessages(input.thread);
  const content = normalizeText(inbound.map((message) => message.content).join('\n'));
  const bundle = buildWhatsappHelpdeskSeed();
  const scores = bundle.categoryRules
    .map((rule) => {
      const matchedPatterns = rule.patterns.filter((pattern) => containsPattern(content, pattern));
      return {
        category: rule.category,
        score: matchedPatterns.length * rule.weight,
        matchedPatterns,
      };
    })
    .filter((score) => score.score > 0)
    .sort((left, right) => right.score - left.score || left.category.localeCompare(right.category));

  const category = input.requestedCategory ?? scores[0]?.category ?? 'general';

  const hasUrgentSignal = URGENT_PATTERNS.some((pattern) => containsPattern(content, pattern));
  const hasHighImpactSignal = HIGH_IMPACT_PATTERNS.some((pattern) =>
    containsPattern(content, pattern)
  );
  const priority =
    input.requestedPriority ?? (hasUrgentSignal ? 'P1' : hasHighImpactSignal ? 'P2' : 'P4');

  const matchedTemplateCodes = findTemplateCodes(category, content);
  const rationale =
    scores.length === 0
      ? 'No category rule matched; routed by deterministic default rule.'
      : `Matched ${scores[0].matchedPatterns.join(', ')} for ${scores[0].category}.`;

  return {
    category,
    priority,
    scores,
    matchedTemplateCodes,
    rationale,
  };
}

export function selectWhatsappHelpdeskQueue(
  classification: Pick<WhatsappHelpdeskClassification, 'category' | 'priority'>,
  channel: WhatsappHelpdeskChannel = 'whatsapp'
): WhatsappHelpdeskRoutingQueue {
  const candidates = buildWhatsappHelpdeskSeed()
    .queues.filter(
      (queue) =>
        queue.intakeEnabled &&
        queue.categories.includes(classification.category) &&
        queue.channels.includes(channel) &&
        queue.priorities.includes(classification.priority)
    )
    .sort((left, right) => left.sequence - right.sequence);

  const queue =
    candidates[0] ??
    buildWhatsappHelpdeskSeed().queues.find((candidate) => candidate.id === 'waq-support-tier-1');
  if (!queue) {
    throw new Error('Deterministic fallback queue is missing from the helpdesk seed');
  }
  return queue;
}

export function addBusinessMinutes(
  from: Date,
  minutes: number,
  seed = buildWhatsappHelpdeskSeed()
): Date {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new Error('Business minutes must be a non-negative integer');
  }
  if (minutes === 0) {
    return new Date(from.getTime());
  }

  const cursor = new Date(from.getTime());
  let remaining = minutes;
  while (remaining > 0) {
    const local = new Date(cursor.getTime() + seed.utcOffsetMinutes * MILLISECONDS_PER_MINUTE);
    const day = local.getUTCDay();
    const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();

    if (day === 0 || day === 6 || minuteOfDay >= seed.workEndMinute) {
      const nextDay = new Date(
        Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1)
      );
      nextDay.setUTCHours(seed.workStartMinute / 60, seed.workStartMinute % 60, 0, 0);
      cursor.setTime(nextDay.getTime() - seed.utcOffsetMinutes * MILLISECONDS_PER_MINUTE);
      continue;
    }

    if (minuteOfDay < seed.workStartMinute) {
      const opening = new Date(
        Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
      );
      opening.setUTCHours(seed.workStartMinute / 60, seed.workStartMinute % 60, 0, 0);
      cursor.setTime(opening.getTime() - seed.utcOffsetMinutes * MILLISECONDS_PER_MINUTE);
      continue;
    }

    const available = Math.min(remaining, seed.workEndMinute - minuteOfDay);
    cursor.setTime(cursor.getTime() + available * MILLISECONDS_PER_MINUTE);
    remaining -= available;
  }
  return cursor;
}

export function calculateWhatsappHelpdeskSla(
  priority: WhatsappHelpdeskPriority,
  startedAt: string,
  calendar?: WhatsappHelpdeskSlaPolicy['calendar']
): WhatsappHelpdeskSlaTimer {
  const seed = buildWhatsappHelpdeskSeed();
  const policy = seed.slaPolicies.find((candidate) => candidate.priority === priority);
  if (!policy) {
    throw new Error(`SLA policy for priority ${priority} is missing`);
  }
  const effectiveCalendar = calendar ?? policy.calendar;
  const start = assertIsoTimestamp(startedAt, 'startedAt');
  const addMinutes =
    effectiveCalendar === '24x7'
      ? (minutes: number) => new Date(start.getTime() + minutes * MILLISECONDS_PER_MINUTE)
      : (minutes: number) => addBusinessMinutes(start, minutes, seed);

  return {
    policyId: policy.id,
    calendar: effectiveCalendar,
    startedAt: start.toISOString(),
    firstResponseDueAt: addMinutes(policy.responseMinutes).toISOString(),
    resolutionDueAt: addMinutes(policy.resolutionMinutes).toISOString(),
    responseMinutes: policy.responseMinutes,
    resolutionMinutes: policy.resolutionMinutes,
  };
}

export function buildWhatsappHelpdeskEscalations(
  priority: WhatsappHelpdeskPriority,
  startedAt: string,
  calendar?: WhatsappHelpdeskSlaPolicy['calendar']
): readonly WhatsappHelpdeskEscalationStep[] {
  const seed = buildWhatsappHelpdeskSeed();
  const policy = seed.escalationPolicies.find((candidate) => candidate.priority === priority);
  if (!policy) {
    throw new Error(`Escalation policy for priority ${priority} is missing`);
  }
  const effectiveCalendar =
    calendar ?? seed.slaPolicies.find((candidate) => candidate.priority === priority)?.calendar;
  const start = assertIsoTimestamp(startedAt, 'startedAt');

  return [...policy.levels]
    .sort((left, right) => left.level - right.level)
    .map((level) => {
      const queue = seed.queues.find((candidate) => candidate.id === level.targetQueueId);
      if (!queue) {
        throw new Error(`Escalation queue ${level.targetQueueId} is missing`);
      }
      const due =
        effectiveCalendar === '24x7'
          ? new Date(start.getTime() + level.afterMinutes * MILLISECONDS_PER_MINUTE)
          : addBusinessMinutes(start, level.afterMinutes, seed);
      return {
        policyId: policy.id,
        level: level.level,
        afterMinutes: level.afterMinutes,
        dueAt: due.toISOString(),
        targetQueueId: queue.id,
        targetQueueCode: queue.code,
        targetQueueName: queue.name,
        notifyRoles: [...level.notifyRoles],
        severity: level.severity,
      };
    });
}

function buildTicketCode(threadId: string, createdAt: string): string {
  const created = assertIsoTimestamp(createdAt, 'createdAt');
  const datePart = created.toISOString().slice(0, 10).replace(/-/gu, '');
  const threadPart = threadId
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '')
    .slice(-8)
    .padStart(8, '0');
  return `WA-${datePart}-${threadPart}`;
}

function buildSubject(
  thread: WhatsappHelpdeskInboundThread,
  message: WhatsappHelpdeskInboundMessage
): string {
  const firstSentence = normalizeText(message.content).split('.')[0] ?? '';
  const truncated = firstSentence.slice(0, 120);
  return `${thread.name}: ${truncated}`;
}

export function createWhatsappHelpdeskTicket(
  request: WhatsappHelpdeskTicketRequest
): WhatsappHelpdeskTicketPlan {
  const classification = classifyWhatsappHelpdeskIntent(request);
  const queue = selectWhatsappHelpdeskQueue(classification, request.channel);
  const start = assertIsoTimestamp(request.createdAt, 'createdAt');
  const sla = calculateWhatsappHelpdeskSla(
    classification.priority,
    request.createdAt,
    queue.calendar
  );
  const escalations = buildWhatsappHelpdeskEscalations(
    classification.priority,
    request.createdAt,
    queue.calendar
  );
  const inbound = collectInboundMessages(request.thread);
  const firstMessage = inbound[0];
  const fallbackContact = request.thread.contactJid ?? request.thread.jid;

  const ticket: WhatsappHelpdeskTicket = {
    code: buildTicketCode(request.thread.threadId, request.createdAt),
    source: 'whatsapp',
    channel: request.channel,
    status: 'open',
    category: classification.category,
    priority: classification.priority,
    subject: buildSubject(request.thread, firstMessage),
    description: inbound
      .map((message) => `${message.sentAt} ${message.senderJid}: ${message.content}`)
      .join('\n'),
    locale: request.locale ?? 'id-ID',
    createdAt: start.toISOString(),
    companyId: request.thread.companyId,
    threadId: request.thread.threadId,
    contact: {
      jid: fallbackContact,
      name: request.thread.name,
      senderJid: firstMessage.senderJid,
    },
    assignment: {
      queueId: queue.id,
      queueCode: queue.code,
      queueName: queue.name,
      team: queue.team,
      assignedUserId: request.thread.assignedUserId ?? null,
      assignedTeamId: request.thread.assignedTeamId ?? null,
    },
    classification,
    sla,
    escalations,
    sourceMessageIds: inbound.map((message) => message.externalId),
  };

  const seed = buildWhatsappHelpdeskSeed();
  const slaPolicy = seed.slaPolicies.find((policy) => policy.id === sla.policyId);
  const escalationPolicy = seed.escalationPolicies.find(
    (policy) => policy.id === escalations[0]?.policyId
  );
  if (!slaPolicy || !escalationPolicy) {
    throw new Error('Ticket calculation referenced a missing helpdesk policy');
  }

  return { ticket, queue, slaPolicy, escalationPolicy };
}

export function evaluateWhatsappHelpdeskEscalation(
  ticket: WhatsappHelpdeskTicket,
  level: number,
  evaluatedAt: string
): WhatsappHelpdeskEscalationDecision {
  const step = ticket.escalations.find((candidate) => candidate.level === level);
  if (!step) {
    throw new Error(`Ticket ${ticket.code} has no escalation level ${level}`);
  }
  const evaluationTime = assertIsoTimestamp(evaluatedAt, 'evaluatedAt');
  return {
    ticketCode: ticket.code,
    fromQueueId: ticket.assignment.queueId,
    toQueueId: step.targetQueueId,
    toQueueCode: step.targetQueueCode,
    toQueueName: step.targetQueueName,
    level: step.level,
    severity: step.severity,
    dueAt: step.dueAt,
    evaluatedAt: evaluationTime.toISOString(),
    isDue: evaluationTime.getTime() >= new Date(step.dueAt).getTime(),
    notifyRoles: [...step.notifyRoles],
    reason: `Escalation level ${step.level} after ${step.afterMinutes} minutes from ticket creation.`,
  };
}

export function resolveWhatsappHelpdeskTemplate(
  intent: WhatsappHelpdeskTicketIntent,
  variables: Readonly<Record<string, string>>
): string {
  const template = buildWhatsappHelpdeskSeed().templates.find(
    (candidate) => candidate.code === intent.templateCode
  );
  if (!template) {
    throw new Error(`WhatsApp helpdesk template ${intent.templateCode} is missing`);
  }
  const missingVariables = template.variables.filter(
    (variable) => variables[variable] === undefined
  );
  if (missingVariables.length > 0) {
    throw new Error(`Template ${template.code} requires ${missingVariables.join(', ')}`);
  }
  return template.body.replace(
    /\{([a-z_]+)\}/gu,
    (_match, variable: string) => variables[variable] ?? ''
  );
}

export function isWhatsappHelpdeskBusinessMoment(moment: WhatsappHelpdeskScheduledMoment): boolean {
  const seed = buildWhatsappHelpdeskSeed();
  const timestamp = assertIsoTimestamp(moment.utcTimestamp, 'moment.utcTimestamp');
  const local = new Date(timestamp.getTime() + seed.utcOffsetMinutes * MILLISECONDS_PER_MINUTE);
  const day = local.getUTCDay();
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  return (
    day >= 1 && day <= 5 && minuteOfDay >= seed.workStartMinute && minuteOfDay < seed.workEndMinute
  );
}
