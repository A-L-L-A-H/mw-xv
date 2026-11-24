import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';
import {
  computeLayerParallax,
  createSceneCameraController,
  type CameraBounds,
  type CameraState,
  type ParallaxInput,
  type SceneCameraController,
} from '../lib/scene-camera.js';
import { useScenePlayback } from '../lib/scene-playback.js';
import { getActiveSceneHarness } from '../lib/scene-test-harness.js';
import { useReducedMotion } from '../lib/use-reduced-motion.js';

export type SceneLayerMediaKind = 'image' | 'vector' | 'video-frame';

export interface SceneLayerTransform {
  readonly x?: number;
  readonly y?: number;
  readonly scale?: number;
  readonly rotateDeg?: number;
}

export interface SceneLayerPivot {
  readonly x: number;
  readonly y: number;
}

export interface SceneLayerDescriptor {
  readonly id: string;
  readonly mediaKind: SceneLayerMediaKind;
  readonly src?: string;
  readonly alt?: string;
  readonly svgContent?: ReactNode;
  readonly zOrder: number;
  readonly opacity?: number;
  readonly transform?: SceneLayerTransform;
  readonly blendMode?: CSSProperties['mixBlendMode'];
  readonly clipPath?: string;
  readonly parallax?: ParallaxInput;
  readonly pivot?: SceneLayerPivot;
  readonly hidden?: boolean;
}

export interface SceneLayerOverride {
  readonly layerId: string;
  readonly opacity?: number;
  readonly transform?: SceneLayerTransform;
  readonly blendMode?: CSSProperties['mixBlendMode'];
  readonly clipPath?: string;
  readonly parallax?: ParallaxInput;
  readonly pivot?: SceneLayerPivot;
  readonly hidden?: boolean;
  readonly zOrder?: number;
}

export interface SceneBreakpointDescriptor {
  readonly name: string;
  readonly minWidth: number;
  readonly maxWidth?: number;
  readonly layerOverrides?: readonly SceneLayerOverride[];
}

