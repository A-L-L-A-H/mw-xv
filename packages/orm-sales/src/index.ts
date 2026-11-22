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
