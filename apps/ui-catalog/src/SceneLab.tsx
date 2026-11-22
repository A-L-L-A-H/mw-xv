import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { LayeredScene, type SceneLayerDescriptor } from '@moonwitness/ui/components/layered-scene';
import { SpritePlayer, type SpriteClipMetadata } from '@moonwitness/ui/components/sprite-player';
import { createSceneTimeline, type TimelineStatus } from '@moonwitness/ui/lib/scene-timeline';
import { getActiveSceneHarness } from '@moonwitness/ui/lib/scene-test-harness';
import skyUrl from '@moonwitness/assets/environments/moon-city-sky.svg';
import moonUrl from '@moonwitness/assets/environments/moon-city-moon.svg';
import cloudsFarUrl from '@moonwitness/assets/environments/moon-city-clouds-far.svg';
import skylineFarUrl from '@moonwitness/assets/environments/moon-city-skyline-far.svg';
import cloudsNearUrl from '@moonwitness/assets/environments/moon-city-clouds-near.svg';
import skylineMidUrl from '@moonwitness/assets/environments/moon-city-skyline-mid.svg';
import foregroundUrl from '@moonwitness/assets/environments/moon-city-foreground.svg';
import railingUrl from '@moonwitness/assets/environments/moon-city-prop-railing.svg';
import wiresUrl from '@moonwitness/assets/environments/moon-city-prop-wires.svg';
import idleFrame1 from '@moonwitness/assets/animation/crew-01-idle/crew-01-idle-frame-01.svg';
import idleFrame2 from '@moonwitness/assets/animation/crew-01-idle/crew-01-idle-frame-02.svg';
import fallbackHeroDesktop from '@moonwitness/assets/illustrations/home-hero-desktop.webp';
import fallbackHeroMobile from '@moonwitness/assets/illustrations/home-hero-mobile.webp';

const INITIAL_LAYERS: readonly SceneLayerDescriptor[] = [
  { id: 'sky', src: skyUrl, mediaKind: 'vector', zOrder: 0, opacity: 1, pivot: { x: 0.5, y: 0.5 }, parallax: { x: 0, y: 0 }, alt: 'Moon City sky' },
  { id: 'moon', src: moonUrl, mediaKind: 'vector', zOrder: 10, opacity: 1, pivot: { x: 0.72, y: 0.24 }, parallax: { x: 0.04, y: 0.03 }, alt: 'Moon disc' },
  { id: 'clouds-far', src: cloudsFarUrl, mediaKind: 'vector', zOrder: 20, opacity: 0.85, pivot: { x: 0.5, y: 0.28 }, parallax: { x: 0.08, y: 0.04 }, alt: 'Far clouds' },
  { id: 'skyline-far', src: skylineFarUrl, mediaKind: 'vector', zOrder: 30, opacity: 1, pivot: { x: 0.5, y: 0.75 }, parallax: { x: 0.14, y: 0.06 }, alt: 'Far skyline' },
  { id: 'clouds-near', src: cloudsNearUrl, mediaKind: 'vector', zOrder: 40, opacity: 0.9, pivot: { x: 0.5, y: 0.34 }, parallax: { x: 0.22, y: 0.08 }, alt: 'Near clouds' },
  { id: 'skyline-mid', src: skylineMidUrl, mediaKind: 'vector', zOrder: 50, opacity: 1, pivot: { x: 0.5, y: 0.8 }, parallax: { x: 0.32, y: 0.12 }, alt: 'Midground city' },
  { id: 'foreground', src: foregroundUrl, mediaKind: 'vector', zOrder: 70, opacity: 1, pivot: { x: 0.5, y: 0.92 }, parallax: { x: 0.55, y: 0.18 }, alt: 'Rooftop foreground' },
  { id: 'prop-railing', src: railingUrl, mediaKind: 'vector', zOrder: 80, opacity: 1, pivot: { x: 0.5, y: 0.95 }, parallax: { x: 0.65, y: 0.22 }, alt: 'Safety railing' },
  { id: 'prop-wires', src: wiresUrl, mediaKind: 'vector', zOrder: 85, opacity: 0.92, pivot: { x: 0.5, y: 0.12 }, parallax: { x: 0.72, y: 0.24 }, alt: 'Overhead wires' },
];

