'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  LayeredScene,
  type SceneBreakpointDescriptor,
  type SceneLayerDescriptor,
} from '@moonwitness/ui/components/layered-scene';

const MOON_CITY_LAYERS: readonly SceneLayerDescriptor[] = [
  {
    id: 'sky',
    mediaKind: 'image',
    src: '/environments/moon-city-sky.svg',
    zOrder: 0,
    opacity: 1,
    pivot: { x: 0.5, y: 0.5 },
    parallax: { x: 0, y: 0 },
  },
  {
    id: 'moon',
    mediaKind: 'image',
    src: '/environments/moon-city-moon.svg',
    zOrder: 10,
    opacity: 1,
    pivot: { x: 0.72, y: 0.24 },
    parallax: { x: 0.04, y: 0.03 },
  },
  {
    id: 'clouds-far',
    mediaKind: 'image',
    src: '/environments/moon-city-clouds-far.svg',
    zOrder: 20,
    opacity: 0.85,
    pivot: { x: 0.5, y: 0.28 },
    parallax: { x: 0.08, y: 0.04 },
  },
  {
    id: 'skyline-far',
    mediaKind: 'image',
    src: '/environments/moon-city-skyline-far.svg',
    zOrder: 30,
    opacity: 1,
    pivot: { x: 0.5, y: 0.75 },
    parallax: { x: 0.14, y: 0.06 },
  },
  {
    id: 'clouds-near',
    mediaKind: 'image',
    src: '/environments/moon-city-clouds-near.svg',
    zOrder: 40,
    opacity: 0.9,
    pivot: { x: 0.5, y: 0.34 },
    parallax: { x: 0.22, y: 0.08 },
  },
  {
    id: 'skyline-mid',
    mediaKind: 'image',
    src: '/environments/moon-city-skyline-mid.svg',
    zOrder: 50,
    opacity: 1,
    pivot: { x: 0.5, y: 0.8 },
    parallax: { x: 0.32, y: 0.12 },
  },
  {
    id: 'rooftop-foreground',
    mediaKind: 'image',
    src: '/environments/moon-city-foreground.svg',
    zOrder: 70,
    opacity: 1,
    pivot: { x: 0.5, y: 0.92 },
    parallax: { x: 0.55, y: 0.18 },
  },
  {
    id: 'prop-railing',
    mediaKind: 'image',
    src: '/environments/moon-city-prop-railing.svg',
    zOrder: 80,
    opacity: 1,
    pivot: { x: 0.5, y: 0.95 },
    parallax: { x: 0.65, y: 0.22 },
  },
  {
    id: 'prop-wires',
    mediaKind: 'image',
    src: '/environments/moon-city-prop-wires.svg',
    zOrder: 85,
    opacity: 0.92,
    pivot: { x: 0.5, y: 0.12 },
    parallax: { x: 0.72, y: 0.24 },
  },
];

const MOON_CITY_BREAKPOINTS: readonly SceneBreakpointDescriptor[] = [
  {
    name: 'mobile',
    minWidth: 0,
    maxWidth: 767,
    layerOverrides: [
      {
        layerId: 'moon',
        pivot: { x: 0.52, y: 0.2 },
        parallax: { x: 0.02, y: 0.02 },
      },
      {
        layerId: 'prop-wires',
        opacity: 0.45,
        parallax: { x: 0.18, y: 0.08 },
      },
    ],
  },
  {
    name: 'desktop',
    minWidth: 768,
  },
];

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
  const showInteractiveScene = mounted && !reducedMotion && !failed;

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
              onError={() => setFailed(true)}
            />
          </picture>
          {showInteractiveScene ? (
            <LayeredScene
              sceneId="moon-city-hero"
              label="Moon City night rooftop parallax scene"
              layers={MOON_CITY_LAYERS}
              breakpoints={MOON_CITY_BREAKPOINTS}
              staticFallback="/illustrations/home-hero-desktop.webp"
              accessibilityFallback="/illustrations/home-hero-mobile.webp"
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
        </>
      )}
    </div>
  );
}
