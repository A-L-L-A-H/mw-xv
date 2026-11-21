import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALID_SLUG = /^[a-z][a-z0-9-]{1,31}$/u;

export function toPascalCase(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

export function buildAddonFiles(slug, { version = '1.0.0-rc.1' } = {}) {
  if (!VALID_SLUG.test(slug)) {
    throw new Error(
      `Invalid addon slug "${slug}". Use lowercase letters, digits, and hyphens (2-32 chars, starting with a letter).`
    );
  }
  const pkgName = `@moonwitness/orm-${slug}`;
  const pascal = toPascalCase(slug);
  const snake = slug.replace(/-/gu, '_');
  const modelName = `${snake}.record`;

  return {
    'package.json': `${JSON.stringify(
      {
        name: pkgName,
        version,
        type: 'module',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
        scripts: {
          build: 'tsc -p tsconfig.json',
          test: 'vitest run',
        },
        dependencies: {
          '@moonwitness/orm': 'workspace:*',
          '@moonwitness/orm-base': 'workspace:*',
        },
        moonwitnessAddon: {
          name: slug,
          entry: './dist/index.js',
        },
      },
      null,
      2
    )}\n`,
    'tsconfig.json': `${JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          outDir: './dist',
          rootDir: './src',
        },
        include: ['src/**/*'],
      },
      null,
      2
    )}\n`,
    'src/index.ts': `import { defineAddon, defineModel, fields } from '@moonwitness/orm';

export const ${pascal}Record = defineModel({
  name: '${modelName}',
  description: '${pascal} Record',
  fields: {
    name: fields.string({ required: true, label: 'Name' }),
    state: fields.selection({
      values: ['draft', 'active', 'archived'] as const,
      default: 'draft',
      label: 'State',
    }),
    notes: fields.text({ label: 'Notes' }),
  },
  views: {
    list: { columns: ['name', 'state', 'write_date'] },
    form: {
      groups: [{ title: 'General', fields: ['name', 'state', 'notes'] }],
    },
    search: { fields: ['name', 'notes'] },
  },
});

export const ${snake}Addon = defineAddon({
  name: '${slug}',
  version: '${version}',
  depends: ['base'],
  models: [${pascal}Record],
  menus: [
    {
      id: '${slug}.root',
      label: '${pascal}',
      model: '${modelName}',
      sequence: 80,
    },
  ],
});

export default ${snake}Addon;
`,
    [`tests/${slug}.test.ts`]: `import { describe, expect, it } from 'vitest';
import { ${snake}Addon, ${pascal}Record } from '../src/index.js';

describe('${pkgName}', () => {
  it('declares addon manifest and model metadata', () => {
    expect(${snake}Addon.name).toBe('${slug}');
    expect(${snake}Addon.depends).toContain('base');
    expect(${pascal}Record.modelName).toBe('${modelName}');
  });
});
`,
  };
}

export async function scaffoldAddon(slug, { targetRoot = root, dryRun = false } = {}) {
  const files = buildAddonFiles(slug);
  const addonDir = path.join(targetRoot, 'packages', `orm-${slug}`);
  if (!dryRun) {
    try {
      await stat(addonDir);
      throw new Error(`Target directory already exists: ${addonDir}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(addonDir, relPath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
    }
  }
  return { addonDir, files: Object.keys(files) };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const slug = args.find((arg) => !arg.startsWith('--'));
  if (!slug) {
    process.stderr.write('Usage: pnpm addon:create <addon-slug> [--dry-run]\n');
    process.exitCode = 1;
    return;
  }
  const result = await scaffoldAddon(slug, { dryRun });
  process.stdout.write(
    `${dryRun ? '[dry-run] Would scaffold' : 'Scaffolded'} ${result.addonDir} (${result.files.length} files).\n`
  );
  process.stdout.write(
    'Next steps: run `pnpm install`, `pnpm build`, `pnpm test:addon-conformance`, and `pnpm docs:generate`.\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
