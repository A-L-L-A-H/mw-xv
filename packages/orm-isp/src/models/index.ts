import { defineModel, fields } from '@moonwitness/orm';
import { Partner } from '@moonwitness/orm-base';
import { Company } from '@moonwitness/orm-base';

export const ISPType = defineModel('isp.isp_type', {
  table: 'isp_isp_types',
  order: 'sequence asc, name asc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    code: fields.string({ required: true, unique: true }),
    description: fields.text({ label: 'Description' }),
    company_id: fields.integer({ label: 'Company' }),
    sequence: fields.integer({ required: true, default: 10 }),
  },
});

export const ISPNAS = defineModel('isp.nas', {
  table: 'isp_nas',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    description: fields.text({ label: 'Description' }),
    ip_address: fields.string({ required: true, unique: true }),
    secret: fields.string({ required: true }),
    vendor: fields.string({ label: 'Vendor' }),
    model: fields.string({ label: 'Model' }),
    location: fields.string({ label: 'Location' }),
    is_active: fields.boolean({ required: true, default: true }),
    company_id: fields.integer({ label: 'Company' }),
    project_id: fields.integer({ label: 'Project' }),
  },
});

export const ISPBandwidthProfile = defineModel('isp.bandwidth_profile', {
  table: 'isp_bandwidth_profiles',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    download_kbps: fields.integer({ required: true }),
    upload_kbps: fields.integer({ required: true }),
    burst_download_kbps: fields.integer({ label: 'Burst Download' }),
    burst_upload_kbps: fields.integer({ label: 'Burst Upload' }),
    burst_period: fields.integer({ label: 'Burst Period (seconds)' }),
    company_id: fields.integer({ label: 'Company' }),
  },
});

export const ISPPool = defineModel('isp.ip_pool', {
  table: 'isp_ip_pools',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    description: fields.text({ label: 'Description' }),
    network: fields.string({ required: true, label: 'Network CIDR' }),
    gateway: fields.string({ label: 'Gateway' }),
    dns1: fields.string({ label: 'DNS 1' }),
    dns2: fields.string({ label: 'DNS 2' }),
    range_start: fields.string({ label: 'Range Start' }),
    range_end: fields.string({ label: 'Range End' }),
    company_id: fields.integer({ label: 'Company' }),
  },
});

export const ISPSubscriber = defineModel('isp.subscriber', {
  table: 'isp_subscribers',
  order: 'username asc',
  fields: {
    username: fields.string({ required: true, unique: true }),
    password: fields.string({ required: true }),
    partner_id: fields.integer({ required: true, label: 'Customer' }),
    company_id: fields.integer({ label: 'Company' }),
    type: fields.string({ required: true, values: ['pppoe', 'hotspot', 'static'], label: 'Connection Type' }),
    ip_address: fields.string({ label: 'Static IP' }),
    mac_address: fields.string({ label: 'MAC Address' }),
    profile_id: fields.integer({ label: 'Bandwidth Profile' }),
    pool_id: fields.integer({ label: 'IP Pool' }),
    start_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    expiry_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    status: fields.string({
      required: true,
      default: 'active',
      values: ['active', 'suspended', 'terminated'],
      label: 'Status',
    }),
  },
});

export const ISPRadiusSession = defineModel('isp.radius_session', {
  table: 'isp_radius_sessions',
  order: 'start_time desc',
  fields: {
    session_id: fields.string({ required: true, unique: true }),
    subscriber_id: fields.integer({ required: true, label: 'Subscriber' }),
    nas_ip: fields.string({ label: 'NAS IP' }),
    nas_port: fields.string({ label: 'NAS Port' }),
    username: fields.string({ required: true }),
    calling_station_id: fields.string({ label: 'Calling Station ID (MAC)' }),
    called_station_id: fields.string({ label: 'Called Station ID' }),
    framed_ip_address: fields.string({ label: 'Framed IP Address' }),
    framed_ipv6_address: fields.string({ label: 'Framed IPv6 Address' }),
    acct_input_octets: fields.integer({ label: 'Input Octets' }),
    acct_output_octets: fields.integer({ label: 'Output Octets' }),
    acct_session_time: fields.integer({ label: 'Session Time (seconds)' }),
    start_time: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$' }),
    stop_time: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$' }),
    session_end_reason: fields.string({ label: 'End Reason' }),
  },
});

export const ISPRadiusOutbox = defineModel('isp.radius_outbox', {
  table: 'isp_radius_outbox',
  order: 'created_at asc',
  fields: {
    nas_ip: fields.string({ label: 'NAS IP' }),
    nas_port: fields.string({ label: 'NAS Port' }),
    username: fields.string({ required: true }),
    type: fields.string({ required: true, values: ['disconnect', 'accounting'], label: 'Type' }),
    status: fields.string({
      required: true,
      default: 'pending',
      values: ['pending', 'sent', 'failed'],
      label: 'Status',
    }),
    acct_session_id: fields.string({ label: 'Acct-Session-ID' }),
    framed_ip_address: fields.string({ label: 'Framed IP Address' }),
    created_at: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$' }),
    sent_at: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$' }),
    response: fields.text({ label: 'Response' }),
    error_message: fields.text({ label: 'Error Message' }),
  },
});