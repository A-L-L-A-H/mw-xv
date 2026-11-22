import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_KEY_PATTERN = /secret|password|token|apikey|private[_-]?key|credential/iu;

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '[REDACTED]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}

export async function inspectWorkspaceOrm({
  workspaceRoot = root,
  addonFilter = null,
  modelFilter = null,
} = {}) {
  const packagesDir = path.join(workspaceRoot, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const addons = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(packagesDir, entry.name);
    let pkg;
    try {
      pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!entry.name.startsWith('orm-') && !pkg.moonwitnessAddon) continue;
    const addonName = pkg.moonwitnessAddon?.name ?? entry.name.replace(/^orm-/u, '');
    if (addonFilter && addonName !== addonFilter) continue;

    const srcDir = path.join(pkgDir, 'src');
    const models = [];
    try {
      const files = await readdir(srcDir, { recursive: true });
      for (const rel of files) {
        if (!String(rel).endsWith('.ts')) continue;
        const content = await readFile(path.join(srcDir, String(rel)), 'utf8');
        const patterns = [
          /defineModel\s*\(\s*['"]([^'"]+)['"]/gu,
          /defineModel\s*\(\s*\{[\s\S]*?name\s*:\s*['"]([^'"]+)['"]/gu,
          /static\s+(?:override\s+)?modelName\s*=\s*['"]([^'"]+)['"]/gu,
        ];
        for (const pattern of patterns) {
          for (const match of content.matchAll(pattern)) {
            const modelName = match[1];
            if (modelFilter && modelName !== modelFilter) continue;
            models.push(modelName);
          }
        }
      }
    } catch {
      // package without src/
    }

    if (modelFilter && models.length === 0) continue;
    addons.push({
      addon: addonName,
      packageName: pkg.name,
      version: pkg.version,
      models: [...new Set(models)].sort(),
    });
  }

  addons.sort((a, b) => a.addon.localeCompare(b.addon));
  return redactSecrets({
    format: 'moonwitness-orm-inspect/v1',
    addonCount: addons.length,
    modelCount: addons.reduce((sum, a) => sum + a.models.length, 0),
    addons,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const addonIdx = args.indexOf('--addon');
  const modelIdx = args.indexOf('--model');
  const addonFilter = addonIdx >= 0 ? (args[addonIdx + 1] ?? null) : null;
  const modelFilter = modelIdx >= 0 ? (args[modelIdx + 1] ?? null) : null;

  const report = await inspectWorkspaceOrm({ addonFilter, modelFilter });
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `MoonWitness ORM Inspect: ${report.addonCount} addons, ${report.modelCount} models\n`
  );
  for (const item of report.addons) {
    process.stdout.write(
      `  - ${item.addon} (${item.packageName}@${item.version}): ${item.models.length} models\n`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