const SCENE_BREAKPOINTS = [
  {
    name: 'mobile',
    minWidth: 0,
    maxWidth: 767,
    layerOverrides: [
      { layerId: 'moon', pivot: { x: 0.52, y: 0.2 }, parallax: { x: 0.02, y: 0.02 } },
      { layerId: 'prop-wires', opacity: 0.45, parallax: { x: 0.18, y: 0.08 } },
    ],
  },
  { name: 'desktop', minWidth: 768 },
] as const;

const IDLE_CLIP: SpriteClipMetadata = {
  id: 'crew-01-idle',
  frames: [idleFrame1, idleFrame2],
  durationMs: 1800,
  loop: true,
  pingPong: true,
  fallbackAsset: idleFrame1,
  width: 160,
  height: 160,
};

export function SceneLab() {
  const harness = getActiveSceneHarness() ?? {};
  const [layers, setLayers] = useState<SceneLayerDescriptor[]>([...INITIAL_LAYERS]);
  const [hiddenIds, setHiddenIds] = useState<Record<string, boolean>>({});
  const [composition, setComposition] = useState<'desktop' | 'mobile'>('desktop');
  const [showGuides, setShowGuides] = useState(true);
  const [staticMode, setStaticMode] = useState(Boolean(harness.reducedMotion));
  const [spritePlaying, setSpritePlaying] = useState(!harness.paused && !harness.reducedMotion);
  const [timelineStatus, setTimelineStatus] = useState<TimelineStatus>('idle');
  const [timelineTimeMs, setTimelineTimeMs] = useState(harness.fixedTimeMs ?? 0);
  const timelineRef = useRef<ReturnType<typeof createSceneTimeline> | null>(null);

  useEffect(() => {
    const timeline = createSceneTimeline({
      totalDurationMs: 1800,
      tracks: [
        { id: 'sky-entrance', startMs: 0, durationMs: 600, kind: 'entrance', triggers: ['city-reveal'] },
        { id: 'city-reveal', startMs: 400, durationMs: 800, kind: 'layer-transition', triggers: ['crew-idle'] },
        { id: 'crew-idle', startMs: 900, durationMs: 900, kind: 'clip' },
      ],
    });
    timelineRef.current = timeline;
    if (typeof harness.fixedTimeMs === 'number') {
      timeline.seek(harness.fixedTimeMs);
      const snap = timeline.getState();
      setTimelineStatus(snap.status);
      setTimelineTimeMs(snap.timeMs);
    }
    const unsub = timeline.subscribe((snap) => {
      setTimelineStatus(snap.status);
      setTimelineTimeMs(snap.timeMs);
    });
    return () => {
      unsub();
      timeline.dispose();
      timelineRef.current = null;
    };
  }, [harness.fixedTimeMs]);

  const activeLayers = useMemo(
    () => layers.filter((layer) => !hiddenIds[layer.id]),
    [layers, hiddenIds]
  );

  const toggleLayer = (id: string) =>
    setHiddenIds((prev) => ({ ...prev, [id]: !prev[id] }));

  const moveLayer = (index: number, delta: -1 | 1) => {
    setLayers((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.map((entry) => ({ ...entry }));
      const currentOrder = next[index].zOrder;
      next[index].zOrder = next[target].zOrder;
      next[target].zOrder = currentOrder;
      return next.sort((a, b) => a.zOrder - b.zOrder);
    });
  };

  const viewportWidth = composition === 'mobile' ? 390 : 1280;

  return (
    <div className="scene-lab" data-testid="scene-lab">
      <div className="scene-lab-toolbar">
        <Button
          variant={composition === 'desktop' ? 'magenta' : 'default'}
          onClick={() => setComposition('desktop')}
        >
          Desktop 16:9
        </Button>
        <Button
          variant={composition === 'mobile' ? 'magenta' : 'default'}
          onClick={() => setComposition('mobile')}
        >
          Mobile 9:16
        </Button>
        <Button variant="default" onClick={() => setShowGuides((v) => !v)}>
          {showGuides ? 'Hide safe guides' : 'Show safe guides'}
        </Button>
        <Button variant="default" onClick={() => setStaticMode((v) => !v)}>
          {staticMode ? 'Live scene' : 'Static fallback'}
        </Button>
        <Button
          variant="default"
          onClick={() => {
            const tl = timelineRef.current;
            if (!tl) return;
            tl.restart();
            tl.advance(600);
          }}
        >
          Step timeline
        </Button>
        <Button variant="default" onClick={() => timelineRef.current?.complete()}>
          Complete timeline
        </Button>
      </div>
      <p className="scene-lab-status" data-testid="scene-timeline-status">
        Composition: {composition} ({viewportWidth}px) · Timeline: {timelineStatus} ({timelineTimeMs}ms) · Active planes: {activeLayers.length}/{layers.length}
      </p>
      <div
        className={`scene-lab-stage ${composition === 'mobile' ? 'scene-lab-stage-mobile' : ''}`}
        data-composition={composition}
      >
        <LayeredScene
          sceneId="moon-city-hero"
          label="Moon City layered environment preview"
          layers={activeLayers}
          breakpoints={SCENE_BREAKPOINTS}
          viewportWidth={viewportWidth}
          staticFallback={composition === 'mobile' ? fallbackHeroMobile : fallbackHeroDesktop}
          accessibilityFallback={fallbackHeroMobile}
          forceStatic={staticMode}
          enableKeyboardCamera={!staticMode}
          enablePointerParallax={!staticMode}
          style={{ width: '100%', height: composition === 'mobile' ? 420 : 340 }}
        />
        {showGuides && (
          <div className="scene-lab-guides" aria-hidden="true" data-testid="scene-safe-guides">
            <div className="scene-lab-safe-zone" />
            <div
              className="scene-lab-focal-pin"
              style={{
                left: composition === 'mobile' ? '52%' : '72%',
                top: composition === 'mobile' ? '20%' : '24%',
              }}
            />
          </div>
        )}
      </div>
      <div className="scene-lab-grid">
        <div className="scene-lab-inspector" data-testid="depth-inspector">
          <h3>Depth &amp; pivot inspector</h3>
          <ul className="scene-lab-plane-list">
            {layers.map((layer, index) => {
              const hidden = Boolean(hiddenIds[layer.id]);
              return (
                <li key={layer.id} data-plane-id={layer.id} data-plane-order={layer.zOrder}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!hidden}
                      onChange={() => toggleLayer(layer.id)}
                    />
                    <span>
                      {layer.id} (z={layer.zOrder} · pivot {layer.pivot?.x ?? 0.5},{layer.pivot?.y ?? 0.5} · px {layer.parallax?.x ?? 0})
                    </span>
                  </label>
                  <div className="scene-lab-plane-actions">
                    <Button size="sm" variant="default" onClick={() => moveLayer(index, -1)} disabled={index === 0}>
                      Back
                    </Button>
                    <Button size="sm" variant="default" onClick={() => moveLayer(index, 1)} disabled={index === layers.length - 1}>
                      Front
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="scene-lab-sprite" data-testid="sprite-player-specimen">
          <h3>Sprite sequence player (crew-01-idle)</h3>
          <SpritePlayer
            clip={IDLE_CLIP}
            playing={spritePlaying}
            reducedMotion={staticMode}
            label="crew-01 idle breathing sprite"
            scale={1}
          />
          <div className="scene-lab-toolbar">
            <Button size="sm" variant="magenta" onClick={() => setSpritePlaying((p) => !p)}>
              {spritePlaying ? 'Pause sprite' : 'Play sprite'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
