import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { env, execPath, platform, stdout } from 'node:process';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  extractPackageVerificationErrorCode,
  renderPackageVerificationAnnotation,
} from './verification-diagnostics.mjs';

const execFileAsync = promisify(execFile);
const packageManager = platform === 'win32' ? (env.ComSpec ?? 'cmd.exe') : 'pnpm';
const packageManagerPrefix = platform === 'win32' ? ['/d', '/s', '/c', 'pnpm'] : [];
const packageRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(packageRoot, '../..');
const tempRoot = await mkdtemp(join(tmpdir(), 'moonwitness-ui-package-'));
let verificationPhase = 'create package archive';

async function packPackage(directory) {
  const packed = await execFileAsync(
    packageManager,
    [...packageManagerPrefix, 'pack', '--pack-destination', tempRoot],
    { cwd: directory, windowsHide: true }
  );
  const archiveName = packed.stdout.match(/[\w.-]+\.tgz/u)?.[0];
  assert.ok(archiveName, 'pnpm pack should report the generated archive');
  return join(tempRoot, archiveName);
}

async function readInstalledVersion(directory, dependencyName) {
  const dependencyPackage = JSON.parse(
    await readFile(join(directory, 'node_modules', dependencyName, 'package.json'), 'utf8')
  );
  assert.match(
    dependencyPackage.version,
    /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u,
    `Expected an exact installed version for ${dependencyName}`
  );
  return dependencyPackage.version;
}

async function createConsumer(name, dependencies) {
  const consumerRoot = join(tempRoot, name);
  await mkdir(consumerRoot);
  // The packed UI declares @moonwitness/types as a regular dependency at its
  // published version. Without an override pnpm resolves that transitive
  // dependency from the registry, where the private workspace package does not
  // exist. Point overrides at the same local archives supplied to the consumer.
  const localOverrides = Object.fromEntries(
    Object.entries(dependencies).filter(([, version]) => version.startsWith('file:'))
  );
  await writeFile(
    join(consumerRoot, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2)
  );
  if (Object.keys(localOverrides).length > 0) {
    const overrideLines = Object.entries(localOverrides)
      .map(([name, version]) => `  '${name}': '${version}'`)
      .join('\n');
    await writeFile(join(consumerRoot, 'pnpm-workspace.yaml'), `overrides:\n${overrideLines}\n`);
  }
  verificationPhase = 'install isolated consumer dependencies';
  await execFileAsync(
    packageManager,
    [
      ...packageManagerPrefix,
      'add',
      '--prefer-offline',
      '--save-exact',
      '--config.auto-install-peers=false',
      ...Object.entries(dependencies).map(([dependencyName, version]) =>
        version.startsWith('file:') ? version : `${dependencyName}@${version}`
      ),
    ],
    { cwd: consumerRoot, windowsHide: true }
  );

  for (const [dependencyName, expectedVersion] of Object.entries(dependencies)) {
    if (expectedVersion.startsWith('file:')) continue;
    assert.equal(
      await readInstalledVersion(consumerRoot, dependencyName),
      expectedVersion,
      `${name} resolved an unexpected ${dependencyName} version`
    );
  }
  return consumerRoot;
}

