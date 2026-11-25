import {
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
  type AuthenticatedContext,
} from '@moonwitness/orm';
import type { Knex } from 'knex';
import { isRecord } from '@moonwitness/types';
import { Product, ProductVariant } from './models/index.js';
import {
  applyRepricing,
  parseRepricingRule,
  resolveVariantPrice,
  type VariantSelection,
} from './pricing.js';

interface ProductRow {
  id: number;
  sku: string;
  price_minor: number;
  cost_minor: number | null;
  company_id: number | null;
}

interface VariantRow {
  id: number;
  product_id: number;
  sku: string;
  attributes: string | null;
  price_adjustment_minor: number;
  stock_qty: number;
}

function parseVariantRows(rows: readonly VariantRow[]): VariantSelection[] {
  return rows.map((row) => ({
    id: row.id,
    product: row.product_id,
    sku: row.sku,
    attributes:
      typeof row.attributes === 'string'
        ? (JSON.parse(row.attributes) as Record<string, unknown>)
        : ((row.attributes ?? {}) as Record<string, unknown>),
    priceAdjustmentMinor: row.price_adjustment_minor,
    stockQty: row.stock_qty,
  }));
}

let db: Knex;

/** Binds the Knex instance used by the reprice route (called by the host at boot). */
export function bindCatalogDb(instance: Knex): void {
  db = instance;
}

export const catalogHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/catalog/products/reprice', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { sku, rule, variantSku, persist } = req.body;
    if (typeof sku !== 'string' || sku.trim() === '') {
      return reply.code(400).send({ success: false, error: 'sku string is required' });
    }

    let pricingRule;
    try {
      pricingRule = parseRepricingRule(rule);
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }

    const productRow = (await db(Product.tableName)
      .where({ sku: sku.trim() })
      .first('id', 'sku', 'price_minor', 'cost_minor', 'company_id')) as ProductRow | undefined;

    if (!productRow) {
      return reply.code(404).send({ success: false, error: `Product not found: ${sku}` });
    }

    if (auth.companyId !== productRow.company_id) {
      return reply.code(403).send({ success: false, error: 'Product belongs to another company' });
    }

    const variantRows = (await db(ProductVariant.tableName)
      .where({ product_id: productRow.id })
      .select(
        'id',
        'product_id',
        'sku',
        'attributes',
        'price_adjustment_minor',
        'stock_qty'
      )) as VariantRow[];

    try {
      const variantSelections = parseVariantRows(variantRows);
      const outcome = applyRepricing(productRow.price_minor, productRow.cost_minor, pricingRule);
      const variantResolution =
        typeof variantSku === 'string'
          ? resolveVariantPrice(productRow.price_minor, variantSelections, variantSku)
          : null;

      if (persist === true && auth.role !== 'admin') {
        return reply
          .code(403)
          .send({ success: false, error: 'Persisting repricing requires the admin role' });
      }

      if (persist === true) {
        await db(Product.tableName)
          .where({ id: productRow.id })
          .update({ price_minor: outcome.newPriceMinor, update_date: db.fn.now() });
      }

      return reply.code(200).send({
        success: true,
        data: {
          product: { id: productRow.id, sku: productRow.sku },
          repricing: outcome,
          variant: variantResolution,
          persisted: persist === true,
        },
      });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};
