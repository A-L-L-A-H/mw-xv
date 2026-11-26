import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company, Partner } from '@moonwitness/orm-base';
import { Project } from '@moonwitness/orm-project';
import { Subscription } from '@moonwitness/orm-subscription';

function modelRef(resolver: () => typeof BaseModel): () => typeof BaseModel {
  return resolver;
}

export const ISPType = defineModel('isp.isp_type', {
  table: 'isp_isp_types',
  order: 'sequence asc, name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    name: fields.string({ required: true, unique: true, label: 'Name' }),
    code: fields.string({ required: true, unique: true, label: 'Code' }),
    description: fields.text({ label: 'Description' }),
    sequence: fields.integer({ required: true, default: 10, label: 'Sequence' }),
  },
});

export const ISPNAS = defineModel('isp.nas', {
  table: 'isp_nas',
  order: 'name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    project: fields.belongsTo(
      modelRef(() => Project),
      { label: 'Project' }
    ),
    name: fields.string({ required: true, label: 'NAS Name' }),
    description: fields.text({ label: 'Description' }),
    ip_address: fields.string({ required: true, unique: true, label: 'IP Address' }),
    secret: fields.string({ required: true, sensitive: true, label: 'RADIUS Secret' }),
    vendor: fields.string({ label: 'Vendor' }),
    model: fields.string({ label: 'Hardware Model' }),
    location: fields.string({ label: 'Location' }),
    ha_group: fields.string({ label: 'HA Pool Group' }),
    ha_priority: fields.integer({ default: 100, label: 'HA Failover Priority' }),
    health_status: fields.enum(['healthy', 'degraded', 'offline'], {
      required: true,
      default: 'healthy',
      label: 'Health Status',
    }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const ISPBandwidthProfile = defineModel('isp.bandwidth_profile', {
  table: 'isp_bandwidth_profiles',
  order: 'name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    name: fields.string({ required: true, unique: true, label: 'Profile Name' }),
    download_kbps: fields.integer({ required: true, label: 'Download (kbps)' }),
    upload_kbps: fields.integer({ required: true, label: 'Upload (kbps)' }),
    burst_download_kbps: fields.integer({ label: 'Burst Download (kbps)' }),
    burst_upload_kbps: fields.integer({ label: 'Burst Upload (kbps)' }),
    burst_period: fields.integer({ label: 'Burst Period (seconds)' }),
  },
});

export const ISPPool = defineModel('isp.ip_pool', {
  table: 'isp_ip_pools',
  order: 'name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    name: fields.string({ required: true, unique: true, label: 'Pool Name' }),
    description: fields.text({ label: 'Description' }),
    network: fields.string({ required: true, label: 'Network CIDR' }),
    gateway: fields.string({ label: 'Gateway' }),
    dns1: fields.string({ label: 'Primary DNS' }),
    dns2: fields.string({ label: 'Secondary DNS' }),
    range_start: fields.string({ label: 'Range Start' }),
    range_end: fields.string({ label: 'Range End' }),
  },
});

export const ISPSubscriber = defineModel('isp.subscriber', {
  table: 'isp_subscribers',
  order: 'username asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    partner: fields.belongsTo(
      modelRef(() => Partner),
      { required: true, label: 'Customer' }
    ),
    subscription: fields.belongsTo(
      modelRef(() => Subscription),
      { label: 'Subscription' }
    ),
    project: fields.belongsTo(
      modelRef(() => Project),
      { label: 'Project' }
    ),
    profile: fields.belongsTo(
      modelRef(() => ISPBandwidthProfile),
      { label: 'Bandwidth Profile' }
    ),
    pool: fields.belongsTo(
      modelRef(() => ISPPool),
      { label: 'IP Pool' }
    ),
    username: fields.string({ required: true, unique: true, label: 'Username' }),
    password: fields.string({ required: true, sensitive: true, label: 'RADIUS Password' }),
    type: fields.enum(['pppoe', 'hotspot', 'static'], {
      required: true,
      default: 'pppoe',
      label: 'Connection Type',
    }),
    ip_address: fields.string({ label: 'Static IP' }),
    mac_address: fields.string({ label: 'MAC Address' }),
    start_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Start Date' }),
    expiry_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Expiry Date' }),
    monthly_price_minor: fields.integer({ label: 'Monthly Price (minor units)' }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
    status: fields.enum(['active', 'suspended', 'terminated'], {
      required: true,
      default: 'active',
      label: 'Status',
    }),
  },
});

export const ISPRadiusSession = defineModel('isp.radius_session', {
  table: 'isp_radius_sessions',
  order: 'start_time desc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    subscriber: fields.belongsTo(
      modelRef(() => ISPSubscriber),
      {
        required: true,
        label: 'Subscriber',
      }
    ),
    session_id: fields.string({ required: true, unique: true, label: 'Session ID' }),
    nas_ip: fields.string({ label: 'NAS IP' }),
    nas_port: fields.string({ label: 'NAS Port' }),
    username: fields.string({ required: true, label: 'Username' }),
    calling_station_id: fields.string({ label: 'Calling Station ID (MAC)' }),
    called_station_id: fields.string({ label: 'Called Station ID' }),
    framed_ip_address: fields.string({ label: 'Framed IP Address' }),
    framed_ipv6_address: fields.string({ label: 'Framed IPv6 Address' }),
    acct_input_octets: fields.integer({ label: 'Input Octets' }),
    acct_output_octets: fields.integer({ label: 'Output Octets' }),
    acct_session_time: fields.integer({ label: 'Session Time (seconds)' }),
    start_time: fields.string({ label: 'Start Time' }),
    stop_time: fields.string({ label: 'Stop Time' }),
    session_end_reason: fields.string({ label: 'End Reason' }),
  },
});

export const ISPRadiusOutbox = defineModel('isp.radius_outbox', {
  table: 'isp_radius_outbox',
  order: 'created_at asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    nas_ip: fields.string({ label: 'NAS IP' }),
    nas_port: fields.string({ label: 'NAS Port' }),
    username: fields.string({ required: true, label: 'Username' }),
    type: fields.enum(['disconnect', 'accounting'], { required: true, label: 'Type' }),
    // M19.08: lifecycle states are distinct from the transport outcome. Only
    // `acknowledged` means the NAS verified the Disconnect; `sent` means the
    // request went out but completion is still pending verification.
    status: fields.enum(
      ['pending', 'sent', 'acknowledged', 'rejected', 'timed_out', 'no_session', 'retryable_failure', 'failed'],
      {
        required: true,
        default: 'pending',
        label: 'Status',
      }
    ),
    acct_session_id: fields.string({ label: 'Acct-Session-ID' }),
    framed_ip_address: fields.string({ label: 'Framed IP Address' }),
    created_at: fields.string({ label: 'Created At' }),
    sent_at: fields.string({ label: 'Sent At' }),
    acknowledged_at: fields.string({ label: 'Acknowledged At' }),
    attempt_count: fields.integer({ label: 'Attempt Count' }),
    next_attempt_at: fields.string({ label: 'Next Attempt At' }),
    claim_token: fields.string({ label: 'Claim Token' }),
    response: fields.text({ label: 'Response' }),
    error_message: fields.text({ label: 'Error Message' }),
  },
});