const runtimeConsumerSource = `
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, createRef, Fragment } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});
for (const key of [
  'window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
// Radix probes DOM constructors such as HTMLFormElement at module/render time.
// Mirror any window global Node does not already provide without clobbering
// Node's own primitives (setTimeout, process, ...).
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key in globalThis) continue;
  try {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key],
    });
  } catch { /* some window properties cannot be redefined */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.ResizeObserver = globalThis.ResizeObserver;
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { createRoot } = await import('react-dom/client');
const { Button } = await import('@moonwitness/ui/components/button');
const { Input } = await import('@moonwitness/ui/components/input');
const { Field } = await import('@moonwitness/ui/components/field');
const { Select, SelectTrigger } = await import('@moonwitness/ui/components/select');
const { UserIcon } = await import('@moonwitness/ui/icons/user');
const { Command } = await import('@moonwitness/ui/components/command');
const { ToastHost } = await import('@moonwitness/ui/components/toast');
const { themeRegistry } = await import('@moonwitness/ui/themes');
const { createSceneTimeline } = await import('@moonwitness/ui/lib/scene-timeline');

for (const component of [Button, Input, Field, Select, SelectTrigger, UserIcon, Command, ToastHost]) {
  assert.ok(component, 'Public component exports must remain available');
}
assert.equal(typeof createSceneTimeline, 'function');
assert.ok(themeRegistry.list().length > 0);

const buttonRef = createRef();
const fieldRef = createRef();
const iconRef = createRef();
const selectRef = createRef();
let callbackInput;
const root = createRoot(document.getElementById('root'));
await act(async () => {
  root.render(createElement(Fragment, null,
    createElement(Button, { ref: buttonRef }, 'Save'),
    createElement(Input, { ref: (node) => { callbackInput = node; }, 'aria-label': 'Name' }),
    createElement(Field, { ref: fieldRef, label: 'Profile', htmlFor: 'consumer-profile' }, createElement(Input)),
    createElement(UserIcon, { ref: iconRef }),
    createElement(Select, null, createElement(SelectTrigger, { ref: selectRef }, 'Pick'))
  ));
});
assert.equal(buttonRef.current.tagName, 'BUTTON');
assert.equal(callbackInput.tagName, 'INPUT');
assert.equal(fieldRef.current.tagName, 'DIV');
assert.equal(iconRef.current.tagName, 'svg');
assert.equal(selectRef.current.tagName, 'BUTTON');
await act(async () => root.unmount());

for (const privatePath of [
  '@moonwitness/ui/dist/components/button.js',
  '@moonwitness/ui/src/components/button.tsx',
]) {
  let rejected = false;
  try { await import(privatePath); }
  catch (error) { rejected = error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'; }
  assert.equal(rejected, true, privatePath + ' must not be publicly importable');
}
`;

const typeConsumerSource = `
import { createRef } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { Field } from '@moonwitness/ui/components/field';
import { Input } from '@moonwitness/ui/components/input';
import { Select, SelectTrigger } from '@moonwitness/ui/components/select';
import { UserIcon } from '@moonwitness/ui/icons/user';
import '@moonwitness/ui/components.css';

const buttonRef = createRef<HTMLButtonElement>();
const fieldRef = createRef<HTMLDivElement>();
const inputRef = createRef<HTMLInputElement>();
const iconRef = createRef<SVGSVGElement>();
const selectRef = createRef<HTMLButtonElement>();

export const Fixture = () => (
  <>
    <Button ref={buttonRef}>Save</Button>
    <Field ref={fieldRef} label="Name" htmlFor="consumer-name"><Input ref={inputRef} /></Field>
    <UserIcon ref={iconRef} />
    <Select><SelectTrigger ref={selectRef}>Pick</SelectTrigger></Select>
  </>
);
`;

const minimalConsumerSource = `
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { Button } from '@moonwitness/ui/components/button';
import { UserIcon } from '@moonwitness/ui/icons/user';
import { themeRegistry } from '@moonwitness/ui/themes';

assert.ok(Button);
assert.ok(UserIcon);
assert.ok(themeRegistry.list().length > 0);
for (const optionalPeer of ['cmdk', 'sonner']) {
  await assert.rejects(access('node_modules/' + optionalPeer), { code: 'ENOENT' });
}
for (const [subpath, peerName] of [
  ['@moonwitness/ui/components/command', 'cmdk'],
  ['@moonwitness/ui/components/toast', 'sonner'],
]) {
  await assert.rejects(import(subpath), (error) =>
    error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes(peerName)
  );
}
`;

