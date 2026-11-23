import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  auditUiSources,
  auditWorkspaceUi,
  compareUiBaseline,
  createUiBaseline,
} from './check-ui-design-system.mjs';

const manifest = {
  exports: {
    './components.css': './src/styles/components.css',
    './styles/tokens.css': './src/styles/tokens.css',
    './icons': './dist/icons/index.js',
    './icons/*': './dist/icons/*.js',
  },
};
const importManifest = {
  exports: {
    ...manifest.exports,
    './components/button': './dist/components/button.js',
  },
};

const sourceFiles = (entries) =>
  entries.map(([file, source]) => ({ file: file.replaceAll('\\', '/'), source }));

function rules(result) {
  return result.findings.map(({ rule }) => rule);
}

test('CSS audit ignores comments, URLs, and token source values', () => {
  const { findings } = auditUiSources(
    sourceFiles([
      [
        'packages/ui/src/styles/tokens.css',
        ':root { --mw-yellow: #ffe031; --mw-cyan: #39e6ff; --mw-border: #000000; }',
      ],
      [
        'apps/board/src/index.css',
        `/* color: #111111; */
         .ink-panel { background: url("data:image/svg+xml,%23ff0000"); border: 1px solid var(--mw-border); }`,
      ],
    ]),
    manifest
  );
  assert.deepEqual(rules({ findings }), []);
});

test('CSS audit reports literal colors, shared-token literals, and shared-class overrides', () => {
  const { findings } = auditUiSources(
    sourceFiles([
      [
        'apps/board/src/index.css',
        `.auth-card { color: #123456; background: rgb(13 13 13 / 20%); }
         .auth-card { --mw-primary: #ffe031; }
         .mw-ui-button { border-color: red; }
         .auth-card .mw-ui-button { border-width: 2px; }`,
      ],
    ]),
    manifest
  );
  assert.deepEqual(
    findings.map(({ rule, line }) => [rule, line]),
    [
      ['hardcoded-color', 1],
      ['hardcoded-color', 1],
      ['shared-token-literal', 2],
      ['shared-style-override', 3],
    ]
  );
  assert.ok(findings.every(({ file }) => file === 'apps/board/src/index.css'));
});

test('token references require a static definition, even when an inline fallback exists', () => {
  const result = auditUiSources(
    sourceFiles([
      ['packages/ui/src/styles/tokens.css', ':root { --mw-paper: #f3efe4; }'],
      [
        'apps/board/src/index.css',
        '.a { color: var(--mw-paper); background: var(--mw-missing, var(--mw-paper)); border-color: var(--mw-undefined); }',
      ],
    ]),
    manifest
  );
  assert.deepEqual(
    result.findings
      .filter(({ rule }) => rule === 'undefined-token')
      .map(({ evidence }) => evidence),
    ['--mw-missing', '--mw-undefined']
  );
});

test('self-referential token aliases are rejected but fallback defaults are allowed', () => {
  const result = auditUiSources(
    sourceFiles([
      [
        'apps/board/src/index.css',
        '.auth-card { --auth-border: var(--auth-border); --auth-surface: var(--auth-surface, #fff); color: var(--auth-surface); }',
      ],
    ]),
    manifest
  );
  assert.deepEqual(
    result.findings.filter(({ rule }) => rule === 'cyclic-token').map(({ evidence }) => evidence),
    ['--auth-border: var(--auth-border)']
  );
});

test('composite shadow tokens cannot be embedded in a color slot', () => {
  const { findings } = auditUiSources(
    sourceFiles([
      ['packages/ui/src/styles/tokens.css', ':root { --mw-shadow-ink: 3px 3px 0 0 #000; }'],
      ['apps/board/src/index.css', '.panel { box-shadow: 4px 4px 0 var(--mw-shadow-ink); }'],
    ]),
    manifest
  );
  assert.deepEqual(
    findings.filter(({ rule }) => rule === 'composite-token-slot').map(({ evidence }) => evidence),
    ['box-shadow: 4px 4px 0 var(--mw-shadow-ink)']
  );
});

