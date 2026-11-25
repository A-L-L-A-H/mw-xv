import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import {
  auditWorkspacePolicy,
  discoverWorkspaceApps,
  uiFindingFingerprint,
  validateUiGovernancePolicy,
} from './check-board-shared-ui.mjs';
import {
  auditUiSources,
  auditWorkspaceUi,
  compareUiBaseline,
  createUiBaseline,
} from './check-ui-design-system.mjs';

const componentNames = ['button', 'card', 'dialog', 'textarea', 'badge'];
const uiManifest = {
  exports: {
    './components.css': './src/styles/components.css',
    './styles/tokens.css': './src/styles/tokens.css',
    ...Object.fromEntries(
      componentNames.map((name) => [`./components/${name}`, `./dist/components/${name}.js`])
    ),
  },
};

async function createWorkspace(t, files, policy) {
  const root = await mkdtemp(join(tmpdir(), 'mw-ui-governance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseFiles = [
    ['packages/ui/package.json', JSON.stringify(uiManifest)],
    [
      'packages/ui/src/styles/tokens.css',
      ':root { --mw-ink-black: #000000; --mw-ink-soft: #333333; }',
    ],
    ...componentNames.map((name) => [
      `packages/ui/src/components/${name}.tsx`,
      `export const ${name[0].toUpperCase()}${name.slice(1)} = () => null;`,
    ]),
    ...files,
  ];
  for (const [file, source] of baseFiles) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), source);
  }
  if (policy) {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await writeFile(join(root, 'scripts/ui-governance-policy.json'), JSON.stringify(policy));
  }
  return root;
}

function appConfig(app, classification = 'product-adopter', overrides = {}) {
  return {
    packageName: `@moonwitness/${basename(app)}`,
    classification,
    browser: false,
    sourceRoots: ['src'],
    publicRoots: [],
    sharedSourceRoots: [],
    routeRoots: [],
    entryFiles: [],
    aliases: {},
    generatedAssets: [],
    runtimeEvidence: [],
    ...overrides,
  };
}

function policyFor(apps) {
  return { version: 1, apps: Object.fromEntries(Object.entries(apps)) };
}

function appManifest(app, dependencies = { '@moonwitness/ui': 'workspace:*' }) {
  return [
    `${app}/package.json`,
    JSON.stringify({ name: `@moonwitness/${basename(app)}`, dependencies }),
  ];
}

test('unknown workspace apps fail governance and stale or mismatched policy entries fail', async (t) => {
  const root = await createWorkspace(t, [appManifest('apps/new-app')], policyFor({}));
  const policy = policyFor({});
  const discovered = await discoverWorkspaceApps(root, policy);

  assert.equal(discovered.apps.length, 1);
  assert.equal(discovered.apps[0].config, undefined);
  assert.ok(
    discovered.violations.some(
      ({ app, rule }) => app === 'apps/new-app' && rule === 'unclassified-workspace-app'
    )
  );

  const stale = await discoverWorkspaceApps(
    root,
    policyFor({ 'apps/missing': appConfig('apps/missing', 'non-ui') })
  );
  assert.ok(stale.violations.some(({ rule }) => rule === 'stale-ui-policy-app'));

  const mismatch = await discoverWorkspaceApps(
    root,
    policyFor({
      'apps/new-app': {
        ...appConfig('apps/new-app'),
        packageName: '@moonwitness/not-new-app',
      },
    })
  );
  assert.ok(mismatch.violations.some(({ rule }) => rule === 'ui-policy-package-mismatch'));
});

test('policy validates app classifications and prevents path traversal', () => {
  assert.throws(
    () => validateUiGovernancePolicy(policyFor({ '../outside': appConfig('../outside') })),
    /Invalid UI governance path/u
  );
  assert.throws(
    () =>
      validateUiGovernancePolicy(
        policyFor({ 'apps/board': appConfig('apps/board', 'probably-ui') })
      ),
    /Invalid UI governance classification/u
  );
  assert.throws(
    () =>
      validateUiGovernancePolicy(
        policyFor({
          'apps/desktop': appConfig('apps/desktop', 'product-adopter', {
            aliases: { '@': '../outside' },
          }),
        })
      ),
    /Invalid UI governance path/u
  );
});