try {
  verificationPhase = 'create package archive';
  const typesArchive = await packPackage(resolve(packageRoot, '../types'));
  const uiArchive = await packPackage(packageRoot);
  verificationPhase = 'validate package archive';
  assert.ok(typesArchive.endsWith('.tgz'));
  assert.ok(uiArchive.endsWith('.tgz'));

  verificationPhase = 'read locked consumer dependency versions';
  const react19 = await readInstalledVersion(packageRoot, 'react');
  const reactDom19 = await readInstalledVersion(packageRoot, 'react-dom');
  const typesReact19 = await readInstalledVersion(packageRoot, '@types/react');
  const typesReactDom19 = await readInstalledVersion(packageRoot, '@types/react-dom');
  assert.match(react19, /^19\./u);
  assert.match(reactDom19, /^19\./u);
  const sharedVersions = {
    'radix-ui': await readInstalledVersion(packageRoot, 'radix-ui'),
    cmdk: await readInstalledVersion(packageRoot, 'cmdk'),
    sonner: await readInstalledVersion(packageRoot, 'sonner'),
    typescript: await readInstalledVersion(workspaceRoot, 'typescript'),
    jsdom: await readInstalledVersion(workspaceRoot, 'jsdom'),
  };
  const matrices = [
    {
      name: 'consumer-react-18',
      react: '18.3.1',
      'react-dom': '18.3.1',
      '@types/react': '18.3.24',
      '@types/react-dom': '18.3.7',
    },
    {
      name: 'consumer-react-19',
      react: react19,
      'react-dom': reactDom19,
      '@types/react': typesReact19,
      '@types/react-dom': typesReactDom19,
    },
  ];

  for (const matrix of matrices) {
    const consumerRoot = await createConsumer(matrix.name, {
      '@moonwitness/types': `file:${typesArchive}`,
      '@moonwitness/ui': `file:${uiArchive}`,
      react: matrix.react,
      'react-dom': matrix['react-dom'],
      '@types/react': matrix['@types/react'],
      '@types/react-dom': matrix['@types/react-dom'],
      ...sharedVersions,
    });
    await writeFile(join(consumerRoot, 'consumer.mjs'), runtimeConsumerSource);
    await writeFile(join(consumerRoot, 'fixture.tsx'), typeConsumerSource);
    await writeFile(
      join(consumerRoot, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: 'ES2022',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'react-jsx',
            skipLibCheck: false,
          },
          include: ['fixture.tsx'],
        },
        null,
        2
      )
    );

    verificationPhase = 'run consumer import smoke test';
    await execFileAsync(execPath, [join(consumerRoot, 'consumer.mjs')], {
      cwd: consumerRoot,
      windowsHide: true,
    });
    verificationPhase = 'run consumer typecheck';
    await execFileAsync(
      packageManager,
      [...packageManagerPrefix, 'exec', 'tsc', '-p', 'tsconfig.json'],
      {
        cwd: consumerRoot,
        windowsHide: true,
      }
    );
  }

  verificationPhase = 'validate optional peer isolation';
  const minimalConsumer = await createConsumer('consumer-minimal-peers', {
    '@moonwitness/types': `file:${typesArchive}`,
    '@moonwitness/ui': `file:${uiArchive}`,
    react: '18.3.1',
    'react-dom': '18.3.1',
    'radix-ui': sharedVersions['radix-ui'],
  });
  await writeFile(join(minimalConsumer, 'consumer.mjs'), minimalConsumerSource);
  verificationPhase = 'run consumer import smoke test';
  await execFileAsync(execPath, [join(minimalConsumer, 'consumer.mjs')], {
    cwd: minimalConsumer,
    windowsHide: true,
  });

  const installedUiRoot = join(minimalConsumer, 'node_modules', '@moonwitness', 'ui');
  const packageJson = JSON.parse(await readFile(join(installedUiRoot, 'package.json'), 'utf8'));
  verificationPhase = 'validate package peer metadata';
  for (const requiredPeer of ['react', 'react-dom', 'radix-ui']) {
    assert.ok(packageJson.peerDependencies[requiredPeer], `${requiredPeer} must remain required`);
  }
  for (const optionalPeer of ['cmdk', 'sonner']) {
    assert.equal(packageJson.peerDependenciesMeta[optionalPeer]?.optional, true);
  }
  assert.doesNotMatch(packageJson.dependencies['@moonwitness/types'], /workspace:/u);

  verificationPhase = 'validate public stylesheet exports';
  for (const stylesheet of ['./components.css', './styles/tokens.css']) {
    const exportPath = packageJson.exports[stylesheet];
    assert.equal(typeof exportPath, 'string', `Missing public CSS export ${stylesheet}`);
    assert.ok((await readFile(join(installedUiRoot, exportPath), 'utf8')).length > 0);
  }

  stdout.write(
    `Packed consumers passed on React ${matrices.map((matrix) => matrix.react).join(' and ')}; refs, TypeScript, CSS, private paths, and optional peers verified.\n`
  );
} catch (error) {
  const errorCode = extractPackageVerificationErrorCode(error);
  stdout.write(renderPackageVerificationAnnotation(verificationPhase, errorCode));
  throw error;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
