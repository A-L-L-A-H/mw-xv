import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createScenePlaybackController,
} from '../dist/lib/scene-playback.js';
import {
  applyKeyboardCameraAction,
  computeLayerParallax,
  createSceneCameraController,
} from '../dist/lib/scene-camera.js';
import {
  MAX_TIMELINE_DEPTH,
  createSceneTimeline,
  validateTimelineTracks,
} from '../dist/lib/scene-timeline.js';
import {
  createCharacterAdapterRegistry,
  createSpriteSequenceAdapter,
} from '../dist/lib/character-adapter.js';
import {
  getActiveSceneHarness,
  parseSceneHarnessFromSearch,
  resetSceneHarness,
  setSceneHarness,
} from '../dist/lib/scene-test-harness.js';

test('scene playback handles play, pause, seek, step, reset, reduced-motion, offscreen pause, and zero leaked handles', () => {
  let nextRafId = 1;
  const activeRafs = new Map();
  const scheduler = {
    requestAnimationFrame(cb) {
      const id = nextRafId++;
      activeRafs.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      activeRafs.delete(id);
    },
    now: () => 0,
  };

  const controller = createScenePlaybackController({
    durationMs: 1000,
    loop: true,
    scheduler,
  });

  assert.equal(controller.getSnapshot().effectiveState, 'idle');
  controller.play();
  assert.equal(controller.getSnapshot().effectiveState, 'playing');
  assert.equal(activeRafs.size, 1);

  controller.step(250);
  assert.equal(controller.getSnapshot().timeMs, 250);
  assert.equal(controller.getSnapshot().progress, 0.25);

  controller.setVisible(false);
  assert.equal(controller.getSnapshot().effectiveState, 'paused');
  assert.equal(controller.getSnapshot().requestedPlaying, true);
  assert.equal(activeRafs.size, 0);

  controller.step(250);
  assert.equal(controller.getSnapshot().timeMs, 250);

  controller.setVisible(true);
  assert.equal(controller.getSnapshot().effectiveState, 'playing');
  assert.equal(activeRafs.size, 1);

  controller.setDocumentHidden(true);
  assert.equal(controller.getSnapshot().effectiveState, 'paused');
  assert.equal(controller.getSnapshot().requestedPlaying, true);

  controller.setDocumentHidden(false);
  assert.equal(controller.getSnapshot().effectiveState, 'playing');

  controller.setReducedMotion(true);
  assert.equal(controller.getSnapshot().effectiveState, 'static');
  assert.equal(controller.getSnapshot().timeMs, 0);
  assert.equal(activeRafs.size, 0);

  controller.step(500);
  assert.equal(controller.getSnapshot().timeMs, 0);

  controller.setReducedMotion(false);
  assert.equal(controller.getSnapshot().effectiveState, 'playing');

  controller.seek(800);
  assert.equal(controller.getSnapshot().timeMs, 800);
  controller.step(300);
  assert.equal(controller.getSnapshot().timeMs, 100);

  controller.reset();
  assert.equal(controller.getSnapshot().timeMs, 0);
  assert.equal(controller.getSnapshot().effectiveState, 'idle');
  assert.equal(activeRafs.size, 0);

  let observerDisconnected = false;
  let intersectionCallback = null;
  const visibilityListeners = new Set();
  const mediaListeners = new Set();

  const fakeWindow = {
    IntersectionObserver: class {
      constructor(cb) {
        intersectionCallback = cb;
      }
      observe() {}
      disconnect() {
        observerDisconnected = true;
      }
    },
    document: {
      hidden: false,
      addEventListener(type, fn) {
        if (type === 'visibilitychange') visibilityListeners.add(fn);
      },
      removeEventListener(type, fn) {
        if (type === 'visibilitychange') visibilityListeners.delete(fn);
      },
    },
    matchMedia() {
      return {
        matches: false,
        addEventListener(type, fn) {
          if (type === 'change') mediaListeners.add(fn);
        },
        removeEventListener(type, fn) {
          if (type === 'change') mediaListeners.delete(fn);
        },
      };
    },
  };

  controller.play();
  controller.attachObservers({}, fakeWindow);
  assert.equal(controller.getSnapshot().activeHandleCount, 4);

  intersectionCallback([{ isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(controller.getSnapshot().visible, false);
  assert.equal(controller.getSnapshot().effectiveState, 'paused');

  intersectionCallback([{ isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(controller.getSnapshot().visible, true);
  assert.equal(controller.getSnapshot().effectiveState, 'playing');

  controller.dispose();
  assert.equal(controller.getSnapshot().disposed, true);
  assert.equal(controller.getSnapshot().effectiveState, 'disposed');
  assert.equal(controller.getSnapshot().activeHandleCount, 0);
  assert.equal(activeRafs.size, 0);
  assert.equal(observerDisconnected, true);
  assert.equal(visibilityListeners.size, 0);
  assert.equal(mediaListeners.size, 0);
});

test('scene camera enforces bounds, keyboard navigation, passive pointer/scroll, and zero motion in reduced/operational modes', () => {
  const camera = createSceneCameraController({
    bounds: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZoom: 1, maxZoom: 1.25 },
    pointerStrength: 0.2,
    scrollStrength: 0.2,
  });

  camera.setCamera({ x: 5, y: -5, zoom: 3 });
  assert.deepEqual(camera.getState(), { x: 0.5, y: -0.5, zoom: 1.25 });

  camera.reset();
  assert.deepEqual(camera.getState(), { x: 0, y: 0, zoom: 1 });

  camera.setPointer(1, -1);
  assert.equal(camera.getState().x, 0.2);
  assert.equal(camera.getState().y, -0.2);

  camera.setScrollProgress(1);
  assert.equal(Number(camera.getState().y.toFixed(4)), 0);

  const parallax = camera.computeParallax({ x: 0.5, y: 0.5 }, 20);
  assert.equal(parallax.translateX, -2);
  assert.equal(parallax.translateY, 0);

  camera.setOperationalMode(true);
  assert.deepEqual(camera.getState(), { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(camera.computeParallax({ x: 1, y: 1 }, 20), { translateX: 0, translateY: 0 });

  camera.setOperationalMode(false);
  camera.setReducedMotion(true);
  assert.deepEqual(camera.getState(), { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(
    computeLayerParallax({ x: 0.5, y: 0.5, zoom: 1.2 }, { x: 1, y: 1 }, { reducedMotion: true }),
    { translateX: 0, translateY: 0 }
  );

  const right = applyKeyboardCameraAction({ x: 0, y: 0, zoom: 1 }, 'ArrowRight');
  assert.equal(right.handled, true);
  assert.equal(right.state.x, 0.15);

  const zoomIn = applyKeyboardCameraAction(right.state, '+');
  assert.equal(zoomIn.handled, true);
  assert.equal(zoomIn.state.zoom, 1.1);

  const zoomOut = applyKeyboardCameraAction(zoomIn.state, '-');
  assert.equal(zoomOut.handled, true);
  assert.equal(zoomOut.state.zoom, 1);

  const reset = applyKeyboardCameraAction(zoomIn.state, 'Home');
  assert.equal(reset.handled, true);
  assert.deepEqual(reset.state, { x: 0, y: 0, zoom: 1 });

  camera.dispose();
});

test('scene timeline coordinates tracks, non-blocking complete/cancel, and rejects cycles or excessive depth', () => {
  const events = [];
  const timeline = createSceneTimeline({
    tracks: [
      { id: 'intro', kind: 'entrance', startMs: 0, durationMs: 300, triggers: ['reveal'] },
      { id: 'reveal', kind: 'layer-transition', startMs: 200, durationMs: 400, easing: 'ease-out' },
      { id: 'cue', kind: 'event', startMs: 500, durationMs: 0, payload: { cue: 'ready' } },
    ],
    onEvent: (event) => events.push(event),
  });

  timeline.play();
  assert.equal(timeline.getState().status, 'playing');
  assert.deepEqual(timeline.getState().activeTrackIds, ['intro']);
  assert.equal(events.length, 1);

  timeline.advance(250);
  assert.deepEqual(timeline.getState().activeTrackIds, ['intro', 'reveal']);
  assert.equal(events.length, 2);

  timeline.advance(350);
  assert.equal(timeline.getState().status, 'completed');
  assert.equal(timeline.getState().timeMs, 600);
  assert.equal(events.length, 3);

  timeline.restart();
  assert.equal(timeline.getState().status, 'playing');
  assert.equal(timeline.getState().timeMs, 0);

  timeline.cancel();
  assert.equal(timeline.getState().status, 'cancelled');
  assert.deepEqual(timeline.getActiveTracks(), []);

  timeline.complete();
  assert.equal(timeline.getState().status, 'completed');
  assert.equal(timeline.getState().timeMs, 600);
  timeline.dispose();

  assert.throws(
    () =>
      validateTimelineTracks([
        { id: 'self', kind: 'event', startMs: 0, durationMs: 100, triggers: ['self'] },
      ]),
    /self-reference/u
  );

  assert.throws(
    () =>
      validateTimelineTracks([
        { id: 'a', kind: 'entrance', startMs: 0, durationMs: 100, triggers: ['b'] },
        { id: 'b', kind: 'entrance', startMs: 100, durationMs: 100, triggers: ['a'] },
      ]),
    /Cyclic/u
  );

  const deepTracks = [];
  for (let index = 0; index <= MAX_TIMELINE_DEPTH + 1; index += 1) {
    deepTracks.push({
      id: `t${index}`,
      kind: 'entrance',
      startMs: index * 10,
      durationMs: 10,
      triggers: index <= MAX_TIMELINE_DEPTH ? [`t${index + 1}`] : undefined,
    });
  }
  assert.throws(() => validateTimelineTracks(deepTracks), /exceeds maximum depth/u);
});

test('character adapter supports loop, ping-pong, one-shot, reduced-motion, and isolated optional adapters', () => {
  const adapter = createSpriteSequenceAdapter();
  const baseClip = {
    id: 'crew-01-idle',
    format: 'sprite-sequence',
    frames: ['/f0.png', '/f1.png', '/f2.png', '/f3.png'],
    fps: 10,
    fallbackAsset: '/static.png',
  };

  assert.equal(adapter.resolveFrame({ ...baseClip, mode: 'loop' }, 0).frameIndex, 0);
  assert.equal(adapter.resolveFrame({ ...baseClip, mode: 'loop' }, 150).frameIndex, 1);
  assert.equal(adapter.resolveFrame({ ...baseClip, mode: 'loop' }, 450).frameIndex, 0);

  assert.equal(adapter.resolveFrame({ ...baseClip, mode: 'ping-pong' }, 300).frameIndex, 3);
  assert.equal(adapter.resolveFrame({ ...baseClip, mode: 'ping-pong' }, 400).frameIndex, 2);
  assert.equal(adapter.resolveFrame({ ...baseClip, mode: 'ping-pong' }, 500).frameIndex, 1);
  assert.equal(adapter.resolveFrame({ ...baseClip, mode: 'ping-pong' }, 600).frameIndex, 0);

  const oneShotEnd = adapter.resolveFrame({ ...baseClip, mode: 'one-shot' }, 999);
  assert.equal(oneShotEnd.frameIndex, 3);
  assert.equal(oneShotEnd.completed, true);

  const reduced = adapter.resolveFrame(baseClip, 250, { reducedMotion: true });
  assert.equal(reduced.isStaticFallback, true);
  assert.equal(reduced.asset, '/static.png');

  const registry = createCharacterAdapterRegistry();
  assert.deepEqual(registry.listAdapters(), ['sprite-sequence']);

  let disposedRig = false;
  registry.register({
    kind: 'rig-optional',
    supports: (format) => format === 'rig-optional',
    resolveFrame: (clip) => ({
      frameIndex: 2,
      asset: clip.fallbackAsset,
      isStaticFallback: false,
      completed: false,
      adapterKind: 'rig-optional',
    }),
    dispose: () => {
      disposedRig = true;
    },
  });

  const rigResult = registry.resolveFrame(
    { ...baseClip, format: 'rig-optional' },
    100
  );
  assert.equal(rigResult.adapterKind, 'rig-optional');
  assert.equal(rigResult.frameIndex, 2);

  const unknownResult = registry.resolveFrame(
    { ...baseClip, format: 'unsupported-format' },
    100
  );
  assert.equal(unknownResult.isStaticFallback, true);
  assert.equal(unknownResult.asset, '/static.png');

  registry.dispose();
  assert.equal(disposedRig, true);
});

test('scene test harness parses search params and manages global overrides cleanly', () => {
  resetSceneHarness();
  assert.equal(getActiveSceneHarness(''), null);

  const parsed = parseSceneHarnessFromSearch(
    '?sceneTime=500&sceneFrame=2&sceneReducedMotion=1&scenePaused=true&sceneCameraX=0.25&sceneCameraZoom=1.15&sceneDisableTransitions=1'
  );
  assert.deepEqual(parsed, {
    fixedTimeMs: 500,
    fixedFrame: 2,
    reducedMotion: true,
    paused: true,
    camera: { x: 0.25, zoom: 1.15 },
    disableTransitions: true,
  });

  setSceneHarness({ fixedTimeMs: 750, paused: false });
  const merged = getActiveSceneHarness('?sceneFrame=1&scenePaused=1');
  assert.equal(merged.fixedTimeMs, 750);
  assert.equal(merged.fixedFrame, 1);
  assert.equal(merged.paused, false);

  resetSceneHarness();
  assert.equal(getActiveSceneHarness(''), null);
});
