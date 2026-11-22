import { defineAddon, ref, seed } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import { ISPType, ISPNAS, ISPBandwidthProfile, ISPPool, ISPSubscriber, ISPRadiusSession, ISPRadiusOutbox } from './models/index.js';

export const manifest = defineAddon({
  name: 'isp',
  version: '1.0.0',
  depends: ['base'],
  models: [ISPType, ISPNAS, ISPBandwidthProfile, ISPPool, ISPSubscriber, ISPRadiusSession, ISPRadiusOutbox],
  data: [
    seed(ISPType, 'isp.type_pppoe', {
      company_id: 1,
      name: 'PPPoE',
      code: 'pppoe',
      description: 'PPPoE NAS device',
      sequence: 10,
    }),
    seed(ISPType, 'isp.type_hotspot', {
      company_id: 1,
      name: 'Hotspot',
      code: 'hotspot',
      description: 'WiFi Hotspot NAS device',
      sequence: 20,
    }),
    seed(ISPType, 'isp.type_static', {
      company_id: 1,
      name: 'Static IP',
      code: 'static',
      description: 'Static IP NAS device',
      sequence: 30,
    }),
    seed(ModelAccess, 'isp.access_user_nas_read', {
      group: ref('base.group_user'),
      model_name: ISPNAS.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    }),
    seed(ModelAccess, 'isp.access_user_subscriber_read', {
      group: ref('base.group_user'),
      model_name: ISPSubscriber.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'isp.access_user_session_read', {
      group: ref('base.group_user'),
      model_name: ISPRadiusSession.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    }),
  ],
  menus: [
    {
      model: ISPType.modelName,
      label: 'NAS Types',
      group: 'ISP',
      sequence: 30,
      developmentOnly: true,
    },
    {
      model: ISPNAS.modelName,
      label: 'NAS Devices',
      group: 'ISP',
      sequence: 31,
    },
    {
      model: ISPBandwidthProfile.modelName,
      label: 'Bandwidth Profiles',
      group: 'ISP',
      sequence: 32,
    },
    {
      model: ISPPool.modelName,
      label: 'IP Pools',
      group: 'ISP',
      sequence: 33,
    },
    {
      model: ISPSubscriber.modelName,
      label: 'Subscribers',
      group: 'ISP',
      sequence: 34,
    },
    {
      model: ISPRadiusSession.modelName,
      label: 'Radius Sessions',
      group: 'ISP',
      sequence: 35,
    },
    {
      model: ISPRadiusOutbox.modelName,
      label: 'Radius Outbox',
      group: 'ISP',
      sequence: 36,
      developmentOnly: true,
    },
  ],
});
