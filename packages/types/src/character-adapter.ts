export type CharacterClipFormat = 'sprite-sequence' | 'rig-optional' | (string & {});

export type CharacterPlaybackMode = 'loop' | 'ping-pong' | 'one-shot';

export interface CharacterIdentity {
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly depictionPolicy: string;
  readonly canonicalSheet: string;
}

export interface CharacterClipFrame {
  readonly asset: string;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface CharacterClipDescriptor {
  readonly id: string;
  readonly format: CharacterClipFormat;
  readonly frames: readonly (string | CharacterClipFrame)[];
  readonly fps?: number;
  readonly durationMs?: number;
  readonly mode?: CharacterPlaybackMode;
  readonly loop?: boolean;
  readonly pingPong?: boolean;
  readonly fallbackAsset: string;
  readonly staticFrameIndex?: number;
}

export interface CharacterPlaybackRequest {
  readonly characterId: string;
  readonly clipId: string;
  readonly timeMs: number;
  readonly reducedMotion?: boolean;
  readonly pinnedFrame?: number;
  readonly playbackRate?: number;
}

export interface CharacterResolveOptions {
  readonly reducedMotion?: boolean;
  readonly pinnedFrame?: number;
  readonly playbackRate?: number;
}

export interface CharacterResolvedFrame {
  readonly frameIndex: number;
  readonly asset: string;
  readonly isStaticFallback: boolean;
  readonly completed: boolean;
  readonly adapterKind: string;
}

export interface CharacterAdapter {
  readonly kind: CharacterClipFormat;
  supports(format: string): boolean;
  resolveFrame(
    clip: CharacterClipDescriptor,
    timeMs: number,
    options?: CharacterResolveOptions
  ): CharacterResolvedFrame;
  dispose?(): void;
}

export interface CharacterAdapterRegistry {
  register(adapter: CharacterAdapter): void;
  unregister(kind: string): boolean;
  resolveAdapter(format: string): CharacterAdapter | null;
  resolveFrame(
    clip: CharacterClipDescriptor,
    timeMs: number,
    options?: CharacterResolveOptions
  ): CharacterResolvedFrame;
  listAdapters(): readonly string[];
  dispose(): void;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isCharacterIdentity(value: unknown): value is CharacterIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.slug) &&
    isNonEmptyString(candidate.label) &&
    isNonEmptyString(candidate.depictionPolicy) &&
    isNonEmptyString(candidate.canonicalSheet)
  );
}

export function isCharacterPlaybackRequest(value: unknown): value is CharacterPlaybackRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.characterId) || !isNonEmptyString(candidate.clipId)) {
    return false;
  }
  if (
    typeof candidate.timeMs !== 'number' ||
    !Number.isFinite(candidate.timeMs) ||
    candidate.timeMs < 0
  ) {
    return false;
  }
  if (candidate.reducedMotion !== undefined && typeof candidate.reducedMotion !== 'boolean') {
    return false;
  }
  if (
    candidate.pinnedFrame !== undefined &&
    (typeof candidate.pinnedFrame !== 'number' ||
      !Number.isInteger(candidate.pinnedFrame) ||
      candidate.pinnedFrame < 0)
  ) {
    return false;
  }
  if (
    candidate.playbackRate !== undefined &&
    (typeof candidate.playbackRate !== 'number' ||
      !Number.isFinite(candidate.playbackRate) ||
      candidate.playbackRate <= 0)
  ) {
    return false;
  }
  return true;
}

export function isCharacterAdapter(value: unknown): value is CharacterAdapter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.kind) &&
    typeof candidate.supports === 'function' &&
    typeof candidate.resolveFrame === 'function' &&
    (candidate.dispose === undefined || typeof candidate.dispose === 'function')
  );
}
