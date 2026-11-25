'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  LayeredScene,
  type SceneBreakpointDescriptor,
  type SceneLayerDescriptor,
} from '@moonwitness/ui/components/layered-scene';
import moonCitySceneBundle from '@moonwitness/assets/scenes/moon-city-scene.json';
import { SpritePlayer, type SpriteClipMetadata } from '@moonwitness/ui/components/sprite-player';

const HERO_SCENE = moonCitySceneBundle.scenes.find((scene) => scene.id === 'moon-city-hero');
const MOON_CITY_LAYERS: readonly SceneLayerDescriptor[] = (HERO_SCENE?.layers ?? []).map(
  (layer) => ({
    id: layer.id,
    mediaKind: 'image',
    src: `/${layer.asset}`,
    zOrder: layer.order,
    opacity: layer.opacity,
    pivot: layer.pivot ?? layer.position,
    parallax: layer.parallax,
  })
);

const MOON_CITY_BREAKPOINTS: readonly SceneBreakpointDescriptor[] = (
  HERO_SCENE?.breakpoints ?? []
).map((breakpoint) => ({
  name: breakpoint.name,
  minWidth: breakpoint.minWidth,
  maxWidth: breakpoint.maxWidth,
  layerOverrides: breakpoint.layerOverrides?.map((override) => ({
    layerId: override.layerId,
    opacity: override.opacity,
    pivot: override.position,
    parallax: override.parallax,
  })),
}));

const PILOT_IDLE_CLIP = moonCitySceneBundle.clips.find((clip) => clip.id === 'crew-01-idle');
const PILOT_IDLE_FRAMES = PILOT_IDLE_CLIP?.frames.map((frame) => `/${frame.asset}`) ?? [];
const PILOT_CLIP: SpriteClipMetadata = {
  id: PILOT_IDLE_CLIP?.id ?? 'crew-01-idle',
  frames: PILOT_IDLE_FRAMES,
  durationMs: PILOT_IDLE_CLIP?.frames.reduce((total, frame) => total + frame.durationMs, 0) ?? 2880,
  loop: PILOT_IDLE_CLIP?.loop ?? true,
  pingPong: PILOT_IDLE_CLIP?.direction === 'ping-pong',
  fallbackAsset: PILOT_IDLE_FRAMES[0] ?? '/animation/crew-01-idle/crew-01-idle-frame-01.svg',
  width: 1024,
  height: 1024,
};

const subscribeNoop = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return reduced;
}

export function HomeHeroArt() {
  const [failed, setFailed] = useState(false);
  const mounted = useSyncExternalStore(subscribeNoop, getClientMounted, getServerMounted);
  const reducedMotion = usePrefersReducedMotion();
  const showInteractiveScene =
    mounted && !reducedMotion && !failed && MOON_CITY_LAYERS.length > 0;

  return (
    <div className="home-hero-art" aria-hidden="true">
      {failed ? (
        <div className="home-hero-fallback" data-testid="home-hero-fallback" />
      ) : (
        <>
          <picture>
            <source media="(max-width: 600px)" srcSet="/illustrations/home-hero-mobile.webp" />
            <img
              className="home-hero-art-image"
              src="/illustrations/home-hero-desktop.webp"
              alt=""
              fetchPriority="high"
              onError={(event) => {
                if (event.currentTarget.naturalWidth === 0) setFailed(true);
              }}
            />
          </picture>
          {showInteractiveScene ? (
            <LayeredScene
              sceneId="moon-city-hero"
              label="Moon City night rooftop parallax scene"
              layers={MOON_CITY_LAYERS}
              breakpoints={MOON_CITY_BREAKPOINTS}
              staticFallback={`/${HERO_SCENE?.staticFallback ?? 'illustrations/home-hero-desktop.webp'}`}
              accessibilityFallback={`/${HERO_SCENE?.accessibilityFallback ?? 'illustrations/home-hero-mobile.webp'}`}
              autoPlay
              enablePointerParallax
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                aspectRatio: 'auto',
              }}
            />
          ) : null}
          <div className="home-hero-crew" data-testid="home-hero-crew" aria-hidden="true">
            <SpritePlayer
              clip={PILOT_CLIP}
              label="Anonymous Moon City pilot example"
              playing={!reducedMotion}
              reducedMotion={reducedMotion}
              frameStyle={{ filter: 'var(--home-crew-key)' }}
            />
          </div>
        </>
      )}
    </div>
  );
}
