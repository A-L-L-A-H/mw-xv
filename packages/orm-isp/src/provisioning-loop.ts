import { Subscription, SubscriptionInvoiceLine } from '@moonwitness/orm-subscription';
import { DEFAULT_ISP_SERVICE_URL } from '@moonwitness/types';
import { ISPNAS, ISPRadiusOutbox, ISPRadiusSession, ISPSubscriber } from './models/index.js';
import { resolveIspAdminToken, type IspAdminTokenOptions } from './auth.js';
import { dispatchIspDisconnect } from './reconcile.js';

const DEFAULT_COMPANY_KEY = 'base.company_default';
const DEFAULT_USER_GROUP_KEY = 'base.group_user';
const DEFAULT_PROJECT_KEY = 'project.example_platform_roadmap';
const DEFAULT_PARTNER_KEY = 'base.partner_acme';
const DEFAULT_SUBSCRIPTION_KEY = 'subscription.sub_acme_enterprise';

export interface InitialIspSeedBundle {
  readonly types: readonly {
    readonly key: string;
    readonly name: string;
    readonly code: string;
    readonly description: string;
    readonly sequence: number;
  }[];
  readonly bandwidthProfiles: readonly {
    readonly key: string;
    readonly name: string;
    readonly downloadKbps: number;
    readonly uploadKbps: number;
    readonly burstDownloadKbps?: number;
    readonly burstUploadKbps?: number;
    readonly burstPeriodSeconds?: number;
  }[];
  readonly pools: readonly {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly network: string;
    readonly gateway: string;
    readonly dnsPrimary: string;
    readonly dnsSecondary: string;
    readonly rangeStart: string;
    readonly rangeEnd: string;
  }[];
  readonly nasDevices: readonly {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly ipAddress: string;
    readonly secret: string;
    readonly vendor: string;
    readonly model: string;
    readonly location: string;
    readonly haGroup: string;
    readonly haPriority: number;
    readonly healthStatus: 'healthy' | 'degraded' | 'offline';
    readonly isActive: boolean;
  }[];
  readonly subscribers: readonly {
    readonly key: string;
    readonly username: string;
    readonly password: string;
    readonly connectionType: 'pppoe' | 'hotspot' | 'static';
    readonly startDate: string;
    readonly expiryDate: string;
    readonly monthlyPriceMinor: number;
    readonly currency: string;
    readonly status: 'active' | 'suspended' | 'terminated';
    readonly bandwidthProfileKey: string;
    readonly poolKey: string;
    readonly projectKey: string;
    readonly partnerKey: string;
    readonly subscriptionKey: string;
    readonly staticIp?: string;
    readonly macAddress?: string;
  }[];
  readonly accessRules: readonly {
    readonly key: string;
    readonly modelName: string;
    readonly companyKey?: string;
    readonly userGroupKey?: string;
    readonly canRead: boolean;
    readonly canCreate: boolean;
    readonly canWrite: boolean;
    readonly canUnlink: boolean;
  }[];
}

export interface BuildInitialIspSeedBundleOptions {
  readonly companyKey?: string;
  readonly userGroupKey?: string;
  readonly projectKey?: string;
  readonly partnerKey?: string;
  readonly subscriptionKey?: string;
  readonly defaults?: Partial<InitialIspSeedBundle>;
}

