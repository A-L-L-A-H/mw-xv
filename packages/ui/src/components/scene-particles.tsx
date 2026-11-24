'use client';

import { useMemo, type CSSProperties } from 'react';
import { cn } from '../lib/cn.js';
import { useAnimationVisibility } from '../lib/use-animation-visibility.js';
import { useReducedMotion } from '../lib/use-reduced-motion.js';

export type SceneParticlePreset = 'rain' | 'dust' | 'stars' | 'sparks';
export type SceneParticleIntensity = 'subtle' | 'medium' | 'intense';

export const MAX_SCENE_PARTICLES = 36;

const PRESET_DEFAULT_COUNT: Record<SceneParticlePreset, number> = {
  rain: 24,
  dust: 16,
  stars: 20,
  sparks: 18,
};

const INTENSITY_FACTOR: Record<SceneParticleIntensity, number> = {
  subtle: 0.5,
  medium: 1,
  intense: 1.5,
};

export interface SceneParticleDatum {
  readonly id: number;
  readonly xPct: number;
  readonly yPct: number;
  readonly sizePx: number;
  readonly durationMs: number;
  readonly delayMs: number;
  readonly opacity: number;
}

function mulberry32(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function particleShape(preset: SceneParticlePreset) {
  if (preset === 'rain') return { borderRadius: '1px', heightScale: 10, widthScale: 0.55 };
  if (preset === 'sparks') return { borderRadius: '1px', heightScale: 1.8, widthScale: 0.55 };
  if (preset === 'stars') return { borderRadius: '1px', heightScale: 1, widthScale: 1 };
  return { borderRadius: '999px', heightScale: 1, widthScale: 1 };
}

export function generateSceneParticles(
  preset: SceneParticlePreset,
  options: { count?: number; intensity?: SceneParticleIntensity; seed?: number } = {}
): readonly SceneParticleDatum[] {
  const base = options.count ?? PRESET_DEFAULT_COUNT[preset];
  const factor = INTENSITY_FACTOR[options.intensity ?? 'medium'];
  const bounded = Math.max(0, Math.min(MAX_SCENE_PARTICLES, Math.round(base * factor)));
  const rand = mulberry32(options.seed ?? preset.length * 97 + 13);
  const items: SceneParticleDatum[] = [];
  for (let index = 0; index < bounded; index += 1) {
    items.push({
      id: index,
      xPct: Number((rand() * 100).toFixed(2)),
      yPct: Number((rand() * 100).toFixed(2)),
      sizePx:
        preset === 'rain'
          ? Number((1 + rand() * 1.5).toFixed(2))
          : Number((2 + rand() * 3).toFixed(2)),
      durationMs: Math.round(1400 + rand() * 1800),
      delayMs: Math.round(rand() * 1200),
      opacity: Number((0.28 + rand() * 0.55).toFixed(2)),
    });
  }
  return items;
}

export interface SceneParticlesProps {
  readonly preset: SceneParticlePreset;
  readonly intensity?: SceneParticleIntensity;
  readonly count?: number;
  readonly seed?: number;
  readonly paused?: boolean;
  readonly reducedMotion?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function SceneParticles({
  preset,
  intensity = 'medium',
  count,
  seed,
  paused = false,
  reducedMotion,
  className,
  style,
}: SceneParticlesProps) {
  const motion = useAnimationVisibility<HTMLDivElement>();
  const effectiveReducedMotion = useReducedMotion(reducedMotion);
  const particles = useMemo(
    () => generateSceneParticles(preset, { count, intensity, seed }),
    [preset, count, intensity, seed]
  );
  const staticMode = effectiveReducedMotion || paused;
  const shape = particleShape(preset);

  return (
    <div
      ref={motion.ref}
      aria-hidden="true"
      className={cn(
        'mw-ui-scene-particles',
        staticMode ? 'mw-ui-motion-paused' : motion.visibilityClass,
        className
      )}
      data-particle-preset={preset}
      data-particle-intensity={intensity}
      data-particle-count={particles.length}
      data-particle-state={staticMode ? 'static' : 'active'}
      data-reduced-motion={effectiveReducedMotion ? 'true' : 'false'}
      style={{
        position: 'relative',
        overflow: 'hidden',
        pointerEvents: 'none',
        contain: 'layout style paint',
        ...style,
      }}
    >
      {particles.map((particle) => (
        <span
          key={particle.id}
          className="mw-ui-scene-particle"
          data-particle-id={particle.id}
          style={{
            position: 'absolute',
            left: `${particle.xPct}%`,
            top: `${particle.yPct}%`,
            width: `${particle.sizePx * shape.widthScale}px`,
            height: `${particle.sizePx * shape.heightScale}px`,
            borderRadius: shape.borderRadius,
            opacity: particle.opacity,
            background:
              preset === 'sparks'
                ? 'var(--mw-yellow)'
                : preset === 'rain'
                  ? 'var(--mw-cyan)'
                  : 'var(--mw-paper)',
            transform: staticMode ? 'none' : 'translate3d(0, 0, 0)',
            animationDuration: staticMode ? '0ms' : `${particle.durationMs}ms`,
            animationDelay: staticMode ? '0ms' : `${particle.delayMs}ms`,
          }}
        />
      ))}
    </div>
  );
}
