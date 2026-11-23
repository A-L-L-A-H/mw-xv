/**
 * CLI entrypoint: `node dist/cli.js` serves the read-only MoonWitness MCP
 * server over stdio. Manifest loading is lazy and read-only.
 *
 * NOTE: addon packages are PEER packages resolved from the host workspace
 * (imported dynamically so this package's dependency graph stays minimal;
 * zero external npm dependencies). Missing addons are skipped silently so
 * the catalog reflects whatever the host workspace provides.
 */
import { MoonWitnessMcpServer } from './server.js';
import { serveMoonWitnessStdio } from './stdio.js';
import { MANIFEST_KEYS, registerCatalogManifests, type ManifestKey } from './manifest-registry.js';

interface ManifestLoaderSpec {
  readonly packageName: string;
  readonly exportName: string;
  readonly addonName: string;
}

const MANIFEST_LOADERS: readonly ManifestLoaderSpec[] = [
  { packageName: '@moonwitness/orm-base', exportName: 'manifest', addonName: 'base' },
  { packageName: '@moonwitness/auth', exportName: 'manifest', addonName: 'auth' },
  { packageName: '@moonwitness/jobs', exportName: 'jobsManifest', addonName: 'jobs' },
  { packageName: '@moonwitness/orm-notification', exportName: 'manifest', addonName: 'notification' },
  { packageName: '@moonwitness/orm-workflow', exportName: 'manifest', addonName: 'workflow' },
  { packageName: '@moonwitness/orm-organization', exportName: 'manifest', addonName: 'organization' },
  { packageName: '@moonwitness/orm-project', exportName: 'manifest', addonName: 'project' },
  { packageName: '@moonwitness/orm-crm', exportName: 'manifest', addonName: 'crm' },
  { packageName: '@moonwitness/orm-sales', exportName: 'manifest', addonName: 'sales' },
  { packageName: '@moonwitness/orm-subscription', exportName: 'manifest', addonName: 'subscription' },
  { packageName: '@moonwitness/orm-integration', exportName: 'manifest', addonName: 'integration' },
  { packageName: '@moonwitness/orm-request', exportName: 'manifest', addonName: 'request' },
  { packageName: '@moonwitness/orm-knowledge', exportName: 'manifest', addonName: 'knowledge' },
  { packageName: '@moonwitness/orm-ai', exportName: 'manifest', addonName: 'ai' },
  { packageName: '@moonwitness/orm-a2a', exportName: 'manifest', addonName: 'a2a' },
  { packageName: '@moonwitness/orm-storage', exportName: 'manifest', addonName: 'storage' },
  { packageName: '@moonwitness/orm-whatsapp', exportName: 'whatsappManifest', addonName: 'whatsapp' },
  { packageName: '@moonwitness/orm-isp', exportName: 'manifest', addonName: 'isp' },
  { packageName: '@moonwitness/orm-cloud', exportName: 'manifest', addonName: 'cloud' },
];

type ManifestEntry = { name: string; manifest: never };

async function loadManifest(spec: ManifestLoaderSpec): Promise<ManifestEntry | undefined> {
  try {
    const module = (await import(spec.packageName)) as Record<string, unknown>;
    const manifest = module[spec.exportName];
    return manifest ? { name: spec.addonName, manifest: manifest as never } : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const loaders: Partial<Record<ManifestKey, () => Promise<ManifestEntry | undefined>>> = {};
  for (const key of MANIFEST_KEYS) {
    const spec = MANIFEST_LOADERS.find((entry) => entry.addonName === key);
    if (!spec) continue;
    loaders[key] = () => loadManifest(spec);
  }
  await registerCatalogManifests(loaders as Parameters<typeof registerCatalogManifests>[0]);

  const server = new MoonWitnessMcpServer();
  const handle = serveMoonWitnessStdio(server);
  const onSignal = (): void => {
    void handle.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  await handle.done;
}

await main();
