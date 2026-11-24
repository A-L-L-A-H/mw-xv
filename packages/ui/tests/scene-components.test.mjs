import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  LayeredScene,
  resolveSceneLayersForWidth,
} from '../dist/components/layered-scene.js';
import {
  SpritePlayer,
  computeSpriteFrameIndex,
} from '../dist/components/sprite-player.js';
import {
  resetSceneHarness,
  setSceneHarness,
} from '../dist/lib/scene-test-harness.js';

const sampleLayers = [
  {
    id: 'foreground',
    mediaKind: 'vector',
    svgContent: React.createElement('svg', { viewBox: '0 0 10 10' }),
    zOrder: 30,
    opacity: 0.9,
    parallax: { x: 0.4, y: 0.2 },
  },
  {
    id: 'sky',
    mediaKind: 'image',
    src: '/assets/sky.png',
    zOrder: 10,
    blendMode: 'screen',
    parallax: { x: 0.1, y: 0 },
  },
  {
    id: 'signal-frame',
    mediaKind: 'video-frame',
    src: '/assets/signal-01.png',
    zOrder: 20,
    clipPath: 'inset(0% 0% 0% 0%)',
  },
];

const sampleBreakpoints = [
  {
    name: 'mobile',
    minWidth: 0,
    maxWidth: 640,
    layerOverrides: [
      { layerId: 'foreground', hidden: true },
      { layerId: 'sky', opacity: 0.7 },
    ],
  },
];

test('resolveSceneLayersForWidth sorts layers by zOrder and applies breakpoint overrides', () => {
  const desktop = resolveSceneLayersForWidth(sampleLayers, sampleBreakpoints, 1280);
  assert.deepEqual(
    desktop.map((layer) => layer.id),
    ['sky', 'signal-frame', 'foreground']
  );

  const mobile = resolveSceneLayersForWidth(sampleLayers, sampleBreakpoints, 480);
  assert.deepEqual(
    mobile.map((layer) => layer.id),
    ['sky', 'signal-frame']
  );
  assert.equal(mobile[0].opacity, 0.7);
});

test('resolveSceneLayersForWidth places crew-01 (zOrder 82) between rooftop foreground and prop wires and applies the mobile position override', () => {
  // Manifest layer.position is surfaced to the scene component as descriptor.pivot.
  const crewSceneLayers = [
    {
      id: 'rooftop-foreground',
      mediaKind: 'image',
      src: '/assets/moon-city-foreground.svg',
      zOrder: 70,
    },
    {
      id: 'crew-01',
      mediaKind: 'image',
      src: '/assets/crew-01-idle-frame-01.svg',
      zOrder: 82,
      pivot: { x: 0.5, y: 0.9 },
    },
    {
      id: 'prop-wires',
      mediaKind: 'image',
      src: '/assets/moon-city-prop-wires.svg',
      zOrder: 85,
    },
  ];
  const crewBreakpoints = [
    {
      name: 'mobile',
      minWidth: 0,
      maxWidth: 767,
      layerOverrides: [{ layerId: 'crew-01', pivot: { x: 0.52, y: 0.9 } }],
    },
  ];

  const desktop = resolveSceneLayersForWidth(crewSceneLayers, crewBreakpoints, 1280);
  assert.deepEqual(
    desktop.map((layer) => layer.id),
    ['rooftop-foreground', 'crew-01', 'prop-wires']
  );
  assert.deepEqual(desktop[1].pivot, { x: 0.5, y: 0.9 });

  const mobile = resolveSceneLayersForWidth(crewSceneLayers, crewBreakpoints, 480);
  assert.deepEqual(
    mobile.map((layer) => layer.id),
    ['rooftop-foreground', 'crew-01', 'prop-wires']
  );
  assert.deepEqual(mobile[1].pivot, { x: 0.52, y: 0.9 });

  const mobileHtml = renderToStaticMarkup(
    React.createElement(LayeredScene, {
      sceneId: 'moon-city-hero',
      label: 'Moon City hero',
      layers: crewSceneLayers,
      staticFallback: '/assets/hero-static.png',
      breakpoints: crewBreakpoints,
      viewportWidth: 480,
    })
  );
  const rooftopPos = mobileHtml.indexOf('data-layer-id="rooftop-foreground"');
  const crewPos = mobileHtml.indexOf('data-layer-id="crew-01"');
  const wiresPos = mobileHtml.indexOf('data-layer-id="prop-wires"');
  assert.ok(rooftopPos > 0 && crewPos > rooftopPos && wiresPos > crewPos);
});

