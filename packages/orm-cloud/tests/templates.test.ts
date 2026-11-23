import { describe, expect, it } from 'vitest';
import {
  PAAS_TEMPLATE_CATALOG,
  buildDeployParamsFromTemplate,
  getPaasTemplateById,
} from '../src/templates.js';
import type { MoonWitnessMeshDeployParams } from '../src/providers/moonwitness-mesh.js';

describe('PAAS_TEMPLATE_CATALOG', () => {
  it('contains all 6 required production templates', () => {
    const ids = PAAS_TEMPLATE_CATALOG.map((t) => t.id);
    expect(ids).toEqual([
      'postgres-16',
      'redis-7',
      'ollama-local',
      'static-site',
      'node-api',
      'moonwitness-tenant',
    ]);
  });

  it('looks up templates by id', () => {
    const pg = getPaasTemplateById('postgres-16');
    expect(pg?.image).toBe('postgres:16-alpine');
    expect(pg?.defaultPort).toBe(5432);
    expect(getPaasTemplateById('nonexistent')).toBeUndefined();
  });
});

describe('buildDeployParamsFromTemplate', () => {
  it('builds valid MoonWitnessMeshDeployParams for postgres-16 with merged env', () => {
    const params: MoonWitnessMeshDeployParams = buildDeployParamsFromTemplate('postgres-16', {
      endpoint: 'http://100.64.0.2:3003',
      slug: 'billing-db',
      tenant: 'tenant-1',
      env: {
        POSTGRES_PASSWORD: 'super-secret-password',
        POSTGRES_DB: 'billing_prod',
      },
    });

    expect(params.endpoint).toBe('http://100.64.0.2:3003');
    expect(params.slug).toBe('billing-db');
    expect(params.image).toBe('postgres:16-alpine');
    expect(params.port).toBe(5432);
    expect(params.tenant).toBe('tenant-1');
    expect(params.env).toEqual({
      POSTGRES_USER: 'postgres',
      POSTGRES_DB: 'billing_prod',
      POSTGRES_PASSWORD: 'super-secret-password',
    });
  });

  it('builds valid params for moonwitness-tenant with required secrets', () => {
    const params = buildDeployParamsFromTemplate('moonwitness-tenant', {
      endpoint: 'http://10.0.0.5:3003',
      slug: 'acme-tenant',
      domain: 'acme.moonwitness.cloud',
      port: 4000,
      env: {
        MW_INTERNAL_SECRET: 'sec-123',
        DATABASE_URL: 'postgres://user:pass@10.0.0.6:5432/acme',
      },
    });

    expect(params.image).toBe('ghcr.io/moonwitness/tenant-runtime:latest');
    expect(params.port).toBe(4000);
    expect(params.domain).toBe('acme.moonwitness.cloud');
    expect(params.env?.MW_TENANT_MODE).toBe('isolated');
  });

  it('rejects missing required env keys fail-closed', () => {
    expect(() =>
      buildDeployParamsFromTemplate('postgres-16', {
        endpoint: 'http://100.64.0.2:3003',
        slug: 'missing-pw-db',
      })
    ).toThrow(/POSTGRES_PASSWORD/u);
  });

  it('rejects unknown template id, invalid slug, invalid port, and invalid env key', () => {
    expect(() =>
      buildDeployParamsFromTemplate('unknown-tpl', {
        endpoint: 'http://100.64.0.2:3003',
        slug: 'app-1',
      })
    ).toThrow(/Unknown PaaS template/u);

    expect(() =>
      buildDeployParamsFromTemplate('redis-7', {
        endpoint: 'http://100.64.0.2:3003',
        slug: '../evil',
      })
    ).toThrow(/Invalid PaaS app slug/u);

    expect(() =>
      buildDeployParamsFromTemplate('redis-7', {
        endpoint: 'http://100.64.0.2:3003',
        slug: 'cache-1',
        port: 70000,
      })
    ).toThrow(/Invalid port/u);

    expect(() =>
      buildDeployParamsFromTemplate('node-api', {
        endpoint: 'http://100.64.0.2:3003',
        slug: 'api-1',
        env: { 'BAD-KEY': '1' },
      })
    ).toThrow(/Invalid environment variable key/u);
  });
});
