import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const debtRules = new Set([
  'hardcoded-color',
  'shared-token-literal',
  'shared-style-override',
  'duplicate-chalk-mask',
]);
const normalizeFile = (file) => path.posix.normalize(file.replaceAll('\\', '/'));
const normalizeEvidence = (value) => value.replace(/\s+/g, ' ').trim();
const lexicalCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const isUiFile = (file) => file.startsWith('packages/ui/');
const appOf = (file) => /^apps\/[^/]+/.exec(file)?.[0];
const visualProperty = (property) =>
  /^(?:color|background(?:-|$)|border(?:-|$)|outline(?:-|$)|(?:box-|text-)?shadow$|fill(?:-|$)|stroke(?:-|$)|(?:text-decoration|caret|accent)-color$)/.test(
    property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
  );

function closingParen(text, start) {
  let depth = 1;
  let quote;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (quote) {
      if (text[i] === quote) quote = undefined;
    } else if (text[i] === '"' || text[i] === "'") {
      quote = text[i];
    } else if (text[i] === '(') {
      depth++;
    } else if (text[i] === ')' && --depth === 0) {
      return i;
    }
  }
  return text.length - 1;
}

// Mask non-code without changing offsets; URLs may contain CSS-looking SVG data.
function maskCss(text) {
  const chars = text.split('');
  const blank = (start, end) => {
    for (let i = start; i <= end; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const last = end === -1 ? text.length - 1 : end + 1;
      blank(i, last);
      i = last;
    } else if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      let end = i + 1;
      while (end < text.length) {
        if (text[end] === '\\') end += 2;
        else if (text[end++] === quote) break;
      }
      blank(i, end - 1);
      i = end - 1;
    } else if (text.slice(i, i + 3).toLowerCase() === 'url' && !/[\w-]/.test(text[i - 1] ?? '')) {
      let open = i + 3;
      while (/\s/.test(text[open] ?? '') && open < text.length) open++;
      if (text[open] === '(') {
        const end = closingParen(text, open);
        blank(i, end);
        i = end;
      }
    } else if (text[i] === '\\') {
      i++;
    }
  }
  return chars.join('');
}

function cssDeclarations(source, onDeclaration, onBlock) {
  const code = maskCss(source);
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  const declaration = (end) => {
    const segment = code.slice(start, end);
    const colon = segment.indexOf(':');
    if (colon === -1) return;
    const property = segment.slice(0, colon).trim();
    if (!/^(?:--[\w-]+|[\w-]+)$/.test(property)) return;
    const offset = start + segment.indexOf(property);
    onDeclaration({
      property,
      value: source.slice(start + colon + 1, end).trim(),
      offset,
    });
  };
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '(') parentheses++;
    else if (code[i] === ')') parentheses--;
    else if (code[i] === '[') brackets++;
    else if (code[i] === ']') brackets--;
    else if (!parentheses && !brackets) {
      if (code[i] === '{') {
        const selector = code.slice(start, i).trim();
        onBlock(selector, start + code.slice(start, i).search(/\S/));
        start = i + 1;
      } else if (code[i] === ';' || code[i] === '}') {
        declaration(i);
        start = i + 1;
      }
    }
  }
}

function hasLiteralColor(value) {
  const code = maskCss(value);
  if (/(?:^|[^\w-])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])/i.test(code))
    return true;
  if (/(?<![\w-])(?:white|black)(?![\w-])/i.test(code)) return true;
  const colors = /\b(?:rgba?|hsla?|oklch)\s*\(/gi;
  for (const match of code.matchAll(colors)) {
    const open = match.index + match[0].lastIndexOf('(');
    const channels = code.slice(open + 1, closingParen(code, open)).trim();
    if (/^[+-.\d]/.test(channels)) return true;
  }
  return false;
}

