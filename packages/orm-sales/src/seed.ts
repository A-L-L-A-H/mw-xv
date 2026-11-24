import type { Knex } from 'knex';
import { countValue } from '@moonwitness/types';
import { SaleOrder, SaleOrderLine, SaleOrderState, SaleOrderTagLink } from './models/index.js';
import { Partner, resolveInsertedId } from '@moonwitness/orm-base';

export type SalesSeedStateCode = 'draft' | 'sent' | 'confirmed' | 'done' | 'cancel';

export interface SalesInitialStateSeed {
  readonly id: string;
  readonly code: SalesSeedStateCode;
  readonly name: string;
  readonly sequence: number;
  readonly is_done: boolean;
  readonly color: string;
}

export interface SalesInitialOrderSeed {
  readonly id: string;
  readonly name: string;
  readonly partnerEmail: string;
  readonly stateCode: SalesSeedStateCode;
  readonly opportunityName: string;
  readonly assignedToLogin: string;
  readonly currency: string;
  readonly deadline: string;
  readonly confirmDate: string | null;
  readonly totalAmountMinor: number;
  readonly description: string;
  readonly tagNames: readonly string[];
}

export interface SalesInitialLineSeed {
  readonly id: string;
  readonly orderId: string;
  readonly sequence: number;
  readonly name: string;
  readonly product: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly discountPercent: number;
  readonly subtotalMinor: number;
}

export interface SalesInitialSeed {
  readonly version: string;
  readonly states: readonly SalesInitialStateSeed[];
  readonly orders: readonly SalesInitialOrderSeed[];
  readonly lines: readonly SalesInitialLineSeed[];
}

export interface SalesSeedExecutionResult {
  readonly companyId: number;
  readonly statesTotal: number;
  readonly ordersTotal: number;
  readonly linesTotal: number;
  readonly tagLinksTotal: number;
  readonly insertedStates: number;
  readonly insertedOrders: number;
  readonly insertedLines: number;
  readonly insertedTagLinks: number;
}

export interface SeedSalesInitialDataOptions {
  readonly companyId?: number;
  readonly ownerId?: number;
}

interface SeedRow {
  readonly id: number | string;
}

interface CountRow {
  readonly count: number | string;
}

const SALES_SEED_STATES: readonly SalesInitialStateSeed[] = [
  {
    id: 'sales-seed-state-draft',
    code: 'draft',
    name: 'Seed Draft',
    sequence: 10,
    is_done: false,
    color: '#64748B',
  },
  {
    id: 'sales-seed-state-sent',
    code: 'sent',
    name: 'Seed Sent',
    sequence: 20,
    is_done: false,
    color: '#3B82F6',
  },
  {
    id: 'sales-seed-state-confirmed',
    code: 'confirmed',
    name: 'Seed Confirmed',
    sequence: 30,
    is_done: false,
    color: '#0EA5E9',
  },
  {
    id: 'sales-seed-state-done',
    code: 'done',
    name: 'Seed Done',
    sequence: 90,
    is_done: true,
    color: '#22C55E',
  },
  {
    id: 'sales-seed-state-cancel',
    code: 'cancel',
    name: 'Seed Cancel',
    sequence: 100,
    is_done: false,
    color: '#EF4444',
  },
];

const SALES_SEED_ORDERS: readonly SalesInitialOrderSeed[] = [
  {
    id: 'sales-seed-order-acme-workshop',
    name: 'SEED-SO-2026-0001',
    partnerEmail: 'procurement@acme.local',
    stateCode: 'confirmed',
    opportunityName: 'Acme Studio Annual Platform License',
    assignedToLogin: 'superadmin',
    currency: 'USD',
    deadline: '2026-12-18',
    confirmDate: '2026-11-19',
    totalAmountMinor: 12500000,
    description: 'Deterministic seed order for Acme Studio platform expansion.',
    tagNames: ['Customer'],
  },
  {
    id: 'sales-seed-order-meridian-workflow',
    name: 'SEED-SO-2026-0002',
    partnerEmail: 'ops@meridian.local',
    stateCode: 'sent',
    opportunityName: 'Meridian Enterprise Workflow Suite',
    assignedToLogin: 'superadmin',
    currency: 'USD',
    deadline: '2026-12-27',
    confirmDate: null,
    totalAmountMinor: 7600000,
    description: 'Deterministic seed order for Meridian enterprise workflow rollout.',
    tagNames: ['Customer'],
  },
  {
    id: 'sales-seed-order-kite-cluster',
    name: 'SEED-SO-2026-0003',
    partnerEmail: 'infra@kite.local',
    stateCode: 'done',
    opportunityName: 'Kite and Co Dedicated Cluster Deployment',
    assignedToLogin: 'superadmin',
    currency: 'USD',
    deadline: '2026-11-29',
    confirmDate: '2026-11-16',
    totalAmountMinor: 9800000,
    description: 'Deterministic seed order for Kite and Co dedicated cluster capacity.',
    tagNames: [],
  },
  {
    id: 'sales-seed-order-bluebird-support',
    name: 'SEED-SO-2026-0004',
    partnerEmail: 'cx.director@bluebird.local',
    stateCode: 'draft',
    opportunityName: 'Bluebird Omnichannel Support Upgrade',
    assignedToLogin: 'system',
    currency: 'USD',
    deadline: '2027-01-14',
    confirmDate: null,
    totalAmountMinor: 3700000,
    description: 'Deterministic seed order for Bluebird omnichannel support uplift.',
    tagNames: [],
  },
];

