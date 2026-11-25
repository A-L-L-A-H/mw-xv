import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import {
  AnimeActionLines,
  AnimeImpactBurst,
  DecorativeMotif,
  Doodle,
  EditorialTexture,
  GrungeCanvas,
  GrungeDivider,
  GrungeStamp,
  InkFrame,
  InkUnderline,
  LiveIndicator,
  LoadingSpinner,
  MangaPanel,
  SpeedLines,
  SpeechBubble,
  ZineSticker,
} from '../dist/components/effects.js';
import { ArtworkFrame } from '../dist/components/artwork-frame.js';
import { Badge } from '../dist/components/badge.js';
import { Button } from '../dist/components/button.js';

test('ink effects render as decorative shared primitives', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(SpeedLines, { count: 3 }),
      React.createElement(InkUnderline),
      React.createElement(Doodle, { kind: 'star' }),
      React.createElement(SpeechBubble, null, 'Hello'),
      React.createElement(InkFrame, null, React.createElement('span', null, 'Framed'))
    )
  );

  assert.match(html, /class="mw-ui-speed-lines(?:\s|")/u);
  assert.match(html, /class="mw-ui-speed-lines-pulse"/u);
  assert.match(html, /class="mw-ui-ink-underline(?:\s|")/u);
  assert.match(html, /class="mw-ui-ink-underline-path"/u);
  assert.match(html, /pathLength="1"/u);
  assert.match(html, /class="mw-ui-doodle(?:\s|")/u);
  assert.match(html, /class="mw-ui-speech-bubble(?:\s|")/u);
  assert.match(html, /class="mw-ui-ink-frame"/u);
  assert.match(html, /aria-hidden="true"/u);
});

test('loading spinner is compact and decorative while button text carries the action status', () => {
  const html = renderToStaticMarkup(React.createElement(LoadingSpinner));

  assert.match(html, /class="mw-ui-loading-spinner(?:\s|")/u);
  assert.match(html, /aria-hidden="true"/u);
});

test('speed lines stop pulsing when animation is disabled', () => {
  const html = renderToStaticMarkup(React.createElement(SpeedLines, { count: 3, animate: false }));

  assert.match(html, /mw-ui-speed-lines/u);
  assert.doesNotMatch(html, /mw-ui-speed-lines-pulse/u);
});

test('doodle crown, smiley, and decorative motifs stay non-interactive and aria-hidden', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(Doodle, { kind: 'crown' }),
      React.createElement(Doodle, { kind: 'smiley' }),
      React.createElement(DecorativeMotif, { kind: 'moon-phases' }),
      React.createElement(DecorativeMotif, { kind: 'eye-target' }),
      React.createElement(DecorativeMotif, { kind: 'globe-grid' })
    )
  );

  assert.match(html, /viewBox="0 0 28 24"/u);
  assert.match(html, /class="mw-ui-decorative-motif"/u);
  assert.match(html, /focusable="false"/u);
  assert.match(html, /aria-hidden="true"/u);
});

test('live indicator binds to active state with non-color label and offscreen pause class', () => {
  const activeHtml = renderToStaticMarkup(
    React.createElement(LiveIndicator, { active: true, label: 'ON AIR', variant: 'on-air' })
  );
  const idleHtml = renderToStaticMarkup(
    React.createElement(LiveIndicator, { active: false, label: 'STANDBY' })
  );

  assert.match(activeHtml, /class="mw-ui-live-indicator(?:\s|")/u);
  assert.match(activeHtml, /data-active="true"/u);
  assert.match(activeHtml, /data-variant="on-air"/u);
  assert.match(activeHtml, /ON AIR/u);
  assert.match(idleHtml, /data-active="false"/u);
  assert.match(idleHtml, /STANDBY/u);
});

