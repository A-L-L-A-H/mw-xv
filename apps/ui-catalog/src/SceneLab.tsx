import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { Checkbox } from '@moonwitness/ui/components/checkbox';
import {
  LayeredScene,
  type SceneLayerDescriptor,
  type SceneBreakpointDescriptor,
} from '@moonwitness/ui/components/layered-scene';
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
import fallbackHeroDesktop from '@moonwitness/assets/illustrations/home-hero-desktop.webp';
import fallbackHeroMobile from '@moonwitness/assets/illustrations/home-hero-mobile.webp';
import moonCitySceneBundle from '@moonwitness/assets/scenes/moon-city-scene.json';
import idleFrame1 from '@moonwitness/assets/animation/crew-01-idle/crew-01-idle-frame-01.svg';
import idleFrame2 from '@moonwitness/assets/animation/crew-01-idle/crew-01-idle-frame-02.svg';

const HERO_SCENE = moonCitySceneBundle.scenes.find((entry) => entry.id === 'moon-city-hero')!;
const SCENE_LAYER_SOURCES = [
  skyUrl,
  moonUrl,
  cloudsFarUrl,
  skylineFarUrl,
  cloudsNearUrl,
  skylineMidUrl,
  foregroundUrl,
  railingUrl,
  wiresUrl,
];

const INITIAL_LAYERS: readonly SceneLayerDescriptor[] = HERO_SCENE.layers.map((layer, index) => ({
  id: layer.id,
  src: SCENE_LAYER_SOURCES[index],
  mediaKind: 'vector',
  zOrder: layer.order,
  opacity: layer.opacity,
  pivot: layer.pivot ?? layer.position,
  parallax: layer.parallax,
  alt: `Moon City ${layer.id.replaceAll('-', ' ')}`,
}));

const SCENE_BREAKPOINTS: readonly SceneBreakpointDescriptor[] = HERO_SCENE.breakpoints.map(
  (breakpoint) => ({
    name: breakpoint.name,
    minWidth: breakpoint.minWidth,
    maxWidth: breakpoint.maxWidth,
    layerOverrides: breakpoint.layerOverrides?.map((override) => ({
      layerId: override.layerId,
      opacity: override.opacity,
      pivot: override.position,
      parallax: override.parallax,
    })),
  })
);

const IDLE_CLIP_DEFINITION = moonCitySceneBundle.clips.find((clip) => clip.id === 'crew-01-idle')!;
const IDLE_FRAMES = [idleFrame1, idleFrame2];

const IDLE_CLIP: SpriteClipMetadata = {
  id: IDLE_CLIP_DEFINITION.id,
  // Frame count/timing come from the canonical clip; only two stills are shipped to keep the
  // lazy scene chunk under budget.
  frames: IDLE_CLIP_DEFINITION.frames.map((_, index) => IDLE_FRAMES[Math.min(index, 1)]),
  durationMs: IDLE_CLIP_DEFINITION.frames.reduce((total, frame) => total + frame.durationMs, 0),
  loop: IDLE_CLIP_DEFINITION.loop,
  pingPong: IDLE_CLIP_DEFINITION.direction === 'ping-pong',
  fallbackAsset: idleFrame1,
  width: 160,
  height: 160,
};

const CREW_SPRITE_FILTER = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='k' color-interpolation-filters='sRGB'%3E%3CfeColorMatrix type='matrix' values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 -3 -3 -3 8.35 0'/%3E%3C/filter%3E%3C/svg%3E#k")`;

/**
 * The in-scene crew plane reuses the canonical idle clip but keeps its own DOM hook so the
 * standalone sprite specimen (data-sprite-clip="crew-01-idle") stays independently testable.
 * The plane itself is exposed as [data-layer-id="crew-01"] with a z-order between the rooftop
 * (70) / railing (80) and the foreground wires (85).
 */
const SCENE_CREW_CLIP: SpriteClipMetadata = { ...IDLE_CLIP, id: 'crew-01-idle-scene' };
const CREW_PLANE_Z_ORDER = 82;

