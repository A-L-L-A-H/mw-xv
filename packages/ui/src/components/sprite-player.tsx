import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createSpriteSequenceAdapter } from '../lib/character-adapter.js';
import { cn } from '../lib/cn.js';
import {
  createScenePlaybackController,
  type ScenePlaybackController,
  type ScenePlaybackSnapshot,
} from '../lib/scene-playback.js';
import { getActiveSceneHarness } from '../lib/scene-test-harness.js';

export interface SpriteClipMetadata {
  readonly id: string;
  readonly frames: readonly string[];
  readonly fps?: number;
  readonly durationMs?: number;
  readonly loop?: boolean;
  readonly pingPong?: boolean;
  readonly fallbackAsset: string;
  readonly width: number;
  readonly height: number;
}

export interface SpritePlayerProps {
  readonly clip: SpriteClipMetadata;
  readonly label?: string;
  readonly scale?: number;
  readonly playing?: boolean;
  readonly paused?: boolean;
  readonly pinnedFrame?: number;
  readonly reducedMotion?: boolean;
  readonly pauseOffscreen?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onFrameChange?: (frameIndex: number) => void;
}

const DEFAULT_SPRITE_FPS = 12;
const spriteAdapter = createSpriteSequenceAdapter();

function resolveClipCycleDurationMs(
  clip: Pick<SpriteClipMetadata, 'frames' | 'fps' | 'durationMs' | 'pingPong'>
): number {
  const count = clip.frames.length;
  if (count === 0) return 0;
  const fps =
    typeof clip.fps === 'number' && Number.isFinite(clip.fps) && clip.fps > 0
      ? clip.fps
      : DEFAULT_SPRITE_FPS;
  const baseDurationMs =
    typeof clip.durationMs === 'number' && Number.isFinite(clip.durationMs) && clip.durationMs > 0
      ? clip.durationMs
      : (count / fps) * 1000;

  if (clip.pingPong && count >= 2) {
    const frameDurationMs = baseDurationMs / count;
    return frameDurationMs * (2 * (count - 1));
  }
  return baseDurationMs;
}

export function computeSpriteFrameIndex(
  clip: Pick<SpriteClipMetadata, 'frames' | 'fps' | 'durationMs' | 'loop' | 'pingPong'>,
  timeMs: number,
  options?: {
    readonly reducedMotion?: boolean;
    readonly pinnedFrame?: number;
  }
): number {
  const resolved = spriteAdapter.resolveFrame(
    {
      id: 'sprite-clip',
      format: 'sprite-sequence',
      frames: clip.frames,
      fps: clip.fps,
      durationMs: clip.durationMs,
      loop: clip.loop,
      pingPong: clip.pingPong,
      fallbackAsset: clip.frames[0] ?? '',
    },
    timeMs,
    {
      reducedMotion: options?.reducedMotion,
      pinnedFrame: options?.pinnedFrame,
    }
  );
  return resolved.frameIndex;
}

