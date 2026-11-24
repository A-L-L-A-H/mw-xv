import type { Knex } from 'knex';
import { resolveInsertedId } from '@moonwitness/orm-base';
import {
  Subscription,
  SubscriptionInvoiceLine,
  SubscriptionPlan,
  SubscriptionTagLink,
} from './models/index.js';

export const SUBSCRIPTION_SEED_VERSION = '1.0.0';

export type SubscriptionPlanInterval = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type SubscriptionState = 'draft' | 'pending' | 'active' | 'paused' | 'cancelled' | 'expired';

export interface SubscriptionPlanSeed {
  readonly name: string;
  readonly code: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly interval: SubscriptionPlanInterval;
  readonly intervalCount: number;
  readonly trialDays: number;
  readonly isActive: boolean;
}

export interface SubscriptionContractSeed {
  readonly name: string;
  readonly partnerEmail: string;
  readonly planCode: string;
  readonly saleOrderName: string | null;
  readonly state: SubscriptionState;
  readonly currency: string;
  readonly amountMinor: number;
  readonly startDate: string;
  readonly nextInvoiceDate: string;
  readonly assignedToLogin: string;
  readonly description: string;
}

export interface SubscriptionInvoiceLineSeed {
  readonly subscriptionName: string;
  readonly sequence: number;
  readonly name: string;
  readonly product: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly discountPercent: number;
  readonly subtotalMinor: number;
  readonly invoiceDate: string;
}

export interface SubscriptionTagLinkSeed {
  readonly tagName: string;
  readonly resourceModel: string;
  readonly subscriptionName: string;
}

export interface SubscriptionInitialSeedBundle {
  readonly version: string;
  readonly plans: readonly SubscriptionPlanSeed[];
  readonly subscriptions: readonly SubscriptionContractSeed[];
  readonly invoiceLines: readonly SubscriptionInvoiceLineSeed[];
  readonly tagLinks: readonly SubscriptionTagLinkSeed[];
}

export interface SubscriptionSeedExecutionResult {
  readonly companyId: number;
  readonly plansTotal: number;
  readonly subscriptionsTotal: number;
  readonly invoiceLinesTotal: number;
  readonly tagLinksTotal: number;
  readonly insertedPlans: number;
  readonly insertedSubscriptions: number;
  readonly insertedInvoiceLines: number;
  readonly insertedTagLinks: number;
}

export interface SeedSubscriptionInitialDataOptions {
  readonly companyId?: number;
  readonly companyName?: string;
}

const SEED_COMPANY = 'Default Company';
const CUSTOMER_TAG = 'Customer';

const PLANS: readonly SubscriptionPlanSeed[] = [
  {
    name: 'Basic Monthly',
    code: 'basic-monthly',
    description: 'Basic monthly workspace tier for growing support and CRM teams.',
    amountMinor: 9900,
    currency: 'USD',
    interval: 'monthly',
    intervalCount: 1,
    trialDays: 7,
    isActive: true,
  },
  {
    name: 'Pro Monthly',
    code: 'pro-monthly',
    description: 'Professional monthly plan with workflow automation and AI contracts.',
    amountMinor: 29900,
    currency: 'USD',
    interval: 'monthly',
    intervalCount: 1,
    trialDays: 14,
    isActive: true,
  },
  {
    name: 'Business Quarterly',
    code: 'business-quarterly',
    description: 'Quarterly business billing with multi-team orchestration and SLAs.',
    amountMinor: 149000,
    currency: 'USD',
    interval: 'quarterly',
    intervalCount: 1,
    trialDays: 14,
    isActive: true,
  },
  {
    name: 'Enterprise Yearly',
    code: 'enterprise-yearly',
    description: 'Annual enterprise cluster commitment with governance & dedicated support.',
    amountMinor: 960000,
    currency: 'USD',
    interval: 'yearly',
    intervalCount: 1,
    trialDays: 30,
    isActive: true,
  },
];

