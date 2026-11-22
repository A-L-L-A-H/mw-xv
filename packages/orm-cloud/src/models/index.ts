import { defineModel, fields } from '@moonwitness/orm';
import { Partner } from '@moonwitness/orm-base';
import { Company } from '@moonwitness/orm-base';
import { Project } from '@moonwitness/orm-project';
import { Subscription } from '@moonwitness/orm-subscription';

export const CloudProvider = defineModel('cloud.provider', {
  table: 'cloud_providers',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    code: fields.string({ required: true, unique: true }),
    type: fields.string({
      required: true,
      values: ['docker_agent', 'coolify', 'gcp', 'vps_ssh'],
      label: 'Provider Type',
    }),
    endpoint: fields.string({ label: 'Endpoint URL' }),
    access_key: fields.string({ label: 'Access Key' }),
    secret_key: fields.string({ label: 'Secret Key' }),
    region: fields.string({ label: 'Region' }),
    is_active: fields.boolean({ required: true, default: true }),
    company_id: fields.integer({ label: 'Company' }),
  },
});

export const CloudServer = defineModel('cloud.server', {
  table: 'cloud_servers',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    provider_id: fields.integer({ required: true, label: 'Cloud Provider' }),
    server_name: fields.string({ label: 'Server Name' }),
    ip_address: fields.string({ label: 'Public IP' }),
    provider_instance_id: fields.string({ label: 'Provider Instance ID' }),
    cpu_cores: fields.integer({ label: 'CPU Cores' }),
    ram_gb: fields.integer({ label: 'RAM (GB)' }),
    disk_gb: fields.integer({ label: 'Disk (GB)' }),
    os: fields.string({ label: 'OS' }),
    status: fields.string({
      required: true,
      values: ['active', 'inactive', 'maintenance'],
      label: 'Status',
    }),
    company_id: fields.integer({ label: 'Company' }),
  },
});

export const CloudDeploymentTarget = defineModel('cloud.deployment_target', {
  table: 'cloud_deployment_targets',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    server_id: fields.integer({ label: 'Server' }),
    environment: fields.string({
      required: true,
      values: ['production', 'staging', 'development'],
      label: 'Environment',
    }),
    docker_host: fields.string({ label: 'Docker Host' }),
    port: fields.integer({ label: 'Docker Port', default: 2375 }),
    api_url: fields.string({ label: 'API URL' }),
    is_active: fields.boolean({ required: true, default: true }),
    company_id: fields.integer({ label: 'Company' }),
  },
});

export const CloudApp = defineModel('cloud.app', {
  table: 'cloud_apps',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    description: fields.text({ label: 'Description' }),
    deployment_target_id: fields.integer({ required: true, label: 'Deployment Target' }),
    image: fields.string({ required: true, label: 'Container Image' }),
    image_tag: fields.string({ label: 'Image Tag', default: 'latest' }),
    port: fields.integer({ label: 'Container Port' }),
    host_port: fields.integer({ label: 'Host Port' }),
    env_vars: fields.json({ label: 'Environment Variables' }),
    volumes: fields.text({ label: 'Volume Mappings' }),
    domain: fields.string({ label: 'Custom Domain' }),
    health_check_url: fields.string({ label: 'Health Check URL' }),
    is_active: fields.boolean({ required: true, default: true }),
    company_id: fields.integer({ label: 'Company' }),
    project_id: fields.integer({ label: 'Project' }),
    subscription_id: fields.integer({ label: 'Subscription' }),
  },
});

export const CloudDeployment = defineModel('cloud.deployment', {
  table: 'cloud_deployments',
  order: 'created_at desc',
  fields: {
    app_id: fields.integer({ required: true, label: 'App' }),
    version: fields.string({ label: 'Version' }),
    image_tag: fields.string({ label: 'Image Tag' }),
    status: fields.string({
      required: true,
      values: ['pending', 'building', 'running', 'failed', 'stopped'],
      label: 'Status',
    }),
    container_id: fields.string({ label: 'Container ID' }),
    trigger: fields.string({
      required: true,
      values: ['manual', 'webhook', 'agent'],
      label: 'Trigger',
    }),
    log: fields.text({ label: 'Deployment Log' }),
    started_at: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$' }),
    completed_at: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$' }),
    error_message: fields.text({ label: 'Error Message' }),
  },
});