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
import {
  loadMoonCitySceneData,
  type MoonCityClipDescriptor,
  type MoonCitySceneDescriptor,
} from './moon-city-scene-data';
import type { AssetProvenanceEntry, AssetReviewStatus } from './asset-review-status';
import { resolveSceneLayerSources } from './scene-layer-sources';
import idleFrame1 from '@moonwitness/assets/animation/crew-01-idle/crew-01-idle-frame-01.svg';
import idleFrame2 from '@moonwitness/assets/animation/crew-01-idle/crew-01-idle-frame-02.svg';
import signalSpecimenArt from '@moonwitness/assets/illustrations/editorial-signal.webp';
import archiveSpecimenArt from '@moonwitness/assets/illustrations/editorial-archive.webp';

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

const IDLE_FRAMES = [idleFrame1, idleFrame2];

function buildInitialLayers(scene: MoonCitySceneDescriptor): SceneLayerDescriptor[] {
  return resolveSceneLayerSources(scene.layers, SCENE_LAYER_SOURCES).map((layer) => ({
    id: layer.id,
    src: layer.src,
    mediaKind: 'vector',
    zOrder: layer.order,
    opacity: layer.opacity,
    pivot: layer.pivot ?? layer.position,
    parallax: layer.parallax,
    alt: `Moon City ${layer.id.replaceAll('-', ' ')}`,
  }));
}

function buildBreakpoints(scene: MoonCitySceneDescriptor): readonly SceneBreakpointDescriptor[] {
  return scene.breakpoints.map((breakpoint) => ({
    name: breakpoint.name,
    minWidth: breakpoint.minWidth ?? 0,
    maxWidth: breakpoint.maxWidth ?? Number.MAX_SAFE_INTEGER,
    layerOverrides: breakpoint.layerOverrides?.map((override) => ({
      layerId: override.layerId,
      opacity: override.opacity,
      pivot: override.position,
      parallax: override.parallax,
    })),
  }));
}

function buildIdleClip(clipDef: MoonCityClipDescriptor): SpriteClipMetadata {
  return {
    id: clipDef.id,
    // Frame count/timing come from the canonical clip; only two stills are shipped to keep the
    // lazy scene chunk under budget.
    frames: clipDef.frames.map((_, index) => IDLE_FRAMES[Math.min(index, 1)]),
    durationMs: clipDef.frames.reduce((total, frame) => total + frame.durationMs, 0),
    loop: clipDef.loop,
    pingPong: clipDef.direction === 'ping-pong',
    fallbackAsset: idleFrame1,
    width: 160,
    height: 160,
  };
}

export function SceneLab() {
  const harness = getActiveSceneHarness() ?? {};
  const [sceneData, setSceneData] = useState<{
    scene: MoonCitySceneDescriptor;
    breakpoints: readonly SceneBreakpointDescriptor[];
    crewOrder: number;
    idleClip: SpriteClipMetadata;
    sceneCrewClip: SpriteClipMetadata;
    initialLayers: SceneLayerDescriptor[];
    provenanceByPath: Map<string, AssetProvenanceEntry>;
    assetStatuses: Map<string, AssetReviewStatus>;
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [layers, setLayers] = useState<SceneLayerDescriptor[]>([]);
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

  useEffect(() => {
    let active = true;
    loadMoonCitySceneData()
      .then((loaded) => {
        if (!active) return;
        const crewActor = loaded.scene.actors.find((entry) => entry.id === 'crew-01');
        if (!crewActor) {
          throw new Error('Moon City hero scene is missing its crew-01 actor descriptor.');
        }
        const initialLayers = buildInitialLayers(loaded.scene);
        const idleClip = buildIdleClip(loaded.clip);
        /**
         * The in-scene crew plane reuses the canonical idle clip but keeps its own DOM hook so the
         * standalone sprite specimen (data-sprite-clip="crew-01-idle") stays independently testable.
         * The plane itself is exposed as [data-layer-id="crew-01"] with a z-order between the rooftop
         * (70) / railing (80) and the foreground wires (85).
         */
        const sceneCrewClip: SpriteClipMetadata = { ...idleClip, id: 'crew-01-idle-scene' };
        setSceneData({
          scene: loaded.scene,
          breakpoints: buildBreakpoints(loaded.scene),
          crewOrder: crewActor.order,
          idleClip,
          sceneCrewClip,
          initialLayers,
          provenanceByPath: loaded.provenanceIndex,
          assetStatuses: loaded.assetStatuses,
        });
        setLayers(initialLayers);
      })
      .catch(() => {
        if (active) setLoadError(true);
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

  if (loadError) {
    return (
      <div className="scene-lab" data-testid="scene-lab">
        <p role="alert">Failed to load Moon City scene bundle.</p>
      </div>
    );
  }

  if (!sceneData) {
    return (
      <div className="scene-lab" data-testid="scene-lab-loading" aria-busy="true">
        <p>Loading Moon City scene…</p>
      </div>
    );
  }

  return (
    <div className="scene-lab" data-testid="scene-lab">
      <div className="scene-lab-toolbar">
        <Button
          variant="default"
          onClick={() => {
            setLayers([...sceneData.initialLayers]);
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
          sceneId={sceneData.scene.id}
          label="Moon City layered environment preview"
          layers={displayedLayers}
          breakpoints={sceneData.breakpoints}
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
          data-z-order={String(sceneData.crewOrder)}
          style={{ zIndex: sceneData.crewOrder }}
        >
          <SpritePlayer
            clip={sceneData.sceneCrewClip}
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
          <h3>Depth &amp; pivot inspector</h3>
          <ul className="scene-lab-plane-list">
            {layers.map((layer, index) => {
              const hidden = Boolean(hiddenIds[layer.id]);
              const canonical = sceneData.scene.layers.find((entry) => entry.id === layer.id);
              const provenance = canonical?.asset
                ? sceneData.provenanceByPath.get(canonical.asset)
                : undefined;
              const reviewStatus = canonical?.asset
                ? sceneData.assetStatuses.get(canonical.asset) ?? 'unverified'
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
            clip={sceneData.idleClip}
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
      <section
        className="scene-lab-selected-scenes"
        aria-label="Signals and Archive catalog specimens"
        data-testid="signals-archive-specimens"
      >
        <header>
          <span>ROUTE GAP · CATALOG ONLY</span>
          <h3>Signals &amp; Archive scene directions</h3>
          <p>
            Visual concepts for future routes. These specimens contain no production records,
            metrics, or live data.
          </p>
        </header>
        <div className="scene-lab-selected-scenes-grid">
          <article data-testid="signals-scene-specimen">
            <img src={signalSpecimenArt} alt="Abstract editorial signal artwork" loading="lazy" />
            <div>
              <span>01 / SIGNALS</span>
              <h4>Signal in the city</h4>
              <p>Editorial atmosphere only · no route or live signal feed</p>
            </div>
          </article>
          <article data-testid="archive-scene-specimen">
            <img src={archiveSpecimenArt} alt="Abstract editorial archive artwork" loading="lazy" />
            <div>
              <span>02 / ARCHIVE</span>
              <h4>Quiet stacks</h4>
              <p>Editorial atmosphere only · no route or archive records</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
