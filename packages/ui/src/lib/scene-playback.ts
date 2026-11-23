import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getActiveSceneHarness } from './scene-test-harness.js';

export type ScenePlaybackState =
  'idle' | 'playing' | 'paused' | 'static' | 'completed' | 'disposed';

export interface ScenePlaybackScheduler {
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
}

export interface SceneObserverIntersectionEntry {
  readonly isIntersecting: boolean;
  readonly intersectionRatio?: number;
}

export interface SceneObserverIntersectionLike {
  observe(target: Element): void;
  disconnect(): void;
}

export interface SceneObserverMediaQueryLike {
  readonly matches: boolean;
  addEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
  addListener?: (listener: (event: { matches: boolean }) => void) => void;
  removeListener?: (listener: (event: { matches: boolean }) => void) => void;
}

export interface SceneObserverDocumentLike {
  readonly hidden?: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface SceneObserverWindow {
  IntersectionObserver?: new (
    callback: (entries: readonly SceneObserverIntersectionEntry[]) => void,
    options?: { threshold?: number | number[] }
  ) => SceneObserverIntersectionLike;
  matchMedia?: (query: string) => SceneObserverMediaQueryLike;
  document?: SceneObserverDocumentLike;
}

export interface ScenePlaybackOptions {
  readonly durationMs?: number;
  readonly loop?: boolean;
  readonly playbackRate?: number;
  readonly initialTimeMs?: number;
  readonly autoPlay?: boolean;
  readonly reducedMotion?: boolean;
  readonly pauseOffscreen?: boolean;
  readonly visible?: boolean;
  readonly documentHidden?: boolean;
  readonly staticFallbackTimeMs?: number;
  readonly scheduler?: ScenePlaybackScheduler;
}

export interface ScenePlaybackSnapshot {
  readonly timeMs: number;
  readonly durationMs: number | null;
  readonly progress: number;
  readonly requestedPlaying: boolean;
  readonly effectiveState: ScenePlaybackState;
  readonly reducedMotion: boolean;
  readonly visible: boolean;
  readonly documentHidden: boolean;
  readonly disposed: boolean;
  readonly activeHandleCount: number;
}

export type ScenePlaybackListener = (snapshot: ScenePlaybackSnapshot) => void;

export interface ScenePlaybackController {
  play(): void;
  pause(): void;
  seek(timeMs: number): void;
  reset(): void;
  step(deltaMs: number): ScenePlaybackSnapshot;
  setReducedMotion(reduced: boolean): void;
  setVisible(visible: boolean): void;
  setDocumentHidden(hidden: boolean): void;
  subscribe(listener: ScenePlaybackListener): () => void;
  getSnapshot(): ScenePlaybackSnapshot;
  attachObservers(element: Element | null, win?: SceneObserverWindow): () => void;
  dispose(): void;
}

export interface UseScenePlaybackOptions extends ScenePlaybackOptions {
  readonly targetRef?: RefObject<Element | null>;
  readonly respectHarness?: boolean;
}

export interface UseScenePlaybackResult {
  readonly snapshot: ScenePlaybackSnapshot;
  readonly controller: ScenePlaybackController;
  readonly ref: (element: Element | null) => void;
}

function normalizeDuration(durationMs: number | undefined): number | null {
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
    return durationMs;
  }
  return null;
}

function clampInitialTime(value: number | undefined, durationMs: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  if (durationMs !== null) {
    return Math.min(durationMs, value);
  }
  return value;
}

function getDefaultScheduler(): ScenePlaybackScheduler {
  const globalScope = globalThis as unknown as {
    requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
    performance?: { now?: () => number };
  };
  return {
    requestAnimationFrame:
      typeof globalScope.requestAnimationFrame === 'function'
        ? globalScope.requestAnimationFrame.bind(globalScope)
        : undefined,
    cancelAnimationFrame:
      typeof globalScope.cancelAnimationFrame === 'function'
        ? globalScope.cancelAnimationFrame.bind(globalScope)
        : undefined,
    now:
      typeof globalScope.performance?.now === 'function'
        ? () => globalScope.performance!.now!()
        : () => Date.now(),
  };
}

