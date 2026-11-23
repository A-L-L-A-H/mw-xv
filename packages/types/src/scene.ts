export type SceneId = string & { __brand: 'SceneId' };
export type LayerId = string & { __brand: 'LayerId' };
export type ClipId = string & { __brand: 'ClipId' };
export type AssetId = string & { __brand: 'AssetId' };

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface BoundedParallax {
  readonly x: number;
  readonly y: number;
}

export interface LayerDefinition {
  readonly id: LayerId;
  readonly asset: AssetId;
  readonly order: number;
  readonly position: NormalizedPoint;
  readonly pivot?: NormalizedPoint;
  readonly opacity?: number;
  readonly parallax?: BoundedParallax;
}

export interface CameraDefinition {
  readonly bounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly parallax?: BoundedParallax;
}

export interface ClipFrame {
  readonly asset: AssetId;
  readonly durationMs: number;
}

export interface ClipDefinition {
  readonly id: ClipId;
  readonly loop: boolean;
  readonly direction: 'forward' | 'reverse' | 'ping-pong';
  readonly pivot: NormalizedPoint;
  readonly frames: readonly ClipFrame[];
}

export interface SceneEvent {
  readonly type: string;
  readonly target?: AssetId;
  readonly payload?: Record<string, unknown>;
}

export interface SceneState {
  readonly activeSceneId?: SceneId;
  readonly camera?: CameraDefinition;
  readonly events?: readonly SceneEvent[];
  readonly reducedMotion?: boolean;
}

export interface SceneDefinition {
  readonly id: SceneId;
  readonly layers: readonly LayerDefinition[];
  readonly staticFallback: AssetId;
  readonly includes?: readonly SceneId[];
  readonly clips?: readonly ClipId[];
  readonly breakpoints?: readonly SceneBreakpoint[];
  readonly accessibilityFallback?: string;
}

export interface SceneBreakpoint {
  readonly name: string;
  readonly minWidth: number;
  readonly maxWidth?: number;
  readonly overlay?: AssetId;
  readonly layerOverrides?: readonly LayerOverride[];
}

export interface LayerOverride {
  readonly layerId: LayerId;
  readonly position?: NormalizedPoint;
  readonly opacity?: number;
  readonly parallax?: BoundedParallax;
}

export interface SceneBundle {
  readonly scenes: readonly SceneDefinition[];
  readonly clips: readonly ClipDefinition[];
}

export function isNormalizedPoint(value: unknown): value is NormalizedPoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.x === 'number' &&
    Number.isFinite(p.x) &&
    p.x >= 0 &&
    p.x <= 1 &&
    typeof p.y === 'number' &&
    Number.isFinite(p.y) &&
    p.y >= 0 &&
    p.y <= 1
  );
}

export function isBoundedParallax(value: unknown): value is BoundedParallax {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.x === 'number' &&
    Number.isFinite(p.x) &&
    Math.abs(p.x) <= 1 &&
    typeof p.y === 'number' &&
    Number.isFinite(p.y) &&
    Math.abs(p.y) <= 1
  );
}

export function isLayerDefinition(value: unknown): value is LayerDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.id === 'string' &&
    l.id.length > 0 &&
    typeof l.asset === 'string' &&
    l.asset.length > 0 &&
    Number.isInteger(l.order) &&
    isNormalizedPoint(l.position)
  );
}