const CONTRACTS: readonly SubscriptionContractSeed[] = [
  {
    name: 'SUB-2026-0001',
    partnerEmail: 'hello@acme.local',
    planCode: 'enterprise-yearly',
    saleOrderName: 'SO-2026-0001',
    state: 'active',
    currency: 'USD',
    amountMinor: 960000,
    startDate: '2026-11-18',
    nextInvoiceDate: '2027-11-18',
    assignedToLogin: 'superadmin',
    description: 'Acme Studio annual Enterprise cluster & AI Copilot recurring agreement.',
  },
  {
    name: 'SUB-2026-0002',
    partnerEmail: 'contact@kite.local',
    planCode: 'business-quarterly',
    saleOrderName: 'SO-2026-0003',
    state: 'active',
    currency: 'USD',
    amountMinor: 149000,
    startDate: '2026-11-15',
    nextInvoiceDate: '2027-02-15',
    assignedToLogin: 'superadmin',
    description: 'Kite and Co quarterly dedicated node & RADIUS monitoring subscription.',
  },
  {
    name: 'SUB-2026-0003',
    partnerEmail: 'team@meridian.local',
    planCode: 'pro-monthly',
    saleOrderName: 'SO-2026-0002',
    state: 'pending',
    currency: 'USD',
    amountMinor: 29900,
    startDate: '2026-12-01',
    nextInvoiceDate: '2027-01-01',
    assignedToLogin: 'superadmin',
    description: 'Meridian Works Pro monthly workflow tier awaiting signature activation.',
  },
  {
    name: 'SUB-2026-0004',
    partnerEmail: 'support@bluebird.local',
    planCode: 'basic-monthly',
    saleOrderName: null,
    state: 'paused',
    currency: 'USD',
    amountMinor: 9900,
    startDate: '2026-10-01',
    nextInvoiceDate: '2026-12-01',
    assignedToLogin: 'system',
    description: 'Bluebird Market starter monthly seat subscription queued for upgrade.',
  },
];

const INVOICE_LINES: readonly SubscriptionInvoiceLineSeed[] = [
  {
    subscriptionName: 'SUB-2026-0001',
    sequence: 10,
    name: 'Enterprise Yearly Base Platform',
    product: 'MW-SUB-ENT-YR',
    quantity: 1,
    unitPriceMinor: 720000,
    discountPercent: 0,
    subtotalMinor: 720000,
    invoiceDate: '2026-11-18',
  },
  {
    subscriptionName: 'SUB-2026-0001',
    sequence: 20,
    name: 'Autonomous AI Governance Seats',
    product: 'MW-SUB-AI-SEAT',
    quantity: 1,
    unitPriceMinor: 240000,
    discountPercent: 0,
    subtotalMinor: 240000,
    invoiceDate: '2026-11-18',
  },
  {
    subscriptionName: 'SUB-2026-0002',
    sequence: 10,
    name: 'Business Quarterly Cluster Hosting',
    product: 'MW-SUB-BUS-QTR',
    quantity: 1,
    unitPriceMinor: 119000,
    discountPercent: 0,
    subtotalMinor: 119000,
    invoiceDate: '2026-11-15',
  },
  {
    subscriptionName: 'SUB-2026-0002',
    sequence: 20,
    name: 'ISP Telemetry & RADIUS Sync',
    product: 'MW-SUB-ISP',
    quantity: 1,
    unitPriceMinor: 30000,
    discountPercent: 0,
    subtotalMinor: 30000,
    invoiceDate: '2026-11-15',
  },
  {
    subscriptionName: 'SUB-2026-0003',
    sequence: 10,
    name: 'Pro Monthly Workspace Tier',
    product: 'MW-SUB-PRO-MO',
    quantity: 1,
    unitPriceMinor: 29900,
    discountPercent: 0,
    subtotalMinor: 29900,
    invoiceDate: '2026-12-01',
  },
  {
    subscriptionName: 'SUB-2026-0004',
    sequence: 10,
    name: 'Basic Monthly Workspace Tier',
    product: 'MW-SUB-BASIC-MO',
    quantity: 1,
    unitPriceMinor: 9900,
    discountPercent: 0,
    subtotalMinor: 9900,
    invoiceDate: '2026-10-01',
  },
];

const TAG_LINKS: readonly SubscriptionTagLinkSeed[] = [
  {
    tagName: CUSTOMER_TAG,
    resourceModel: Subscription.modelName,
    subscriptionName: 'SUB-2026-0001',
  },
  {
    tagName: CUSTOMER_TAG,
    resourceModel: Subscription.modelName,
    subscriptionName: 'SUB-2026-0002',
  },
];

export function buildSubscriptionInitialSeed(): SubscriptionInitialSeedBundle {
  const bundle: SubscriptionInitialSeedBundle = {
    version: SUBSCRIPTION_SEED_VERSION,
    plans: PLANS.map((plan) => ({ ...plan })),
    subscriptions: CONTRACTS.map((contract) => ({ ...contract })),
    invoiceLines: INVOICE_LINES.map((line) => ({ ...line })),
    tagLinks: TAG_LINKS.map((link) => ({ ...link })),
  };
  assertSubscriptionInitialSeed(bundle, 'buildSubscriptionInitialSeed');
  return bundle;
}

