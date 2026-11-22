import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiSourceRoot = path.join(root, 'apps/api/src');

/**
 * All domain ORM models and addon manifests must live in workspace packages under `packages/*`.
 * Zero ORM models or addon manifests may be defined inside `apps/api/src`.
 */
const LEGACY_MODEL_ALLOWLIST = new Set();
const LEGACY_ADDON_ALLOWLIST = new Set();

/**
 * Core HTTP host routes that belong to `apps/api` itself (not domain addons).
 */
const CORE_API_ROUTE_ALLOWLIST = new Set([
  'apps/api/src/routes/auth.routes.ts',
  'apps/api/src/routes/bootstrap.routes.ts',
  'apps/api/src/routes/generic.routes.ts',
  'apps/api/src/routes/generic-addon-validation.ts',
  'apps/api/src/routes/generic-audit.ts',
  'apps/api/src/routes/generic-extended.routes.ts',
  'apps/api/src/routes/generic-query-graph.ts',
  'apps/api/src/routes/generic-references.ts',
  'apps/api/src/routes/health.routes.ts',
  'apps/api/src/routes/jobs.routes.ts',
]);

/**
 * Frozen shrink-only allowlist of pre-existing domain route files in `apps/api/src/routes/`.
 * NEVER add new entries here. All new custom domain routes MUST be defined inside their
 * workspace addon package (`packages/orm-*`) and exported via `manifest.httpPlugins`.
 */
const LEGACY_DOMAIN_ROUTE_ALLOWLIST = new Set([
  'apps/api/src/routes/ai-corporation.routes.ts',
  'apps/api/src/routes/ai-desktop-sync.routes.ts',
  'apps/api/src/routes/bug-case.routes.ts',
  'apps/api/src/routes/child-protection.routes.ts',
  'apps/api/src/routes/concept-profile.routes.ts',
  'apps/api/src/routes/corpus.routes.ts',
  'apps/api/src/routes/evidence.routes.ts',
  'apps/api/src/routes/local-ai-suggestion.routes.ts',
  'apps/api/src/routes/local-retrieval.routes.ts',
  'apps/api/src/routes/project.routes.ts',
  'apps/api/src/routes/publication.routes.ts',
  'apps/api/src/routes/research-actor-identity.routes.ts',
  'apps/api/src/routes/research-duplicate-candidates.routes.ts',
  'apps/api/src/routes/research-explanation.routes.ts',
  'apps/api/src/routes/research-privacy.routes.ts',
  'apps/api/src/routes/research-review.routes.ts',
  'apps/api/src/routes/research-witness.routes.ts',
  'apps/api/src/routes/story-workbench.routes.ts',
  'apps/api/src/routes/whatsapp.routes.ts',
  'apps/api/src/routes/whatsapp/accounts.routes.ts',
  'apps/api/src/routes/whatsapp/conversations.routes.ts',
  'apps/api/src/routes/whatsapp/group-management.routes.ts',
  'apps/api/src/routes/whatsapp/groups.routes.ts',
  'apps/api/src/routes/whatsapp/media.routes.ts',
  'apps/api/src/routes/whatsapp/message-actions.routes.ts',
  'apps/api/src/routes/whatsapp/messages.routes.ts',
  'apps/api/src/routes/whatsapp/statuses.routes.ts',
  'apps/api/src/routes/whatsapp/triage.routes.ts',
  'apps/api/src/routes/whatsapp/webhooks.routes.ts',
  'apps/api/src/routes/workflow.routes.ts',
]);

function isAllowedApiRouteFile(normalizedPath) {
  return (
    CORE_API_ROUTE_ALLOWLIST.has(normalizedPath) ||
    LEGACY_DOMAIN_ROUTE_ALLOWLIST.has(normalizedPath)
  );
}

export function findApiAddonBoundaryViolations(source, file = 'apps/api/src/fixture.ts') {
  const normalized = file.replaceAll('\\', '/');
  const violations = [];
  if (normalized.startsWith('apps/api/src/routes/') && !isAllowedApiRouteFile(normalized)) {
    violations.push(
      `${normalized}:1: Custom route files are forbidden inside apps/api/src/routes (define custom HTTP routes inside your workspace addon package under packages/orm-* and export them via manifest.httpPlugins)`
    );
  }
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

    if (
      normalized === 'apps/api/src/addons/registry.ts' &&
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (/^\.\.\/routes\//u.test(specifier)) {
        const targetTs = `apps/api/src/${specifier.slice(3).replace(/\.js$/u, '.ts')}`;
        if (!isAllowedApiRouteFile(targetTs)) {
          report(
            node.moduleSpecifier,
            'New custom route imports in apps/api/src/addons/registry.ts are forbidden',
            'expose custom HTTP routes via manifest.httpPlugins in your workspace addon package under packages/orm-*'
          );
        }
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