function buildBaseBundle(): InitialIspSeedBundle {
  return {
    types: [
      {
        key: 'isp.type_pppoe',
        name: 'PPPoE',
        code: 'pppoe',
        description: 'PPPoE NAS device',
        sequence: 10,
      },
      {
        key: 'isp.type_hotspot',
        name: 'Hotspot',
        code: 'hotspot',
        description: 'WiFi Hotspot NAS device',
        sequence: 20,
      },
      {
        key: 'isp.type_static',
        name: 'Static IP',
        code: 'static',
        description: 'Static IP NAS device',
        sequence: 30,
      },
    ],
    bandwidthProfiles: [
      {
        key: 'isp.profile_residential_30m',
        name: 'Nusantara FTTx 30M',
        downloadKbps: 30_000,
        uploadKbps: 15_000,
        burstDownloadKbps: 45_000,
        burstUploadKbps: 22_000,
        burstPeriodSeconds: 15,
      },
      {
        key: 'isp.profile_residential_100m',
        name: 'Nusantara FTTx 100M',
        downloadKbps: 100_000,
        uploadKbps: 50_000,
        burstDownloadKbps: 150_000,
        burstUploadKbps: 75_000,
        burstPeriodSeconds: 30,
      },
      {
        key: 'isp.profile_dedicated_500m',
        name: 'Nusantara Dedicated 500M',
        downloadKbps: 500_000,
        uploadKbps: 500_000,
      },
      {
        key: 'isp.profile_dedicated_1g',
        name: 'Nusantara Dedicated 1G',
        downloadKbps: 1_000_000,
        uploadKbps: 1_000_000,
      },
    ],
    pools: [
      {
        key: 'isp.pool_fttx_jakarta',
        name: 'Nusantara FTTx Jakarta',
        description: 'Primary Jakarta FTTx subscriber pool.',
        network: '100.64.0.0/22',
        gateway: '100.64.0.1',
        dnsPrimary: '1.1.1.1',
        dnsSecondary: '8.8.8.8',
        rangeStart: '100.64.0.10',
        rangeEnd: '100.64.3.250',
      },
      {
        key: 'isp.pool_dedicated_surabaya',
        name: 'Nusantara Dedicated Surabaya',
        description: 'Dedicated business circuit pool for Surabaya.',
        network: '103.21.118.0/24',
        gateway: '103.21.118.1',
        dnsPrimary: '1.1.1.1',
        dnsSecondary: '1.0.0.1',
        rangeStart: '103.21.118.10',
        rangeEnd: '103.21.118.240',
      },
    ],
    nasDevices: [
      {
        key: 'isp.nas_jakarta_core',
        name: 'Jakarta Core CCR2004',
        description: 'Primary FTTx aggregation NAS for Jakarta.',
        ipAddress: '10.10.0.1',
        secret: 'nusantara-jakarta-radius-2026',
        vendor: 'MikroTik',
        model: 'CCR2004-1G-12S+2XS',
        location: 'Jakarta POP',
        haGroup: 'jakarta-core',
        haPriority: 10,
        healthStatus: 'healthy',
        isActive: true,
      },
      {
        key: 'isp.nas_surabaya_core',
        name: 'Surabaya Core CCR1036',
        description: 'Primary dedicated-circuit NAS for Surabaya.',
        ipAddress: '10.20.0.1',
        secret: 'nusantara-surabaya-radius-2026',
        vendor: 'MikroTik',
        model: 'CCR1036-8G-4S+',
        location: 'Surabaya POP',
        haGroup: 'surabaya-core',
        haPriority: 10,
        healthStatus: 'healthy',
        isActive: true,
      },
      {
        key: 'isp.nas_bandung_backup',
        name: 'Bandung Backup RB5009',
        description: 'Backup aggregation NAS for Bandung FTTx.',
        ipAddress: '10.30.0.1',
        secret: 'nusantara-bandung-radius-2026',
        vendor: 'MikroTik',
        model: 'RB5009UG+S+IN',
        location: 'Bandung POP',
        haGroup: 'bandung-backup',
        haPriority: 50,
        healthStatus: 'healthy',
        isActive: true,
      },
    ],
    subscribers: [
      {
        key: 'isp.subscriber_nusantara_fttx_001',
        username: 'nusantara-fttx-001',
        password: 'fttx-001-radius-secret',
        connectionType: 'pppoe',
        startDate: '2026-01-01',
        expiryDate: '2027-01-01',
        monthlyPriceMinor: 329_000,
        currency: 'IDR',
        status: 'active',
        bandwidthProfileKey: 'isp.profile_residential_30m',
        poolKey: 'isp.pool_fttx_jakarta',
        projectKey: DEFAULT_PROJECT_KEY,
        partnerKey: DEFAULT_PARTNER_KEY,
        subscriptionKey: DEFAULT_SUBSCRIPTION_KEY,
        macAddress: 'B8:27:EB:10:00:01',
      },
      {
        key: 'isp.subscriber_nusantara_dedicated_001',
        username: 'nusantara-dedicated-001',
        password: 'dedicated-001-radius-secret',
        connectionType: 'static',
        startDate: '2026-02-01',
        expiryDate: '2027-02-01',
        monthlyPriceMinor: 2_450_000,
        currency: 'IDR',
        status: 'active',
        bandwidthProfileKey: 'isp.profile_dedicated_500m',
        poolKey: 'isp.pool_dedicated_surabaya',
        projectKey: DEFAULT_PROJECT_KEY,
        partnerKey: DEFAULT_PARTNER_KEY,
        subscriptionKey: DEFAULT_SUBSCRIPTION_KEY,
        staticIp: '103.21.118.20',
        macAddress: 'B8:27:EB:20:00:01',
      },
    ],
    accessRules: [
      {
        key: 'isp.access_user_nas_read',
        modelName: ISPNAS.modelName,
        canRead: true,
        canCreate: false,
        canWrite: false,
        canUnlink: false,
      },
      {
        key: 'isp.access_user_profile_read',
        modelName: 'isp.bandwidth_profile',
        canRead: true,
        canCreate: false,
        canWrite: false,
        canUnlink: false,
      },
      {
        key: 'isp.access_user_pool_read',
        modelName: 'isp.ip_pool',
        canRead: true,
        canCreate: false,
        canWrite: false,
        canUnlink: false,
      },
      {
        key: 'isp.access_user_subscriber_read',
        modelName: ISPSubscriber.modelName,
        canRead: true,
        canCreate: true,
        canWrite: true,
        canUnlink: false,
      },
      {
        key: 'isp.access_user_session_read',
        modelName: 'isp.radius_session',
        canRead: true,
        canCreate: false,
        canWrite: false,
        canUnlink: false,
      },
    ],
  };
}