export interface LayeredSceneProps {
  readonly sceneId: string;
  readonly label: string;
  readonly layers: readonly SceneLayerDescriptor[];
  readonly staticFallback: string;
  readonly accessibilityFallback?: string;
  readonly breakpoints?: readonly SceneBreakpointDescriptor[];
  readonly viewportWidth?: number;
  readonly aspectRatio?: string;
  readonly reducedMotion?: boolean;
  readonly operationalMode?: boolean;
  readonly forceStatic?: boolean;
  readonly autoPlay?: boolean;
  readonly durationMs?: number;
  readonly cameraBounds?: Partial<CameraBounds>;
  readonly enableKeyboardCamera?: boolean;
  readonly enablePointerParallax?: boolean;
  readonly scrollProgress?: number;
  readonly maxParallaxShiftPx?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const DEFAULT_VIEWPORT_WIDTH = 1280;

function clampOpacity(opacity: number | undefined): number {
  if (typeof opacity !== 'number' || !Number.isFinite(opacity)) return 1;
  return Math.min(1, Math.max(0, opacity));
}

function formatPivotOrigin(pivot: SceneLayerPivot | undefined): string {
  if (!pivot) return '50% 50%';
  const normalizedX = Number.isFinite(pivot.x) ? Math.min(1, Math.max(0, pivot.x)) : 0.5;
  const normalizedY = Number.isFinite(pivot.y) ? Math.min(1, Math.max(0, pivot.y)) : 0.5;
  return `${Math.round(normalizedX * 100)}% ${Math.round(normalizedY * 100)}%`;
}

function buildLayerTransformCss(
  transform: SceneLayerTransform | undefined,
  parallaxX: number,
  parallaxY: number
): string | undefined {
  const parts: string[] = [];
  const offsetX = (transform?.x ?? 0) + parallaxX;
  const offsetY = (transform?.y ?? 0) + parallaxY;
  if (offsetX !== 0 || offsetY !== 0) {
    parts.push(`translate3d(${offsetX}px, ${offsetY}px, 0)`);
  }
  if (
    typeof transform?.scale === 'number' &&
    Number.isFinite(transform.scale) &&
    transform.scale !== 1
  ) {
    parts.push(`scale(${transform.scale})`);
  }
  if (
    typeof transform?.rotateDeg === 'number' &&
    Number.isFinite(transform.rotateDeg) &&
    transform.rotateDeg !== 0
  ) {
    parts.push(`rotate(${transform.rotateDeg}deg)`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function isValidRenderableLayer(layer: SceneLayerDescriptor): boolean {
  if (!layer || typeof layer.id !== 'string' || layer.id.trim().length === 0) {
    return false;
  }
  if (!Number.isFinite(layer.zOrder)) {
    return false;
  }
  if (layer.mediaKind === 'vector') {
    return Boolean(layer.svgContent || (typeof layer.src === 'string' && layer.src.length > 0));
  }
  return typeof layer.src === 'string' && layer.src.length > 0;
}

export function resolveSceneLayersForWidth(
  layers: readonly SceneLayerDescriptor[],
  breakpoints: readonly SceneBreakpointDescriptor[] | undefined,
  width: number
): readonly SceneLayerDescriptor[] {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : DEFAULT_VIEWPORT_WIDTH;
  const overridesByLayerId = new Map<string, SceneLayerOverride[]>();

  if (Array.isArray(breakpoints)) {
    for (const breakpoint of breakpoints) {
      const matchesMin = safeWidth >= breakpoint.minWidth;
      const matchesMax = breakpoint.maxWidth === undefined || safeWidth <= breakpoint.maxWidth;
      if (!matchesMin || !matchesMax || !breakpoint.layerOverrides) {
        continue;
      }
      for (const override of breakpoint.layerOverrides) {
        const existing = overridesByLayerId.get(override.layerId);
        if (existing) {
          existing.push(override);
        } else {
          overridesByLayerId.set(override.layerId, [override]);
        }
      }
    }
  }

  const resolvedWithIndex = layers
    .map((layer, index) => {
      const overrides = overridesByLayerId.get(layer.id);
      if (!overrides || overrides.length === 0) {
        return { layer, index };
      }
      let merged: SceneLayerDescriptor = layer;
      for (const override of overrides) {
        merged = {
          ...merged,
          opacity: override.opacity ?? merged.opacity,
          blendMode: override.blendMode ?? merged.blendMode,
          clipPath: override.clipPath ?? merged.clipPath,
          parallax: override.parallax ?? merged.parallax,
          pivot: override.pivot ?? merged.pivot,
          hidden: override.hidden ?? merged.hidden,
          zOrder: override.zOrder ?? merged.zOrder,
          transform: override.transform
            ? { ...merged.transform, ...override.transform }
            : merged.transform,
        };
      }
      return { layer: merged, index };
    })
    .filter(({ layer }) => !layer.hidden && isValidRenderableLayer(layer));

  resolvedWithIndex.sort((left, right) => {
    if (left.layer.zOrder !== right.layer.zOrder) {
      return left.layer.zOrder - right.layer.zOrder;
    }
    return left.index - right.index;
  });

  return resolvedWithIndex.map((entry) => entry.layer);
}

export function LayeredScene({
  sceneId,
  label,
  layers,
  staticFallback,
  accessibilityFallback,
  breakpoints,
  viewportWidth,
  aspectRatio = '16 / 9',
  reducedMotion,
  operationalMode = false,
  forceStatic = false,
  autoPlay = false,
  durationMs,
  cameraBounds,
  enableKeyboardCamera = false,
  enablePointerParallax = true,
  scrollProgress,
  maxParallaxShiftPx = 24,
  className,
  style,
}: LayeredSceneProps) {
  const harness = getActiveSceneHarness();
  const effectiveReducedMotion = useReducedMotion(reducedMotion);
  const playback = useScenePlayback({
    autoPlay: forceStatic || effectiveReducedMotion ? false : autoPlay,
    durationMs,
    reducedMotion: effectiveReducedMotion,
  });

  const [measuredWidth, setMeasuredWidth] = useState<number>(
    viewportWidth ?? DEFAULT_VIEWPORT_WIDTH
  );
  const effectiveWidth = viewportWidth ?? measuredWidth;

  const cameraControllerRef = useRef<SceneCameraController | null>(null);
  if (cameraControllerRef.current === null) {
    cameraControllerRef.current = createSceneCameraController({
      bounds: cameraBounds,
      initial: harness?.camera,
      reducedMotion: effectiveReducedMotion,
      operationalMode,
    });
  }
  const cameraController = cameraControllerRef.current;
  const [cameraState, setCameraState] = useState<CameraState>(() => cameraController.getState());

  const rootElementRef = useRef<HTMLDivElement | null>(null);
  const setCombinedRef = useCallback(
    (element: HTMLDivElement | null) => {
      rootElementRef.current = element;
      playback.ref(element);
    },
    [playback.ref]
  );

  useEffect(() => {
    cameraController.setReducedMotion(effectiveReducedMotion || playback.snapshot.reducedMotion);
    cameraController.setOperationalMode(operationalMode);
  }, [cameraController, effectiveReducedMotion, operationalMode, playback.snapshot.reducedMotion]);

  useEffect(() => {
    if (typeof scrollProgress === 'number' && Number.isFinite(scrollProgress)) {
      cameraController.setScrollProgress(scrollProgress);
    }
  }, [cameraController, scrollProgress]);

  useEffect(() => {
    const unsubscribe = cameraController.subscribe(setCameraState);
    setCameraState(cameraController.getState());
    return unsubscribe;
  }, [cameraController]);

  useEffect(() => {
    return () => {
      cameraController.dispose();
    };
  }, [cameraController]);

  useEffect(() => {
    if (viewportWidth !== undefined) return;
    const element = rootElementRef.current;
    if (!element) return;
    const updateWidth = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) {
        setMeasuredWidth(Math.round(rect.width));
      }
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(updateWidth);
      resizeObserver.observe(element);
      return () => resizeObserver.disconnect();
    }
    return undefined;
  }, [viewportWidth]);

  const resolvedLayers = useMemo(() => {
    try {
      return resolveSceneLayersForWidth(layers, breakpoints, effectiveWidth);
    } catch {
      return [];
    }
  }, [layers, breakpoints, effectiveWidth]);

  const isReduced = effectiveReducedMotion || playback.snapshot.reducedMotion;
  const isStaticFallback = forceStatic || isReduced || resolvedLayers.length === 0;
  const sceneState = isStaticFallback ? 'static' : playback.snapshot.effectiveState;
  const accessibleLabel = accessibilityFallback ?? label;
  const transitionsDisabled = Boolean(harness?.disableTransitions || isReduced || operationalMode);

  const effectiveCamera: CameraState =
    isStaticFallback || operationalMode ? { x: 0, y: 0, zoom: 1 } : cameraState;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!enableKeyboardCamera || isStaticFallback || operationalMode) return;
      cameraController.handleKeyDown(event);
    },
    [cameraController, enableKeyboardCamera, isStaticFallback, operationalMode]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!enablePointerParallax || isStaticFallback || operationalMode) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const normalizedY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      cameraController.setPointer(normalizedX, normalizedY);
    },
    [cameraController, enablePointerParallax, isStaticFallback, operationalMode]
  );

  const handlePointerLeave = useCallback(() => {
    if (!enablePointerParallax || isStaticFallback || operationalMode) return;
    cameraController.setPointer(0, 0);
  }, [cameraController, enablePointerParallax, isStaticFallback, operationalMode]);

  const stageTransform =
    effectiveCamera.zoom !== 1 || effectiveCamera.x !== 0 || effectiveCamera.y !== 0
      ? `scale(${effectiveCamera.zoom})`
      : undefined;

  return (
    <div
      ref={setCombinedRef}
      className={cn('mw-ui-layered-scene', className)}
      role="img"
      aria-label={accessibleLabel}
      tabIndex={enableKeyboardCamera && !isStaticFallback && !operationalMode ? 0 : undefined}
      data-scene-id={sceneId}
      data-scene-state={sceneState}
      data-scene-time={String(Math.round(playback.snapshot.timeMs))}
      onKeyDown={enableKeyboardCamera ? handleKeyDown : undefined}
      onPointerMove={enablePointerParallax ? handlePointerMove : undefined}
      onPointerLeave={enablePointerParallax ? handlePointerLeave : undefined}
      style={{
        position: 'relative',
        overflow: 'hidden',
        aspectRatio,
        ...style,
      }}
    >
      {isStaticFallback ? (
        <img
          className="mw-ui-layered-scene-fallback"
          src={staticFallback}
          alt={accessibleLabel}
          data-scene-fallback="true"
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div
          className="mw-ui-layered-scene-stage"
          style={{
            position: 'absolute',
            inset: 0,
            transform: stageTransform,
            transformOrigin: '50% 50%',
            transition: transitionsDisabled ? 'none' : 'transform 160ms ease-out',
          }}
        >
          {resolvedLayers.map((layer) => {
            const parallaxOffset = layer.parallax
              ? computeLayerParallax(effectiveCamera, layer.parallax, {
                  reducedMotion: isReduced,
                  operationalMode,
                  maxShiftPx: maxParallaxShiftPx,
                })
              : { translateX: 0, translateY: 0 };

            const transformCss = buildLayerTransformCss(
              layer.transform,
              parallaxOffset.translateX,
              parallaxOffset.translateY
            );

            const layerStyle: CSSProperties = {
              position: 'absolute',
              inset: 0,
              zIndex: layer.zOrder,
              opacity: clampOpacity(layer.opacity),
              mixBlendMode: layer.blendMode,
              clipPath: layer.clipPath,
              transform: transformCss,
              transformOrigin: formatPivotOrigin(layer.pivot),
              transition: transitionsDisabled
                ? 'none'
                : 'transform 160ms ease-out, opacity 160ms ease-out',
              pointerEvents: 'none',
            };

            return (
              <div
                key={layer.id}
                className="mw-ui-layered-scene-layer"
                data-layer-id={layer.id}
                data-z-order={String(layer.zOrder)}
                data-media-kind={layer.mediaKind}
                aria-hidden="true"
                style={layerStyle}
              >
                {layer.mediaKind === 'vector' && layer.svgContent ? (
                  layer.svgContent
                ) : (
                  <img
                    src={layer.src}
                    alt=""
                    decoding="async"
                    data-video-frame={layer.mediaKind === 'video-frame' ? 'true' : undefined}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
