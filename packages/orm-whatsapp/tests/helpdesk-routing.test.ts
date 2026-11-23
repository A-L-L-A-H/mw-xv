import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  addBusinessMinutes,
  buildWhatsappHelpdeskEscalations,
  buildWhatsappHelpdeskSeed,
  calculateWhatsappHelpdeskSla,
  classifyWhatsappHelpdeskIntent,
  createWhatsappHelpdeskTicket,
  evaluateWhatsappHelpdeskEscalation,
  isWhatsappHelpdeskBusinessMoment,
  resolveWhatsappHelpdeskTemplate,
  selectWhatsappHelpdeskQueue,
  type WhatsappHelpdeskInboundThread,
  type WhatsappHelpdeskSeedBundle,
  type WhatsappHelpdeskTicketRequest,
} from '../src/index.js';

const SECURITY_THREAD: WhatsappHelpdeskInboundThread = {
  threadId: 'thread-phishing-001',
  companyId: 7,
  jid: '6281234567890@s.whatsapp.net',
  name: 'Siti Rahmawati',
  contactJid: '6281234567890@s.whatsapp.net',
  assignedUserId: null,
  assignedTeamId: null,
  workState: 'inbox',
  messages: [
    {
      externalId: 'wa-msg-security-1',
      direction: 'inbound',
      content: 'Halo, saya menerima link phishing dan akun saya dibobol. Tolong bantu.',
      senderJid: '6281234567890@s.whatsapp.net',
      sentAt: '2026-11-20T01:58:00.000Z',
      providerType: 'text',
    },
    {
      externalId: 'wa-msg-security-2',
      direction: 'outbound',
      content: 'Tim kami sedang meninjau laporan Anda.',
      senderJid: '6281111111111@s.whatsapp.net',
      sentAt: '2026-11-20T01:59:00.000Z',
      providerType: 'text',
    },
  ],
};

const BILLING_THREAD: WhatsappHelpdeskInboundThread = {
  threadId: 'thread-billing-001',
  companyId: 7,
  jid: '6287654321098@s.whatsapp.net',
  name: 'Budi Santoso',
  messages: [
    {
      externalId: 'wa-msg-billing-1',
      direction: 'inbound',
      content:
        'Pembayaran QRIS untuk invoice INV-2026-001 belum masuk. Mohon bantu verifikasi tagihan.',
      senderJid: '6287654321098@s.whatsapp.net',
      sentAt: '2026-11-20T02:00:00.000Z',
      providerType: 'text',
    },
  ],
};

const ACCOUNT_THREAD: WhatsappHelpdeskInboundThread = {
  threadId: 'thread-account-001',
  companyId: 7,
  jid: '6285555555555@s.whatsapp.net',
  name: 'Dewi Anggraini',
  messages: [
    {
      externalId: 'wa-msg-account-1',
      direction: 'inbound',
      content: 'Saya ingin verifikasi akun dan memperbarui nomor telepon.',
      senderJid: '6285555555555@s.whatsapp.net',
      sentAt: '2026-11-20T02:00:00.000Z',
      providerType: 'text',
    },
  ],
};

function createRequest(
  thread: WhatsappHelpdeskInboundThread,
  createdAt: string
): WhatsappHelpdeskTicketRequest {
  return {
    thread,
    channel: 'whatsapp',
    createdAt,
  };
}

