import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import {
  MAX_SCENE_PARTICLES,
  SceneParticles,
  generateSceneParticles,
} from '../dist/components/scene-particles.js';
import { ComicSceneTransition } from '../dist/components/scene-transitions.js';
import { LayeredScene } from '../dist/components/layered-scene.js';
import { SpritePlayer } from '../dist/components/sprite-player.js';
import { CharacterPreview } from '../dist/components/character-preview.js';
import { createSceneSoundscapeController } from '../dist/lib/scene-soundscape.js';
import { resetSceneHarness, setSceneHarness } from '../dist/lib/scene-test-harness.js';

test('generateSceneParticles bounds count and produces deterministic coordinates', () => {
  const rain = generateSceneParticles('rain', { count: 999, intensity: 'intense', seed: 42 });
  assert.equal(rain.length, MAX_SCENE_PARTICLES);
  const rain2 = generateSceneParticles('rain', { count: 999, intensity: 'intense', seed: 42 });
  assert.deepEqual(rain, rain2);
  const html = renderToStaticMarkup(
    createElement(SceneParticles, { preset: 'sparks', reducedMotion: true, intensity: 'subtle' })
  );
  assert.match(html, /data-particle-preset="sparks"/u);
  assert.match(html, /data-particle-state="static"/u);
});

test('ComicSceneTransition never hides content on reduced-motion or initial render', () => {
  for (const variant of ['ink-wipe', 'panel-reveal', 'cut-impact', 'soft']) {
    const html = renderToStaticMarkup(
      createElement(
        ComicSceneTransition,
        { variant, reducedMotion: true },
        createElement('span', null, 'Scene Content')
      )
    );
    assert.match(html, /data-transition-variant=/u);
    assert.match(html, /data-transition-state="entered"/u);
    assert.match(html, /opacity:1;visibility:visible/u);
    assert.match(html, /Scene Content/u);
  }
});

test('createSceneSoundscapeController stays muted by default, enforces single source, and swallows errors', () => {
  const created = [];
  const ctrl = createSceneSoundscapeController({
    sources: {
      'moon-city-night': '/ambience/moon-city-night.wav',
      'underground-hum': '/ambience/underground-hum.wav',
      'archive-quiet': '/ambience/archive-quiet.wav',
      'street-rain': '/ambience/street-rain.wav',
    },
    createAudio(src) {
      const inst = {
        src,
        loop: false,
        volume: 0,
        paused: true,
        async play() {
          inst.paused = false;
        },
        pause() {
          inst.paused = true;
        },
      };
      created.push(inst);
      return inst;
    },
  });
  assert.equal(ctrl.getSnapshot().muted, true);
  assert.equal(ctrl.getSnapshot().playing, false);
  ctrl.enterScene('moon-city-night');
  assert.equal(created.length, 0);

  ctrl.activateUserGesture();
  ctrl.setMuted(false);
  assert.equal(created.length, 1);
  assert.equal(ctrl.getSnapshot().playing, true);

  ctrl.enterScene('archive-quiet');
  assert.equal(created[0].paused, true);
  assert.equal(created.length, 2);
  assert.equal(created[0].src, '/ambience/moon-city-night.wav');
  assert.equal(created[1].src, '/ambience/archive-quiet.wav');
  assert.equal(ctrl.getSnapshot().activeSceneId, 'archive-quiet');

  ctrl.dispose();
  assert.equal(created[1].paused, true);

  // Audio failure never throws
  const broken = createSceneSoundscapeController({
    createAudio() {
      throw new Error('Autoplay blocked');
    },
  });
  broken.activateUserGesture();
  assert.doesNotThrow(() => {
    broken.setMuted(false);
    broken.enterScene('street-rain');
  });
  assert.equal(broken.getSnapshot().playing, false);
});

test('scene soundscape does not substitute UI cues when ambience sources are absent', () => {
  const created = [];
  const ctrl = createSceneSoundscapeController({
    createAudio(src) {
      created.push(src);
      return { loop: false, volume: 0, play: async () => {}, pause() {} };
    },
  });
  ctrl.activateUserGesture();
  ctrl.setMuted(false);
  ctrl.enterScene('moon-city-night');
  assert.deepEqual(created, []);
  assert.equal(ctrl.getSnapshot().activeSceneId, 'moon-city-night');
  assert.equal(ctrl.getSnapshot().playing, false);
  ctrl.dispose();
});

