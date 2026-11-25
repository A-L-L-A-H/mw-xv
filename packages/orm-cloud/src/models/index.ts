import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company, Partner } from '@moonwitness/orm-base';
import { Project } from '@moonwitness/orm-project';
import { Subscription } from '@moonwitness/orm-subscription';

function modelRef(resolver: () => typeof BaseModel): () => typeof BaseModel {
  return resolver;
}

export const CloudProvider = defineModel('cloud.provider', {
  table: 'cloud_providers',
  order: 'name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    name: fields.string({ required: true, label: 'Provider Name' }),
    code: fields.string({ required: true, unique: true, label: 'Code' }),
    type: fields.enum(['docker_agent', 'coolify', 'gcp', 'vps_ssh'], {
      required: true,
      default: 'docker_agent',
      label: 'Provider Type',
    }),
    endpoint: fields.string({ label: 'Endpoint URL' }),
    access_key: fields.string({ sensitive: true, label: 'Access Key' }),
    secret_key: fields.string({ sensitive: true, label: 'Secret Key' }),
    region: fields.string({ label: 'Region' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const CloudServer = defineModel('cloud.server', {
  table: 'cloud_servers',
  order: 'name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    provider: fields.belongsTo(
      modelRef(() => CloudProvider),
      {
        required: true,
        label: 'Cloud Provider',
      }
    ),
    partner: fields.belongsTo(
      modelRef(() => Partner),
      { label: 'Customer' }
    ),
    project: fields.belongsTo(
      modelRef(() => Project),
      { label: 'Project' }
    ),
    subscription: fields.belongsTo(
      modelRef(() => Subscription),
      { label: 'Subscription' }
    ),
    name: fields.string({ required: true, unique: true, label: 'Name' }),
    server_name: fields.string({ label: 'Hostname' }),
    ip_address: fields.string({ label: 'Public IP' }),
    provider_instance_id: fields.string({ label: 'Provider Instance ID' }),
    cpu_cores: fields.integer({ label: 'CPU Cores' }),
    ram_gb: fields.integer({ label: 'RAM (GB)' }),
    disk_gb: fields.integer({ label: 'Disk (GB)' }),
    os: fields.string({ label: 'OS' }),
    region: fields.string({ default: 'local', label: 'Region' }),
    ha_group: fields.string({ label: 'HA Group' }),
    ha_priority: fields.integer({ default: 100, label: 'HA Priority' }),
    monthly_price_minor: fields.integer({ label: 'Monthly Price (minor units)' }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    status: fields.enum(['active', 'inactive', 'maintenance'], {
      required: true,
      default: 'active',
      label: 'Status',
    }),
  },
});

export const CloudDeploymentTarget = defineModel('cloud.deployment_target', {
  table: 'cloud_deployment_targets',
  order: 'name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    server: fields.belongsTo(
      modelRef(() => CloudServer),
      { label: 'Server' }
    ),
    project: fields.belongsTo(
      modelRef(() => Project),
      { label: 'Project' }
    ),
    name: fields.string({ required: true, unique: true, label: 'Target Name' }),
    environment: fields.enum(['production', 'staging', 'development'], {
      required: true,
      default: 'production',
      label: 'Environment',
    }),
    docker_host: fields.string({ label: 'Docker Host' }),
    port: fields.integer({ default: 3003, label: 'Agent Port' }),
    api_url: fields.string({ label: 'Control Plane API URL' }),
    ha_group: fields.string({ label: 'HA Group' }),
    priority: fields.integer({ default: 100, label: 'Failover Priority' }),
    health_status: fields.enum(['healthy', 'degraded', 'offline'], {
      required: true,
      default: 'healthy',
      label: 'Health Status',
    }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const CloudApp = defineModel('cloud.app', {
  table: 'cloud_apps',
  order: 'name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    deployment_target: fields.belongsTo(
      modelRef(() => CloudDeploymentTarget),
      {
        required: true,
        label: 'Deployment Target',
      }
    ),
    partner: fields.belongsTo(
      modelRef(() => Partner),
      { label: 'Customer' }
    ),
    project: fields.belongsTo(
      modelRef(() => Project),
      { label: 'Project' }
    ),
    subscription: fields.belongsTo(
      modelRef(() => Subscription),
      { label: 'Subscription' }
    ),
    name: fields.string({ required: true, unique: true, label: 'App Name' }),
    description: fields.text({ label: 'Description' }),
    image: fields.string({ required: true, label: 'Container Image' }),
    image_tag: fields.string({ default: 'latest', label: 'Image Tag' }),
    port: fields.integer({ label: 'Container Port' }),
    host_port: fields.integer({ label: 'Host Port' }),
    env_vars: fields.json({ label: 'Environment Variables' }),
    volumes: fields.text({ label: 'Volume Mappings' }),
    domain: fields.string({ label: 'Custom Domain' }),
    managed_by: fields.enum(['manual', 'paas', 'coolify'] as const, {
      required: true,
      default: 'manual',
      label: 'Managed By',
    }),
    deploy_mode: fields.enum(['image', 'compose', 'git'] as const, {
      required: true,
      default: 'image',
      label: 'Deploy Mode',
    }),
    template_id: fields.string({ label: 'Coolify Template ID' }),
    compose_spec: fields.text({ label: 'Compose Specification' }),
    git_repo: fields.string({ label: 'Git Repository URL' }),
    git_branch: fields.string({ label: 'Git Branch' }),
    dockerfile_path: fields.string({ label: 'Dockerfile Path' }),
    ingress_routes: fields.json({ label: 'Ingress Routes' }),
    webhook_secret: fields.string({ sensitive: true, label: 'Webhook Secret' }),
    coolify_uuid: fields.string({ label: 'Coolify Application UUID' }),
    health_check_url: fields.string({ label: 'Health Check URL' }),
    monthly_price_minor: fields.integer({ label: 'Monthly Price (minor units)' }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const CloudDeployment = defineModel('cloud.deployment', {
  table: 'cloud_deployments',
  order: 'started_at desc, id desc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    app: fields.belongsTo(
      modelRef(() => CloudApp),
      { required: true, label: 'App' }
    ),
    version: fields.string({ label: 'Version' }),
    image_tag: fields.string({ label: 'Image Tag' }),
    status: fields.enum(['pending', 'building', 'running', 'failed', 'stopped'], {
      required: true,
      default: 'pending',
      label: 'Status',
    }),
    container_id: fields.string({ label: 'Container ID' }),
    trigger: fields.enum(['manual', 'webhook', 'agent'], {
      required: true,
      default: 'manual',
      label: 'Trigger',
    }),
    log: fields.text({ label: 'Deployment Log' }),
    started_at: fields.string({ label: 'Started At' }),
    completed_at: fields.string({ label: 'Completed At' }),
    error_message: fields.text({ label: 'Error Message' }),
  },
});
