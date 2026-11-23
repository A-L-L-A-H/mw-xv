export type WhatsappHelpdeskPriority = 'P1' | 'P2' | 'P3' | 'P4';

import { DEFAULT_TIMEZONE, DEFAULT_UTC_OFFSET_MINUTES } from '@moonwitness/orm-base';

export type WhatsappHelpdeskCategory =
  'security' | 'sharia_compliance' | 'billing' | 'delivery' | 'technical' | 'account' | 'general';

export type WhatsappHelpdeskCalendar = '24x7' | 'jakarta_business_hours';

export type WhatsappHelpdeskChannel = 'whatsapp' | 'web' | 'email' | 'voice' | 'in_app';

export interface WhatsappTransactionalTemplate {
  readonly id: string;
  readonly code: string;
  readonly locale: 'id-ID';
  readonly channel: 'whatsapp';
  readonly category: WhatsappHelpdeskCategory;
  readonly body: string;
  readonly variables: readonly string[];
}

export interface WhatsappHelpdeskRoutingQueue {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly team: string;
  readonly intakeEnabled: boolean;
  readonly categories: readonly WhatsappHelpdeskCategory[];
  readonly channels: readonly WhatsappHelpdeskChannel[];
  readonly priorities: readonly WhatsappHelpdeskPriority[];
  readonly calendar: WhatsappHelpdeskCalendar;
  readonly description: string;
  readonly sequence: number;
}

export interface WhatsappHelpdeskSlaPolicy {
  readonly id: string;
  readonly priority: WhatsappHelpdeskPriority;
  readonly responseMinutes: number;
  readonly resolutionMinutes: number;
  readonly calendar: WhatsappHelpdeskCalendar;
  readonly description: string;
}

export interface WhatsappHelpdeskEscalationLevel {
  readonly level: number;
  readonly afterMinutes: number;
  readonly targetQueueId: string;
  readonly notifyRoles: readonly string[];
  readonly severity: 'warning' | 'critical';
}

export interface WhatsappHelpdeskEscalationPolicy {
  readonly id: string;
  readonly priority: WhatsappHelpdeskPriority;
  readonly levels: readonly WhatsappHelpdeskEscalationLevel[];
}

export interface WhatsappHelpdeskCategoryRule {
  readonly category: WhatsappHelpdeskCategory;
  readonly patterns: readonly string[];
  readonly weight: number;
}

export interface WhatsappHelpdeskSeedBundle {
  readonly version: string;
  readonly timezone: typeof DEFAULT_TIMEZONE;
  readonly utcOffsetMinutes: typeof DEFAULT_UTC_OFFSET_MINUTES;
  readonly workStartMinute: number;
  readonly workEndMinute: number;
  readonly templates: readonly WhatsappTransactionalTemplate[];
  readonly queues: readonly WhatsappHelpdeskRoutingQueue[];
  readonly slaPolicies: readonly WhatsappHelpdeskSlaPolicy[];
  readonly escalationPolicies: readonly WhatsappHelpdeskEscalationPolicy[];
  readonly categoryRules: readonly WhatsappHelpdeskCategoryRule[];
}