test('LayeredScene renders sorted layers with accessible attributes and static fallback for reduced motion', () => {
  resetSceneHarness();

  const layeredHtml = renderToStaticMarkup(
    React.createElement(LayeredScene, {
      sceneId: 'hero-tower',
      label: 'MoonWitness signal tower',
      layers: sampleLayers,
      staticFallback: '/assets/hero-static.png',
      breakpoints: sampleBreakpoints,
      viewportWidth: 1280,
      enableKeyboardCamera: true,
    })
  );

  assert.match(layeredHtml, /role="img"/u);
  assert.match(layeredHtml, /aria-label="MoonWitness signal tower"/u);
  assert.match(layeredHtml, /data-scene-id="hero-tower"/u);
  assert.match(layeredHtml, /tabindex="0"/u);

  const skyPos = layeredHtml.indexOf('data-layer-id="sky"');
  const videoPos = layeredHtml.indexOf('data-layer-id="signal-frame"');
  const fgPos = layeredHtml.indexOf('data-layer-id="foreground"');
  assert.ok(skyPos > 0 && videoPos > skyPos && fgPos > videoPos);
  assert.match(layeredHtml, /data-z-order="10"/u);
  assert.match(layeredHtml, /data-z-order="20"/u);
  assert.match(layeredHtml, /data-z-order="30"/u);
  assert.match(layeredHtml, /data-video-frame="true"/u);

  const reducedHtml = renderToStaticMarkup(
    React.createElement(LayeredScene, {
      sceneId: 'hero-tower',
      label: 'MoonWitness signal tower',
      accessibilityFallback: 'Static hero tower frame',
      layers: sampleLayers,
      staticFallback: '/assets/hero-static.png',
      reducedMotion: true,
    })
  );

  assert.match(reducedHtml, /data-scene-state="static"/u);
  assert.match(reducedHtml, /data-scene-fallback="true"/u);
  assert.match(reducedHtml, /src="\/assets\/hero-static\.png"/u);
  assert.match(reducedHtml, /aria-label="Static hero tower frame"/u);
  assert.doesNotMatch(reducedHtml, /data-layer-id=/u);

  const emptyHtml = renderToStaticMarkup(
    React.createElement(LayeredScene, {
      sceneId: 'empty-scene',
      label: 'Fallback scene',
      layers: [],
      staticFallback: '/assets/fallback.png',
    })
  );
  assert.match(emptyHtml, /data-scene-state="static"/u);
  assert.match(emptyHtml, /data-scene-fallback="true"/u);
});

test('SpritePlayer computes frames deterministically and honors pinnedFrame, reducedMotion, scale, and test harness', () => {
  resetSceneHarness();

  const clip = {
    id: 'crew-01-wave',
    frames: ['/wave-0.png', '/wave-1.png', '/wave-2.png'],
    fps: 10,
    loop: true,
    fallbackAsset: '/wave-static.png',
    width: 120,
    height: 160,
  };

  assert.equal(computeSpriteFrameIndex(clip, 0), 0);
  assert.equal(computeSpriteFrameIndex(clip, 150), 1);
  assert.equal(computeSpriteFrameIndex(clip, 250), 2);
  assert.equal(computeSpriteFrameIndex(clip, 350), 0);
  assert.equal(computeSpriteFrameIndex(clip, 250, { reducedMotion: true }), 0);
  assert.equal(computeSpriteFrameIndex(clip, 0, { pinnedFrame: 2 }), 2);

  const pinnedHtml = renderToStaticMarkup(
    React.createElement(SpritePlayer, {
      clip,
      pinnedFrame: 1,
      scale: 0.5,
    })
  );
  assert.match(pinnedHtml, /data-sprite-clip="crew-01-wave"/u);
  assert.match(pinnedHtml, /data-sprite-frame="1"/u);
  assert.match(pinnedHtml, /data-sprite-state="pinned"/u);
  assert.match(pinnedHtml, /src="\/wave-1\.png"/u);
  assert.match(pinnedHtml, /width="60"/u);
  assert.match(pinnedHtml, /height="80"/u);

  const reducedHtml = renderToStaticMarkup(
    React.createElement(SpritePlayer, {
      clip,
      reducedMotion: true,
    })
  );
  assert.match(reducedHtml, /data-sprite-state="static"/u);
  assert.match(reducedHtml, /data-sprite-frame="0"/u);
  assert.match(reducedHtml, /src="\/wave-static\.png"/u);

  setSceneHarness({ fixedFrame: 2 });
  const harnessHtml = renderToStaticMarkup(
    React.createElement(SpritePlayer, { clip })
  );
  assert.match(harnessHtml, /data-sprite-frame="2"/u);
  assert.match(harnessHtml, /data-sprite-state="pinned"/u);
  assert.match(harnessHtml, /src="\/wave-2\.png"/u);
  resetSceneHarness();
});