export function createScenePlaybackController(
  options: ScenePlaybackOptions = {}
): ScenePlaybackController {
  const durationMs = normalizeDuration(options.durationMs);
  const loop = options.loop ?? durationMs !== null;
  const playbackRate =
    typeof options.playbackRate === 'number' &&
    Number.isFinite(options.playbackRate) &&
    options.playbackRate > 0
      ? options.playbackRate
      : 1;
  const pauseOffscreen = options.pauseOffscreen !== false;
  const staticFallbackTimeMs = clampInitialTime(options.staticFallbackTimeMs ?? 0, durationMs);
  const scheduler = options.scheduler ?? getDefaultScheduler();

  let reducedMotion = Boolean(options.reducedMotion);
  let visible = options.visible ?? true;
  let documentHidden = Boolean(options.documentHidden);
  let requestedPlaying = Boolean(options.autoPlay);
  let completed = false;
  let disposed = false;
  let timeMs = reducedMotion
    ? staticFallbackTimeMs
    : clampInitialTime(options.initialTimeMs ?? 0, durationMs);

  let rafHandle: number | null = null;
  let lastFrameTimestamp: number | null = null;

  const listeners = new Set<ScenePlaybackListener>();
  const observerCleanups = new Set<() => void>();

  function computeEffectiveState(): ScenePlaybackState {
    if (disposed) return 'disposed';
    if (reducedMotion) return 'static';
    if (completed) return 'completed';
    if (!requestedPlaying) {
      return timeMs === 0 ? 'idle' : 'paused';
    }
    if (pauseOffscreen && (!visible || documentHidden)) {
      return 'paused';
    }
    return 'playing';
  }

  function computeActiveHandleCount(): number {
    return observerCleanups.size + (rafHandle !== null ? 1 : 0);
  }

  function buildSnapshot(): ScenePlaybackSnapshot {
    const effectiveState = computeEffectiveState();
    const effectiveTimeMs = reducedMotion ? staticFallbackTimeMs : timeMs;
    const progress =
      durationMs !== null && durationMs > 0
        ? Math.min(1, Math.max(0, effectiveTimeMs / durationMs))
        : 0;

    return {
      timeMs: effectiveTimeMs,
      durationMs,
      progress,
      requestedPlaying,
      effectiveState,
      reducedMotion,
      visible,
      documentHidden,
      disposed,
      activeHandleCount: computeActiveHandleCount(),
    };
  }

  function notify(): ScenePlaybackSnapshot {
    const snapshot = buildSnapshot();
    if (!disposed) {
      for (const listener of listeners) {
        listener(snapshot);
      }
    }
    return snapshot;
  }

  function cancelScheduledFrame(): void {
    if (rafHandle !== null) {
      scheduler.cancelAnimationFrame?.(rafHandle);
      rafHandle = null;
      lastFrameTimestamp = null;
    }
  }

  function advanceInternal(deltaMs: number): void {
    if (disposed || reducedMotion) {
      timeMs = staticFallbackTimeMs;
      return;
    }
    if (computeEffectiveState() !== 'playing') {
      return;
    }
    const safeDelta = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs * playbackRate : 0;
    if (safeDelta === 0) return;

    const nextTime = timeMs + safeDelta;
    if (durationMs !== null) {
      if (loop) {
        timeMs = ((nextTime % durationMs) + durationMs) % durationMs;
      } else if (nextTime >= durationMs) {
        timeMs = durationMs;
        completed = true;
        requestedPlaying = false;
        cancelScheduledFrame();
      } else {
        timeMs = nextTime;
      }
    } else {
      timeMs = nextTime;
    }
  }

  function onAnimationFrame(timestamp: number): void {
    rafHandle = null;
    if (disposed || computeEffectiveState() !== 'playing') {
      lastFrameTimestamp = null;
      return;
    }
    const previousTimestamp = lastFrameTimestamp;
    lastFrameTimestamp = timestamp;
    if (previousTimestamp !== null) {
      const deltaMs = Math.max(0, timestamp - previousTimestamp);
      advanceInternal(deltaMs);
      notify();
    }
    syncAnimationLoop();
  }

  function syncAnimationLoop(): void {
    if (disposed || computeEffectiveState() !== 'playing') {
      cancelScheduledFrame();
      return;
    }
    if (rafHandle === null && typeof scheduler.requestAnimationFrame === 'function') {
      lastFrameTimestamp = null;
      rafHandle = scheduler.requestAnimationFrame(onAnimationFrame);
    }
  }

  syncAnimationLoop();

  return {
    play(): void {
      if (disposed) return;
      if (completed) {
        timeMs = 0;
        completed = false;
      }
      requestedPlaying = true;
      if (reducedMotion) {
        timeMs = staticFallbackTimeMs;
        cancelScheduledFrame();
      } else {
        syncAnimationLoop();
      }
      notify();
    },

    pause(): void {
      if (disposed) return;
      requestedPlaying = false;
      cancelScheduledFrame();
      notify();
    },

    seek(targetTimeMs: number): void {
      if (disposed) return;
      if (reducedMotion) {
        timeMs = staticFallbackTimeMs;
        notify();
        return;
      }
      const safeTarget = Number.isFinite(targetTimeMs) && targetTimeMs > 0 ? targetTimeMs : 0;
      if (durationMs !== null) {
        if (loop && safeTarget >= durationMs) {
          timeMs = safeTarget % durationMs;
          completed = false;
        } else {
          timeMs = Math.min(durationMs, safeTarget);
          completed = !loop && timeMs >= durationMs;
          if (completed) {
            requestedPlaying = false;
            cancelScheduledFrame();
          }
        }
      } else {
        timeMs = safeTarget;
        completed = false;
      }
      syncAnimationLoop();
      notify();
    },

    reset(): void {
      if (disposed) return;
      requestedPlaying = false;
      completed = false;
      timeMs = reducedMotion ? staticFallbackTimeMs : 0;
      cancelScheduledFrame();
      notify();
    },

    step(deltaMs: number): ScenePlaybackSnapshot {
      if (disposed) return buildSnapshot();
      advanceInternal(deltaMs);
      return notify();
    },

    setReducedMotion(reduced: boolean): void {
      if (disposed) return;
      const nextReduced = Boolean(reduced);
      if (nextReduced === reducedMotion) return;
      reducedMotion = nextReduced;
      if (reducedMotion) {
        timeMs = staticFallbackTimeMs;
        cancelScheduledFrame();
      } else {
        syncAnimationLoop();
      }
      notify();
    },

    setVisible(nextVisible: boolean): void {
      if (disposed) return;
      const coerced = Boolean(nextVisible);
      if (coerced === visible) return;
      visible = coerced;
      syncAnimationLoop();
      notify();
    },

    setDocumentHidden(hidden: boolean): void {
      if (disposed) return;
      const coerced = Boolean(hidden);
      if (coerced === documentHidden) return;
      documentHidden = coerced;
      syncAnimationLoop();
      notify();
    },

    subscribe(listener: ScenePlaybackListener): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): ScenePlaybackSnapshot {
      return buildSnapshot();
    },

    attachObservers(element: Element | null, win?: SceneObserverWindow): () => void {
      if (disposed) return () => {};
      const hostWindow: SceneObserverWindow | undefined =
        win ??
        (typeof window !== 'undefined' ? (window as unknown as SceneObserverWindow) : undefined);
      const localCleanups: Array<() => void> = [];

      const registerCleanup = (cleanup: () => void): void => {
        let cleaned = false;
        const wrapped = () => {
          if (cleaned) return;
          cleaned = true;
          observerCleanups.delete(wrapped);
          cleanup();
        };
        observerCleanups.add(wrapped);
        localCleanups.push(wrapped);
      };

      const IntersectionCtor =
        hostWindow?.IntersectionObserver ??
        (typeof IntersectionObserver !== 'undefined'
          ? (IntersectionObserver as unknown as SceneObserverWindow['IntersectionObserver'])
          : undefined);

      if (element && IntersectionCtor) {
        const observer = new IntersectionCtor(
          (entries) => {
            const entry = entries[0];
            if (!entry) return;
            const isIntersecting =
              entry.isIntersecting &&
              (entry.intersectionRatio === undefined || entry.intersectionRatio > 0);
            this.setVisible(isIntersecting);
          },
          { threshold: 0 }
        );
        observer.observe(element);
        registerCleanup(() => observer.disconnect());
      }

      const doc = hostWindow?.document;
      if (doc) {
        if (typeof doc.hidden === 'boolean') {
          documentHidden = doc.hidden;
        }
        const onVisibilityChange = () => {
          this.setDocumentHidden(Boolean(doc.hidden));
        };
        doc.addEventListener('visibilitychange', onVisibilityChange);
        registerCleanup(() => doc.removeEventListener('visibilitychange', onVisibilityChange));
      }

      if (typeof hostWindow?.matchMedia === 'function') {
        const mediaQuery = hostWindow.matchMedia('(prefers-reduced-motion: reduce)');
        if (typeof mediaQuery.matches === 'boolean' && options.reducedMotion === undefined) {
          reducedMotion = mediaQuery.matches;
          if (reducedMotion) {
            timeMs = staticFallbackTimeMs;
          }
        }
        const onReducedMotionChange = (event: { matches: boolean }) => {
          this.setReducedMotion(Boolean(event.matches));
        };
        if (typeof mediaQuery.addEventListener === 'function') {
          mediaQuery.addEventListener('change', onReducedMotionChange);
          registerCleanup(() => {
            mediaQuery.removeEventListener?.('change', onReducedMotionChange);
          });
        } else if (typeof mediaQuery.addListener === 'function') {
          mediaQuery.addListener(onReducedMotionChange);
          registerCleanup(() => {
            mediaQuery.removeListener?.(onReducedMotionChange);
          });
        }
      }

      syncAnimationLoop();
      notify();

      return () => {
        for (const cleanup of localCleanups) {
          cleanup();
        }
        notify();
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      requestedPlaying = false;
      cancelScheduledFrame();
      for (const cleanup of Array.from(observerCleanups)) {
        cleanup();
      }
      observerCleanups.clear();
      listeners.clear();
    },
  };
}

