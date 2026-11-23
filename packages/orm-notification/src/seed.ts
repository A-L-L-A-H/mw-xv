import type { Knex } from 'knex';
import { NotificationTemplate } from './models.js';
import type { NotificationChannel, NotificationSeverity } from './notification-router.js';

export const NOTIFICATION_SEED_VERSION = '1.0.0';

export type NotificationSeedChannelCode = NotificationChannel;
export type NotificationTemplateSeedChannel = 'in_app' | 'email';

export interface NotificationChannelSeed {
  readonly code: NotificationSeedChannelCode;
  readonly label: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly supportsDigest: boolean;
  readonly defaultSeverity: NotificationSeverity;
}

export interface NotificationTemplateSeed {
  readonly code: string;
  readonly channel: NotificationTemplateSeedChannel;
  readonly operationalChannels: readonly NotificationSeedChannelCode[];
  readonly category: string;
  readonly severity: NotificationSeverity;
  readonly locale: string;
  readonly title: string;
  readonly body: string;
  readonly variables: readonly string[];
}

export interface NotificationInitialSeedBundle {
  readonly version: string;
  readonly channels: readonly NotificationChannelSeed[];
  readonly templates: readonly NotificationTemplateSeed[];
}

export interface NotificationSeedExecutionResult {
  readonly channelsTotal: number;
  readonly templatesTotal: number;
  readonly insertedTemplates: number;
}

const CHANNELS: readonly NotificationChannelSeed[] = [
  {
    code: 'desktop',
    label: 'Desktop workspace',
    description: 'Delivers actionable alerts to the signed-in operator workspace.',
    enabled: true,
    supportsDigest: true,
    defaultSeverity: 'medium',
  },
  {
    code: 'email',
    label: 'Email',
    description:
      'Delivers durable correspondence and approval records to verified company mailboxes.',
    enabled: true,
    supportsDigest: true,
    defaultSeverity: 'low',
  },
  {
    code: 'whatsapp',
    label: 'WhatsApp business inbox',
    description:
      'Routes inbound business messages and critical operational escalations through the company inbox.',
    enabled: true,
    supportsDigest: false,
    defaultSeverity: 'high',
  },
  {
    code: 'webhook',
    label: 'Signed webhook',
    description:
      'Forwards machine-readable events to HTTPS endpoints with deterministic retry identity.',
    enabled: true,
    supportsDigest: false,
    defaultSeverity: 'medium',
  },
];

const TEMPLATES: readonly NotificationTemplateSeed[] = [
  {
    code: 'seed.notification.workflow_approval_required',
    channel: 'in_app',
    operationalChannels: ['desktop'],
    category: 'workflow',
    severity: 'medium',
    locale: 'id-ID',
    title: 'Persetujuan alur kerja menunggu tindakan',
    body: 'Permintaan {{request_code}} menunggu keputusan Anda. Tinjau rincian sebelum menyetujui atau menolak.',
    variables: ['request_code'],
  },
  {
    code: 'seed.notification.workflow_approved',
    channel: 'in_app',
    operationalChannels: ['desktop'],
    category: 'workflow',
    severity: 'low',
    locale: 'id-ID',
    title: 'Permintaan disetujui',
    body: 'Permintaan {{request_code}} telah disetujui oleh {{approver_name}} dan dilanjutkan ke tahap berikutnya.',
    variables: ['request_code', 'approver_name'],
  },
  {
    code: 'seed.notification.incident_escalation',
    channel: 'in_app',
    operationalChannels: ['desktop', 'whatsapp', 'webhook'],
    category: 'incident',
    severity: 'critical',
    locale: 'id-ID',
    title: 'Insiden operasional dieskalasi',
    body: 'Insiden {{incident_code}} mencapai ambang eskalasi kritis. Tim respons harus mengambil alih sesuai prosedur.',
    variables: ['incident_code'],
  },
  {
    code: 'seed.notification.security_access_review',
    channel: 'email',
    operationalChannels: ['email'],
    category: 'security',
    severity: 'high',
    locale: 'id-ID',
    title: 'Peninjauan akses istimewa diperlukan',
    body: 'Akses istimewa untuk akun {{account_login}} memerlukan peninjauan dalam siklus tata kelola berjalan.',
    variables: ['account_login'],
  },
  {
    code: 'seed.notification.invoice_overdue',
    channel: 'email',
    operationalChannels: ['email'],
    category: 'finance',
    severity: 'high',
    locale: 'id-ID',
    title: 'Faktur jatuh tempo',
    body: 'Faktur {{invoice_number}} telah melewati tanggal jatuh tempo dan memerlukan tindakan penagihan.',
    variables: ['invoice_number'],
  },
  {
    code: 'seed.notification.payment_received',
    channel: 'in_app',
    operationalChannels: ['desktop'],
    category: 'finance',
    severity: 'low',
    locale: 'id-ID',
    title: 'Pembayaran diterima',
    body: 'Pembayaran untuk faktur {{invoice_number}} telah dicatat dan sedang direkonsiliasi.',
    variables: ['invoice_number'],
  },
  {
    code: 'seed.notification.storage_quota_warning',
    channel: 'in_app',
    operationalChannels: ['desktop', 'webhook'],
    category: 'storage',
    severity: 'medium',
    locale: 'id-ID',
    title: 'Kuota penyimpanan mendekati batas',
    body: 'Bucket {{bucket_code}} mencapai {{usage_percent}} persen dari kuota yang dikonfigurasi.',
    variables: ['bucket_code', 'usage_percent'],
  },
  {
    code: 'seed.notification.whatsapp_inbound_message',
    channel: 'in_app',
    operationalChannels: ['whatsapp'],
    category: 'inbox',
    severity: 'medium',
    locale: 'id-ID',
    title: 'Pesan WhatsApp masuk',
    body: 'Pesan baru dari {{contact_name}} diterima di kotak masuk WhatsApp perusahaan.',
    variables: ['contact_name'],
  },
];

function cloneChannel(channel: NotificationChannelSeed): NotificationChannelSeed {
  return { ...channel };
}

function cloneTemplate(template: NotificationTemplateSeed): NotificationTemplateSeed {
  return {
    ...template,
    operationalChannels: [...template.operationalChannels],
    variables: [...template.variables],
  };
}

export function buildNotificationInitialSeed(): NotificationInitialSeedBundle {
  return {
    version: NOTIFICATION_SEED_VERSION,
    channels: CHANNELS.map(cloneChannel),
    templates: TEMPLATES.map(cloneTemplate),
  };
}

export async function seedNotificationInitialData(
  db: Knex
): Promise<NotificationSeedExecutionResult> {
  const bundle = buildNotificationInitialSeed();
  let insertedTemplates = 0;

  for (const template of bundle.templates) {
    const existing = await db(NotificationTemplate.tableName)
      .where({ code: template.code })
      .first('id');
    if (existing) continue;

    await db(NotificationTemplate.tableName).insert({
      code: template.code,
      channel: template.channel,
      locale: template.locale,
      title: template.title,
      body: template.body,
    });
    insertedTemplates += 1;
  }

  const templateCount = await db(NotificationTemplate.tableName)
    .count<{ count: number | string }>({ count: '*' })
    .first();

  return {
    channelsTotal: bundle.channels.length,
    templatesTotal: Number(templateCount?.count ?? 0),
    insertedTemplates,
  };
}
