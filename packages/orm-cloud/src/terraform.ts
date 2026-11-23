import { CloudApp, CloudDeploymentTarget, CloudProvider, CloudServer } from './models/index.js';

function hclIdent(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return normalized || 'resource';
}

function hclString(raw: string): string {
  return JSON.stringify(raw);
}

export async function exportCloudTerraformHcl(companyId: number): Promise<string> {
  const [providers, servers, targets, apps] = await Promise.all([
    CloudProvider.query().where({ company_id: companyId, active: true }).orderBy('id', 'asc'),
    CloudServer.query().where({ company_id: companyId, active: true }).orderBy('id', 'asc'),
    CloudDeploymentTarget.query()
      .where({ company_id: companyId, active: true })
      .orderBy('id', 'asc'),
    CloudApp.query().where({ company_id: companyId, active: true }).orderBy('id', 'asc'),
  ]);

  const providerById = new Map(providers.map((p) => [p.id, p]));
  const serverById = new Map(servers.map((s) => [s.id, s]));
  const targetById = new Map(targets.map((t) => [t.id, t]));

  const lines: string[] = [
    '# Generated from MoonWitness @moonwitness/orm-cloud',
    'terraform {',
    '  required_version = ">= 1.6.0"',
    '}',
    '',
  ];

  for (const provider of providers) {
    if (provider.type === 'coolify') {
      lines.push(
        `variable ${hclString(`coolify_token_${hclIdent(provider.code)}`)} {`,
        '  type      = string',
        '  sensitive = true',
        '}',
        ''
      );
    }
  }

  for (const app of apps) {
    const target = targetById.get(app.deployment_target_id);
    const server = target?.server_id ? serverById.get(target.server_id) : undefined;
    const provider = server ? providerById.get(server.provider_id) : undefined;
    const resourceName = hclIdent(app.name);

    if (provider?.type === 'coolify') {
      lines.push(
        `resource "coolify_application" ${hclString(resourceName)} {`,
        `  name        = ${hclString(app.name)}`,
        `  endpoint    = ${hclString(provider.endpoint ?? target?.api_url ?? '')}`,
        `  docker_image = ${hclString(`${app.image}:${app.image_tag ?? 'latest'}`)}`,
        ...(app.domain ? [`  fqdn        = ${hclString(app.domain)}`] : []),
        '}',
        ''
      );
    } else {
      lines.push(
        `resource "docker_container" ${hclString(resourceName)} {`,
        `  name  = ${hclString(app.name)}`,
        `  image = ${hclString(`${app.image}:${app.image_tag ?? 'latest'}`)}`,
        ...(app.port && app.host_port
          ? ['  ports {', `    internal = ${app.port}`, `    external = ${app.host_port}`, '  }']
          : []),
        '}',
        ''
      );
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