const TEMPLATES: readonly WhatsappTransactionalTemplate[] = [
  {
    id: 'wa-tpl-payment-received',
    code: 'transaction.payment.received',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'billing',
    body: 'Pembayaran {amount_idr} untuk invoice {invoice_number} telah kami terima melalui {payment_method}. Kwitansi digital tersedia di {receipt_url}.',
    variables: ['amount_idr', 'invoice_number', 'payment_method', 'receipt_url'],
  },
  {
    id: 'wa-tpl-payment-verification-pending',
    code: 'transaction.payment.verification_pending',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'billing',
    body: 'Pembayaran QRIS {invoice_number} sebesar {amount_idr} sedang diverifikasi. Jangan mengulang pembayaran; tim Billing Nusantara akan mengabari hasilnya maksimal {verification_minutes} menit.',
    variables: ['invoice_number', 'amount_idr', 'verification_minutes'],
  },
  {
    id: 'wa-tpl-refund-processed',
    code: 'transaction.refund.processed',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'billing',
    body: 'Refund {amount_idr} untuk transaksi {transaction_id} telah dikirim ke {destination}. Dana biasanya masuk dalam 1-3 hari kerja bank.',
    variables: ['amount_idr', 'transaction_id', 'destination'],
  },
  {
    id: 'wa-tpl-delivery-updated',
    code: 'transaction.delivery.updated',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'delivery',
    body: 'Paket {tracking_number} telah tiba di hub {hub_city} dan sedang dalam perjalanan ke {destination_city}. Perkiraan tiba {eta_label}.',
    variables: ['tracking_number', 'hub_city', 'destination_city', 'eta_label'],
  },
  {
    id: 'wa-tpl-ticket-created',
    code: 'transaction.ticket.created',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'general',
    body: 'Tiket {ticket_code} telah dibuat oleh {queue_name}. Estimasi respons pertama sebelum {first_response_due} (Asia/Jakarta).',
    variables: ['ticket_code', 'queue_name', 'first_response_due'],
  },
  {
    id: 'wa-tpl-sla-warning',
    code: 'transaction.sla.warning',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'general',
    body: 'Tiket {ticket_code} mendekati batas {sla_phase} {sla_policy}. Silakan berikan update sebelum {due_at} (Asia/Jakarta).',
    variables: ['ticket_code', 'sla_phase', 'sla_policy', 'due_at'],
  },
  {
    id: 'wa-tpl-escalation-notice',
    code: 'transaction.escalation.notice',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'general',
    body: 'Tiket {ticket_code} dieskalasi ke {queue_name} karena {reason}. PIC baru: {notify_roles}.',
    variables: ['ticket_code', 'queue_name', 'reason', 'notify_roles'],
  },
  {
    id: 'wa-tpl-account-verified',
    code: 'transaction.account.verified',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'account',
    body: 'Verifikasi nomor {masked_phone} berhasil. Akun {account_name} kini aktif untuk transaksi Nusantara.',
    variables: ['masked_phone', 'account_name'],
  },
  {
    id: 'wa-tpl-security-alert',
    code: 'transaction.security.alert',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'security',
    body: 'Aktivitas mencurigakan terdeteksi pada akun {account_name}. Jangan pernah membagikan kode OTP; tim Security Incident Response telah menerima laporan {ticket_code}.',
    variables: ['account_name', 'ticket_code'],
  },
  {
    id: 'wa-tpl-sharia-review',
    code: 'transaction.sharia.review',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'sharia_compliance',
    body: 'Permintaan kajian syariah untuk produk {product_name} sedang ditinjau tim Sharia Compliance. Nomor rujukan: {ticket_code}.',
    variables: ['product_name', 'ticket_code'],
  },
  {
    id: 'wa-tpl-subscription-renewed',
    code: 'transaction.subscription.renewed',
    locale: 'id-ID',
    channel: 'whatsapp',
    category: 'billing',
    body: 'Langganan {plan_name} diperpanjang hingga {renewal_date} dengan total {amount_idr}. Terima kasih telah menggunakan layanan Nusantara.',
    variables: ['plan_name', 'renewal_date', 'amount_idr'],
  },
];