export function SpritePlayer({
  clip,
  label,
  scale = 1,
  playing = true,
  paused = false,
  pinnedFrame,
  reducedMotion,
  pauseOffscreen = true,
  className,
  style,
  onFrameChange,
}: SpritePlayerProps) {
  const harness = getActiveSceneHarness();
  const effectiveReducedMotion = Boolean(reducedMotion ?? harness?.reducedMotion ?? false);
  const effectivePinnedFrame = pinnedFrame ?? harness?.fixedFrame;
  const effectivePaused = Boolean(paused || harness?.paused === true);
  const fixedTimeMs = harness?.fixedTimeMs;
  const shouldPlay =
    !effectiveReducedMotion &&
    effectivePinnedFrame === undefined &&
    fixedTimeMs === undefined &&
    playing &&
    !effectivePaused &&
    clip.frames.length > 1;

  const clipSignature = useMemo(
    () =>
      [
        clip.id,
        clip.fallbackAsset,
        String(clip.fps ?? ''),
        String(clip.durationMs ?? ''),
        String(clip.loop ?? ''),
        String(clip.pingPong ?? ''),
        clip.frames.join('|'),
      ].join('::'),
    [clip.id, clip.fallbackAsset, clip.fps, clip.durationMs, clip.loop, clip.pingPong, clip.frames]
  );

  const cycleDurationMs = useMemo(() => resolveClipCycleDurationMs(clip), [clip]);

  const [snapshot, setSnapshot] = useState<ScenePlaybackSnapshot>(() => ({
    timeMs: fixedTimeMs ?? 0,
    durationMs: cycleDurationMs > 0 ? cycleDurationMs : null,
    progress: 0,
    requestedPlaying: shouldPlay,
    effectiveState: effectiveReducedMotion ? 'static' : shouldPlay ? 'playing' : 'paused',
    reducedMotion: effectiveReducedMotion,
    visible: true,
    documentHidden: false,
    disposed: false,
    activeHandleCount: 0,
  }));

  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const controllerRef = useRef<ScenePlaybackController | null>(null);
  const lastReportedFrameRef = useRef<number | null>(null);

  const containerRef = useCallback((element: HTMLDivElement | null) => {
    setContainerElement(element);
  }, []);

  useEffect(() => {
    const controller = createScenePlaybackController({
      durationMs: cycleDurationMs > 0 ? cycleDurationMs : undefined,
      loop: clip.loop !== false || Boolean(clip.pingPong),
      initialTimeMs: fixedTimeMs ?? 0,
      autoPlay: shouldPlay,
      reducedMotion: effectiveReducedMotion,
      pauseOffscreen,
    });
    controllerRef.current = controller;
    setSnapshot(controller.getSnapshot());

    const unsubscribe = controller.subscribe(setSnapshot);
    const detachObservers = controller.attachObservers(containerElement);

    return () => {
      unsubscribe();
      detachObservers();
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [
    clipSignature,
    clip.loop,
    clip.pingPong,
    cycleDurationMs,
    pauseOffscreen,
    containerElement,
    fixedTimeMs,
    effectiveReducedMotion,
    shouldPlay,
  ]);

  const effectiveTimeMs = fixedTimeMs ?? snapshot.timeMs;
  const isReduced = effectiveReducedMotion || snapshot.reducedMotion;

  const resolved = spriteAdapter.resolveFrame(
    {
      id: clip.id,
      format: 'sprite-sequence',
      frames: clip.frames,
      fps: clip.fps,
      durationMs: clip.durationMs,
      loop: clip.loop,
      pingPong: clip.pingPong,
      fallbackAsset: clip.fallbackAsset,
    },
    effectiveTimeMs,
    {
      reducedMotion: isReduced,
      pinnedFrame: effectivePinnedFrame,
    }
  );

  useEffect(() => {
    if (lastReportedFrameRef.current !== resolved.frameIndex) {
      lastReportedFrameRef.current = resolved.frameIndex;
      onFrameChange?.(resolved.frameIndex);
    }
  }, [resolved.frameIndex, onFrameChange]);

  const spriteState =
    isReduced || clip.frames.length === 0
      ? 'static'
      : effectivePinnedFrame !== undefined
        ? 'pinned'
        : resolved.completed
          ? 'completed'
          : shouldPlay && snapshot.effectiveState === 'playing'
            ? 'playing'
            : 'paused';

  const effectiveScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const scaledWidth = Math.max(1, Math.round(clip.width * effectiveScale));
  const scaledHeight = Math.max(1, Math.round(clip.height * effectiveScale));

  return (
    <div
      ref={containerRef}
      className={cn('mw-ui-sprite-player', className)}
      data-sprite-clip={clip.id}
      data-sprite-frame={String(resolved.frameIndex)}
      data-sprite-state={spriteState}
      style={{
        display: 'inline-block',
        width: `min(100%, ${scaledWidth}px)`,
        maxWidth: '100%',
        aspectRatio: `${scaledWidth} / ${scaledHeight}`,
        ...style,
      }}
    >
      <img
        className="mw-ui-sprite-player-frame"
        src={resolved.asset}
        alt={label ?? `${clip.id} sprite frame`}
        width={scaledWidth}
        height={scaledHeight}
        decoding="async"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />
    </div>
  );
}