describe('Wave Q2B WhatsApp helpdesk routing', () => {
  it('creates deterministic inbound tickets with queue, contact, and source message provenance', () => {
    const first = createWhatsappHelpdeskTicket(
      createRequest(SECURITY_THREAD, '2026-11-20T02:00:00.000Z')
    );
    const second = createWhatsappHelpdeskTicket(
      createRequest(SECURITY_THREAD, '2026-11-20T02:00:00.000Z')
    );

    assert.deepEqual(first, second);
    assert.equal(first.ticket.code, 'WA-20261120-SHING001');
    assert.equal(first.ticket.source, 'whatsapp');
    assert.equal(first.ticket.status, 'open');
    assert.equal(first.ticket.category, 'security');
    assert.equal(first.ticket.priority, 'P1');
    assert.equal(first.queue.code, 'SEC-ID');
    assert.equal(first.ticket.assignment.queueId, 'waq-security-incident');
    assert.equal(first.ticket.assignment.team, 'security-oncall');
    assert.equal(first.ticket.companyId, 7);
    assert.equal(first.ticket.contact.name, 'Siti Rahmawati');
    assert.equal(first.ticket.contact.senderJid, '6281234567890@s.whatsapp.net');
    assert.deepEqual(first.ticket.sourceMessageIds, ['wa-msg-security-1']);
    assert.match(first.ticket.subject, /Siti Rahmawati: halo, saya menerima link phishing/);
  });

  it('classifies Nusantara transactional intent and resolves WhatsApp templates', () => {
    const request = createRequest(BILLING_THREAD, '2026-11-20T02:00:00.000Z');
    const classification = classifyWhatsappHelpdeskIntent(request);

    assert.equal(classification.category, 'billing');
    assert.equal(classification.priority, 'P2');
    assert.ok(classification.scores.some((score) => score.category === 'billing'));
    assert.ok(classification.matchedTemplateCodes.includes('transaction.payment.received'));
    assert.equal(selectWhatsappHelpdeskQueue(classification).code, 'BIL-ID');

    const message = resolveWhatsappHelpdeskTemplate(
      { templateCode: 'transaction.payment.received' },
      {
        amount_idr: 'Rp 250.000',
        invoice_number: 'INV-2026-001',
        payment_method: 'QRIS',
        receipt_url: 'https://nusantara.example.id/receipt/INV-2026-001',
      }
    );

    assert.match(message, /Pembayaran Rp 250\.000 untuk invoice INV-2026-001/);
    assert.match(message, /melalui QRIS/);
    assert.doesNotMatch(message, /\{/);
  });

  it('calculates Jakarta business-hour SLA timers across non-working windows', () => {
    const fridayBusiness = calculateWhatsappHelpdeskSla('P4', '2026-11-20T10:00:00.000Z');
    assert.equal(fridayBusiness.calendar, 'jakarta_business_hours');
    assert.equal(fridayBusiness.responseMinutes, 240);
    assert.equal(fridayBusiness.firstResponseDueAt, '2026-11-23T05:00:00.000Z');
    assert.equal(fridayBusiness.resolutionDueAt, '2026-11-30T04:00:00.000Z');

    const critical = calculateWhatsappHelpdeskSla('P1', '2026-11-20T10:00:00.000Z');
    assert.equal(critical.calendar, '24x7');
    assert.equal(critical.firstResponseDueAt, '2026-11-20T10:15:00.000Z');
    assert.equal(critical.resolutionDueAt, '2026-11-20T14:00:00.000Z');

    assert.equal(
      addBusinessMinutes(new Date('2026-11-20T08:30:00.000Z'), 30).toISOString(),
      '2026-11-20T09:00:00.000Z'
    );
  });

  it('builds escalation policies and evaluates due escalation levels', () => {
    const plan = createWhatsappHelpdeskTicket(
      createRequest(BILLING_THREAD, '2026-11-20T02:00:00.000Z')
    );
    const firstStep = plan.ticket.escalations.find((step) => step.level === 1);

    assert.equal(plan.escalationPolicy.id, 'wa-esc-p2');
    assert.deepEqual(
      plan.ticket.escalations.map((step) => step.dueAt),
      ['2026-11-20T02:30:00.000Z', '2026-11-20T04:00:00.000Z']
    );
    assert.equal(firstStep?.targetQueueCode, 'T2-ID');
    assert.equal(firstStep?.severity, 'warning');
    assert.deepEqual(firstStep?.notifyRoles, ['team-lead', 'billing-operations']);

    const before = evaluateWhatsappHelpdeskEscalation(plan.ticket, 1, '2026-11-20T02:29:59.000Z');
    const atDue = evaluateWhatsappHelpdeskEscalation(plan.ticket, 1, '2026-11-20T09:00:00.000Z');

    assert.equal(before.isDue, false);
    assert.equal(atDue.isDue, true);
    assert.equal(atDue.fromQueueId, 'waq-billing-nusantara');
    assert.equal(atDue.toQueueId, 'waq-support-tier-2');
    assert.equal(atDue.level, 1);
    assert.equal(atDue.severity, 'warning');
    assert.match(atDue.reason, /Escalation level 1 after 30 minutes/);
  });

  it('routes account triage through deterministic tier-1 fallback and rejects insufficient threads', () => {
    const classification = classifyWhatsappHelpdeskIntent(
      createRequest(ACCOUNT_THREAD, '2026-11-20T02:00:00.000Z')
    );
    assert.equal(classification.category, 'account');
    assert.equal(classification.priority, 'P4');

    const queue = selectWhatsappHelpdeskQueue(classification);
    assert.equal(queue.id, 'waq-support-tier-1');
    assert.equal(queue.intakeEnabled, true);

    const noInbound: WhatsappHelpdeskInboundThread = {
      ...ACCOUNT_THREAD,
      messages: [
        {
          externalId: 'wa-msg-outbound-only',
          direction: 'outbound',
          content: 'Pembayaran sudah kami terima.',
          senderJid: '6281111111111@s.whatsapp.net',
          sentAt: '2026-11-20T02:00:00.000Z',
        },
      ],
    };
    assert.throws(
      () => createWhatsappHelpdeskTicket(createRequest(noInbound, '2026-11-20T02:00:00.000Z')),
      /has no inbound messages/
    );
  });

  it('provides deterministic Nusantara seed bundles isolated from caller mutation', () => {
    const first = buildWhatsappHelpdeskSeed();
    const second = buildWhatsappHelpdeskSeed();

    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.equal(first.version, '1.0.0');
    assert.equal(first.timezone, 'Asia/Jakarta');
    assert.equal(first.utcOffsetMinutes, 420);
    assert.equal(first.templates.length, 11);
    assert.equal(first.queues.length, 7);
    assert.equal(first.slaPolicies.length, 4);
    assert.equal(first.escalationPolicies.length, 4);
    assert.equal(first.categoryRules.length, 6);
    assert.deepEqual(
      first.queues.map((queue) => queue.code),
      ['SEC-ID', 'SYR-ID', 'BIL-ID', 'LOG-ID', 'T2-ID', 'T1-ID', 'MGR-ID']
    );

    const mutatedSeed: WhatsappHelpdeskSeedBundle = {
      ...buildWhatsappHelpdeskSeed(),
      templates: first.templates.map((template, index) =>
        index === 0 ? { ...template, variables: [...template.variables, 'mutation'] } : template
      ),
      queues: first.queues.map((queue, index) =>
        index === 0 ? { ...queue, priorities: [...queue.priorities, 'P3'] } : queue
      ),
    };
    assert.equal(mutatedSeed.templates[0].variables.length, 5);
    assert.deepEqual(mutatedSeed.queues[0].priorities, ['P1', 'P2', 'P3']);
    assert.equal(second.templates[0].variables.length, 4);
    assert.deepEqual(second.queues[0].priorities, ['P1', 'P2']);
  });

  it('validates template variables and Jakarta business moments', () => {
    assert.throws(
      () =>
        resolveWhatsappHelpdeskTemplate(
          { templateCode: 'transaction.delivery.updated' },
          { tracking_number: 'JP-001' }
        ),
      /requires hub_city, destination_city, eta_label/
    );
    assert.throws(
      () => resolveWhatsappHelpdeskTemplate({ templateCode: 'transaction.unknown' }, {}),
      /template transaction\.unknown is missing/
    );

    assert.equal(
      isWhatsappHelpdeskBusinessMoment({ utcTimestamp: '2026-11-20T02:00:00.000Z' }),
      true
    );
    assert.equal(
      isWhatsappHelpdeskBusinessMoment({ utcTimestamp: '2026-11-20T01:59:00.000Z' }),
      false
    );
    assert.equal(
      isWhatsappHelpdeskBusinessMoment({ utcTimestamp: '2026-11-20T11:00:00.000Z' }),
      false
    );
    assert.equal(
      isWhatsappHelpdeskBusinessMoment({ utcTimestamp: '2026-11-21T02:00:00.000Z' }),
      false
    );
  });

  it('rejects malformed UTC timestamps and negative business durations', () => {
    assert.throws(
      () => calculateWhatsappHelpdeskSla('P1', '2026-11-20T02:00:00+07:00'),
      /ISO 8601 UTC timestamp/
    );
    assert.throws(
      () => addBusinessMinutes(new Date('2026-11-20T02:00:00.000Z'), -1),
      /non-negative integer/
    );
    assert.throws(
      () => buildWhatsappHelpdeskEscalations('P1', 'not-a-timestamp'),
      /ISO 8601 UTC timestamp/
    );
  });
});
