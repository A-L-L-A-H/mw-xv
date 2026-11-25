import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { seedSubscriptionInitialData } from './seed.js';

export type { AddonSeedManifest };
export const subscriptionSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    const res = await seedSubscriptionInitialData(ctx.db, {
      companyId: ctx.companyId,
    });
    const inserted =
      res.insertedPlans +
      res.insertedSubscriptions +
      res.insertedInvoiceLines +
      res.insertedTagLinks;
    const total =
      res.plansTotal + res.subscriptionsTotal + res.invoiceLinesTotal + res.tagLinksTotal;
    return {
      inserted,
      updated: 0,
      skipped: Math.max(0, total - inserted),
    };
  },
};
