export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface CameraBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

export interface ParallaxInput {
  readonly x: number;
  readonly y: number;
}

export interface ParallaxOffset {
  readonly translateX: number;
  readonly translateY: number;
}

export interface SceneCameraOptions {
  readonly bounds?: Partial<CameraBounds>;
  readonly initial?: Partial<CameraState>;
  readonly reducedMotion?: boolean;
  readonly operationalMode?: boolean;
  readonly pointerStrength?: number;
  readonly scrollStrength?: number;
  readonly panStep?: number;
  readonly zoomStep?: number;
}

export interface KeyboardCameraActionOptions {
  readonly panStep?: number;
  readonly zoomStep?: number;
  readonly reducedMotion?: boolean;
  readonly operationalMode?: boolean;
}

export interface KeyboardCameraActionResult {
  readonly handled: boolean;
  readonly state: CameraState;
}

export interface KeyboardEventLike {
  readonly key: string;
  preventDefault?: () => void;
}

export type SceneCameraListener = (state: CameraState) => void;

export interface SceneCameraController {
  getState(): CameraState;
  getRawState(): CameraState;
  getBounds(): CameraBounds;
  setCamera(next: Partial<CameraState>): CameraState;
  panBy(deltaX: number, deltaY: number): CameraState;
  zoomBy(deltaZoom: number): CameraState;
  setPointer(normalizedX: number, normalizedY: number): CameraState;
  setScrollProgress(progress: number): CameraState;
  setReducedMotion(reduced: boolean): CameraState;
  setOperationalMode(operational: boolean): CameraState;
  handleKeyDown(event: KeyboardEventLike): KeyboardCameraActionResult;
  reset(): CameraState;
  computeParallax(parallax: ParallaxInput, maxShiftPx?: number): ParallaxOffset;
  subscribe(listener: SceneCameraListener): () => void;
  dispose(): void;
}

const DEFAULT_CAMERA_BOUNDS: CameraBounds = {
  minX: -1,
  maxX: 1,
  minY: -1,
  maxY: 1,
  minZoom: 1,
  maxZoom: 1.35,
};

const IDENTITY_CAMERA: CameraState = {
  x: 0,
  y: 0,
  zoom: 1,
};

const DEFAULT_PAN_STEP = 0.15;
const DEFAULT_ZOOM_STEP = 0.1;
const DEFAULT_POINTER_STRENGTH = 0.35;
const DEFAULT_SCROLL_STRENGTH = 0.25;
const DEFAULT_MAX_PARALLAX_SHIFT_PX = 24;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  return Object.is(clamped, -0) ? 0 : clamped;
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function resolveCameraBounds(bounds?: Partial<CameraBounds>): CameraBounds {
  const minX = Number.isFinite(bounds?.minX) ? (bounds!.minX as number) : DEFAULT_CAMERA_BOUNDS.minX;
  const maxX = Number.isFinite(bounds?.maxX) ? (bounds!.maxX as number) : DEFAULT_CAMERA_BOUNDS.maxX;
  const minY = Number.isFinite(bounds?.minY) ? (bounds!.minY as number) : DEFAULT_CAMERA_BOUNDS.minY;
  const maxY = Number.isFinite(bounds?.maxY) ? (bounds!.maxY as number) : DEFAULT_CAMERA_BOUNDS.maxY;
  const minZoom = Number.isFinite(bounds?.minZoom) && (bounds!.minZoom as number) > 0
    ? (bounds!.minZoom as number)
    : DEFAULT_CAMERA_BOUNDS.minZoom;
  const maxZoom = Number.isFinite(bounds?.maxZoom) && (bounds!.maxZoom as number) > 0
    ? (bounds!.maxZoom as number)
    : DEFAULT_CAMERA_BOUNDS.maxZoom;

  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
    minZoom: Math.min(minZoom, maxZoom),
    maxZoom: Math.max(minZoom, maxZoom),
  };
}

function clampCameraState(candidate: Partial<CameraState>, bounds: CameraBounds): CameraState {
  const baseX = candidate.x ?? 0;
  const baseY = candidate.y ?? 0;
  const baseZoom = candidate.zoom ?? 1;
  return {
    x: clampNumber(baseX, bounds.minX, bounds.maxX),
    y: clampNumber(baseY, bounds.minY, bounds.maxY),
    zoom: clampNumber(baseZoom, bounds.minZoom, bounds.maxZoom),
  };
}

function isSameCamera(first: CameraState, second: CameraState): boolean {
  return first.x === second.x && first.y === second.y && first.zoom === second.zoom;
}