test('workspace audit includes app desktop-web UI sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mw-ui-scan-'));
  try {
    await mkdir(join(root, 'packages/ui/src'), { recursive: true });
    await writeFile(
      join(root, 'packages/ui/package.json'),
      JSON.stringify({ exports: { './components.css': './src/styles/components.css' } })
    );
    await mkdir(join(root, 'apps/desktop/desktop-web'), { recursive: true });
    await writeFile(
      join(root, 'apps/desktop/package.json'),
      JSON.stringify({ dependencies: { '@moonwitness/ui': 'workspace:*' } })
    );
    await writeFile(join(root, 'apps/desktop/desktop-web/panel.css'), '.panel { color: #123456; }');

    const report = await auditWorkspaceUi(root);

    assert.ok(
      report.findings.some(
        (finding) =>
          finding.file === 'apps/desktop/desktop-web/panel.css' &&
          finding.rule === 'hardcoded-color'
      )
    );
    assert.ok(report.coverage.apps.some((app) => app.app === 'apps/desktop'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('JSX audit checks nested class strings and style literals without flagging payload colors', () => {
  const classes = 'px-2 bg-paper border-2 border-ink';
  const result = auditUiSources(
    sourceFiles([
      [
        'apps/board/src/board.tsx',
        `const classes = '${classes}';
         export const App = () => (
           <>
             <div className={[classes, condition ? 'text-red-500 shadow-[2px_2px_0_#171717]' : '']} />
             <span style={{ color: '#e6ff00' }}>placeholder</span>
             <input placeholder="#000000" />
           </>
         );`,
      ],
    ]),
    manifest
  );
  assert.deepEqual(
    result.findings.map(({ rule, evidence }) => [rule, evidence]),
    [
      ['hardcoded-color', 'text-red-500'],
      ['hardcoded-color', 'shadow-[2px_2px_0_#171717]'],
      ['hardcoded-color', 'color: #e6ff00'],
    ]
  );
});

test('UI imports must use public exports and wildcard subpaths', () => {
  const result = auditUiSources(
    sourceFiles([
      [
        'apps/board/src/imports.tsx',
        `import { Button } from '@moonwitness/ui/components/button';
         import { SaveIcon } from '@moonwitness/ui/icons/save';
         import { internal } from '@moonwitness/ui/dist/components/button.js';
         const lazy = import('@moonwitness/ui/components/private');
         const required = require('@moonwitness/ui/dist/icons/index.js');`,
      ],
    ]),
    importManifest
  );
  assert.deepEqual(
    result.findings
      .filter(({ rule }) => rule === 'invalid-ui-import')
      .map(({ evidence }) => evidence),
    [
      '@moonwitness/ui/dist/components/button.js',
      '@moonwitness/ui/components/private',
      '@moonwitness/ui/dist/icons/index.js',
    ]
  );
  assert.ok(result.coverage.apps[0].importedComponents.includes('./components/button'));
});

test('export integrity rejects missing sources and unpublished components', () => {
  const result = auditUiSources(
    sourceFiles([
      ['packages/ui/src/components/button.tsx', 'export const Button = () => null;'],
      ['packages/ui/src/components/orphan.tsx', 'export const Orphan = () => null;'],
    ]),
    {
      exports: {
        ...manifest.exports,
        './components/button': './dist/components/button.js',
        './components/missing': './dist/components/missing.js',
      },
    }
  );
  assert.deepEqual(
    result.findings
      .filter(({ rule }) => rule === 'missing-ui-export')
      .map(({ evidence }) => evidence),
    ['./components/missing', './components/orphan']
  );
});

test('baseline accepts reviewed debt only and rejects stale or new findings', () => {
  const result = auditUiSources(
    sourceFiles([
      ['apps/board/src/a.css', '.a { color: #000000; }'],
      ['apps/board/src/b.css', '.b { color: #ffffff; }'],
    ]),
    manifest
  );
  const baseline = createUiBaseline(result.findings);
  assert.equal(baseline.version, 1);
  assert.equal(baseline.entries.length, 2);
  assert.ok(baseline.entries.every(({ reason }) => reason.length > 0));

  const known = compareUiBaseline(result.findings, baseline);
  assert.equal(known.newFindings.length, 0);
  assert.equal(known.knownFindings.length, 2);
  assert.equal(known.staleEntries.length, 0);

  const grown = auditUiSources(
    sourceFiles([
      ['apps/board/src/a.css', '.a { color: #000000; }\n.a span { color: #000000; }'],
      ['apps/board/src/b.css', '.b { color: #ffffff; }'],
    ]),
    manifest
  );
  const growth = compareUiBaseline(grown.findings, baseline);
  assert.equal(growth.newFindings.length, 1);
  assert.equal(growth.newFindings[0].line, 2);

  const structural = auditUiSources(
    sourceFiles([
      ['apps/board/src/a.css', '.a { color: var(--mw-undefined); }'],
      ['apps/board/src/b.css', '.b { color: #ffffff; }'],
    ]),
    manifest
  );
  assert.equal(compareUiBaseline(structural.findings, baseline).newFindings.length, 1);

  const stale = auditUiSources(
    sourceFiles([['apps/board/src/b.css', '.b { color: #ffffff; }']]),
    manifest
  );
  assert.equal(compareUiBaseline(stale.findings, baseline).staleEntries.length, 1);
});

test('baseline entries require reviewed reasons and cannot hide structural errors', () => {
  const result = auditUiSources(
    sourceFiles([['apps/board/src/a.css', '.a { color: #000000; }']]),
    manifest
  );
  const baseline = createUiBaseline(result.findings);
  baseline.entries[0].rule = 'undefined-token';
  baseline.entries[0].reason = '';
  assert.throws(() => compareUiBaseline(result.findings, baseline), /Invalid UI baseline entry/u);
});

test('findings are deterministic across input ordering and normalize Windows paths', () => {
  const entries = sourceFiles([
    ['apps\\board\\src\\b.css', '.b { color: #222222; }'],
    ['apps/board/src/a.css', '.a { color: #111111; }'],
  ]);
  const first = auditUiSources(entries, manifest);
  const second = auditUiSources([...entries].reverse(), manifest);
  assert.deepEqual(first.findings, second.findings);
  assert.ok(first.findings.every(({ file }) => !file.includes('\\')));
  assert.equal(first.findings[0].line, 1);
});
