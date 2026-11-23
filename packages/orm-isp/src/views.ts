import { defineView } from '@moonwitness/orm';
import {
  ISPBandwidthProfile,
  ISPNAS,
  ISPPool,
  ISPRadiusOutbox,
  ISPRadiusSession,
  ISPSubscriber,
  ISPType,
} from './models/index.js';

export const views = [
  defineView(ISPType, {
    title: 'NAS Types',
    list: { columns: ['sequence', 'code', 'name', 'company'], order: 'sequence asc, id asc' },
    form: {
      sections: [
        {
          title: 'Type',
          columns: 2,
          fields: ['company', 'code', 'name', 'sequence', 'description'],
        },
      ],
    },
    search: { fields: ['code', 'name'] },
  }),
  defineView(ISPNAS, {
    title: 'NAS Devices',
    list: {
      columns: ['name', 'ip_address', 'vendor', 'location', 'is_active', 'project', 'company'],
    },
    form: {
      sections: [
        {
          title: 'Router / NAS Gateway',
          columns: 2,
          fields: [
            'company',
            'project',
            'name',
            'ip_address',
            'secret',
            'vendor',
            'model',
            'location',
            'is_active',
          ],
        },
        { title: 'Notes', fields: ['description'] },
      ],
    },
    search: { fields: ['name', 'ip_address', 'vendor', 'location'] },
  }),
  defineView(ISPBandwidthProfile, {
    title: 'Bandwidth Profiles',
    list: {
      columns: [
        'name',
        'download_kbps',
        'upload_kbps',
        'burst_download_kbps',
        'burst_upload_kbps',
        'company',
      ],
    },
    form: {
      sections: [
        {
          title: 'Speed Limits',
          columns: 2,
          fields: [
            'company',
            'name',
            'download_kbps',
            'upload_kbps',
            'burst_download_kbps',
            'burst_upload_kbps',
            'burst_period',
          ],
        },
      ],
    },
    search: { fields: ['name'] },
  }),
  defineView(ISPPool, {
    title: 'IP Pools',
    list: { columns: ['name', 'network', 'gateway', 'range_start', 'range_end', 'company'] },
    form: {
      sections: [
        {
          title: 'Subnet & Range',
          columns: 2,
          fields: [
            'company',
            'name',
            'network',
            'gateway',
            'range_start',
            'range_end',
            'dns1',
            'dns2',
          ],
        },
        { title: 'Description', fields: ['description'] },
      ],
    },
    search: { fields: ['name', 'network', 'gateway'] },
  }),
  defineView(ISPSubscriber, {
    title: 'ISP Subscribers',
    list: {
      columns: [
        'username',
        'partner',
        'type',
        'profile',
        'subscription',
        'project',
        'status',
        'expiry_date',
      ],
      decorations: [
        { color: 'success', domain: [['status', '=', 'active']] },
        { color: 'warning', domain: [['status', '=', 'suspended']] },
        { color: 'muted', domain: [['status', '=', 'terminated']] },
      ],
    },
    form: {
      header: { statusField: 'status' },
      sections: [
        {
          title: 'Customer & Commercial Link',
          columns: 2,
          fields: [
            'company',
            'partner',
            'subscription',
            'project',
            'monthly_price_minor',
            'currency',
          ],
        },
        {
          title: 'RADIUS Access',
          columns: 2,
          fields: [
            'username',
            'password',
            'type',
            'status',
            'profile',
            'pool',
            'ip_address',
            'mac_address',
            'start_date',
            'expiry_date',
          ],
        },
      ],
    },
    search: {
      fields: ['username', 'ip_address', 'mac_address'],
      filters: [
        { label: 'Active', domain: [['status', '=', 'active']] },
        { label: 'Suspended', domain: [['status', '=', 'suspended']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Type', field: 'type' },
      ],
    },
  }),
  defineView(ISPRadiusSession, {
    title: 'RADIUS Sessions',
    list: {
      columns: [
        'session_id',
        'username',
        'nas_ip',
        'framed_ip_address',
        'acct_session_time',
        'start_time',
        'stop_time',
      ],
    },
    form: {
      sections: [
        {
          title: 'Session Details',
          columns: 2,
          fields: [
            'company',
            'subscriber',
            'session_id',
            'username',
            'nas_ip',
            'nas_port',
            'framed_ip_address',
            'framed_ipv6_address',
            'calling_station_id',
            'called_station_id',
            'acct_input_octets',
            'acct_output_octets',
            'acct_session_time',
            'start_time',
            'stop_time',
            'session_end_reason',
          ],
        },
      ],
    },
    search: { fields: ['session_id', 'username', 'nas_ip', 'framed_ip_address'] },
  }),
  defineView(ISPRadiusOutbox, {
    title: 'RADIUS Outbox',
    list: { columns: ['username', 'type', 'status', 'nas_ip', 'created_at', 'sent_at'] },
    form: {
      sections: [
        {
          title: 'Outbox Event',
          columns: 2,
          fields: [
            'company',
            'username',
            'type',
            'status',
            'nas_ip',
            'nas_port',
            'acct_session_id',
            'framed_ip_address',
            'created_at',
            'sent_at',
            'response',
            'error_message',
          ],
        },
      ],
    },
    search: { fields: ['username', 'type', 'status', 'nas_ip'] },
  }),
];