const SALES_SEED_LINES: readonly SalesInitialLineSeed[] = [
  {
    id: 'sales-seed-line-acme-platform-seats',
    orderId: 'sales-seed-order-acme-workshop',
    sequence: 10,
    name: 'Expansion Platform Seats (40 Users)',
    product: 'MW-SEED-SEAT',
    quantity: 40,
    unitPriceMinor: 250000,
    discountPercent: 0,
    subtotalMinor: 10000000,
  },
  {
    id: 'sales-seed-line-acme-onboarding',
    orderId: 'sales-seed-order-acme-workshop',
    sequence: 20,
    name: 'Expansion Onboarding Package',
    product: 'MW-SEED-ONBOARD',
    quantity: 1,
    unitPriceMinor: 2500000,
    discountPercent: 0,
    subtotalMinor: 2500000,
  },
  {
    id: 'sales-seed-line-meridian-workflow-licenses',
    orderId: 'sales-seed-order-meridian-workflow',
    sequence: 10,
    name: 'Enterprise Workflow Licenses (50 Users)',
    product: 'MW-SEED-WORKFLOW',
    quantity: 50,
    unitPriceMinor: 160000,
    discountPercent: 5,
    subtotalMinor: 7600000,
  },
  {
    id: 'sales-seed-line-kite-cluster-nodes',
    orderId: 'sales-seed-order-kite-cluster',
    sequence: 10,
    name: 'Dedicated Cluster Nodes',
    product: 'MW-SEED-CLUSTER',
    quantity: 2,
    unitPriceMinor: 4900000,
    discountPercent: 0,
    subtotalMinor: 9800000,
  },
  {
    id: 'sales-seed-line-bluebird-support-seats',
    orderId: 'sales-seed-order-bluebird-support',
    sequence: 10,
    name: 'Omnichannel Support Seats (25 Users)',
    product: 'MW-SEED-SUPPORT',
    quantity: 25,
    unitPriceMinor: 120000,
    discountPercent: 0,
    subtotalMinor: 3000000,
  },
  {
    id: 'sales-seed-line-bluebird-sla-extension',
    orderId: 'sales-seed-order-bluebird-support',
    sequence: 20,
    name: 'SLA Extension Package',
    product: 'MW-SEED-SLA',
    quantity: 1,
    unitPriceMinor: 700000,
    discountPercent: 0,
    subtotalMinor: 700000,
  },
];

function cloneSalesSeed(): SalesInitialSeed {
  return {
    version: '1.0.0',
    states: SALES_SEED_STATES.map((state) => ({ ...state })),
    orders: SALES_SEED_ORDERS.map((order) => ({ ...order, tagNames: [...order.tagNames] })),
    lines: SALES_SEED_LINES.map((line) => ({ ...line })),
  };
}

