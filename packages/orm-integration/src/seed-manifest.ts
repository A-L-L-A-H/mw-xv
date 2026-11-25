import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
export type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { seedIntegrationData } from './seed.js';

export const integrationSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: async (ctx: SeedContext): Promise<SeedResult> => {
    const result = await seedIntegrationData(ctx.db, { companyId: ctx.companyId });
    const inserted =
      result.insertedErpConnectors +
      result.insertedGatewayConnectors +
      result.insertedWebhookEndpoints;
    const total =
      result.erpConnectorsTotal + result.gatewayConnectorsTotal + result.webhookEndpointsTotal;
    return {
      inserted,
      updated: 0,
      skipped: total - inserted,
    };
  },
};
