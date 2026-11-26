import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createSkinInitScript, themeRegistry } from '../dist/themes/index.js';
import { resetSceneHarness, setSceneHarness } from '../dist/lib/scene-test-harness.js';

const uiRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(uiRoot, 'package.json'), 'utf8'));
const tokensCss = await readFile(resolve(uiRoot, 'src/styles/tokens.css'), 'utf8');
const componentsCss = await readFile(resolve(uiRoot, 'src/styles/components.css'), 'utf8');

function parseBlock(css, selector) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const blocks = [];
  for (const match of stripped.matchAll(/(?:^|\n)([^{}\n][^{}]*?)\s*\{([^}]+)\}/gu)) {
    const selectors = match[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (selectors.includes(selector)) {
      blocks.push(match[2]);
    }
  }
  return blocks.join('\n');
}

function getToken(css, token, selectors) {
  for (let index = selectors.length - 1; index >= 0; index -= 1) {
    const block = parseBlock(css, selectors[index]);
    const match = block.match(new RegExp(`--mw-${token}:\\s*([^;]+);`));
    if (match) return match[1].trim();
  }
  return undefined;
}

function resolveToken(css, token, selectors, seen = new Set()) {
  const value = getToken(css, token, selectors);
  assert.ok(value, `Missing --mw-${token} across [${selectors.join(', ')}]`);
  const ref = value.match(/^var\(--mw-([\w-]+)\)$/);
  if (!ref) return value;
  assert.ok(!seen.has(token), `Cyclic token reference for --mw-${token}`);
  seen.add(token);
  return resolveToken(css, ref[1], selectors, seen);
}

function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i, `Expected 6-digit hex, got ${hex}`);
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('all 59 @moonwitness/ui component subpath exports resolve to valid modules', async () => {
  const componentSubpaths = Object.keys(packageJson.exports)
    .filter((key) => key.startsWith('./components/') && !key.includes('*'))
    .sort();
  assert.equal(componentSubpaths.length, 59, 'Expected 59 public component exports');

  for (const subpath of componentSubpaths) {
    const distTarget = packageJson.exports[subpath].import;
    assert.ok(distTarget, `Missing import target for ${subpath}`);
    const mod = await import(pathToFileURL(resolve(uiRoot, distTarget)).href);
    const exportedKeys = Object.keys(mod);
    assert.ok(exportedKeys.length > 0, `${subpath} should export at least one symbol`);
    for (const key of exportedKeys) {
      assert.notEqual(mod[key], undefined, `${subpath} export "${key}" must be defined`);
    }
  }
});

