import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
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
import manifestUrl from '@moonwitness/assets/manifest.json?url';
import licensesUrl from '@moonwitness/assets/licenses.json?url';
import {
  buildProvenanceIndex,
  resolveAssetReviewStatuses,
  type AssetProvenanceEntry,
  type AssetReviewStatus,
} from './asset-review-status';
import { resolveSceneLayerSources } from './scene-layer-sources';
import { SceneLabSpecimens } from './SceneLabSpecimens';
const SceneLabSpecimensLazy = lazy(() => import('./SceneLabSpecimens').then((mod) => ({ default: mod.SceneLabSpecimens })));
import idleFrame1 from '@moonwitness/assets/animation/crew-01-idle/crew-01-idle-frame-01.svg';
import idleFrame2 from '@moonwitness/assets/animation/crew-01-idle/crew-01-idle-frame-02.svg';

const HERO_SCENE = moonCitySceneBundle.scenes.find((entry) => entry.id === 'moon-city-hero')!;
const SCENE_LAYER_SOURCES = {
  sky: skyUrl,
  moon: moonUrl,
  'clouds-far': cloudsFarUrl,
  'skyline-far': skylineFarUrl,
  'clouds-near': cloudsNearUrl,
  'skyline-mid': skylineMidUrl,
  'rooftop-foreground': foregroundUrl,
  'prop-railing': railingUrl,
  'prop-wires': wiresUrl,
} satisfies Record<string, string>;

const CREW_ACTOR = (() => {
  const actor = HERO_SCENE.actors.find((entry) => entry.id === 'crew-01');
  if (!actor) throw new Error('Moon City hero scene is missing its crew-01 actor descriptor.');
  return actor;
})();

const INITIAL_LAYERS: readonly SceneLayerDescriptor[] = resolveSceneLayerSources(
  HERO_SCENE.layers,
  SCENE_LAYER_SOURCES
).map((layer) => ({
  id: layer.id,
  src: layer.src,
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

/**
 * The in-scene crew plane reuses the canonical idle clip but keeps its own DOM hook so the
 * standalone sprite specimen (data-sprite-clip="crew-01-idle") stays independently testable.
 * The plane itself is exposed as [data-layer-id="crew-01"] with a z-order between the rooftop
 * (70) / railing (80) and the foreground wires (85).
 */
const SCENE_CREW_CLIP: SpriteClipMetadata = { ...IDLE_CLIP, id: 'crew-01-idle-scene' };

export function SceneLab() {
  const harness = getActiveSceneHarness() ?? {};
  const [provenanceData, setProvenanceData] = useState<{
    provenanceByPath: Map<string, AssetProvenanceEntry>;
    assetStatuses: Map<string, AssetReviewStatus>;
  } | null>(null);
  const [layers, setLayers] = useState<SceneLayerDescriptor[]>([...INITIAL_LAYERS]);
  const [hiddenIds, setHiddenIds] = useState<Record<string, boolean>>({});
  const [composition, setComposition] = useState<'desktop' | 'mobile'>('desktop');
  const [showGuides, setShowGuides] = useState(true);
  const [staticMode, setStaticMode] = useState(Boolean(harness.reducedMotion));
  const [prefersReducedMotion] = useState(() =>
    Boolean(
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    )
  );
  const [spritePlaying, setSpritePlaying] = useState(!harness.paused && !harness.reducedMotion);
  const [timelineStatus, setTimelineStatus] = useState<TimelineStatus>('idle');
  const [timelineTimeMs, setTimelineTimeMs] = useState(harness.fixedTimeMs ?? 0);
  const timelineRef = useRef<ReturnType<typeof createSceneTimeline> | null>(null);

  // Provenance metadata (manifest.json + licenses.json, ~220 KB combined) loads after first
  // render via URL imports so it never lands in the JavaScript bundle graph.
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(manifestUrl).then((response) => {
        if (!response.ok) throw new Error('The canonical asset manifest could not be loaded.');
        return response.json() as Promise<{ assets: { path: string; status?: string }[] }>;
      }),
      fetch(licensesUrl).then((response) => {
        if (!response.ok) throw new Error('Asset provenance could not be loaded.');
        return response.json() as Promise<{ sourceAssets?: AssetProvenanceEntry[] }>;
      }),
    ])
      .then(([manifest, provenance]) => {
        if (!active) return;
        setProvenanceData({
          provenanceByPath: buildProvenanceIndex(provenance.sourceAssets ?? []),
          assetStatuses: resolveAssetReviewStatuses(
            manifest.assets,
            buildProvenanceIndex(provenance.sourceAssets ?? [])
          ),
        });
      })
      .catch(() => {
        if (active) setProvenanceData({ provenanceByPath: new Map(), assetStatuses: new Map() });
      });
    return () => {
      active = false;
    };
  }, []);

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
          data-z-order={String(CREW_ACTOR.order)}
          style={{ zIndex: CREW_ACTOR.order }}
        >
          <SpritePlayer
            clip={SCENE_CREW_CLIP}
            label="crew-01 idle in Moon City"
            playing={spritePlaying}
            reducedMotion={crewReducedMotion}
            frameStyle={{ filter: 'var(--scene-crew-filter)' }}
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
          <h3>Depth & pivot inspector</h3>
          <ul className="scene-lab-plane-list">
            {layers.map((layer, index) => {
              const hidden = Boolean(hiddenIds[layer.id]);
              const canonical = HERO_SCENE.layers.find((entry) => entry.id === layer.id);
              const provenance = canonical
                ? provenanceData?.provenanceByPath.get(canonical.asset)
                : undefined;
              const reviewStatus = canonical
                ? provenanceData?.assetStatuses.get(canonical.asset) ?? 'unverified'
                : 'unverified';
              return (
                <li key={layer.id} data-plane-id={layer.id} data-plane-order={layer.zOrder}>
                  <label>
                    <Checkbox checked={!hidden} onChange={() => toggleLayer(layer.id)} />
                    <span>
                      {layer.id} (z={layer.zOrder} · pivot {layer.pivot?.x ?? 0.5},
                      {layer.pivot?.y ?? 0.5} · px {layer.parallax?.x ?? 0}) · {reviewStatus}
                    </span>
                  </label>
                  <small data-testid={`plane-provenance-${layer.id}`}>
                    {canonical?.asset ?? 'Unmapped asset'} · {provenance?.license ?? 'provenance unavailable'}
                    {provenance?.distribution ? ` · ${provenance.distribution}` : ''}
                  </small>
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
      <Suspense fallback={<div data-testid="scene-lab-specimens-loading" aria-busy="true" />}>
        <SceneLabSpecimensLazy />
      </Suspense>
    </div>
  );
}