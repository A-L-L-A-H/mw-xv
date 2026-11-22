import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MAX_SCENE_PARTICLES,
  SceneParticles,
  generateSceneParticles,
} from '../dist/components/scene-particles.js';
import { ComicSceneTransition } from '../dist/components/scene-transitions.js';
import { createSceneSoundscapeController } from '../dist/lib/scene-soundscape.js';

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
