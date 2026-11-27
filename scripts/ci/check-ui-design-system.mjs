import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  auditWorkspacePolicy,
  loadUiGovernancePolicy,
  uiFindingFingerprint,
} from './check-board-shared-ui.mjs';

const debtRules = new Set([
  'hardcoded-color',
  'shared-token-literal',
  'shared-child-style-debt',
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

function matchingBrace(code, open) {
  let depth = 1;
  for (let i = open + 1; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return i;
  }
  return code.length;
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
  declaration(code.length);
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
export function auditUiSources(files, uiManifest, options = {}) {
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
  const sharedClassNames = new Set();
  for (const { file, source } of sources)
    if (isUiFile(file))
      for (const match of source.matchAll(/\bmw-ui-[a-z][\w-]*/giu)) sharedClassNames.add(match[0]);
  const isInternalChildClass = (name) =>
    [...sharedClassNames].some((parent) => name.startsWith(`${parent}-`));
  const childOverrideOccurrences = new Map();
  const reviewedChildDebt = options.policy?.rules?.sharedChildClassOverrides?.reviewedDebt ?? [];
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

    const inspectCss = (fragment, baseOffset = 0) => {
      const code = maskCss(fragment);
      cssDeclarations(
        fragment,
        ({ property, value, offset }) => {
          const colon = fragment.indexOf(':', offset);
          const valueStart = colon + 1 + fragment.slice(colon + 1).search(/\S/);
          declaration(property, value, baseOffset + offset, baseOffset + valueStart);
        },
        (maskedSelector, offset) => {
          const absoluteOffset = baseOffset + offset;
          const open = code.indexOf('{', offset + maskedSelector.length);
          const selector = fragment.slice(offset, open === -1 ? undefined : open).trim();
          const classMatches = [...selector.matchAll(/\.([a-z_][\w-]*)/gi)];
          const classes = classMatches.map((match) => match[1]);
          const sharedClasses = classMatches.filter((match) => match[1].startsWith('mw-ui-'));
          const overridesSharedClass = sharedClasses.length > 0;
          const hasScopedAnchor = classes.some((name) => !name.startsWith('mw-ui-'));
          if (!isUiFile(file) && overridesSharedClass && !hasScopedAnchor) {
            add(
              file,
              absoluteOffset,
              'shared-style-override',
              'Global selector overrides a shared component class; scope it under an app class or move it into shared components.',
              selector
            );
            return;
          }
          const overridesInternalChild =
            hasScopedAnchor &&
            (classes.some((name) => name.startsWith('mw-ui-') && isInternalChildClass(name)) ||
              sharedClasses.length > 1);
          if (!isUiFile(file) && overridesInternalChild) {
            const close = matchingBrace(code, open);
            const body = open === -1 ? '' : normalizeEvidence(fragment.slice(open + 1, close));
            const evidence = normalizeEvidence(`${selector} { ${body} }`);
            const identity = JSON.stringify([file, evidence]);
            const occurrence = childOverrideOccurrences.get(identity) ?? 0;
            childOverrideOccurrences.set(identity, occurrence + 1);
            const fingerprint = uiFindingFingerprint(
              'shared-child-style-debt',
              file,
              evidence,
              occurrence
            );
            const reviewed = reviewedChildDebt.some(
              (entry) =>
                entry.file === file &&
                entry.fingerprint === fingerprint &&
                normalizeEvidence(entry.selector) === normalizeEvidence(selector)
            );
            add(
              file,
              absoluteOffset,
              reviewed ? 'shared-child-style-debt' : 'shared-child-style-override',
              reviewed
                ? 'Reviewed existing internal child-class override; do not extend or modify it without migration.'
                : 'App overrides an internal shared component child class; use supported props/slots or move the style into @moonwitness/ui.',
              evidence
            );
          }
        }
      );
    };

    if (file.endsWith('.css')) {
      inspectCss(source);
      continue;
    }
    if (file.endsWith('.html')) {
      for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu))
        inspectCss(match[1], match.index + match[0].indexOf('>') + 1);
      for (const match of source.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/giu))
        inspectCss(match[2], match.index + match[0].indexOf(match[2]));
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
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ts.isPropertyAccessExpression(node.left.expression) &&
        node.left.expression.name.text === 'style'
      ) {
        const name = node.left.name.text;
        if (name === 'cssText') strings(node.right, (value, offset) => inspectCss(value, offset));
        else if (visualProperty(name) || name.startsWith('--'))
          strings(node.right, (value, offset) =>
            declaration(name, value, node.getStart(ast), offset)
          );
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'setProperty' &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'style' &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const name = node.arguments[0].text;
        if (visualProperty(name) || name.startsWith('--'))
          strings(node.arguments[1], (value, offset) =>
            declaration(name, value, node.getStart(ast), offset)
          );
      }
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

function baselineEntries(baseline, policy) {
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
    if (
      entry.rule === 'shared-child-style-debt' &&
      !policy?.rules?.sharedChildClassOverrides?.reviewedDebt?.some(
        (reviewed) =>
          reviewed.file === normalizeFile(entry.file) && reviewed.fingerprint === entry.fingerprint
      )
    )
      throw new Error(
        'Invalid UI baseline entry: shared child-class debt must exactly match reviewed policy debt.'
      );
    const key = baselineKey(entry);
    if (seen.has(key)) throw new Error('Invalid UI baseline: duplicate entry.');
    seen.add(key);
  }
  return baseline.entries;
}

