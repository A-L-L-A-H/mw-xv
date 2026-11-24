import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Guarded roots: the agent-facing MCP server package and the Antigravity plugin
 * must stay strictly read-only. They may never define ORM models/addons nor
 * issue database write statements.
 */
const GUARDED_ROOTS = ['packages/mcp-moonwitness/src', 'plugins/moonwitness'];

/**
 * LEGACY_* allowlists must stay empty per learned invariants.
 * Never add entries here — fix violations at the source instead.
 */
const LEGACY_WRITE_ALLOWLIST = new Set();

const WRITE_SQL_PATTERN = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/iu;

export function findAgentBoundaryViolations(source, file = 'packages/mcp-moonwitness/src/fixture.ts') {
  const normalized = file.replaceAll('\\', '/');
  const violations = [];
  const parsed = ts.createSourceFile(normalized, source, ts.ScriptTarget.Latest, true);
  const report = (node, rule, detail) => {
    const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
    violations.push(`${normalized}:${line + 1}: ${rule}${detail ? ` (${detail})` : ''}`);
  };

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'defineModel') {
        report(
          node.expression,
          'defineModel is forbidden in agent-owned surfaces',
          'models are defined only in packages/orm-* and registered via apps/api/src/addons/registry.ts API_ADDONS[]'
        );
      }
      if (node.expression.text === 'defineAddon') {
        report(
          node.expression,
          'defineAddon is forbidden in agent-owned surfaces',
          'addon manifests live in packages/orm-* and are enumerated read-only via apps/api/src/addons/registry.ts API_ADDONS[]'
        );
      }
    }

    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
      const literalText = ts.isTemplateExpression(node)
        ? node.getText(parsed)
        : node.text;
      if (WRITE_SQL_PATTERN.test(literalText) && !LEGACY_WRITE_ALLOWLIST.has(normalized)) {
        report(
          node,
          'Database write SQL is forbidden in agent-owned surfaces',
          'the MCP server performs read-only SELECT queries exclusively'
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return violations;
}

async function guardedFiles(directory) {
  try {
    await readdir(directory);
  } catch {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) return guardedFiles(file);
        if (!entry.isFile()) return [];
        if (/\.[jt]sx?$/u.test(entry.name)) return [file];
        if (/\.(md|json)$/u.test(entry.name)) return [file];
        return [];
      })
    )
  ).flat();
}

async function main() {
  const violations = [];
  for (const guardedRoot of GUARDED_ROOTS) {
    const absoluteRoot = path.join(root, guardedRoot);
    for (const file of await guardedFiles(absoluteRoot)) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      const source = await readFile(file, 'utf8');
      if (/\.[jt]sx?$/u.test(file)) {
        violations.push(...findAgentBoundaryViolations(source, relative));
      } else if (WRITE_SQL_PATTERN.test(source)) {
        violations.push(`${relative}:1: Database write SQL is forbidden in agent-owned surfaces (read-only SELECT queries only)`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(`Agent boundary check failed with ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
      'Fix: agent surfaces (packages/mcp-moonwitness, plugins/moonwitness) must remain strictly read-only — no defineModel/defineAddon, no SQL write statements. Recheck with `pnpm agent:boundary:check`.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    'Agent boundary check passed: packages/mcp-moonwitness and plugins/moonwitness are free of model/addon definitions and write SQL.'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