const QUEUES: readonly WhatsappHelpdeskRoutingQueue[] = [
  {
    id: 'waq-security-incident',
    code: 'SEC-ID',
    name: 'Security Incident Response Nusantara',
    team: 'security-oncall',
    intakeEnabled: true,
    categories: ['security'],
    channels: ['whatsapp', 'web', 'email', 'voice', 'in_app'],
    priorities: ['P1', 'P2'],
    calendar: '24x7',
    description: 'Menangani phishing, penipuan, kebocoran data, dan aktivitas akun tidak sah.',
    sequence: 10,
  },
  {
    id: 'waq-sharia-compliance',
    code: 'SYR-ID',
    name: 'Sharia Compliance Review',
    team: 'sharia-review',
    intakeEnabled: true,
    categories: ['sharia_compliance'],
    channels: ['whatsapp', 'web', 'email', 'voice', 'in_app'],
    priorities: ['P1', 'P2', 'P3', 'P4'],
    calendar: 'jakarta_business_hours',
    description: 'Mengkaji pertanyaan riba, akad, zakat, wakaf, dan kesesuaian produk syariah.',
    sequence: 20,
  },
  {
    id: 'waq-billing-nusantara',
    code: 'BIL-ID',
    name: 'Billing Nusantara',
    team: 'billing-operations',
    intakeEnabled: true,
    categories: ['billing'],
    channels: ['whatsapp', 'web', 'email', 'voice', 'in_app'],
    priorities: ['P1', 'P2', 'P3', 'P4'],
    calendar: 'jakarta_business_hours',
    description:
      'Menangani invoice, QRIS, virtual account, refund, kwitansi, dan tagihan berulang.',
    sequence: 30,
  },
  {
    id: 'waq-logistics-nusantara',
    code: 'LOG-ID',
    name: 'Logistics Nusantara',
    team: 'delivery-operations',
    intakeEnabled: true,
    categories: ['delivery'],
    channels: ['whatsapp', 'web', 'email', 'voice', 'in_app'],
    priorities: ['P1', 'P2', 'P3', 'P4'],
    calendar: 'jakarta_business_hours',
    description: 'Menangani resi, kurir, pengiriman antarpulau, dan update hub domestik.',
    sequence: 40,
  },
  {
    id: 'waq-support-tier-2',
    code: 'T2-ID',
    name: 'Technical Support Tier 2',
    team: 'network-engineering',
    intakeEnabled: true,
    categories: ['technical'],
    channels: ['whatsapp', 'web', 'email', 'voice', 'in_app'],
    priorities: ['P1', 'P2', 'P3'],
    calendar: 'jakarta_business_hours',
    description:
      'Menangani gangguan aplikasi, jaringan, integrasi ERP, dan incident teknis berulang.',
    sequence: 50,
  },
  {
    id: 'waq-support-tier-1',
    code: 'T1-ID',
    name: 'Customer Support Tier 1 Jakarta',
    team: 'customer-care',
    intakeEnabled: true,
    categories: ['account', 'general', 'technical'],
    channels: ['whatsapp', 'web', 'email', 'voice', 'in_app'],
    priorities: ['P3', 'P4'],
    calendar: 'jakarta_business_hours',
    description: 'Menangani verifikasi akun, pertanyaan umum, dan triase awal bahasa Indonesia.',
    sequence: 60,
  },
  {
    id: 'waq-duty-manager',
    code: 'MGR-ID',
    name: 'Duty Manager Nusantara',
    team: 'service-duty-manager',
    intakeEnabled: false,
    categories: ['general'],
    channels: ['whatsapp', 'web', 'email', 'voice', 'in_app'],
    priorities: ['P1', 'P2', 'P3', 'P4'],
    calendar: '24x7',
    description: 'Tujuan eskalasi manajerial untuk SLA yang terlewat atau dampak lintas tim.',
    sequence: 70,
  },
];

const SLA_POLICIES: readonly WhatsappHelpdeskSlaPolicy[] = [
  {
    id: 'wa-sla-p1',
    priority: 'P1',
    responseMinutes: 15,
    resolutionMinutes: 240,
    calendar: '24x7',
    description:
      'Insiden kritis dengan dampak transaksi atau keamanan; respons dan penanganan 24x7.',
  },
  {
    id: 'wa-sla-p2',
    priority: 'P2',
    responseMinutes: 30,
    resolutionMinutes: 480,
    calendar: 'jakarta_business_hours',
    description: 'Gangguan berdampak pada pembayaran, pengiriman, atau kepatuhan syariah.',
  },
  {
    id: 'wa-sla-p3',
    priority: 'P3',
    responseMinutes: 120,
    resolutionMinutes: 1440,
    calendar: 'jakarta_business_hours',
    description: 'Permintaan teknis dan akun yang memerlukan penanganan hari kerja.',
  },
  {
    id: 'wa-sla-p4',
    priority: 'P4',
    responseMinutes: 240,
    resolutionMinutes: 2880,
    calendar: 'jakarta_business_hours',
    description: 'Pertanyaan umum dan permintaan non-darurat.',
  },
];

