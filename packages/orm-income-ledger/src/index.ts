import { manifest } from './manifest.js';

export {
  INCOME_STREAM_KINDS,
  INCOME_STREAM_STATUSES,
  INCOME_ENTRY_KINDS,
  INCOME_ALLOCATION_TARGETS,
} from './models.js';

export * from './models.js';
export * from './recompute.js';
export * from './adapters/sales.js';
export * from './adapters/subscription.js';
export * from './adapters/ecommerce.js';
export * from './adapters/ads.js';
export * from './adapters/affiliate.js';
export * from './adapters/content.js';
export * from './adapters/donation.js';

export { manifest } from './manifest.js';
export { incomeHttpPlugin } from './http-plugin.js';
export { seedIncomeStreams } from './seed.js';

export function createIncomeLedgerAddon() {
  return manifest;
}

export function computeAllocationSplit(
  stream: { id: string; kind: string; status: string; goalMonthlyMinor: number },
  allocations: { target: string; percentage: number; isActive: boolean }[]
): Record<string, number> {
  const result = {
    reinvest: 0,
    savings: 0,
    charity: 0,
    personal: 0,
    tax: 0,
  };

  for (const alloc of allocations) {
    if (alloc.isActive) {
      result[alloc.target as keyof typeof result] += alloc.percentage;
    }
  }

  return result;
}
