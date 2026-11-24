import { defineView } from '@moonwitness/orm';
import {
  CloudApp,
  CloudDeployment,
  CloudDeploymentTarget,
  CloudProvider,
  CloudServer,
} from './models/index.js';

export const views = [
  defineView(CloudProvider, {
    title: 'Cloud Providers',
    list: { columns: ['name', 'code', 'type', 'endpoint', 'region', 'is_active', 'company'] },
    form: {
      sections: [
        {
          title: 'Provider Connection',
          columns: 2,
          fields: ['company', 'name', 'code', 'type', 'endpoint', 'region', 'is_active'],
        },
        // access_key/secret_key are intentionally NOT exposed in any view. Provider
        // credentials are supplied via secret references (see auth.ts token contract)
        // and are redacted from API responses, audit payloads, logs and Terraform output.
      ],
    },
    search: { fields: ['name', 'code', 'type', 'region'] },
  }),
  defineView(CloudServer, {
    title: 'Cloud Servers',
    list: {
      columns: [
        'name',
        'provider',
        'ip_address',
        'cpu_cores',
        'ram_gb',
        'disk_gb',
        'status',
        'subscription',
      ],
      decorations: [
        { color: 'success', domain: [['status', '=', 'active']] },
        { color: 'warning', domain: [['status', '=', 'maintenance']] },
        { color: 'muted', domain: [['status', '=', 'inactive']] },
      ],
    },
    form: {
      header: { statusField: 'status' },
      sections: [
        {
          title: 'Compute Node',
          columns: 2,
          fields: [
            'company',
            'provider',
            'name',
            'server_name',
            'ip_address',
            'provider_instance_id',
            'status',
          ],
        },
        {
          title: 'Capacity & Commercials',
          columns: 2,
          fields: [
            'cpu_cores',
            'ram_gb',
            'disk_gb',
            'os',
            'partner',
            'project',
            'subscription',
            'monthly_price_minor',
            'currency',
          ],
        },
      ],
    },
    search: { fields: ['name', 'server_name', 'ip_address', 'os'] },
  }),
  defineView(CloudDeploymentTarget, {
    title: 'Deployment Targets',
    list: { columns: ['name', 'environment', 'server', 'api_url', 'is_active', 'project'] },
    form: {
      sections: [
        {
          title: 'Target Environment',
          columns: 2,
          fields: [
            'company',
            'name',
            'environment',
            'server',
            'project',
            'docker_host',
            'port',
            'api_url',
            'is_active',
          ],
        },
      ],
    },
    search: { fields: ['name', 'environment', 'api_url'] },
  }),
  defineView(CloudApp, {
    title: 'Cloud Applications',
    list: {
      columns: [
        'name',
        'image',
        'image_tag',
        'domain',
        'deployment_target',
        'project',
        'subscription',
        'is_active',
      ],
    },
    form: {
      sections: [
        {
          title: 'Application & Commercial Ownership',
          columns: 2,
          fields: [
            'company',
            'name',
            'deployment_target',
            'partner',
            'project',
            'subscription',
            'monthly_price_minor',
            'currency',
            'is_active',
          ],
        },
        {
          title: 'Container & Routing',
          columns: 2,
          fields: [
            'image',
            'image_tag',
            'port',
            'host_port',
            'domain',
            'health_check_url',
            'volumes',
            {
              name: 'env_vars',
              label: 'Environment Variables (use secret references; values are redacted in logs)',
            },
          ],
        },
        { title: 'Description', fields: ['description'] },
      ],
    },
    search: { fields: ['name', 'image', 'domain'] },
  }),
  defineView(CloudDeployment, {
    title: 'Deployments',
    list: {
      columns: [
        'app',
        'version',
        'image_tag',
        'status',
        'trigger',
        'container_id',
        'started_at',
        'completed_at',
      ],
      decorations: [
        { color: 'success', domain: [['status', '=', 'running']] },
        { color: 'warning', domain: [['status', '=', 'building']] },
        { color: 'danger', domain: [['status', '=', 'failed']] },
      ],
    },
    form: {
      header: { statusField: 'status' },
      sections: [
        {
          title: 'Execution',
          columns: 2,
          fields: [
            'company',
            'app',
            'version',
            'image_tag',
            'status',
            'trigger',
            'container_id',
            'started_at',
            'completed_at',
          ],
        },
        { title: 'Output', fields: ['log', 'error_message'] },
      ],
    },
    search: { fields: ['version', 'image_tag', 'status', 'container_id'] },
  }),
];