function assertSalesSeed(bundle: SalesInitialSeed): void {
  const stateIds = new Set(bundle.states.map((state) => state.id));
  const stateCodes = new Set(bundle.states.map((state) => state.code));
  const stateNames = new Set(bundle.states.map((state) => state.name));
  const orderIds = new Set(bundle.orders.map((order) => order.id));
  const orderNames = new Set(bundle.orders.map((order) => order.name));
  const lineIds = new Set(bundle.lines.map((line) => line.id));

  if (
    stateIds.size !== bundle.states.length ||
    stateCodes.size !== bundle.states.length ||
    stateNames.size !== bundle.states.length
  ) {
    throw new Error('Sales seed states contain duplicate identifiers, codes, or names');
  }
  if (orderIds.size !== bundle.orders.length || orderNames.size !== bundle.orders.length) {
    throw new Error('Sales seed orders contain duplicate identifiers or names');
  }
  if (lineIds.size !== bundle.lines.length) {
    throw new Error('Sales seed lines contain duplicate identifiers');
  }

  const stateCodeById = new Map(bundle.states.map((state) => [state.id, state.code]));
  const orderIdById = new Map(bundle.orders.map((order) => [order.id, order.id]));
  const lineKeys = new Set<string>();
  for (const order of bundle.orders) {
    if (!stateCodes.has(order.stateCode)) {
      throw new Error(
        `Sales seed order '${order.id}' references unknown state '${order.stateCode}'`
      );
    }
    if (!stateCodeById.has(stateCodeByIdKey(order.stateCode))) {
      throw new Error(`Sales seed order '${order.id}' has unresolvable state code`);
    }
  }
  for (const line of bundle.lines) {
    if (!orderIdById.has(line.orderId)) {
      throw new Error(`Sales seed line '${line.id}' references unknown order '${line.orderId}'`);
    }
    const lineKey = `${line.orderId}:${line.sequence}`;
    if (lineKeys.has(lineKey)) {
      throw new Error(`Sales seed line sequence '${lineKey}' is duplicated`);
    }
    lineKeys.add(lineKey);
  }
}

function stateCodeByIdKey(code: SalesSeedStateCode): string {
  return `sales-seed-state-${code}`;
}

export function buildSalesInitialSeed(): SalesInitialSeed {
  const bundle = cloneSalesSeed();
  assertSalesSeed(bundle);
  return bundle;
}