test('anime effect animations and rough grunge artwork primitives render with decorative attributes', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(EditorialTexture, { variant: 'grunge' }),
      React.createElement(
        InkFrame,
        { roughness: 'brutal' },
        React.createElement('span', null, 'Brutal')
      ),
      React.createElement(AnimeImpactBurst, { variant: 'slash' }),
      React.createElement(AnimeActionLines, { direction: 'diagonal', density: 'dense', seed: 11 }),
      React.createElement(
        GrungeCanvas,
        { intensity: 'heavy', surface: 'ink', scratches: true },
        React.createElement('span', null, 'Raw artwork')
      ),
      React.createElement(GrungeStamp, { tone: 'magenta', tilt: 'left' }, 'IMPACT'),
      React.createElement(
        ArtworkFrame,
        { frame: 'grunge', animeEffect: 'slash', shape: 'landscape' },
        React.createElement('img', { src: '/art.webp', alt: 'Grunge panel' })
      )
    )
  );

  assert.match(html, /mw-ui-editorial-texture[^"]*".*data-variant="grunge"/u);
  assert.match(html, /class="mw-ui-ink-frame" data-roughness="brutal"/u);
  assert.match(html, /class="mw-ui-anime-burst mw-ui-anime-burst-active/u);
  assert.match(html, /data-variant="slash"/u);
  assert.match(html, /class="mw-ui-anime-action-lines mw-ui-anime-action-lines-sweep/u);
  assert.match(html, /data-density="dense" data-direction="diagonal"/u);
  assert.match(html, /class="mw-ui-grunge-canvas/u);
  assert.match(html, /class="mw-ui-grunge-canvas-scratches"/u);
  assert.match(html, /class="mw-ui-grunge-stamp/u);
  assert.match(html, /data-tone="magenta"/u);
  assert.match(html, /class="mw-ui-artwork-frame" data-anime-effect="slash" data-frame="grunge"/u);
  assert.match(html, /class="mw-ui-artwork-frame-grunge"/u);
});

test('phase 3 raw-art primitives and magenta/cyan variants render expected data attributes', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(GrungeDivider, { label: 'SIGNAL BREAK', tone: 'magenta' }),
      React.createElement(
        ZineSticker,
        { tone: 'yellow', tilt: 'right', tape: true },
        'WITNESS THE REAL.'
      ),
      React.createElement(
        MangaPanel,
        {
          surface: 'ink',
          accent: 'magenta',
          actionLines: true,
          badge: React.createElement(Badge, { variant: 'magenta' }, 'RAW'),
        },
        React.createElement(Button, { variant: 'magenta', treatment: 'brush' }, 'Enter the Shadow')
      ),
      React.createElement(Badge, { variant: 'cyan' }, 'SIGNAL')
    )
  );

  assert.match(html, /class="mw-ui-grunge-divider" data-tone="magenta" role="separator"/u);
  assert.match(html, /class="mw-ui-grunge-divider-label">SIGNAL BREAK</u);
  assert.match(
    html,
    /class="mw-ui-zine-sticker" data-tape="true" data-tilt="right" data-tone="yellow"/u
  );
  assert.match(html, /class="mw-ui-manga-panel/u);
  assert.match(html, /data-accent="magenta" data-surface="ink"/u);
  assert.match(html, /data-treatment="brush" data-variant="magenta"/u);
  assert.match(html, /data-variant="cyan"/u);
});

test('SSR and pre-intersection animated primitives never freeze at opacity: 0 and gate entrance keyframes', async () => {
  const componentCss = await readFile(
    new URL('../src/styles/components.css', import.meta.url),
    'utf8'
  );
  const ssrHtml = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(MangaPanel, null, 'Visible SSR MangaPanel'),
      React.createElement(GrungeStamp, null, 'STAMP'),
      React.createElement(SpeechBubble, null, 'Bubble'),
      React.createElement(InkUnderline),
      React.createElement(SpeedLines, { count: 3 })
    )
  );
  assert.match(ssrHtml, /mw-ui-manga-panel mw-ui-motion-paused/u);
  assert.match(ssrHtml, /mw-ui-grunge-stamp mw-ui-motion-paused/u);
  assert.match(ssrHtml, /mw-ui-speech-bubble mw-ui-motion-paused/u);
  assert.match(ssrHtml, /data-pulse-active="false"/u);

  assert.match(
    componentCss,
    /\.mw-ui-grunge-stamp\.mw-ui-motion-visible\s*\{[^}]*mw-ui-anime-slam/u
  );
  assert.match(
    componentCss,
    /\.mw-ui-manga-panel\.mw-ui-motion-visible\s*\{[^}]*mw-ui-anime-slam/u
  );
  assert.match(
    componentCss,
    /\.mw-ui-speech-bubble\.mw-ui-motion-visible\s*\{[^}]*mw-ui-speech-pop/u
  );
  assert.match(
    componentCss,
    /\.mw-ui-motion-visible\s+\.mw-ui-ink-underline-path\s*\{[^}]*mw-ui-ink-draw/u
  );
});

test('useAnimationVisibility re-attaches IntersectionObserver across conditional remounts', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevIO = globalThis.IntersectionObserver;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const observedTargets = [];
  let disconnectCount = 0;
  let activeCallback = null;
  globalThis.IntersectionObserver = class {
    constructor(cb) {
      activeCallback = cb;
    }
    observe(target) {
      observedTargets.push(target);
    }
    disconnect() {
      disconnectCount += 1;
    }
  };

  try {
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.getElementById('root'));

    function ConditionalHost({ show, label }) {
      return show ? React.createElement(GrungeStamp, null, label) : null;
    }

    await act(async () => {
      root.render(React.createElement(ConditionalHost, { show: true, label: 'First' }));
    });
    assert.equal(observedTargets.length, 1);
    assert.match(observedTargets[0].className, /mw-ui-motion-paused/u);

    await act(async () => {
      activeCallback([{ isIntersecting: true, intersectionRatio: 1 }]);
    });
    assert.match(observedTargets[0].className, /mw-ui-motion-visible/u);

    await act(async () => {
      root.render(React.createElement(ConditionalHost, { show: false, label: 'Hidden' }));
    });
    assert.ok(disconnectCount >= 1);

    await act(async () => {
      root.render(React.createElement(ConditionalHost, { show: true, label: 'Second' }));
    });
    assert.equal(observedTargets.length, 2);
    assert.notEqual(observedTargets[1], observedTargets[0]);
    assert.match(observedTargets[1].className, /mw-ui-motion-paused/u);

    await act(async () => {
      activeCallback([{ isIntersecting: true, intersectionRatio: 1 }]);
    });
    assert.match(observedTargets[1].className, /mw-ui-motion-visible/u);

    await act(async () => root.unmount());
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.IntersectionObserver = prevIO;
  }
});