function tokenReferences(value, offset, collect) {
  // Fallbacks hide typos such as --mw-spacing-2 vs --mw-space-2, so every
  // --mw-* reference must resolve to a real shared token definition.
  const code = maskCss(value);
  for (const match of code.matchAll(/\bvar\s*\(\s*(--mw-[\w-]+)/g)) {
    collect(match[1], offset + match.index);
  }
}

function literalSharedValue(value) {
  const code = maskCss(value).trim();
  if (hasLiteralColor(value)) return true;
  if (/\bvar\s*\(/.test(code)) return false;
  return !/^(?:inherit|initial|unset|revert(?:-layer)?|transparent|currentColor)$/i.test(code);
}

function classTokens(value) {
  const tokens = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i <= value.length; i++) {
    if (value[i] === '[' || value[i] === '(') depth++;
    else if (value[i] === ']' || value[i] === ')') depth--;
    if (i === value.length || (/\s/.test(value[i]) && !depth)) {
      if (i > start) tokens.push({ token: value.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  return tokens;
}

function isPaletteClass(token) {
  // Variants have colons, but arbitrary values can also contain colons.
  const utility = token.replace(/^(?:[^:[\]]+:)+/, '').replace(/^!/, '');
  const match =
    /^(?:bg|text|border(?:-[xysetblr])?|divide(?:-[xy])?|outline|ring(?:-offset)?|shadow|fill|stroke|from|via|to|decoration|accent|caret)-(.+)$/.exec(
      utility
    );
  if (!match) return false;
  if (match[1].startsWith('[')) return hasLiteralColor(match[1].slice(1, -1).replaceAll('_', ' '));
  return /^(?:(?:white|black)|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/(?:\d+|\[[^\]]+\]))?!?$/.test(
    match[1]
  );
}

function exportsOf(manifest) {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !manifest.exports ||
    typeof manifest.exports !== 'object' ||
    Array.isArray(manifest.exports)
  ) {
    throw new Error('Invalid @moonwitness/ui manifest: expected an exports object.');
  }
  return Object.entries(manifest.exports)
    .filter(([, target]) => target !== null)
    .map(([key]) => key);
}

function exported(subpath, exports) {
  if (/(?:^|\/)\.?dist(?:\/|$)/.test(subpath)) return false;
  return exports.some((key) => {
    if (!key.includes('*')) return key === subpath;
    const [prefix, suffix] = key.split('*');
    return (
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) &&
      subpath.length > prefix.length + suffix.length
    );
  });
}

/** Static, global token definitions and module imports; not runtime scope/usage coverage. */
export function auditUiSources(files, uiManifest) {
  const exports = exportsOf(uiManifest);
  const availableComponents = exports
    .filter((key) => key.startsWith('./components/') && !key.includes('*'))
    .sort(lexicalCompare);
  const sources = files
    .map(({ file, source }) => ({ file: normalizeFile(file), source }))
    .sort((a, b) => lexicalCompare(a.file, b.file));
  const rawFindings = [];
  const definitions = new Set();
  const references = [];
  const masks = [];
  const apps = new Map();
  const sourceNames = new Set(sources.map(({ file }) => file));
  const add = (file, offset, rule, message, evidence) => {
    rawFindings.push({ file, offset, rule, message, evidence: normalizeEvidence(evidence) });
  };

  for (const component of availableComponents) {
    const counterpart = `packages/ui/src/${component.slice(2)}.tsx`;
    if (!sourceNames.has(counterpart)) {
      add(
        'packages/ui/package.json',
        0,
        'missing-ui-export',
        'Public component export has no TSX source counterpart.',
        component
      );
    }
  }
  for (const { file } of sources) {
    if (/^packages\/ui\/src\/components\/.+\.tsx$/.test(file)) {
      const subpath = `./${file.slice('packages/ui/src/'.length, -4)}`;
      if (!exports.includes(subpath)) {
        add(
          file,
          0,
          'missing-ui-export',
          'Component source is missing an explicit public export.',
          subpath
        );
      }
    }
  }

  for (const { file, source } of sources) {
    const app = appOf(file);
    if (app && !apps.has(app)) apps.set(app, new Set());
    const reference = (value, offset) =>
      tokenReferences(value, offset, (token, position) =>
        references.push({ file, token, position })
      );
    const declaration = (property, value, offset, valueOffset = offset) => {
      const evidence = `${property}: ${value}`;
      if (property.startsWith('--')) definitions.add(property);
      reference(value, valueOffset);
      const selfReference = /^\s*var\s*\(\s*(--[\w-]+)\s*\)\s*$/.exec(maskCss(value));
      if (property.startsWith('--') && selfReference?.[1] === property) {
        add(
          file,
          offset,
          'cyclic-token',
          'Custom property references itself without a fallback; use a concrete value or a var() fallback.',
          evidence
        );
      }
      if (property.startsWith('--mw-') && !isUiFile(file) && literalSharedValue(value)) {
        add(
          file,
          offset,
          'shared-token-literal',
          'App redefines a shared token from a literal source; use an alias or a shared theme token.',
          evidence
        );
      }
      if (
        visualProperty(property) &&
        file !== 'packages/ui/src/styles/tokens.css' &&
        hasLiteralColor(value)
      ) {
        add(
          file,
          offset,
          'hardcoded-color',
          'Use a shared semantic token instead of a literal visual color.',
          evidence
        );
      }
      if (
        property === 'box-shadow' &&
        /var\(--mw-shadow-ink(?:-lg)?\)/u.test(value) &&
        !/^\s*var\(--mw-shadow-ink(?:-lg)?\)\s*$/u.test(value)
      ) {
        add(
          file,
          offset,
          'composite-token-slot',
          'A composite shadow token expands to a full shadow list; use it as the whole value, not as a color slot.',
          evidence
        );
      }
      if (!isUiFile(file) && /chalk-mask$/.test(property) && /\burl\s*\(/i.test(value)) {
        masks.push({ file, offset, evidence, value: normalizeEvidence(value) });
      }
    };

    if (file.endsWith('.css')) {
      cssDeclarations(
        source,
        ({ property, value, offset }) => {
          const colon = source.indexOf(':', offset);
          const valueStart = colon + 1 + source.slice(colon + 1).search(/\S/);
          declaration(property, value, offset, valueStart);
        },
        (selector, offset) => {
          const classes = [...selector.matchAll(/\.([a-z_][\w-]*)/gi)].map((match) => match[1]);
          const overridesSharedClass = classes.some((name) => name.startsWith('mw-ui-'));
          const hasScopedAnchor = classes.some((name) => !name.startsWith('mw-ui-'));
          // App-scoped theming (e.g. `.home-page .mw-ui-button`) is supported;
          // only global redefinitions of shared classes erode the system.
          if (!isUiFile(file) && overridesSharedClass && !hasScopedAnchor) {
            add(
              file,
              offset,
              'shared-style-override',
              'Global selector overrides a shared component class; scope it under an app class or move it into shared components.',
              selector
            );
          }
        }
      );
      continue;
    }

    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      /\.[cm]?jsx?$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
    );
    const bindings = new Map();
    const bind = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        bindings.set(node.name.text, node.initializer);
      ts.forEachChild(node, bind);
    };
    bind(ast);
    const propertyName = (node) =>
      ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined;
    const strings = (node, callback, seen = new Set()) => {
      if (!node) return;
      if (ts.isStringLiteralLike(node)) {
        callback(node.text, node.getStart(ast) + 1);
      } else if (ts.isTemplateExpression(node)) {
        callback(node.head.text, node.head.getStart(ast) + 1);
        for (const span of node.templateSpans) {
          strings(span.expression, callback, seen);
          callback(span.literal.text, span.literal.getStart(ast) + 1);
        }
      } else if (ts.isIdentifier(node) && bindings.has(node.text)) {
        if (seen.has(node.text)) return;
        const next = new Set(seen).add(node.text);
        strings(bindings.get(node.text), callback, next);
      } else {
        ts.forEachChild(node, (child) => strings(child, callback, seen));
      }
    };
    const style = (node, seen = new Set()) => {
      if (!node) return;
      if (ts.isIdentifier(node) && bindings.has(node.text)) {
        if (!seen.has(node.text)) style(bindings.get(node.text), new Set(seen).add(node.text));
      } else if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property)) style(property.expression, seen);
          else if (ts.isPropertyAssignment(property)) {
            const name = propertyName(property.name);
            if (name && (visualProperty(name) || name.startsWith('--'))) {
              strings(property.initializer, (value, offset) =>
                declaration(name, value, property.getStart(ast), offset)
              );
              if (name.startsWith('--')) definitions.add(name);
            }
          }
        }
      } else {
        ts.forEachChild(node, (child) => style(child, seen));
      }
    };
    const inspectImport = (node) => {
      if (!node || !ts.isStringLiteralLike(node)) return;
      const specifier = node.text;
      if (specifier !== '@moonwitness/ui' && !specifier.startsWith('@moonwitness/ui/')) return;
      const subpath =
        specifier === '@moonwitness/ui' ? '.' : `./${specifier.slice('@moonwitness/ui/'.length)}`;
      if (!exported(subpath, exports)) {
        add(
          file,
          node.getStart(ast),
          'invalid-ui-import',
          'Import is not a public @moonwitness/ui export; do not import internal/dist paths.',
          specifier
        );
      } else if (app && availableComponents.includes(subpath)) {
        apps.get(app).add(subpath);
      }
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        inspectImport(node.moduleSpecifier);
      else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      )
        inspectImport(node.moduleReference.expression);
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      )
        inspectImport(node.arguments[0]);
      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(ast);
        const expression =
          node.initializer && ts.isJsxExpression(node.initializer)
            ? node.initializer.expression
            : node.initializer;
        if (name === 'style') style(expression);
        else if (['className', 'fill', 'stroke', 'color'].includes(name)) {
          strings(expression, (value, offset) => {
            reference(value, offset);
            if (name === 'className') {
              for (const { token, offset: tokenOffset } of classTokens(value)) {
                if (isPaletteClass(token))
                  add(
                    file,
                    offset + tokenOffset,
                    'hardcoded-color',
                    'Use semantic design-system utility colors, not arbitrary colors or named palettes.',
                    token
                  );
              }
            } else if (hasLiteralColor(value)) {
              add(
                file,
                offset,
                'hardcoded-color',
                'Use a shared token for JSX visual colors.',
                `${name}: ${value}`
              );
            }
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }

  for (const mask of masks) {
    if (masks.some((other) => other.file !== mask.file && other.value === mask.value)) {
      add(
        mask.file,
        mask.offset,
        'duplicate-chalk-mask',
        'Chalk mask URL is duplicated across app files; use the shared mask token.',
        mask.evidence
      );
    }
  }
  for (const { file, token, position } of references) {
    if (!definitions.has(token))
      add(
        file,
        position,
        'undefined-token',
        'Shared token has no static definition and this var() has no fallback.',
        token
      );
  }
  rawFindings.sort(
    (a, b) =>
      lexicalCompare(a.file, b.file) ||
      a.offset - b.offset ||
      lexicalCompare(a.rule, b.rule) ||
      lexicalCompare(a.evidence, b.evidence)
  );
  const occurrences = new Map();
  const sourceByFile = new Map(sources.map(({ file, source }) => [file, source]));
  const findings = rawFindings.map(({ file, offset, rule, message, evidence }) => {
    const identity = JSON.stringify([rule, file, evidence]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return {
      file,
      line: (sourceByFile.get(file)?.slice(0, offset).match(/\n/g)?.length ?? 0) + 1,
      rule,
      message,
      evidence,
      fingerprint: createHash('sha256')
        .update(JSON.stringify([rule, file, evidence, occurrence]))
        .digest('hex'),
    };
  });
  const imported = new Set([...apps.values()].flatMap((values) => [...values]));
  const coverage = {
    availableComponents,
    apps: [...apps]
      .sort(([a], [b]) => lexicalCompare(a, b))
      .map(([app, components]) => ({
        app,
        importedComponents: [...components].sort(lexicalCompare),
        unusedComponents: availableComponents.filter((component) => !components.has(component)),
      })),
    unusedComponents: availableComponents.filter((component) => !imported.has(component)),
    note: 'Static module import coverage only, not runtime usage. Token definitions are checked globally, not for runtime selector scope.',
  };
  return { findings, coverage };
}

function baselineKey(entry) {
  return JSON.stringify([normalizeFile(entry.file), entry.rule, entry.fingerprint]);
}

function baselineEntries(baseline) {
  if (baseline === undefined) return [];
  if (baseline?.version !== 1 || !Array.isArray(baseline.entries))
    throw new Error('Invalid UI baseline: expected version 1 and entries.');
  const seen = new Set();
  for (const entry of baseline.entries) {
    if (
      !entry ||
      typeof entry.file !== 'string' ||
      !entry.file ||
      !debtRules.has(entry.rule) ||
      !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    ) {
      throw new Error(
        'Invalid UI baseline entry: only reviewed styling-debt rules with a reason and SHA-256 fingerprint are allowed.'
      );
    }
    const key = baselineKey(entry);
    if (seen.has(key)) throw new Error('Invalid UI baseline: duplicate entry.');
    seen.add(key);
  }
  return baseline.entries;
}

export function compareUiBaseline(findings, baseline) {
  const entries = baselineEntries(baseline);
  const known = new Set(entries.map(baselineKey));
  const current = new Set(
    findings.filter((finding) => debtRules.has(finding.rule)).map(baselineKey)
  );
  return {
    newFindings: findings.filter(
      (finding) => !debtRules.has(finding.rule) || !known.has(baselineKey(finding))
    ),
    knownFindings: findings.filter(
      (finding) => debtRules.has(finding.rule) && known.has(baselineKey(finding))
    ),
    staleEntries: entries.filter((entry) => !current.has(baselineKey(entry))),
  };
}

export function createUiBaseline(findings) {
  return {
    version: 1,
    entries: findings
      .filter((finding) => debtRules.has(finding.rule))
      .map(({ file, rule, fingerprint }) => ({
        file: normalizeFile(file),
        rule,
        fingerprint,
        reason:
          'Reviewed existing styling debt; migrate to shared design-system tokens or components.',
      }))
      .sort(
        (a, b) =>
          lexicalCompare(a.file, b.file) ||
          lexicalCompare(a.rule, b.rule) ||
          lexicalCompare(a.fingerprint, b.fingerprint)
      ),
  };
}

async function optionalStat(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readManifest(file) {
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new Error(`Invalid package manifest: ${file}`);
  if (
    manifest.dependencies !== undefined &&
    (!manifest.dependencies ||
      typeof manifest.dependencies !== 'object' ||
      Array.isArray(manifest.dependencies))
  )
    throw new Error(`Invalid dependencies in package manifest: ${file}`);
  return manifest;
}

export async function auditWorkspaceUi(root) {
  const uiManifest = await readManifest(path.join(root, 'packages/ui/package.json'));
  const files = [];
  const scan = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      lexicalCompare(a.name, b.name)
    )) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(full);
      else if (entry.isFile() && /(?:\.css|\.[cm]?[jt]sx?)$/.test(entry.name))
        files.push({
          file: normalizeFile(path.relative(root, full)),
          source: await readFile(full, 'utf8'),
        });
    }
  };
  await scan(path.join(root, 'packages/ui/src'));
  const consumers = [];
  const appsDirectory = path.join(root, 'apps');
  if (await optionalStat(appsDirectory)) {
    for (const entry of (await readdir(appsDirectory, { withFileTypes: true })).sort((a, b) =>
      lexicalCompare(a.name, b.name)
    )) {
      if (!entry.isDirectory()) continue;
      const appDirectory = path.join(appsDirectory, entry.name);
      const manifestFile = path.join(appDirectory, 'package.json');
      if (!(await optionalStat(manifestFile))) continue;
      const manifest = await readManifest(manifestFile);
      if (!Object.hasOwn(manifest.dependencies ?? {}, '@moonwitness/ui')) continue;
      const app = `apps/${entry.name}`;
      consumers.push(app);
      for (const folder of ['src', 'web/src']) {
        const directory = path.join(appDirectory, folder);
        if (await optionalStat(directory)) await scan(directory);
      }
    }
  }
  const report = auditUiSources(files, uiManifest);
  for (const app of consumers) {
    if (!report.coverage.apps.some((entry) => entry.app === app))
      report.coverage.apps.push({
        app,
        importedComponents: [],
        unusedComponents: [...report.coverage.availableComponents],
      });
  }
  report.coverage.apps.sort((a, b) => lexicalCompare(a.app, b.app));
  return report;
}