export function buildInitialIspSeedBundle(
  options: BuildInitialIspSeedBundleOptions = {}
): InitialIspSeedBundle {
  const base = buildBaseBundle();
  const companyKey = options.companyKey ?? DEFAULT_COMPANY_KEY;
  const userGroupKey = options.userGroupKey ?? DEFAULT_USER_GROUP_KEY;
  const projectKey = options.projectKey ?? DEFAULT_PROJECT_KEY;
  const partnerKey = options.partnerKey ?? DEFAULT_PARTNER_KEY;
  const subscriptionKey = options.subscriptionKey ?? DEFAULT_SUBSCRIPTION_KEY;
  const bundle = options.defaults ?? {};
  return {
    types: bundle.types ?? base.types,
    bandwidthProfiles: bundle.bandwidthProfiles ?? base.bandwidthProfiles,
    pools: bundle.pools ?? base.pools,
    nasDevices: bundle.nasDevices ?? base.nasDevices,
    subscribers: (bundle.subscribers ?? base.subscribers).map((subscriber) => ({
      ...subscriber,
      projectKey:
        subscriber.projectKey === DEFAULT_PROJECT_KEY ? projectKey : subscriber.projectKey,
      partnerKey:
        subscriber.partnerKey === DEFAULT_PARTNER_KEY ? partnerKey : subscriber.partnerKey,
      subscriptionKey:
        subscriber.subscriptionKey === DEFAULT_SUBSCRIPTION_KEY
          ? subscriptionKey
          : subscriber.subscriptionKey,
    })),
    accessRules: (bundle.accessRules ?? base.accessRules).map((rule) => ({
      ...rule,
      companyKey: rule.companyKey ?? companyKey,
      userGroupKey: rule.userGroupKey ?? userGroupKey,
    })),
  };
}

export interface OverdueSubscriberSuspensionInput {
  readonly username: string;
  readonly subscriberId: number;
  readonly companyId: number;
  readonly subscriptionId: number;
  readonly subscriptionName: string;
  readonly subscriptionState: string;
  readonly overdueSince: string;
}

export interface EnforceOverdueSubscriberSuspensionsOptions extends IspAdminTokenOptions {
  readonly companyId?: number;
  readonly asOfDate?: string | Date;
  readonly ispServiceUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly input?: readonly OverdueSubscriberSuspensionInput[];
}

export interface OverdueSubscriberSuspensionResult {
  readonly username: string;
  readonly subscriberId: number;
  readonly companyId: number;
  readonly subscriptionId: number;
  readonly outboxId: number;
  readonly disconnectDispatched: boolean;
}

export interface EnforceOverdueSubscriberSuspensionsResult {
  readonly evaluated: number;
  readonly suspended: number;
  readonly dispatched: number;
  readonly dispatchFailures: number;
  readonly suspensions: readonly OverdueSubscriberSuspensionResult[];
}

interface SuspensionCandidate {
  readonly subscriber: {
    readonly id: number;
    readonly company_id: number;
    readonly username: string;
    readonly subscription_id: number | null;
    readonly status: string;
    readonly active: boolean;
  };
  readonly subscription: {
    readonly id: number;
    readonly name: string;
    readonly state: string;
  };
  readonly nasIp: string | null;
  readonly acctSessionId: string | null;
  readonly framedIpAddress: string | null;
}