export function compareUiBaseline(findings, baseline, options = {}) {
  const entries = baselineEntries(baseline, options.policy);
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
      .filter(
        (finding) => debtRules.has(finding.rule) && finding.rule !== 'shared-child-style-debt'
      )
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

export async function auditWorkspaceUi(root, options = {}) {
  const policy = options.policy ?? (await loadUiGovernancePolicy(root));
  const uiManifest =
    options.uiManifest ?? (await readManifest(path.join(root, 'packages/ui/package.json')));
  const governance = await auditWorkspacePolicy(root, { policy, uiManifest });
  const files = [];
  const sourceByFile = new Map();
  const addFile = async (file) => {
    if (sourceByFile.has(file)) return;
    const source = await readFile(path.join(root, file), 'utf8');
    sourceByFile.set(file, source);
    files.push({ file, source });
  };
  const scan = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      lexicalCompare(a.name, b.name)
    )) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'generated', '.next', '.next-e2e'].includes(entry.name))
          await scan(full);
      } else if (entry.isFile() && /(?:\.css|\.[cm]?[jt]sx?)$/.test(entry.name))
        await addFile(normalizeFile(path.relative(root, full)));
    }
  };
  await scan(path.join(root, 'packages/ui/src'));
  for (const app of governance.adoption) for (const file of app.scannedFiles) await addFile(file);

  const report = auditUiSources(files, uiManifest, { policy });
  const policyOccurrences = new Map();
  const policyFindings = governance.violations.map((violation) => {
    const file = normalizeFile(violation.file);
    const evidence = normalizeEvidence(violation.evidence ?? violation.message);
    const identity = JSON.stringify([violation.rule, file, evidence]);
    const occurrence = policyOccurrences.get(identity) ?? 0;
    policyOccurrences.set(identity, occurrence + 1);
    return {
      file,
      line: violation.line ?? 1,
      rule: violation.rule,
      message: violation.message,
      evidence,
      fingerprint: uiFindingFingerprint(violation.rule, file, evidence, occurrence),
    };
  });
  const aliasOccurrences = new Map();
  const aliasFindings = options.strictAliasDebt
    ? governance.aliasDebt.map((finding) => {
        const evidence = `${finding.token} -> ${finding.canonicalToken}`;
        const identity = JSON.stringify([finding.file, evidence]);
        const occurrence = aliasOccurrences.get(identity) ?? 0;
        aliasOccurrences.set(identity, occurrence + 1);
        return {
          file: finding.file,
          line: finding.line,
          rule: finding.rule,
          message: finding.message,
          evidence,
          fingerprint: uiFindingFingerprint(finding.rule, finding.file, evidence, occurrence),
        };
      })
    : [];
  report.findings.push(...policyFindings, ...aliasFindings);
  report.findings.sort(
    (a, b) =>
      lexicalCompare(a.file, b.file) ||
      a.line - b.line ||
      lexicalCompare(a.rule, b.rule) ||
      lexicalCompare(a.evidence, b.evidence)
  );

  const imported = new Set(governance.adoption.flatMap((app) => app.importedComponents));
  report.coverage = {
    availableComponents: report.coverage.availableComponents,
    apps: governance.adoption.map((app) => ({
      app: app.app,
      classification: app.classification,
      importedComponents: app.importedComponents,
      namedComponents: app.namedComponents,
      jsxComponents: app.jsxComponents,
      reachableImportedComponents: app.reachableImportedComponents,
      reachableNamedComponents: app.reachableNamedComponents,
      reachableJsxComponents: app.reachableJsxComponents,
      unusedComponents: app.unusedComponents,
    })),
    unusedComponents: report.coverage.availableComponents.filter(
      (subpath) => !imported.has(subpath)
    ),
    note: 'Static imports, named/value usage, JSX usage, route reachability, Catalog references, and runtime evidence are separate signals; none is an adoption score.',
  };
  return {
    ...report,
    apps: governance.apps,
    adoption: governance.adoption,
    catalogReferenceCoverage: governance.catalogReferenceCoverage,
    publicUi: governance.publicUi,
    independentChecks: governance.independentChecks,
    knip: governance.knip,
    aliasDebt: governance.aliasDebt,
    consumerAliasDebt: governance.consumerAliasDebt,
    aliasEnforcement: policy.aliasCanonicalization?.enforcement ?? 'report-only',
    policyFile: 'scripts/ci/ui-governance-policy.json',
  };
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
  const allowed = new Set(['--json', '--strict', '--write-baseline', '--strict-alias-debt']);
  for (const arg of args)
    if (!allowed.has(arg))
      throw new Error(
        `Unknown argument: ${arg}. Allowed: --json, --strict, --write-baseline, --strict-alias-debt.`
      );
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const baselineFile = path.join(root, 'scripts/ui-design-system.baseline.json');
  const strictAliasDebt = args.includes('--strict-alias-debt');
  const report = await auditWorkspaceUi(root, { strictAliasDebt });
  const policy = await loadUiGovernancePolicy(root);
  let baseline;
  if (await optionalStat(baselineFile)) baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  const structural = report.findings.filter((finding) => !debtRules.has(finding.rule));
  const frozenChildDebt = report.findings.some(
    (finding) => finding.rule === 'shared-child-style-debt'
  );
  let baselineWritten = false;
  let baselineWriteBlocked = '';
  if (args.includes('--write-baseline')) {
    if (structural.length) baselineWriteBlocked = 'fix structural errors first';
    else if (frozenChildDebt)
      baselineWriteBlocked =
        'reviewed child-class debt is frozen in policy and baseline; migrate it or review a new exact fingerprint manually';
  }
  if (args.includes('--write-baseline') && !baselineWriteBlocked) {
    baseline = createUiBaseline(report.findings);
    await writeFile(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    baselineWritten = true;
  }
  const comparison = compareUiBaseline(report.findings, baseline, { policy });
  const strict = args.includes('--strict');
  const failures = strict
    ? [...report.findings, ...comparison.staleEntries]
    : [...comparison.newFindings, ...comparison.staleEntries];
  const remediation =
    'Replace literal styling with shared tokens/components, define missing tokens or use fallbacks, and use public exports. New or changed internal .mw-ui-* child-class overrides are structural and cannot be baselined. After reviewing ordinary existing debt only: node scripts/check-ui-design-system.mjs --write-baseline';
  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          ...report,
          ...comparison,
          counts: ruleCounts(report.findings),
          strict,
          strictAliasDebt,
          failures,
          baselineWritten,
          baselineWriteBlocked,
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
    for (const finding of comparison.newFindings)
      console.log(
        `${finding.file}:${finding.line} [${finding.rule}] ${finding.message} ${finding.evidence}`
      );
    for (const entry of comparison.staleEntries)
      console.log(
        `${entry.file} [stale-baseline] Reviewed debt is no longer present: ${entry.rule}.`
      );
    if (baselineWritten)
      console.log('Wrote scripts/ui-design-system.baseline.json (ordinary styling debt only).');
    if (baselineWriteBlocked) console.log(`Baseline not written: ${baselineWriteBlocked}.`);
    console.log(
      `Component signals: ${report.coverage.availableComponents.length} available; ${report.coverage.unusedComponents.length} not imported by audited apps.`
    );
    for (const app of report.coverage.apps)
      console.log(
        `${app.app}: ${app.importedComponents.length} imported, ${app.namedComponents.length} named usage, ${app.jsxComponents.length} JSX usage, ${app.reachableNamedComponents.length} route-reachable named usage, ${app.unusedComponents.length} unused.`
      );
    console.log(report.coverage.note);
    for (const api of report.knip.protectedPublicApis)
      console.log(
        `Knip-protected public API ${api.export}: ${
          report.catalogReferenceCoverage.referencedComponents.includes(api.subpath)
            ? 'referenced by Catalog JSX'
            : 'retained; Catalog reference not yet present'
        }.`
      );
    for (const app of report.adoption)
      for (const evidence of app.runtimeEvidence)
        console.log(
          `Runtime evidence ${app.app}/${evidence.name}: ${
            evidence.present ? 'test files present' : 'missing test files'
          }; run separately with \`${evidence.command}\`.`
        );
    for (const [app, checks] of Object.entries(report.independentChecks))
      for (const check of checks)
        console.log(`Independent ${app} check ${check.name}: \`${check.command}\`.`);
    if (report.aliasDebt.length) {
      console.log(
        `Package-internal --ink alias debt: ${report.aliasDebt.length} occurrence(s), enforcement=${report.aliasEnforcement}.`
      );
      for (const finding of report.aliasDebt)
        console.log(
          `  ${finding.file}:${finding.line}:${finding.column} ${finding.token} -> ${finding.canonicalToken}`
        );
    }
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