export function computeLayerParallax(
  camera: CameraState,
  parallax: ParallaxInput,
  options?: {
    readonly reducedMotion?: boolean;
    readonly operationalMode?: boolean;
    readonly maxShiftPx?: number;
  }
): ParallaxOffset {
  if (options?.reducedMotion || options?.operationalMode) {
    return { translateX: 0, translateY: 0 };
  }
  const maxShiftPx =
    typeof options?.maxShiftPx === 'number' && Number.isFinite(options.maxShiftPx) && options.maxShiftPx >= 0
      ? options.maxShiftPx
      : DEFAULT_MAX_PARALLAX_SHIFT_PX;
  const factorX = clampNumber(parallax.x, -1, 1);
  const factorY = clampNumber(parallax.y, -1, 1);
  const translateX = normalizeZero(-camera.x * factorX * maxShiftPx);
  const translateY = normalizeZero(-camera.y * factorY * maxShiftPx);
  return { translateX, translateY };
}

export function applyKeyboardCameraAction(
  state: CameraState,
  key: string,
  bounds?: Partial<CameraBounds>,
  options?: KeyboardCameraActionOptions
): KeyboardCameraActionResult {
  if (options?.reducedMotion || options?.operationalMode) {
    return { handled: false, state: IDENTITY_CAMERA };
  }

  const resolvedBounds = resolveCameraBounds(bounds);
  const panStep =
    typeof options?.panStep === 'number' && Number.isFinite(options.panStep) && options.panStep > 0
      ? options.panStep
      : DEFAULT_PAN_STEP;
  const zoomStep =
    typeof options?.zoomStep === 'number' && Number.isFinite(options.zoomStep) && options.zoomStep > 0
      ? options.zoomStep
      : DEFAULT_ZOOM_STEP;

  switch (key) {
    case 'ArrowLeft':
      return {
        handled: true,
        state: clampCameraState({ x: state.x - panStep, y: state.y, zoom: state.zoom }, resolvedBounds),
      };
    case 'ArrowRight':
      return {
        handled: true,
        state: clampCameraState({ x: state.x + panStep, y: state.y, zoom: state.zoom }, resolvedBounds),
      };
    case 'ArrowUp':
      return {
        handled: true,
        state: clampCameraState({ x: state.x, y: state.y - panStep, zoom: state.zoom }, resolvedBounds),
      };
    case 'ArrowDown':
      return {
        handled: true,
        state: clampCameraState({ x: state.x, y: state.y + panStep, zoom: state.zoom }, resolvedBounds),
      };
    case '+':
    case '=':
      return {
        handled: true,
        state: clampCameraState({ x: state.x, y: state.y, zoom: state.zoom + zoomStep }, resolvedBounds),
      };
    case '-':
    case '_':
      return {
        handled: true,
        state: clampCameraState({ x: state.x, y: state.y, zoom: state.zoom - zoomStep }, resolvedBounds),
      };
    case '0':
    case 'Home':
      return {
        handled: true,
        state: clampCameraState(IDENTITY_CAMERA, resolvedBounds),
      };
    default:
      return {
        handled: false,
        state: clampCameraState(state, resolvedBounds),
      };
  }
}