test('Desktop web discovery follows Board aliases and separates imports, usage, JSX, and reachability', async (t) => {
  const policy = policyFor({
    'apps/desktop': appConfig('apps/desktop', 'product-adopter', {
      browser: true,
      sourceRoots: ['desktop-web'],
      sharedSourceRoots: ['apps/board/src'],
      entryFiles: ['desktop-web/main.tsx'],
      aliases: { '@': 'apps/board/src' },
      runtimeEvidence: [
        {
          name: 'desktop-webview',
          command: 'pnpm desktop:test:web',
          tests: ['apps/desktop/e2e/desktop-web.spec.ts'],
        },
      ],
    }),
    'apps/board': appConfig('apps/board', 'product-adopter', { sourceRoots: [] }),
  });
  const root = await createWorkspace(
    t,
    [
      appManifest('apps/desktop'),
      appManifest('apps/board'),
      [
        'apps/desktop/desktop-web/main.tsx',
        `import { Card } from '@moonwitness/ui/components/card';
         import type { Textarea } from '@moonwitness/ui/components/textarea';
         import { App } from '@/page.js';
         const lazy = import('@moonwitness/ui/components/dialog');
         export const Main = () => <App />;`,
      ],
      [
        'apps/desktop/desktop-web/not-routed.tsx',
        `import { Card } from '@moonwitness/ui/components/card';
         export const Preview = () => <Card />;`,
      ],
      [
        'apps/board/src/page.tsx',
        `import { Button } from '@moonwitness/ui/components/button';
         import * as Buttons from '@moonwitness/ui/components/button';
         export const App = () => <><Button /><Buttons.Button /></>;`,
      ],
      ['apps/desktop/e2e/desktop-web.spec.ts', 'test.describe("web", () => {});'],
    ],
    policy
  );

  const report = await auditWorkspacePolicy(root);
  assert.deepEqual(report.violations, []);
  const desktop = report.adoption.find(({ app }) => app === 'apps/desktop');
  assert.ok(desktop);
  assert.deepEqual(desktop.routeReachability.entryFiles, ['apps/desktop/desktop-web/main.tsx']);
  assert.ok(desktop.routeReachability.reachableFiles.includes('apps/board/src/page.tsx'));
  assert.ok(desktop.productImports.includes('@moonwitness/ui/components/dialog'));
  assert.ok(desktop.importedComponents.includes('./components/textarea'));
  assert.ok(!desktop.namedComponents.includes('./components/textarea'));
  assert.ok(desktop.importedWithoutNamedUsage.includes('./components/dialog'));
  assert.deepEqual(desktop.reachableNamedComponents, ['./components/button']);
  assert.deepEqual(desktop.reachableJsxComponents, ['./components/button']);
  assert.ok(desktop.namedOutsideRoutes.includes('./components/card'));
  assert.equal(desktop.runtimeEvidence[0].present, true);
  assert.equal(desktop.runtimeEvidence[0].executed, false);
});

