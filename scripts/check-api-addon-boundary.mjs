import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiSourceRoot = path.join(root, 'apps/api/src');

/**
 * Legacy exceptions tracked for extraction into `packages/orm-whatsapp`.
 * Zero new ORM models or addon manifests may be defined inside `apps/api/src`.
 */
const LEGACY_MODEL_ALLOWLIST = new Set(['apps/api/src/whatsapp/models.ts']);
const LEGACY_ADDON_ALLOWLIST = new Set(['apps/api/src/whatsapp/manifest.ts']);

export function findApiAddonBoundaryViolations(source, file = 'apps/api/src/fixture.ts') {
  const normalized = file.replaceAll('\\', '/');
  const violations = [];
  const parsed = ts.createSourceFile(normalized, source, ts.ScriptTarget.Latest, true);
  const report = (node, rule, detail) => {
    const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
    violations.push(`${normalized}:${line + 1}: ${rule}${detail ? ` (${detail})` : ''}`);
  };

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'defineModel' && !LEGACY_MODEL_ALLOWLIST.has(normalized)) {
        report(
          node.expression,
          'ORM model definitions are forbidden inside apps/api/src',
          'move the model into a workspace addon package under packages/orm-* and register its manifest in apps/api/src/addons/registry.ts'
        );
      }
      if (node.expression.text === 'defineAddon' && !LEGACY_ADDON_ALLOWLIST.has(normalized)) {
        report(
          node.expression,
          'Addon manifests are forbidden inside apps/api/src',
          'define the addon in a workspace package under packages/* and register it in apps/api/src/addons/registry.ts'
        );
      }
    }

    if (
      ts.isClassDeclaration(node) &&
      !LEGACY_MODEL_ALLOWLIST.has(normalized) &&
      node.heritageClauses?.some((clause) =>
        clause.types.some((type) => type.expression.getText(parsed) === 'BaseModel')
      )
    ) {
      report(
        node,
        'BaseModel subclasses are forbidden inside apps/api/src',
        'move ORM models into a workspace addon package under packages/orm-*'
      );
    }

    if (
      normalized === 'apps/api/src/app.ts' &&
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (/^\.\/routes\//u.test(specifier)) {
        report(
          node.moduleSpecifier,
          'apps/api/src/app.ts must stay thin and must not import route plugins directly',
          'register addon routes through apps/api/src/addons/registry.ts'
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return violations;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(file);
        return entry.isFile() && /\.[jt]sx?$/u.test(entry.name) ? [file] : [];
      })
    )
  ).flat();
}

async function main() {
  const violations = [];
  for (const file of await sourceFiles(apiSourceRoot)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    violations.push(...findApiAddonBoundaryViolations(await readFile(file, 'utf8'), relative));
  }

  if (violations.length > 0) {
    console.error(`API addon-first boundary check failed with ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
      'Fix: keep domain models/addons in workspace packages under packages/* and wire them through apps/api/src/addons/registry.ts. Recheck with `pnpm api:addon:check`.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    'API addon-first boundary check passed: apps/api stays thin and all new models/addons live in workspace packages.'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