test('dual-skin Ink and Riot light/dark combinations expose complete semantic tokens and WCAG AA contrast', () => {
  assert.equal(themeRegistry.has('moonwitness-ink'), true);
  assert.equal(themeRegistry.has('moonwitness-riot'), true);
  assert.deepEqual(themeRegistry.get('moonwitness-ink')?.supportedModes, ['light', 'dark']);
  assert.deepEqual(themeRegistry.get('moonwitness-riot')?.supportedModes, ['light', 'dark']);

  const initScript = createSkinInitScript();
  assert.match(initScript, /moonwitness-ink/u);
  assert.match(initScript, /moonwitness-riot/u);

  const combos = [
    { name: 'moonwitness-ink light', selectors: [':root'] },
    { name: 'moonwitness-ink dark', selectors: [':root', '.dark'] },
    { name: 'moonwitness-riot light', selectors: [':root', "[data-skin='moonwitness-riot']"] },
    {
      name: 'moonwitness-riot dark',
      selectors: [
        ':root',
        '.dark',
        "[data-skin='moonwitness-riot']",
        "[data-skin='moonwitness-riot'].dark",
      ],
    },
  ];

  const requiredTokens = [
    'background',
    'foreground',
    'surface',
    'surface-foreground',
    'popover',
    'popover-foreground',
    'primary',
    'primary-foreground',
    'secondary',
    'secondary-foreground',
    'accent',
    'accent-foreground',
    'muted',
    'muted-foreground',
    'ink-faint',
    'color-ink-muted',
    'error',
    'on-error',
    'destructive',
    'destructive-foreground',
    'success',
    'on-success',
    'warning',
    'on-warning',
    'info',
    'on-info',
    'on-magenta',
    'on-violet',
    'border',
    'border-strong',
    'border-subtle',
    'input',
    'focus',
    'magenta-readable',
    'cyan-readable',
    'yellow-readable',
    'violet-readable',
    'shadow-ink',
    'shadow-ink-lg',
    'shadow-comic',
    'shadow-anime-impact',
  ];

  const textPairs = [
    ['foreground', 'background'],
    ['surface-foreground', 'surface'],
    ['popover-foreground', 'popover'],
    ['muted-foreground', 'muted'],
    ['ink-faint', 'paper'],
    ['ink-faint', 'paper-raised'],
    ['ink-faint', 'muted'],
    ['primary-foreground', 'primary'],
    ['secondary-foreground', 'secondary'],
    ['accent-foreground', 'accent'],
    ['destructive-foreground', 'destructive'],
    ['on-error', 'error'],
    ['on-success', 'success'],
    ['on-warning', 'warning'],
    ['on-info', 'info'],
    ['on-magenta', 'magenta'],
    ['on-violet', 'violet'],
    ['magenta-readable', 'surface'],
    ['cyan-readable', 'surface'],
    ['yellow-readable', 'surface'],
    ['violet-readable', 'surface'],
  ];

  for (const combo of combos) {
    for (const token of requiredTokens) {
      const value = resolveToken(tokensCss, token, combo.selectors);
      assert.ok(value.length > 0, `${combo.name}: empty --mw-${token}`);
    }
    for (const [fgName, bgName] of textPairs) {
      const fg = resolveToken(tokensCss, fgName, combo.selectors);
      const bg = resolveToken(tokensCss, bgName, combo.selectors);
      const ratio = contrast(fg, bg);
      assert.ok(
        ratio >= 4.5,
        `${combo.name}: --mw-${fgName} (${fg}) on --mw-${bgName} (${bg}) ratio ${ratio.toFixed(2)} < 4.5`
      );
    }
    assert.ok(
      contrast(
        resolveToken(tokensCss, 'border', combo.selectors),
        resolveToken(tokensCss, 'surface', combo.selectors)
      ) >= 3,
      `${combo.name}: border on surface < 3:1`
    );
    assert.ok(
      contrast(
        resolveToken(tokensCss, 'focus', combo.selectors),
        resolveToken(tokensCss, 'background', combo.selectors)
      ) >= 3,
      `${combo.name}: focus on background < 3:1`
    );
  }

  // Scoped skin/dark containers must re-declare color-mix border-subtle so child scopes update cleanly.
  for (const selector of ['.dark', "[data-skin='moonwitness-riot']"]) {
    assert.match(parseBlock(tokensCss, selector), /--mw-border-subtle:\s*color-mix\(/u, selector);
    assert.match(
      parseBlock(tokensCss, selector),
      /--mw-background:\s*var\(--mw-paper\)/u,
      selector
    );
  }

  // Dark ink comic panel kickers must remain readable against dark ink backgrounds.
  assert.match(
    componentsCss,
    /\.mw-ui-panel\[data-surface='ink'\]\s+\.mw-ui-comic-panel-kicker\s*\{/u
  );
});

test('components.css and component TSX contain zero rogue hardcoded colors on chrome', async () => {
  const strippedCss = componentsCss
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/url\(\s*["']?data:[^)]*["']?\s*\)/giu, '');
  assert.doesNotMatch(
    strippedCss,
    /(?:^|[^\w-])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])/iu
  );

  const componentFiles = (await readdir(resolve(uiRoot, 'src/components'))).sort();
  for (const file of componentFiles) {
    const src = await readFile(resolve(uiRoot, 'src/components', file), 'utf8');
    assert.doesNotMatch(
      src,
      /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b/iu,
      `Unexpected hardcoded hex color in ${file}`
    );
  }
});

test('prefers-reduced-motion disables animations, stamps, particles, and transitions in CSS and JS', async () => {
  for (const motionToken of [
    'fast',
    'normal',
    'slow',
    'pop',
    'delay',
    'draw',
    'effect',
    'pulse',
    'progress',
    'spin',
    'anime-snap',
    'anime-slash',
    'anime-burst',
    'grunge-jitter',
  ]) {
    assert.match(
      tokensCss,
      new RegExp(
        `prefers-reduced-motion:\\s*reduce[\\s\\S]*--mw-motion-${motionToken}:\\s*0ms`,
        'u'
      )
    );
  }

  for (const selector of [
    '.mw-ui-sheet-overlay',
    '.mw-ui-dialog-close',
    '.mw-ui-sheet-close',
    '.mw-ui-sticker-badge',
    '.mw-ui-grunge-stamp',
    '.mw-ui-manga-panel',
    '.mw-ui-speech-bubble',
    '.mw-ui-scene-particle',
    '.mw-ui-comic-transition',
    '.mw-ui-update-banner .animate-spin',
    '.mw-ui-command-item',
    '.mw-ui-layered-scene-stage',
    '.mw-ui-layered-scene-layer',
  ]) {
    assert.ok(componentsCss.includes(selector), `Expected ${selector} coverage in components.css`);
  }
  assert.match(componentsCss, /\.mw-ui-grunge-stamp\[data-reduced-motion='true'\]/u);
  assert.match(componentsCss, /\.mw-ui-scene-particles\[data-reduced-motion='true'\]/u);

  const {
    AnimeActionLines,
    AnimeImpactBurst,
    Doodle,
    GrungeStamp,
    InkUnderline,
    LiveIndicator,
    LoadingProgress,
    LoadingSpinner,
    MangaPanel,
    SpeedLines,
    SpeechBubble: EffectsSpeechBubble,
  } = await import('../dist/components/effects.js');
  const { SpeechBubble } = await import('../dist/components/speech-bubble.js');
  const { SceneParticles } = await import('../dist/components/scene-particles.js');
  const { ComicSceneTransition } = await import('../dist/components/scene-transitions.js');
  const { LayeredScene } = await import('../dist/components/layered-scene.js');
  const { CharacterDisplay, CharacterReaction } =
    await import('../dist/components/character-stage.js');
  const { UpdateBanner } = await import('../dist/components/update-banner.js');

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  dom.window.ResizeObserver = globalThis.ResizeObserver;
  const matchMediaReduced = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  dom.window.matchMedia = matchMediaReduced;
  globalThis.matchMedia = matchMediaReduced;

  try {
    resetSceneHarness();
    setSceneHarness({ reducedMotion: true });
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = document.getElementById('root');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          'div',
          null,
          React.createElement(SpeedLines, { count: 4 }),
          React.createElement(InkUnderline),
          React.createElement(Doodle, { kind: 'sparkle' }),
          React.createElement(AnimeImpactBurst, { variant: 'impact' }),
          React.createElement(AnimeActionLines, { density: 'light' }),
          React.createElement(GrungeStamp, null, 'STAMP'),
          React.createElement(MangaPanel, null, 'PANEL'),
          React.createElement(EffectsSpeechBubble, null, 'EFFECT BUBBLE'),
          React.createElement(SpeechBubble, { speaker: 'Kuro' }, 'STAGE BUBBLE'),
          React.createElement(LiveIndicator, { active: true }),
          React.createElement(LoadingProgress),
          React.createElement(LoadingSpinner),
          React.createElement(SceneParticles, { preset: 'sparks', count: 4 }),
          React.createElement(ComicSceneTransition, { variant: 'ink-wipe' }, 'TRANSITION'),
          React.createElement(LayeredScene, {
            sceneId: 'reduced-scene',
            label: 'Reduced scene',
            layers: [{ id: 'bg', mediaKind: 'image', src: '/bg.png', zOrder: 1 }],
            staticFallback: '/fallback.png',
          }),
          React.createElement(CharacterDisplay, { animated: true, clipId: 'idle' }),
          React.createElement(CharacterReaction, {
            animated: true,
            clipId: 'idle',
            message: 'Calm',
          }),
          React.createElement(UpdateBanner, { currentVersion: '1.0.0', status: 'checking' })
        )
      );
    });

    assert.equal(
      container.querySelector('.mw-ui-speed-lines')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(
      container.querySelector('.mw-ui-speed-lines-pulse')?.getAttribute('data-pulse-active'),
      'false'
    );
    assert.equal(
      container.querySelector('.mw-ui-anime-burst')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(container.querySelector('.mw-ui-anime-burst-active'), null);
    assert.equal(
      container.querySelector('.mw-ui-anime-action-lines')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(container.querySelector('.mw-ui-anime-action-lines-sweep'), null);
    assert.equal(
      container.querySelector('.mw-ui-grunge-stamp')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(
      container.querySelector('.mw-ui-manga-panel')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(
      container.querySelector('.mw-ui-live-indicator')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(
      container.querySelector('.mw-ui-loading-progress')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(
      container.querySelector('.mw-ui-loading-spinner')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(
      container.querySelector('.mw-ui-scene-particles')?.getAttribute('data-particle-state'),
      'static'
    );
    assert.equal(container.querySelector('.mw-ui-scene-particle')?.style.animationDuration, '0ms');
    assert.equal(
      container.querySelector('.mw-ui-comic-transition')?.getAttribute('data-transition-state'),
      'entered'
    );
    assert.equal(container.querySelector('.mw-ui-comic-transition')?.style.transition, 'none');
    assert.equal(
      container.querySelector('.mw-ui-layered-scene')?.getAttribute('data-scene-state'),
      'static'
    );
    assert.equal(
      container.querySelector('.mw-ui-layered-scene')?.getAttribute('data-reduced-motion'),
      'true'
    );
    assert.equal(
      container.querySelector('.mw-ui-character-stage')?.getAttribute('data-animated'),
      'false'
    );
    assert.equal(
      container.querySelector('.mw-ui-speech-bubble[data-reduced-motion="true"]') !== null,
      true
    );
    assert.ok(container.querySelector('.mw-ui-update-banner .motion-reduce\\:animate-none'));

    await act(async () => root.unmount());
  } finally {
    resetSceneHarness();
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
  }
});

test('all component sources enforce ARIA attributes, non-submit button types, and focus-visible rules', async () => {
  const componentFiles = (await readdir(resolve(uiRoot, 'src/components'))).sort();
  const attrName = (prop) => (ts.isJsxAttribute(prop) ? prop.name.getText() : undefined);
  const attrText = (prop) =>
    ts.isJsxAttribute(prop) && prop.initializer && ts.isStringLiteral(prop.initializer)
      ? prop.initializer.text
      : undefined;

  for (const file of componentFiles) {
    const src = await readFile(resolve(uiRoot, 'src/components', file), 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      src,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sourceFile);
        const props = node.attributes.properties;
        const hasSpread = props.some((prop) => ts.isJsxSpreadAttribute(prop));
        const hasAttr = (name) => props.some((prop) => attrName(prop) === name);

        if (
          file !== 'button.tsx' &&
          (tag === 'button' || tag === 'Button') &&
          !hasAttr('asChild')
        ) {
          assert.ok(
            hasAttr('type'),
            `${file}: non-submit <${tag}> missing explicit type attribute`
          );
        }

        if (tag === 'svg' || (tag !== 'LevelIcon' && /^[A-Z][A-Za-z]*Icon$/u.test(tag))) {
          const hasHidden = hasAttr('aria-hidden');
          const roleProp = props.find((prop) => attrName(prop) === 'role');
          const role = roleProp ? attrText(roleProp) : undefined;
          const hasSemanticLabel =
            role === 'img' && (hasAttr('aria-label') || hasAttr('aria-labelledby'));
          assert.ok(
            hasHidden || hasSemanticLabel || (tag === 'svg' && hasSpread),
            `${file}: <${tag}> must be aria-hidden or carry role="img" with aria-label`
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  for (const focusRule of [
    '.mw-ui-button:focus-visible',
    '.mw-ui-dialog-close:focus-visible',
    '.mw-ui-sheet-close:focus-visible',
    '.mw-ui-breadcrumbs-link:focus-visible',
    '.mw-ui-layered-scene:focus-visible',
    '.mw-ui-chart-scroll:focus-visible',
    '.mw-ui-command-input-wrap:focus-within',
    '.mw-ui-tabs-trigger:focus-visible',
    '.mw-ui-select-trigger:focus-visible',
  ]) {
    assert.ok(componentsCss.includes(focusRule), `Missing focus indicator rule for ${focusRule}`);
  }

  const { SoundProvider, SoundToggle } = await import('../dist/components/audio.js');
  const { CharacterPreview } = await import('../dist/components/character-preview.js');
  const { Breadcrumbs } = await import('../dist/components/breadcrumbs.js');
  const { Pagination } = await import('../dist/components/pagination.js');
  const { TagInput } = await import('../dist/components/tag-input.js');
  const { SmartButtonBox } = await import('../dist/components/smart-button-box.js');

  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(SoundProvider, null, React.createElement(SoundToggle)),
      React.createElement(CharacterPreview, { clipId: 'idle', fallbackAsset: '/idle.png' }),
      React.createElement(Breadcrumbs, {
        items: [
          { label: 'Home', href: '/' },
          { label: 'Current', current: true },
        ],
      }),
      React.createElement(Pagination, { page: 1, pageCount: 3, onPageChange: () => {} }),
      React.createElement(TagInput, { label: 'Tags', value: ['riot'], onValueChange: () => {} }),
      React.createElement(SmartButtonBox, {
        primaryActions: [{ id: 'run', label: 'Run', onClick: () => {} }],
      })
    )
  );

  const buttonTags = [...html.matchAll(/<button\b([^>]*)>/gu)].map((match) => match[1]);
  assert.ok(buttonTags.length >= 6);
  for (const attrs of buttonTags) {
    assert.match(attrs, /\btype="button"/u, `Rendered <button ${attrs}> missing type="button"`);
  }

  const svgTags = [...html.matchAll(/<svg\b([^>]*)>/gu)].map((match) => match[1]);
  assert.ok(svgTags.length >= 2);
  for (const attrs of svgTags) {
    assert.match(
      attrs,
      /\baria-hidden="true"/u,
      `Rendered <svg ${attrs}> missing aria-hidden="true"`
    );
  }
});