export async function seedSubscriptionInitialData(
  db: Knex,
  options: SeedSubscriptionInitialDataOptions = {}
): Promise<SubscriptionSeedExecutionResult> {
  const bundle = buildSubscriptionInitialSeed();
  const relations = await resolveSubscriptionSeedRelations(db, options, bundle);
  const counts = {
    companyId: relations.companyId,
    plansTotal: bundle.plans.length,
    subscriptionsTotal: bundle.subscriptions.length,
    invoiceLinesTotal: bundle.invoiceLines.length,
    tagLinksTotal: bundle.tagLinks.length,
    insertedPlans: 0,
    insertedSubscriptions: 0,
    insertedInvoiceLines: 0,
    insertedTagLinks: 0,
  };

  await db.transaction(async (trx) => {
    const planIds = new Map<string, number>();
    for (const plan of bundle.plans) {
      const existing = await trx(SubscriptionPlan.tableName).where({ code: plan.code }).first('id');
      if (existing) {
        planIds.set(plan.code, Number(existing.id));
        continue;
      }
      const inserted = (await trx(SubscriptionPlan.tableName)
        .insert({
          company_id: relations.companyId,
          name: plan.name,
          code: plan.code,
          description: plan.description,
          amount_minor: plan.amountMinor,
          currency: plan.currency,
          interval: plan.interval,
          interval_count: plan.intervalCount,
          trial_days: plan.trialDays,
          is_active: plan.isActive ? 1 : 0,
        })
        .returning('id')) as unknown[];
      planIds.set(plan.code, resolveInsertedId(inserted, `plan ${plan.code}`));
      counts.insertedPlans += 1;
    }

    const subscriptionIds = new Map<string, number>();
    for (const subscription of bundle.subscriptions) {
      const existing = await trx(Subscription.tableName)
        .where({ name: subscription.name })
        .first('id');
      if (existing) {
        subscriptionIds.set(subscription.name, Number(existing.id));
        continue;
      }
      const partnerId = relations.partners.get(subscription.partnerEmail);
      const planId = planIds.get(subscription.planCode);
      const assignedToId = relations.users.get(subscription.assignedToLogin);
      const saleOrderId =
        subscription.saleOrderName === null
          ? null
          : relations.saleOrders.get(subscription.saleOrderName);
      if (
        !partnerId ||
        !planId ||
        !assignedToId ||
        (subscription.saleOrderName !== null && !saleOrderId)
      ) {
        throw new Error(`Unresolved subscription seed relation for ${subscription.name}`);
      }
      const inserted = (await trx(Subscription.tableName)
        .insert({
          company_id: relations.companyId,
          name: subscription.name,
          partner_id: partnerId,
          plan_id: planId,
          sale_order_id: saleOrderId ?? null,
          state: subscription.state,
          currency: subscription.currency,
          amount_minor: subscription.amountMinor,
          start_date: subscription.startDate,
          next_invoice_date: subscription.nextInvoiceDate,
          assigned_to_id: assignedToId,
          description: subscription.description,
        })
        .returning('id')) as unknown[];
      subscriptionIds.set(
        subscription.name,
        resolveInsertedId(inserted, `subscription ${subscription.name}`)
      );
      counts.insertedSubscriptions += 1;
    }

    for (const line of bundle.invoiceLines) {
      const subscriptionId = subscriptionIds.get(line.subscriptionName);
      if (!subscriptionId) {
        throw new Error(`Unresolved subscription seed contract ${line.subscriptionName}`);
      }
      const existing = await trx(SubscriptionInvoiceLine.tableName)
        .where({ subscription_id: subscriptionId, sequence: line.sequence })
        .first('id');
      if (existing) continue;
      await trx(SubscriptionInvoiceLine.tableName).insert({
        subscription_id: subscriptionId,
        sequence: line.sequence,
        name: line.name,
        product: line.product,
        quantity: line.quantity,
        unit_price_minor: line.unitPriceMinor,
        discount_percent: line.discountPercent,
        subtotal_minor: line.subtotalMinor,
        invoice_date: line.invoiceDate,
      });
      counts.insertedInvoiceLines += 1;
    }

    for (const link of bundle.tagLinks) {
      const subscriptionId = subscriptionIds.get(link.subscriptionName);
      const tagId = relations.tags.get(link.tagName);
      if (!subscriptionId || !tagId) {
        throw new Error(
          `Unresolved subscription seed tag link ${link.tagName}/${link.subscriptionName}`
        );
      }
      const existing = await trx(SubscriptionTagLink.tableName)
        .where({
          tag_id: tagId,
          resource_model: link.resourceModel,
          resource_id: subscriptionId,
        })
        .first('id');
      if (existing) continue;
      await trx(SubscriptionTagLink.tableName).insert({
        tag_id: tagId,
        resource_model: link.resourceModel,
        resource_id: subscriptionId,
      });
      counts.insertedTagLinks += 1;
    }
  });

  return counts;
}