test('scene FX and preview components subscribe to OS prefers-reduced-motion and honor scene harness overrides', async () => {
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

  let mediaMatches = false;
  const listeners = new Set();
  const matchMediaMock = () => ({
    get matches() {
      return mediaMatches;
    },
    addEventListener(type, fn) {
      if (type === 'change') listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'change') listeners.delete(fn);
    },
  });
  dom.window.matchMedia = matchMediaMock;
  globalThis.matchMedia = matchMediaMock;

  try {
    resetSceneHarness();
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = document.getElementById('root');
    const root = createRoot(container);

    const sampleClip = {
      id: 'kuro-idle',
      frames: ['/f1.png', '/f2.png'],
      fps: 8,
      fallbackAsset: '/f1.png',
      width: 128,
      height: 128,
    };
    const sampleLayers = [
      { id: 'bg', mediaKind: 'image', src: '/bg.png', zOrder: 1 },
    ];

    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(SceneParticles, { preset: 'rain', count: 2 }),
          createElement(ComicSceneTransition, { durationMs: 200 }, 'Scene'),
          createElement(SpritePlayer, { clip: sampleClip }),
          createElement(LayeredScene, {
            sceneId: 'test-scene',
            label: 'Test scene',
            layers: sampleLayers,
            staticFallback: '/fallback.png',
          }),
          createElement(CharacterPreview, {
            clipId: 'kuro-idle',
            fallbackAsset: '/f1.png',
            frames: ['/f1.png', '/f2.png'],
          })
        )
      );
    });

    assert.equal(container.querySelector('.mw-ui-scene-particles')?.getAttribute('data-particle-state'), 'active');
    assert.equal(container.querySelector('.mw-ui-comic-transition')?.getAttribute('data-reduced-motion'), 'false');
    assert.equal(container.querySelector('.mw-ui-sprite-player')?.getAttribute('data-sprite-state'), 'playing');
    assert.equal(container.querySelector('.mw-ui-layered-scene')?.getAttribute('data-scene-state'), 'idle');

    // Simulate OS reduced-motion toggle
    mediaMatches = true;
    await act(async () => {
      for (const fn of listeners) fn({ matches: true });
    });

    assert.equal(container.querySelector('.mw-ui-scene-particles')?.getAttribute('data-particle-state'), 'static');
    assert.equal(container.querySelector('.mw-ui-comic-transition')?.getAttribute('data-reduced-motion'), 'true');
    assert.equal(container.querySelector('.mw-ui-sprite-player')?.getAttribute('data-sprite-state'), 'static');
    assert.equal(container.querySelector('.mw-ui-layered-scene')?.getAttribute('data-scene-state'), 'static');
    assert.ok(container.querySelector('button[aria-pressed="true"]'));

    // Scene harness reducedMotion=false overrides OS reduced-motion
    mediaMatches = false;
    setSceneHarness({ reducedMotion: true });
    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(SceneParticles, { preset: 'rain', count: 2 }),
          createElement(ComicSceneTransition, { durationMs: 200 }, 'Scene'),
          createElement(SpritePlayer, { clip: sampleClip }),
          createElement(LayeredScene, {
            sceneId: 'test-scene',
            label: 'Test scene',
            layers: sampleLayers,
            staticFallback: '/fallback.png',
          })
        )
      );
    });

    assert.equal(container.querySelector('.mw-ui-scene-particles')?.getAttribute('data-particle-state'), 'static');
    assert.equal(container.querySelector('.mw-ui-comic-transition')?.getAttribute('data-reduced-motion'), 'true');
    assert.equal(container.querySelector('.mw-ui-sprite-player')?.getAttribute('data-sprite-state'), 'static');
    assert.equal(container.querySelector('.mw-ui-layered-scene')?.getAttribute('data-scene-state'), 'static');

    await act(async () => root.unmount());
  } finally {
    resetSceneHarness();
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
  }
});