export function SceneLab() {
  const harness = getActiveSceneHarness() ?? {};
  const [layers, setLayers] = useState<SceneLayerDescriptor[]>([...INITIAL_LAYERS]);
  const [hiddenIds, setHiddenIds] = useState<Record<string, boolean>>({});
  const [composition, setComposition] = useState<'desktop' | 'mobile'>('desktop');
  const [showGuides, setShowGuides] = useState(true);
  const [staticMode, setStaticMode] = useState(Boolean(harness.reducedMotion));
  const [prefersReducedMotion] = useState(() =>
    Boolean(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  );
  const [spritePlaying, setSpritePlaying] = useState(!harness.paused && !harness.reducedMotion);
  const [timelineStatus, setTimelineStatus] = useState<TimelineStatus>('idle');
  const [timelineTimeMs, setTimelineTimeMs] = useState(harness.fixedTimeMs ?? 0);
  const timelineRef = useRef<ReturnType<typeof createSceneTimeline> | null>(null);

  useEffect(() => {
    const timeline = createSceneTimeline({
      totalDurationMs: 1800,
      tracks: [
        {
          id: 'sky-entrance',
          startMs: 0,
          durationMs: 600,
          kind: 'entrance',
          triggers: ['city-reveal'],
        },
        {
          id: 'city-reveal',
          startMs: 400,
          durationMs: 800,
          kind: 'layer-transition',
          triggers: ['crew-idle'],
        },
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

  const toggleLayer = (id: string) => setHiddenIds((prev) => ({ ...prev, [id]: !prev[id] }));

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
  const displayedLayers = activeLayers;
  const crewReducedMotion = staticMode || prefersReducedMotion || Boolean(harness.reducedMotion);

  return (
    <div className="scene-lab" data-testid="scene-lab">
      <div className="scene-lab-toolbar">
        <Button
          variant="default"
          onClick={() => {
            setLayers([...INITIAL_LAYERS]);
            setHiddenIds({});
            setComposition('desktop');
            setStaticMode(Boolean(harness.reducedMotion));
          }}
        >
          Reset inspector
        </Button>
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
        {/* Narrow harness exception: the shared package has no range primitive. Keep native
            timeline semantics, a visible label, and an explicit accessible value. */}
        <label className="scene-lab-scrubber">
          Timeline position {timelineTimeMs} ms
          <input
            type="range"
            min={0}
            max={1800}
            step={100}
            value={timelineTimeMs}
            onChange={(event) => timelineRef.current?.seek(Number(event.currentTarget.value))}
            aria-label="Timeline position"
            aria-valuetext={`${timelineTimeMs} milliseconds`}
          />
        </label>
      </div>
      <p className="scene-lab-status" data-testid="scene-timeline-status">
        Environment: Moon City · Composition: {composition} ({viewportWidth}px) · Timeline:{' '}
        {timelineStatus} ({timelineTimeMs}ms) · Active planes: {displayedLayers.length}
      </p>
      <div
        className={`scene-lab-stage ${composition === 'mobile' ? 'scene-lab-stage-mobile' : ''}`}
        data-composition={composition}
      >
        <LayeredScene
          sceneId={HERO_SCENE.id}
          label="Moon City layered environment preview"
          layers={displayedLayers}
          breakpoints={SCENE_BREAKPOINTS}
          viewportWidth={viewportWidth}
          staticFallback={fallbackHeroDesktop}
          accessibilityFallback={fallbackHeroMobile}
          forceStatic={staticMode}
          enableKeyboardCamera={!staticMode}
          enablePointerParallax={!staticMode}
          style={{ width: '100%', height: composition === 'mobile' ? 420 : 340 }}
        />
        <div
          className="scene-lab-crew-layer"
          data-layer-id="crew-01"
          data-z-order={String(CREW_PLANE_Z_ORDER)}
          style={{ zIndex: CREW_PLANE_Z_ORDER }}
        >
          <SpritePlayer
            clip={SCENE_CREW_CLIP}
            label="crew-01 idle in Moon City"
            playing={spritePlaying}
            reducedMotion={crewReducedMotion}
            frameStyle={{ filter: CREW_SPRITE_FILTER }}
          />
        </div>
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
                    <Checkbox checked={!hidden} onChange={() => toggleLayer(layer.id)} />
                    <span>
                      {layer.id} (z={layer.zOrder} · pivot {layer.pivot?.x ?? 0.5},
                      {layer.pivot?.y ?? 0.5} · px {layer.parallax?.x ?? 0})
                    </span>
                  </label>
                  <div className="scene-lab-plane-actions">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => moveLayer(index, -1)}
                      disabled={index === 0}
                    >
                      Back
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => moveLayer(index, 1)}
                      disabled={index === layers.length - 1}
                    >
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