const ACTIVE_SUBSCRIPTION_STATES = new Set(['active', 'pending']);

function normalizeDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Overdue evaluation date must be valid');
    }
    return value.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error('Overdue evaluation date must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Overdue evaluation date must be a valid YYYY-MM-DD date');
  }
  return value;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

function isoNow(): string {
  return new Date().toISOString().slice(0, 19);
}

function idempotencyKey(candidate: SuspensionCandidate, dueDate: string): string {
  return [
    'overdue-subscriber-suspension',
    candidate.subscriber.company_id,
    candidate.subscriber.id,
    candidate.subscription.id,
    dueDate,
    candidate.acctSessionId ?? candidate.subscriber.username,
  ].join('|');
}

function redactedResponse(candidate: SuspensionCandidate, dueDate: string): string {
  return JSON.stringify({
    reason: 'overdue_subscription_invoice',
    idempotencyKey: idempotencyKey(candidate, dueDate),
    username: candidate.subscriber.username,
    secret: '[REDACTED]',
  });
}

function toInputCandidate(input: OverdueSubscriberSuspensionInput): SuspensionCandidate | null {
  if (!ACTIVE_SUBSCRIPTION_STATES.has(input.subscriptionState)) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.overdueSince)) {
    return null;
  }
  return {
    subscriber: {
      id: input.subscriberId,
      company_id: input.companyId,
      username: input.username,
      subscription_id: input.subscriptionId,
      status: 'active',
      active: true,
    },
    subscription: {
      id: input.subscriptionId,
      name: input.subscriptionName,
      state: input.subscriptionState,
    },
    nasIp: null,
    acctSessionId: null,
    framedIpAddress: null,
  };
}

async function loadCandidates(
  options: EnforceOverdueSubscriberSuspensionsOptions,
  asOfDate: string
): Promise<readonly SuspensionCandidate[]> {
  if (options.input) {
    return options.input
      .filter((entry) => !options.companyId || entry.companyId === options.companyId)
      .map(toInputCandidate)
      .filter((candidate): candidate is SuspensionCandidate => candidate !== null);
  }

  let subscriberQuery = ISPSubscriber.query()
    .where({ is_active: true })
    .whereNotNull('subscription_id')
    .orderBy('id', 'asc');
  if (options.companyId !== undefined) {
    subscriberQuery = subscriberQuery.where({ company_id: options.companyId });
  }
  const subscribers = await subscriberQuery;
  const candidates: SuspensionCandidate[] = [];
  for (const subscriber of subscribers) {
    if (!subscriber.subscription_id) {
      continue;
    }
    const subscription = await Subscription.query()
      .findById(subscriber.subscription_id)
      .whereIn('state', Array.from(ACTIVE_SUBSCRIPTION_STATES));
    if (!subscription || !ACTIVE_SUBSCRIPTION_STATES.has(subscription.state)) {
      continue;
    }
    const invoiceLines = await SubscriptionInvoiceLine.query()
      .where({ subscription_id: subscription.id })
      .whereNotNull('invoice_date')
      .where('invoice_date', '<=', asOfDate)
      .orderBy('invoice_date', 'asc')
      .orderBy('id', 'asc');
    if (invoiceLines.length === 0) {
      continue;
    }
    const aggregate = aggregateOverdueInvoices(invoiceLines, asOfDate);
    if (!aggregate || aggregate.dueDate > advanceMonthly(asOfDate, -1)) {
      continue;
    }
    const activeSession = await ISPRadiusSession.query()
      .where({ subscriber_id: subscriber.id })
      .whereNull('stop_time')
      .orderBy('id', 'asc')
      .first();
    candidates.push({
      subscriber: {
        id: subscriber.id,
        company_id: subscriber.company_id,
        username: subscriber.username,
        subscription_id: subscriber.subscription_id ?? null,
        status: subscriber.status,
        active: subscriber.is_active ?? true,
      },
      subscription,
      nasIp: activeSession?.nas_ip ?? null,
      acctSessionId: activeSession?.session_id ?? null,
      framedIpAddress: activeSession?.framed_ip_address ?? null,
    });
  }
  return candidates;
}