test('Docs publication shells, standalone-exempt apps, and non-ui apps keep independent policy', async (t) => {
  const policy = policyFor({
    'apps/docs': appConfig('apps/docs', 'publication-shell', {
      publicRoots: ['public'],
    }),
    'apps/agent-observability': appConfig('apps/agent-observability', 'standalone-exempt', {
      sourceRoots: [],
      publicRoots: ['public'],
    }),
    'apps/api': appConfig('apps/api', 'non-ui'),
  });
  const root = await createWorkspace(
    t,
    [
      appManifest('apps/docs', {}),
      appManifest('apps/agent-observability', {}),
      appManifest('apps/api', {}),
      ['apps/docs/src/main.tsx', 'export const Docs = () => <><button /><svg /></>;'],
      ['apps/docs/public/docs.css', '.docs { color: #123456; }'],
      ['apps/agent-observability/public/app.js', "document.body.style.color = '#abcdef';"],
      ['apps/api/src/server.tsx', 'export const Server = () => <button />;'],
    ],
    policy
  );

  const governance = await auditWorkspacePolicy(root);
  assert.ok(!governance.violations.some(({ rule }) => rule === 'raw-native-control'));
  assert.ok(!governance.adoption.some(({ app }) => app === 'apps/api'));
  assert.ok(
    governance.publicUi['apps/agent-observability'].handAuthoredFiles.includes(
      'apps/agent-observability/public/app.js'
    )
  );

  const design = await auditWorkspaceUi(root);
  assert.ok(design.findings.some(({ file }) => file === 'apps/docs/public/docs.css'));
  assert.ok(!design.findings.some(({ file }) => file.startsWith('apps/agent-observability/')));
  assert.ok(!design.findings.some(({ file }) => file.startsWith('apps/api/')));
});

test('hand-authored public CSS, HTML, and JS are audited while generated copies are only inventoried', async (t) => {
  const policy = policyFor({
    'apps/board': appConfig('apps/board', 'product-adopter', {
      sourceRoots: [],
      publicRoots: ['public'],
      generatedAssets: ['public/generated/**'],
    }),
  });
  const root = await createWorkspace(
    t,
    [
      appManifest('apps/board'),
      ['apps/board/public/generated/copy.css', '.generated { color: #ffffff; }'],
      ['apps/board/public/styles.css', '.authored { color: #112233; }'],
      [
        'apps/board/public/index.html',
        `<style>.embedded { color: #445566; }</style><div style="color: #778899">Docs</div>`,
      ],
      [
        'apps/board/public/app.js',
        `document.body.style.color = '#aabbcc';
         document.body.style.setProperty('background-color', '#ddeeff');`,
      ],
    ],
    policy
  );

  const governance = await auditWorkspacePolicy(root);
  const publicUi = governance.publicUi['apps/board'];
  assert.deepEqual(publicUi.generatedCopies, ['apps/board/public/generated/copy.css']);
  assert.deepEqual(publicUi.handAuthoredFiles, [
    'apps/board/public/app.js',
    'apps/board/public/index.html',
    'apps/board/public/styles.css',
  ]);

  const design = await auditWorkspaceUi(root);
  assert.ok(!design.findings.some(({ file }) => file.includes('/generated/')));
  const authoredColors = design.findings.filter(
    ({ file, rule }) => file.startsWith('apps/board/public/') && rule === 'hardcoded-color'
  );
  assert.equal(authoredColors.length, 5);
});