export function useScenePlayback(options: UseScenePlaybackOptions = {}): UseScenePlaybackResult {
  const harness = options.respectHarness === false ? null : getActiveSceneHarness();
  const effectiveReducedMotion = options.reducedMotion ?? harness?.reducedMotion ?? false;
  const effectiveInitialTimeMs = harness?.fixedTimeMs ?? options.initialTimeMs ?? 0;
  const effectiveAutoPlay =
    harness?.paused === true || harness?.fixedTimeMs !== undefined
      ? false
      : Boolean(options.autoPlay);

  const controllerRef = useRef<ScenePlaybackController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createScenePlaybackController({
      durationMs: options.durationMs,
      loop: options.loop,
      playbackRate: options.playbackRate,
      initialTimeMs: effectiveInitialTimeMs,
      autoPlay: effectiveAutoPlay,
      reducedMotion: effectiveReducedMotion,
      pauseOffscreen: options.pauseOffscreen,
      visible: options.visible,
      documentHidden: options.documentHidden,
      staticFallbackTimeMs: options.staticFallbackTimeMs,
      scheduler: options.scheduler,
    });
  }

  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState<ScenePlaybackSnapshot>(() => controller.getSnapshot());
  const [observedElement, setObservedElement] = useState<Element | null>(null);

  const ref = useCallback((element: Element | null) => {
    setObservedElement(element);
  }, []);

  useEffect(() => {
    controller.setReducedMotion(effectiveReducedMotion);
  }, [controller, effectiveReducedMotion]);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    setSnapshot(controller.getSnapshot());
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    const target = options.targetRef?.current ?? observedElement;
    const detach = controller.attachObservers(target);
    return () => {
      detach();
    };
  }, [controller, observedElement, options.targetRef]);

  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  return {
    snapshot,
    controller,
    ref,
  };
}