function aggregateOverdueInvoices(
  invoiceLines: readonly { invoice_date?: string | null; subtotal_minor?: number | null }[],
  asOfDate: string
): { readonly dueDate: string; readonly subtotalMinor: number } | null {
  let dueDate = '';
  let subtotalMinor = 0;
  for (const line of invoiceLines) {
    if (!line.invoice_date || line.invoice_date > asOfDate) {
      continue;
    }
    if (!dueDate || line.invoice_date < dueDate) {
      dueDate = line.invoice_date;
    }
    subtotalMinor += line.subtotal_minor ?? 0;
  }
  return dueDate ? { dueDate, subtotalMinor } : null;
}

function advanceMonthly(day: string, months: number): string {
  const [year, month] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + months, 1));
  const targetMonth = shifted.getUTCMonth();
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  const dayOfMonth = Number(day.slice(8, 10));
  const resolvedDay = Math.min(dayOfMonth, lastDay);
  return `${shifted.getUTCFullYear().toString().padStart(4, '0')}-${(targetMonth + 1)
    .toString()
    .padStart(2, '0')}-${resolvedDay.toString().padStart(2, '0')}`;
}

export async function enforceOverdueSubscriberSuspensions(
  options: EnforceOverdueSubscriberSuspensionsOptions = {}
): Promise<EnforceOverdueSubscriberSuspensionsResult> {
  const asOfDate = normalizeDate(options.asOfDate ?? new Date());
  const candidates = await loadCandidates(options, asOfDate);
  const suspensions: OverdueSubscriberSuspensionResult[] = [];
  let dispatched = 0;
  let dispatchFailures = 0;

  for (const candidate of candidates) {
    const dueDate =
      options.input?.find(
        (entry) =>
          entry.subscriberId === candidate.subscriber.id &&
          entry.companyId === candidate.subscriber.company_id
      )?.overdueSince ?? advanceMonthly(asOfDate, -1);
    const existingOutbox = await ISPRadiusOutbox.query().findOne({
      company_id: candidate.subscriber.company_id,
      username: candidate.subscriber.username,
      type: 'disconnect',
      response: redactedResponse(candidate, dueDate),
    });
    if (existingOutbox) {
      continue;
    }

    console.error('[DEBUG] Patching subscriber', candidate.subscriber.id, 'to suspended');
    const patchResult = await ISPSubscriber.query()
      .findById(candidate.subscriber.id)
      .patch({ status: 'suspended' });
    console.error('[DEBUG] Patch result:', patchResult);
    const outbox = await ISPRadiusOutbox.query().insert({
      company_id: candidate.subscriber.company_id,
      username: candidate.subscriber.username,
      nas_ip: candidate.nasIp,
      nas_port: null,
      acct_session_id: candidate.acctSessionId,
      framed_ip_address: candidate.framedIpAddress,
      type: 'disconnect',
      status: 'pending',
      created_at: isoNow(),
      sent_at: null,
      response: redactedResponse(candidate, dueDate),
      error_message: null,
    });

    let disconnectDispatched = false;
    if (options.fetchImpl) {
      const result = await dispatchIspDisconnect({
        baseUrl: trimTrailingSlashes(options.ispServiceUrl ?? DEFAULT_ISP_SERVICE_URL),
        token: resolveIspAdminToken({
          adminToken: options.adminToken,
          jwtSecret: options.jwtSecret,
        }),
        fetchImpl: options.fetchImpl,
        username: candidate.subscriber.username,
        nasIp: candidate.nasIp,
        acctSessionId: candidate.acctSessionId,
        framedIp: candidate.framedIpAddress,
      });
      disconnectDispatched = result.ok;
      if (result.ok) {
        await ISPRadiusOutbox.query().findById(outbox.id).patch({
          status: 'acknowledged',
          sent_at: isoNow(),
          acknowledged_at: isoNow(),
          error_message: null,
        });
        dispatched += 1;
      } else {
        await ISPRadiusOutbox.query()
          .findById(outbox.id)
          .patch({
            status:
              result.outcome === 'retryable_failure' || result.outcome === 'timed_out'
                ? 'retryable_failure'
                : result.outcome,
            error_message: result.errorMessage ?? 'Overdue suspension disconnect failed',
          });
        dispatchFailures += 1;
      }
    }

    suspensions.push({
      username: candidate.subscriber.username,
      subscriberId: candidate.subscriber.id,
      companyId: candidate.subscriber.company_id,
      subscriptionId: candidate.subscription.id,
      outboxId: outbox.id,
      disconnectDispatched,
    });
  }

  return {
    evaluated: candidates.length,
    suspended: suspensions.length,
    dispatched,
    dispatchFailures,
    suspensions,
  };
}
