export { manifest } from './manifest.js';
export { SaleOrderState, SaleOrder, SaleOrderLine, SaleOrderTagLink } from './models/index.js';
export {
  convertOpportunityToSaleOrder,
  confirmSaleOrder,
  type ConvertOpportunityOptions,
  type ConfirmSaleOrderOptions,
  type SaleOrderInstance,
} from './automation.js';
export { createSalesHttpPlugin, salesHttpPlugin } from './http.js';
export {
  compileQuote,
  projectOrderPayload,
  type VolumePriceTier,
  type QuoteLineInput,
  type TaxRule,
  type QuoteCompileInput,
  type CompiledQuoteLine,
  type TaxBreakdownEntry,
  type CompiledQuote,
  type ProjectedOrderLinePayload,
  type ProjectedOrderPayload,
} from './quote-engine.js';
