import { defineAddon, ref, seed } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import { MarketplaceConnection, MarketplaceSyncJob, SyncMetric } from './models/index.js';
import { views } from './views.js';
import { ecommerceSyncHttpPlugin } from './http-plugin.js';
import { ecommerceSyncSeedManifest } from './seed-manifest.js';

export const manifest = defineAddon({
  name: 'ecommerce_sync',
  version: '1.0.0',
  displayName: 'E-Commerce Sync',
  category: 'Commerce',
  summary: 'Marketplace synchronization jobs, connections, and metrics.',
  depends: ['base'],
  models: [MarketplaceSyncJob, MarketplaceConnection, SyncMetric],
  httpPlugins: [ecommerceSyncHttpPlugin],
  data: [
    seed(ModelAccess, 'ecommerce.access_user_sync_job', {
      group: ref('base.group_user'),
      model_name: MarketplaceSyncJob.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'ecommerce.access_user_connection', {
      group: ref('base.group_user'),
      model_name: MarketplaceConnection.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'ecommerce.access_user_sync_metric', {
      group: ref('base.group_user'),
      model_name: SyncMetric.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    }),
  ],
  views,
  menus: [
    {
      model: MarketplaceSyncJob.modelName,
      label: 'Sync Jobs',
      group: 'E-Commerce',
      sequence: 10,
    },
    {
      model: MarketplaceConnection.modelName,
      label: 'Connections',
      group: 'E-Commerce',
      sequence: 20,
    },
    {
      model: SyncMetric.modelName,
      label: 'Sync Metrics',
      group: 'E-Commerce',
      sequence: 30,
      developmentOnly: true,
    },
  ],
});