const ruleCounts = (findings) =>
  Object.fromEntries(
    [...new Set(findings.map(({ rule }) => rule))]
      .sort(lexicalCompare)
      .map((rule) => [rule, findings.filter((finding) => finding.rule === rule).length])
  );
const countsText = (findings) =>
  Object.entries(ruleCounts(findings))
    .map(([rule, count]) => `${rule}=${count}`)
    .join(', ') || 'none';

async function main(args) {
  const allowed = new Set(['--json', '--strict', '--write-baseline']);
  for (const arg of args)
    if (!allowed.has(arg))
      throw new Error(`Unknown argument: ${arg}. Allowed: --json, --strict, --write-baseline.`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baselineFile = path.join(root, 'scripts/ui-design-system.baseline.json');
  const report = await auditWorkspaceUi(root);
  let baseline;
  if (await optionalStat(baselineFile)) baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  const structural = report.findings.filter((finding) => !debtRules.has(finding.rule));
  let baselineWritten = false;
  if (args.includes('--write-baseline') && !structural.length) {
    baseline = createUiBaseline(report.findings);
    await writeFile(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    baselineWritten = true;
  }
  const comparison = compareUiBaseline(report.findings, baseline);
  const strict = args.includes('--strict');
  const failures = strict ? report.findings : comparison.newFindings;
  const remediation =
    'Replace literal styling with shared tokens/components, define missing tokens or use fallbacks, and use public exports. After reviewing existing debt only: node scripts/check-ui-design-system.mjs --write-baseline';
  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          ...report,
          ...comparison,
          counts: ruleCounts(report.findings),
          strict,
          baselineWritten,
          baselineFile: 'scripts/ui-design-system.baseline.json',
          remediation,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `UI design system: ${report.findings.length} finding(s) (${countsText(report.findings)}).`
    );
    console.log(
      `New/structural: ${comparison.newFindings.length}; known debt: ${comparison.knownFindings.length} (${countsText(comparison.knownFindings)}); stale baseline entries: ${comparison.staleEntries.length}.`
    );
    for (const finding of failures)
      console.log(
        `${finding.file}:${finding.line} [${finding.rule}] ${finding.message} ${finding.evidence}`
      );
    if (baselineWritten)
      console.log('Wrote scripts/ui-design-system.baseline.json (styling debt only).');
    if (args.includes('--write-baseline') && structural.length)
      console.log('Baseline not written: fix structural errors first.');
    console.log(
      `Import coverage: ${report.coverage.availableComponents.length} available component subpaths; ${report.coverage.unusedComponents.length} not imported by audited apps.`
    );
    for (const app of report.coverage.apps)
      console.log(
        `${app.app}: ${app.importedComponents.length} imported, ${app.unusedComponents.length} unused component subpaths.`
      );
    console.log(report.coverage.note);
    if (failures.length) console.log(remediation);
  }
  process.exitCode = failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`UI design-system audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