function assertSubscriptionInitialSeed(
  bundle: SubscriptionInitialSeedBundle,
  context: string
): void {
  const planCodes = new Set(bundle.plans.map((plan) => plan.code));
  if (planCodes.size !== bundle.plans.length) {
    throw new Error(`${context}: duplicate subscription plan code`);
  }
  const planNames = new Set(bundle.plans.map((plan) => plan.name));
  if (planNames.size !== bundle.plans.length) {
    throw new Error(`${context}: duplicate subscription plan name`);
  }

  const subscriptionNames = new Set(bundle.subscriptions.map((subscription) => subscription.name));
  if (subscriptionNames.size !== bundle.subscriptions.length) {
    throw new Error(`${context}: duplicate subscription name`);
  }
  for (const subscription of bundle.subscriptions) {
    if (!planCodes.has(subscription.planCode)) {
      throw new Error(`${context}: unknown subscription plan ${subscription.planCode}`);
    }
  }

  const lineKeys = new Set<string>();
  for (const line of bundle.invoiceLines) {
    if (!subscriptionNames.has(line.subscriptionName)) {
      throw new Error(`${context}: unknown subscription contract ${line.subscriptionName}`);
    }
    const key = `${line.subscriptionName}:${line.sequence}`;
    if (lineKeys.has(key)) {
      throw new Error(`${context}: duplicate subscription invoice line ${key}`);
    }
    lineKeys.add(key);
  }

  const tagLinkKeys = new Set<string>();
  for (const link of bundle.tagLinks) {
    if (!subscriptionNames.has(link.subscriptionName)) {
      throw new Error(`${context}: unknown subscription tag link target ${link.subscriptionName}`);
    }
    const key = `${link.tagName}:${link.resourceModel}:${link.subscriptionName}`;
    if (tagLinkKeys.has(key)) {
      throw new Error(`${context}: duplicate subscription tag link ${key}`);
    }
    tagLinkKeys.add(key);
  }
}

interface SubscriptionSeedRelations {
  readonly companyId: number;
  readonly partners: Map<string, number>;
  readonly users: Map<string, number>;
  readonly saleOrders: Map<string, number>;
  readonly tags: Map<string, number>;
}

async function resolveSubscriptionSeedRelations(
  db: Knex,
  options: SeedSubscriptionInitialDataOptions,
  bundle: SubscriptionInitialSeedBundle
): Promise<SubscriptionSeedRelations> {
  const companyId = await resolveCompanyId(db, options);
  const partners = await resolveIdsByValue(
    db,
    'partners',
    'email',
    uniqueValues(bundle.subscriptions.map((subscription) => subscription.partnerEmail))
  );
  const users = await resolveIdsByValue(
    db,
    'users',
    'login',
    uniqueValues(bundle.subscriptions.map((subscription) => subscription.assignedToLogin))
  );
  const saleOrders = await resolveIdsByValue(
    db,
    'sale_orders',
    'name',
    uniqueValues(
      bundle.subscriptions
        .map((subscription) => subscription.saleOrderName)
        .filter((name): name is string => name !== null)
    )
  );
  const tags = await resolveIdsByValue(
    db,
    'tags',
    'name',
    uniqueValues(bundle.tagLinks.map((link) => link.tagName))
  );
  return { companyId, partners, users, saleOrders, tags };
}

async function resolveCompanyId(
  db: Knex,
  options: SeedSubscriptionInitialDataOptions
): Promise<number> {
  const rows = await db('companies').select('id', 'name');
  let company: { id: number | string; name: string } | undefined;
  if (options.companyId !== undefined) {
    company = rows.find((row) => Number(row.id) === options.companyId);
    if (!company) throw new Error(`Subscription seed company id ${options.companyId} not found`);
  } else if (options.companyName) {
    company = rows.find((row) => String(row.name) === options.companyName);
    if (!company) throw new Error(`Subscription seed company ${options.companyName} not found`);
  } else {
    company =
      rows.find((row) => String(row.name) === SEED_COMPANY) ??
      rows.find((row) => Number(row.id) === 1) ??
      rows[0];
  }
  if (!company) throw new Error('Subscription seed company not found');
  return Number(company.id);
}

async function resolveIdsByValue(
  db: Knex,
  table: string,
  column: string,
  values: readonly string[]
): Promise<Map<string, number>> {
  const resolved = new Map<string, number>();
  for (const value of values) {
    const row = await db(table)
      .where({ [column]: value })
      .first('id');
    if (!row) throw new Error(`Subscription seed ${table} ${value} not found`);
    resolved.set(value, Number(row.id));
  }
  return resolved;
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}