export async function seedSalesInitialData(
  db: Knex,
  options: SeedSalesInitialDataOptions = {}
): Promise<SalesSeedExecutionResult> {
  const bundle = buildSalesInitialSeed();
  const companyRow =
    options.companyId === undefined
      ? await db('companies').orderBy('id', 'asc').first<SeedRow>('id')
      : await db('companies').where({ id: options.companyId }).first<SeedRow>('id');
  if (!companyRow) {
    throw new Error('Cannot seed sales initial data: no company record found in database');
  }
  const companyId = Number(companyRow.id);

  const ownerRow =
    options.ownerId === undefined
      ? await db('users').where({ login: 'superadmin' }).first<SeedRow>('id')
      : await db('users').where({ id: options.ownerId }).first<SeedRow>('id');
  const fallbackOwnerRow =
    ownerRow ?? (await db('users').orderBy('id', 'asc').first<SeedRow>('id'));
  if (!fallbackOwnerRow) {
    throw new Error('Cannot seed sales initial data: no salesperson record found in database');
  }
  const ownerId = Number(fallbackOwnerRow.id);

  const stateIdByCode = new Map<SalesSeedStateCode, number>();
  let insertedStates = 0;
  for (const stateSeed of bundle.states) {
    const existing = await db(SaleOrderState.tableName)
      .where({ name: stateSeed.name })
      .first<SeedRow>('id');
    if (existing) {
      stateIdByCode.set(stateSeed.code, Number(existing.id));
      continue;
    }
    const inserted = (await db(SaleOrderState.tableName)
      .insert({
        company_id: companyId,
        name: stateSeed.name,
        sequence: stateSeed.sequence,
        is_done: stateSeed.is_done,
        color: stateSeed.color,
      })
      .returning('id')) as unknown[];
    const stateId = resolveInsertedId(inserted, `state '${stateSeed.id}'`);
    stateIdByCode.set(stateSeed.code, stateId);
    insertedStates += 1;
  }

  const orderDbIdBySeedId = new Map<string, number>();
  let insertedOrders = 0;
  let insertedTagLinks = 0;
  for (const orderSeed of bundle.orders) {
    let partnerRow = await db('partners')
      .where({ email: orderSeed.partnerEmail })
      .first<SeedRow>('id');
    if (!partnerRow) {
      const inserted = (await db('partners')
        .insert({
          name: orderSeed.partnerEmail.split('@')[0],
          email: orderSeed.partnerEmail,
          is_company: false,
          is_customer: true,
          company_id: companyId,
        })
        .returning('id')) as unknown[];
      partnerRow = { id: resolveInsertedId(inserted, `partner '${orderSeed.partnerEmail}'`) };
    }
    let opportunityRow = await db('crm_opportunities')
      .where({ name: orderSeed.opportunityName })
      .first<SeedRow>('id');
    if (!opportunityRow) {
      const inserted = (await db('crm_opportunities')
        .insert({
          name: orderSeed.opportunityName,
          partner_id: Number(partnerRow.id),
          company_id: companyId,
          stage_id: stateIdByCode.get(orderSeed.stateCode) ?? 0,
          probability: 50,
          expected_revenue_minor: orderSeed.totalAmountMinor,
          currency: orderSeed.currency,
          assigned_to_id: ownerId,
          deadline: orderSeed.deadline,
          description: `Auto-created for sales seed order ${orderSeed.name}`,
        })
        .returning('id')) as unknown[];
      opportunityRow = {
        id: resolveInsertedId(inserted, `opportunity '${orderSeed.opportunityName}'`),
      };
    }
    const stateId = stateIdByCode.get(orderSeed.stateCode);
    if (!stateId) {
      throw new Error(
        `Sales seed order '${orderSeed.id}' has unresolved state '${orderSeed.stateCode}'`
      );
    }

    let orderRow = await db(SaleOrder.tableName)
      .where({ name: orderSeed.name })
      .first<SeedRow>('id');
    if (!orderRow) {
      const inserted = (await db(SaleOrder.tableName)
        .insert({
          name: orderSeed.name,
          partner_id: Number(partnerRow.id),
          company_id: companyId,
          state_id: stateId,
          opportunity_id: Number(opportunityRow.id),
          currency: orderSeed.currency,
          description: orderSeed.description,
          assigned_to_id: ownerId,
          deadline: orderSeed.deadline,
          confirm_date: orderSeed.confirmDate,
          total_amount_minor: orderSeed.totalAmountMinor,
        })
        .returning('id')) as unknown[];
      orderRow = { id: resolveInsertedId(inserted, `order '${orderSeed.id}'`) };
      insertedOrders += 1;
    }
    const orderDbId = Number(orderRow.id);
    orderDbIdBySeedId.set(orderSeed.id, orderDbId);

    for (const tagName of orderSeed.tagNames) {
      const tagRow = await db('tags').where({ name: tagName }).first<SeedRow>('id');
      if (!tagRow) {
        throw new Error(`Sales seed tag '${tagName}' not found`);
      }
      const linkFilter = {
        tag_id: Number(tagRow.id),
        resource_model: SaleOrder.modelName,
        resource_id: orderDbId,
      };
      const existingLink = await db(SaleOrderTagLink.tableName)
        .where(linkFilter)
        .first<SeedRow>('id');
      if (!existingLink) {
        await db(SaleOrderTagLink.tableName).insert(linkFilter);
        insertedTagLinks += 1;
      }
    }
  }

  let insertedLines = 0;
  for (const lineSeed of bundle.lines) {
    const orderDbId = orderDbIdBySeedId.get(lineSeed.orderId);
    if (!orderDbId) {
      throw new Error(
        `Sales seed line '${lineSeed.id}' has unresolved order '${lineSeed.orderId}'`
      );
    }
    const existing = await db(SaleOrderLine.tableName)
      .where({ order_id: orderDbId, sequence: lineSeed.sequence })
      .first<SeedRow>('id');
    if (existing) continue;
    await db(SaleOrderLine.tableName).insert({
      name: lineSeed.name,
      order_id: orderDbId,
      product: lineSeed.product,
      quantity: lineSeed.quantity,
      unit_price_minor: lineSeed.unitPriceMinor,
      discount_percent: lineSeed.discountPercent,
      subtotal_minor: lineSeed.subtotalMinor,
      sequence: lineSeed.sequence,
    });
    insertedLines += 1;
  }

  const statesTotal = await db(SaleOrderState.tableName).count<CountRow>({ count: '*' }).first();
  const ordersTotal = await db(SaleOrder.tableName).count<CountRow>({ count: '*' }).first();
  const linesTotal = await db(SaleOrderLine.tableName).count<CountRow>({ count: '*' }).first();
  const tagLinksTotal = await db(SaleOrderTagLink.tableName)
    .count<CountRow>({ count: '*' })
    .first();

  return {
    companyId,
    statesTotal: countValue(statesTotal),
    ordersTotal: countValue(ordersTotal),
    linesTotal: countValue(linesTotal),
    tagLinksTotal: countValue(tagLinksTotal),
    insertedStates,
    insertedOrders,
    insertedLines,
    insertedTagLinks,
  };
}
