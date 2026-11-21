import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseCliArgs(argv) {
  const parsed = { ttlDays: 14, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (!flag.startsWith('--')) continue;
    const val = argv[i + 1];
    if (val === undefined) throw new Error(`Missing value for ${flag}`);
    i += 1;
    if (flag === '--name') parsed.name = val;
    else if (flag === '--flag') parsed.flag = val;
    else if (flag === '--proposal') parsed.proposal = val;
    else if (flag === '--ttl-days') parsed.ttlDays = Number(val);
    else if (flag === '--out-dir') parsed.outDir = path.resolve(val);
  }
  return parsed;
}

/**
 * Generates an ADR-0006 compliant experimental addon package blueprint with TTL metadata
 * and runtime feature-flag gating.
 */
export async function scaffoldExperimentalAddon(options) {
  const addonName = String(options.name ?? '').trim();
  if (!/^exp-[a-z][a-z0-9-]{1,40}$/u.test(addonName)) {
    throw new Error(
      'Experimental addon --name must start with "exp-" and use lowercase kebab-case'
    );
  }
  const flagKey = String(options.flag ?? addonName.replaceAll('-', '_')).trim();
  const proposalId = String(options.proposal ?? 'EVO-UNASSIGNED').trim();
  const ttlDays =
    Number.isFinite(options.ttlDays) && options.ttlDays > 0 ? Math.trunc(options.ttlDays) : 14;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  const modelKey = `${addonName.replaceAll('-', '_')}.record`;
  const tableName = `${addonName.replaceAll('-', '_')}_records`;
  const packageName = `@moonwitness/orm-${addonName}`;

  const manifestTs = [
    "import { defineAddon, defineModel, defineView, fields } from '@moonwitness/orm';",
    '',
    `export const ExperimentalRecord = defineModel('${modelKey}', {`,
    `  table: '${tableName}',`,
    '  fields: {',
    "    title: fields.string({ required: true, label: 'Title' }),",
    "    status: fields.enum(['draft', 'active', 'archived'], { required: true, default: 'draft' }),",
    '  },',
    '});',
    '',
    'export const manifest = defineAddon({',
    `  name: '${addonName}',`,
    "  version: '0.1.0',",
    "  depends: ['base'],",
    '  models: [ExperimentalRecord],',
    '  views: [',
    '    defineView(ExperimentalRecord, {',
    `      title: '${addonName} Records',`,
    "      list: { columns: ['title', 'status'], order: 'id desc' },",
    "      form: { sections: [{ title: 'Details', fields: ['title', 'status'] }] },",
    "      search: { fields: ['title'] },",
    '    }),',
    '  ],',
    `  menus: [{ model: '${modelKey}', group: 'Experiments', sequence: 900, developmentOnly: true }],`,
    '});',
    '',
    'export const experimentMetadata = {',
    `  flagKey: '${flagKey}',`,
    `  expiresAt: '${expiresAt}',`,
    `  proposalId: '${proposalId}',`,
    '} as const;',
    '',
  ].join('\n');

  const blueprint = {
    format: 'moonwitness-exp-addon-blueprint/v1',
    packageName,
    addonName,
    experimental: { flagKey, expiresAt, proposalId },
    files: {
      'src/manifest.ts': manifestTs,
      'src/index.ts':
        "export { manifest, ExperimentalRecord, experimentMetadata } from './manifest.js';\n",
      'package.json': `${JSON.stringify(
        {
          name: packageName,
          version: '0.1.0',
          type: 'module',
          main: './dist/index.js',
          types: './dist/index.d.ts',
          exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
          dependencies: {
            '@moonwitness/orm': 'workspace:*',
            '@moonwitness/orm-base': 'workspace:*',
          },
        },
        null,
        2
      )}\n`,
    },
    dryRun: Boolean(options.dryRun),
  };

  if (!options.dryRun && options.outDir) {
    const pkgDir = path.join(options.outDir, `orm-${addonName}`);
    await mkdir(path.join(pkgDir, 'src'), { recursive: true });
    for (const [relPath, contents] of Object.entries(blueprint.files)) {
      await writeFile(path.join(pkgDir, relPath), contents, 'utf8');
    }
    blueprint.writtenDir = pkgDir;
  }

  return blueprint;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parseCliArgs(process.argv.slice(2));
  const blueprint = await scaffoldExperimentalAddon(parsed);
  process.stdout.write(`${JSON.stringify(blueprint, null, 2)}\n`);
}