export function createSceneCameraController(options: SceneCameraOptions = {}): SceneCameraController {
  const bounds = resolveCameraBounds(options.bounds);
  const pointerStrength = clampNumber(options.pointerStrength ?? DEFAULT_POINTER_STRENGTH, 0, 1);
  const scrollStrength = clampNumber(options.scrollStrength ?? DEFAULT_SCROLL_STRENGTH, 0, 1);
  const panStep =
    typeof options.panStep === 'number' && Number.isFinite(options.panStep) && options.panStep > 0
      ? options.panStep
      : DEFAULT_PAN_STEP;
  const zoomStep =
    typeof options.zoomStep === 'number' && Number.isFinite(options.zoomStep) && options.zoomStep > 0
      ? options.zoomStep
      : DEFAULT_ZOOM_STEP;

  let reducedMotion = Boolean(options.reducedMotion);
  let operationalMode = Boolean(options.operationalMode);
  let manualState: CameraState = clampCameraState(options.initial ?? IDENTITY_CAMERA, bounds);
  let pointerOffsetX = 0;
  let pointerOffsetY = 0;
  let scrollOffsetY = 0;
  let disposed = false;
  const listeners = new Set<SceneCameraListener>();

  function computeRawState(): CameraState {
    return clampCameraState(
      {
        x: manualState.x + pointerOffsetX,
        y: manualState.y + pointerOffsetY + scrollOffsetY,
        zoom: manualState.zoom,
      },
      bounds
    );
  }

  function computeEffectiveState(): CameraState {
    if (reducedMotion || operationalMode) {
      return IDENTITY_CAMERA;
    }
    return computeRawState();
  }

  let lastEmittedState = computeEffectiveState();

  function notifyIfChanged(): CameraState {
    const nextState = computeEffectiveState();
    if (!disposed && !isSameCamera(lastEmittedState, nextState)) {
      lastEmittedState = nextState;
      for (const listener of listeners) {
        listener(nextState);
      }
    } else {
      lastEmittedState = nextState;
    }
    return nextState;
  }

  return {
    getState(): CameraState {
      return computeEffectiveState();
    },

    getRawState(): CameraState {
      return computeRawState();
    },

    getBounds(): CameraBounds {
      return bounds;
    },

    setCamera(next: Partial<CameraState>): CameraState {
      if (disposed) return computeEffectiveState();
      manualState = clampCameraState(
        {
          x: next.x ?? manualState.x,
          y: next.y ?? manualState.y,
          zoom: next.zoom ?? manualState.zoom,
        },
        bounds
      );
      return notifyIfChanged();
    },

    panBy(deltaX: number, deltaY: number): CameraState {
      if (disposed) return computeEffectiveState();
      const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0;
      const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
      manualState = clampCameraState(
        {
          x: manualState.x + safeDeltaX,
          y: manualState.y + safeDeltaY,
          zoom: manualState.zoom,
        },
        bounds
      );
      return notifyIfChanged();
    },

    zoomBy(deltaZoom: number): CameraState {
      if (disposed) return computeEffectiveState();
      const safeDelta = Number.isFinite(deltaZoom) ? deltaZoom : 0;
      manualState = clampCameraState(
        {
          x: manualState.x,
          y: manualState.y,
          zoom: manualState.zoom + safeDelta,
        },
        bounds
      );
      return notifyIfChanged();
    },

    setPointer(normalizedX: number, normalizedY: number): CameraState {
      if (disposed) return computeEffectiveState();
      const clampedX = clampNumber(normalizedX, -1, 1);
      const clampedY = clampNumber(normalizedY, -1, 1);
      pointerOffsetX = normalizeZero(clampedX * pointerStrength);
      pointerOffsetY = normalizeZero(clampedY * pointerStrength);
      return notifyIfChanged();
    },

    setScrollProgress(progress: number): CameraState {
      if (disposed) return computeEffectiveState();
      const clampedProgress = clampNumber(progress, 0, 1);
      const centered = clampedProgress * 2 - 1;
      scrollOffsetY = normalizeZero(centered * scrollStrength);
      return notifyIfChanged();
    },

    setReducedMotion(reduced: boolean): CameraState {
      if (disposed) return computeEffectiveState();
      reducedMotion = Boolean(reduced);
      return notifyIfChanged();
    },

    setOperationalMode(operational: boolean): CameraState {
      if (disposed) return computeEffectiveState();
      operationalMode = Boolean(operational);
      return notifyIfChanged();
    },

    handleKeyDown(event: KeyboardEventLike): KeyboardCameraActionResult {
      if (disposed) {
        return { handled: false, state: computeEffectiveState() };
      }
      const result = applyKeyboardCameraAction(manualState, event.key, bounds, {
        panStep,
        zoomStep,
        reducedMotion,
        operationalMode,
      });
      if (result.handled) {
        event.preventDefault?.();
        if (event.key === '0' || event.key === 'Home') {
          pointerOffsetX = 0;
          pointerOffsetY = 0;
          scrollOffsetY = 0;
        }
        manualState = result.state;
        return { handled: true, state: notifyIfChanged() };
      }
      return { handled: false, state: computeEffectiveState() };
    },

    reset(): CameraState {
      if (disposed) return computeEffectiveState();
      manualState = clampCameraState(IDENTITY_CAMERA, bounds);
      pointerOffsetX = 0;
      pointerOffsetY = 0;
      scrollOffsetY = 0;
      return notifyIfChanged();
    },

    computeParallax(parallax: ParallaxInput, maxShiftPx?: number): ParallaxOffset {
      return computeLayerParallax(computeEffectiveState(), parallax, {
        reducedMotion,
        operationalMode,
        maxShiftPx,
      });
    },

    subscribe(listener: SceneCameraListener): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      disposed = true;
      listeners.clear();
    },
  };
}
