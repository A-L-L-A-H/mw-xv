import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company, Tag, TagLink } from '@moonwitness/orm-base';

export type ProductKind = 'physical' | 'digital' | 'service' | 'subscription';
export type ChannelStatus = 'draft' | 'active' | 'inactive' | 'rejected';

function parentProductModel(): typeof BaseModel {
  return Product;
}

export const Product = defineModel('catalog.product', {
  table: 'catalog_products',
  order: 'create_date desc',
  fields: {
    sku: fields.string({ required: true, unique: true, label: 'SKU' }),
    name: fields.string({ required: true, label: 'Product Name' }),
    description: fields.text({ label: 'Description' }),
    kind: fields.enum(['physical', 'digital', 'service', 'subscription'], {
      required: true,
      default: 'physical',
      label: 'Product Kind',
    }),
    price_minor: fields.integer({ required: true, default: 0, label: 'Sale Price (minor units)' }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    cost_minor: fields.integer({ label: 'Cost (minor units)' }),
    weight_g: fields.integer({ label: 'Weight (grams)' }),
    dimensions: fields.json({ label: 'Dimensions' }),
    images: fields.json({ label: 'Images' }),
    metadata: fields.json({ label: 'Metadata' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
    tags: fields.hasMany(TagLink, { foreignKey: 'resource_id', label: 'Tags' }),
    parent: fields.belongsTo(parentProductModel, { label: 'Parent Product' }),
  },
});

export const ProductVariant = defineModel('catalog.product_variant', {
  table: 'catalog_product_variants',
  order: 'id asc',
  fields: {
    product: fields.belongsTo(Product, { required: true, label: 'Product' }),
    sku: fields.string({ required: true, unique: true, label: 'Variant SKU' }),
    attributes: fields.json({ label: 'Attributes' }),
    price_adjustment_minor: fields.integer({
      required: true,
      default: 0,
      label: 'Price Adjustment (minor units)',
    }),
    stock_qty: fields.integer({ required: true, default: 0, label: 'Stock Quantity' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
  },
});

export const ProductChannel = defineModel('catalog.product_channel', {
  table: 'catalog_product_channels',
  order: 'id asc',
  fields: {
    product: fields.belongsTo(Product, { required: true, label: 'Product' }),
    marketplace_ref: fields.string({ label: 'Marketplace Reference' }),
    platform_listing_id: fields.string({ label: 'Platform Listing ID' }),
    status: fields.enum(['draft', 'active', 'inactive', 'rejected'], {
      required: true,
      default: 'draft',
      label: 'Listing Status',
    }),
    sync_config: fields.json({ label: 'Sync Configuration' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
  },
});