test('only exact policy-reviewed internal child-class debt is baseline eligible', () => {
  const file = 'apps/board/src/index.css';
  const selector = '.dashboard .mw-ui-metric-tile-label';
  const evidence = `${selector} { color: var(--mw-ink-black); }`;
  const fingerprint = uiFindingFingerprint('shared-child-style-debt', file, evidence);
  const policy = {
    rules: {
      sharedChildClassOverrides: {
        reviewedDebt: [
          {
            file,
            selector,
            fingerprint,
            reason: 'Reviewed exact legacy composition.',
          },
        ],
      },
    },
  };
  const files = [
    {
      file: 'packages/ui/src/components/metric-tile.tsx',
      source:
        'export const MetricTile = () => <span className="mw-ui-metric-tile mw-ui-metric-tile-label" />;',
    },
    {
      file: 'packages/ui/src/styles/tokens.css',
      source: ':root { --mw-ink-black: #000; --mw-ink-soft: #333; }',
    },
    { file, source: `.dashboard .mw-ui-metric-tile-label { color: var(--mw-ink-black); }` },
  ];
  const manifest = {
    exports: { './components/metric-tile': './dist/components/metric-tile.js' },
  };

  const reviewed = auditUiSources(files, manifest, { policy });
  assert.deepEqual(
    reviewed.findings.map(({ rule }) => rule),
    ['shared-child-style-debt']
  );
  assert.equal(reviewed.findings[0].fingerprint, fingerprint);

  const baseline = {
    version: 1,
    entries: [
      {
        file,
        rule: 'shared-child-style-debt',
        fingerprint,
        reason: 'Reviewed exact legacy composition.',
      },
    ],
  };
  const accepted = compareUiBaseline(reviewed.findings, baseline, { policy });
  assert.equal(accepted.newFindings.length, 0);
  assert.equal(accepted.knownFindings.length, 1);

  const changedFiles = files.map((entry) =>
    entry.file === file
      ? { ...entry, source: entry.source.replace('--mw-ink-black', '--mw-ink-soft') }
      : entry
  );
  const changed = auditUiSources(changedFiles, manifest, { policy });
  assert.deepEqual(
    changed.findings.map(({ rule }) => rule),
    ['shared-child-style-override']
  );
  const rejected = compareUiBaseline(changed.findings, baseline, { policy });
  assert.equal(rejected.newFindings.length, 1);
  assert.equal(rejected.staleEntries.length, 1);
  assert.deepEqual(createUiBaseline(changed.findings).entries, []);

  assert.throws(
    () => compareUiBaseline(reviewed.findings, baseline),
    /must exactly match reviewed policy debt/u
  );
  assert.throws(
    () =>
      compareUiBaseline(
        changed.findings,
        {
          version: 1,
          entries: [
            {
              file,
              rule: 'shared-child-style-override',
              fingerprint: changed.findings[0].fingerprint,
              reason: 'Structural failures cannot be baselined.',
            },
          ],
        },
        { policy }
      ),
    /only reviewed styling-debt rules/u
  );

  const wrongSelectorPolicy = JSON.parse(JSON.stringify(policy));
  wrongSelectorPolicy.rules.sharedChildClassOverrides.reviewedDebt[0].selector = '.other';
  assert.deepEqual(
    auditUiSources(files, manifest, { policy: wrongSelectorPolicy }).findings.map(
      ({ rule }) => rule
    ),
    ['shared-child-style-override']
  );
});

test('legacy --ink aliases are reported precisely with canonical replacements and optional strict enforcement', async (t) => {
  const policy = policyFor({ 'apps/board': appConfig('apps/board') });
  const root = await createWorkspace(
    t,
    [
      appManifest('apps/board'),
      [
        'packages/ui/src/styles/tokens.css',
        `:root { --ink: #000000; --mw-ink: var(--ink); }
         .legacy { color: var(--ink-soft); }`,
      ],
      ['apps/board/src/index.css', ':root { --ink-faint: #ffffff; } .utility { border-ink: 1px; }'],
    ],
    policy
  );

  const reportOnly = await auditWorkspaceUi(root);
  assert.equal(reportOnly.aliasEnforcement, 'report-only');
  assert.equal(
    reportOnly.findings.filter(({ rule }) => rule === 'noncanonical-ink-token').length,
    0
  );
  assert.deepEqual(
    reportOnly.aliasDebt.map(({ token, canonicalToken }) => [token, canonicalToken]),
    [
      ['--ink', '--mw-ink'],
      ['--ink', '--mw-ink'],
      ['--ink-soft', '--mw-ink-soft'],
    ]
  );
  assert.deepEqual(
    reportOnly.consumerAliasDebt.map(({ token, canonicalToken }) => [token, canonicalToken]),
    [['--ink-faint', '--mw-ink-faint']]
  );
  assert.ok(reportOnly.aliasDebt.every(({ line, column }) => line > 0 && column > 0));

  const strict = await auditWorkspaceUi(root, { strictAliasDebt: true });
  assert.equal(strict.findings.filter(({ rule }) => rule === 'noncanonical-ink-token').length, 3);
});