const ESCALATION_POLICIES: readonly WhatsappHelpdeskEscalationPolicy[] = [
  {
    id: 'wa-esc-p1',
    priority: 'P1',
    levels: [
      {
        level: 1,
        afterMinutes: 15,
        targetQueueId: 'waq-duty-manager',
        notifyRoles: ['security-oncall-lead', 'service-duty-manager'],
        severity: 'critical',
      },
      {
        level: 2,
        afterMinutes: 60,
        targetQueueId: 'waq-duty-manager',
        notifyRoles: ['incident-commander', 'head-of-operations'],
        severity: 'critical',
      },
    ],
  },
  {
    id: 'wa-esc-p2',
    priority: 'P2',
    levels: [
      {
        level: 1,
        afterMinutes: 30,
        targetQueueId: 'waq-support-tier-2',
        notifyRoles: ['team-lead', 'billing-operations'],
        severity: 'warning',
      },
      {
        level: 2,
        afterMinutes: 120,
        targetQueueId: 'waq-duty-manager',
        notifyRoles: ['service-duty-manager'],
        severity: 'critical',
      },
    ],
  },
  {
    id: 'wa-esc-p3',
    priority: 'P3',
    levels: [
      {
        level: 1,
        afterMinutes: 120,
        targetQueueId: 'waq-support-tier-2',
        notifyRoles: ['team-lead'],
        severity: 'warning',
      },
      {
        level: 2,
        afterMinutes: 480,
        targetQueueId: 'waq-duty-manager',
        notifyRoles: ['service-duty-manager'],
        severity: 'critical',
      },
    ],
  },
  {
    id: 'wa-esc-p4',
    priority: 'P4',
    levels: [
      {
        level: 1,
        afterMinutes: 240,
        targetQueueId: 'waq-support-tier-2',
        notifyRoles: ['customer-care-lead'],
        severity: 'warning',
      },
      {
        level: 2,
        afterMinutes: 960,
        targetQueueId: 'waq-duty-manager',
        notifyRoles: ['service-duty-manager'],
        severity: 'critical',
      },
    ],
  },
];

const CATEGORY_RULES: readonly WhatsappHelpdeskCategoryRule[] = [
  {
    category: 'security',
    weight: 100,
    patterns: [
      'phishing',
      'penipuan',
      'akun saya dibobol',
      'akun dibobol',
      'aktivitas tidak sah',
      'kode otp bukan saya',
      'data bocor',
      'kebocoran data',
      'unauthorized',
      'carding',
    ],
  },
  {
    category: 'sharia_compliance',
    weight: 90,
    patterns: [
      'riba',
      'haram',
      'syariah',
      'sharia',
      'zakat',
      'wakaf',
      'akad',
      'murabahah',
      'mudharabah',
      'gharar',
    ],
  },
  {
    category: 'billing',
    weight: 70,
    patterns: [
      'tagih',
      'invoice',
      'pembayaran',
      'bayar',
      'qris',
      'refund',
      'dana',
      'saldo',
      'virtual account',
      'kwitansi',
      'struk',
      'langganan',
    ],
  },
  {
    category: 'delivery',
    weight: 60,
    patterns: [
      'pengiriman',
      'kirim',
      'resi',
      'kurir',
      'jne',
      'j&t',
      'sicepat',
      'paket',
      'barang',
      'ekspedisi',
      'hub',
    ],
  },
  {
    category: 'technical',
    weight: 50,
    patterns: [
      'down',
      'gangguan',
      'error',
      'tidak bisa',
      'gagal',
      'timeout',
      'server',
      'jaringan',
      'koneksi',
      'aplikasi',
      'login',
    ],
  },
  {
    category: 'account',
    weight: 40,
    patterns: ['akun', 'profil', 'nomor telepon', 'verifikasi', 'reset password', 'alamat'],
  },
];

const SEED_BUNDLE: WhatsappHelpdeskSeedBundle = {
  version: '1.0.0',
  timezone: DEFAULT_TIMEZONE,
  utcOffsetMinutes: DEFAULT_UTC_OFFSET_MINUTES,
  workStartMinute: 9 * 60,
  workEndMinute: 18 * 60,
  templates: TEMPLATES,
  queues: QUEUES,
  slaPolicies: SLA_POLICIES,
  escalationPolicies: ESCALATION_POLICIES,
  categoryRules: CATEGORY_RULES,
};

function cloneSeedBundle(bundle: WhatsappHelpdeskSeedBundle): WhatsappHelpdeskSeedBundle {
  return {
    ...bundle,
    templates: bundle.templates.map((template) => ({
      ...template,
      variables: [...template.variables],
    })),
    queues: bundle.queues.map((queue) => ({
      ...queue,
      categories: [...queue.categories],
      channels: [...queue.channels],
      priorities: [...queue.priorities],
    })),
    slaPolicies: bundle.slaPolicies.map((policy) => ({ ...policy })),
    escalationPolicies: bundle.escalationPolicies.map((policy) => ({
      ...policy,
      levels: policy.levels.map((level) => ({
        ...level,
        notifyRoles: [...level.notifyRoles],
      })),
    })),
    categoryRules: bundle.categoryRules.map((rule) => ({
      ...rule,
      patterns: [...rule.patterns],
    })),
  };
}

export function buildWhatsappHelpdeskSeed(): WhatsappHelpdeskSeedBundle {
  return cloneSeedBundle(SEED_BUNDLE);
}
