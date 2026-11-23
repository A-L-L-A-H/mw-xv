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

const DEFAULT_FPS = 12;

function extractFrameAsset(frame: string | CharacterClipFrame): string {
  return typeof frame === 'string' ? frame : frame.asset;
}

function resolvePlaybackMode(clip: CharacterClipDescriptor): CharacterPlaybackMode {
  if (clip.mode === 'loop' || clip.mode === 'ping-pong' || clip.mode === 'one-shot') {
    return clip.mode;
  }
  if (clip.pingPong) return 'ping-pong';
  if (clip.loop === false) return 'one-shot';
  return 'loop';
}

function resolveFrameDurations(clip: CharacterClipDescriptor): readonly number[] {
  const count = clip.frames.length;
  if (count === 0) return [];

  const fps =
    typeof clip.fps === 'number' && Number.isFinite(clip.fps) && clip.fps > 0
      ? clip.fps
      : DEFAULT_FPS;
  const defaultFrameDurationMs =
    typeof clip.durationMs === 'number' && Number.isFinite(clip.durationMs) && clip.durationMs > 0
      ? clip.durationMs / count
      : 1000 / fps;

  return clip.frames.map((frame) => {
    if (
      typeof frame !== 'string' &&
      typeof frame.durationMs === 'number' &&
      Number.isFinite(frame.durationMs) &&
      frame.durationMs > 0
    ) {
      return frame.durationMs;
    }
    return defaultFrameDurationMs;
  });
}

function clampFrameIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

export function createSpriteSequenceAdapter(): CharacterAdapter {
  return {
    kind: 'sprite-sequence',

    supports(format: string): boolean {
      return format === 'sprite-sequence';
    },

    resolveFrame(
      clip: CharacterClipDescriptor,
      timeMs: number,
      options?: CharacterResolveOptions
    ): CharacterResolvedFrame {
      const frameCount = clip.frames.length;
      const staticIndex = clampFrameIndex(clip.staticFrameIndex ?? 0, frameCount);

      if (frameCount === 0 || options?.reducedMotion) {
        return {
          frameIndex: staticIndex,
          asset: clip.fallbackAsset,
          isStaticFallback: true,
          completed: false,
          adapterKind: 'sprite-sequence',
        };
      }

      if (typeof options?.pinnedFrame === 'number' && Number.isFinite(options.pinnedFrame)) {
        const pinnedIndex = clampFrameIndex(options.pinnedFrame, frameCount);
        return {
          frameIndex: pinnedIndex,
          asset: extractFrameAsset(clip.frames[pinnedIndex]),
          isStaticFallback: false,
          completed: false,
          adapterKind: 'sprite-sequence',
        };
      }

      const playbackRate =
        typeof options?.playbackRate === 'number' &&
        Number.isFinite(options.playbackRate) &&
        options.playbackRate > 0
          ? options.playbackRate
          : 1;
      const effectiveTimeMs = (Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0) * playbackRate;
      const durations = resolveFrameDurations(clip);
      const mode = resolvePlaybackMode(clip);

      if (frameCount === 1) {
        const singleDuration = durations[0] ?? 1000 / DEFAULT_FPS;
        return {
          frameIndex: 0,
          asset: extractFrameAsset(clip.frames[0]),
          isStaticFallback: false,
          completed: mode === 'one-shot' && effectiveTimeMs >= singleDuration,
          adapterKind: 'sprite-sequence',
        };
      }

      if (mode === 'one-shot') {
        let elapsed = 0;
        for (let index = 0; index < frameCount; index += 1) {
          const nextElapsed = elapsed + durations[index];
          if (effectiveTimeMs < nextElapsed) {
            return {
              frameIndex: index,
              asset: extractFrameAsset(clip.frames[index]),
              isStaticFallback: false,
              completed: false,
              adapterKind: 'sprite-sequence',
            };
          }
          elapsed = nextElapsed;
        }
        return {
          frameIndex: frameCount - 1,
          asset: extractFrameAsset(clip.frames[frameCount - 1]),
          isStaticFallback: false,
          completed: true,
          adapterKind: 'sprite-sequence',
        };
      }

      if (mode === 'ping-pong') {
        const sequenceIndices: number[] = [];
        for (let index = 0; index < frameCount; index += 1) {
          sequenceIndices.push(index);
        }
        for (let index = frameCount - 2; index >= 1; index -= 1) {
          sequenceIndices.push(index);
        }
        const cycleDurationMs = sequenceIndices.reduce(
          (total, frameIdx) => total + durations[frameIdx],
          0
        );
        const cycleTimeMs = cycleDurationMs > 0 ? effectiveTimeMs % cycleDurationMs : 0;
        let elapsed = 0;
        for (const frameIdx of sequenceIndices) {
          const nextElapsed = elapsed + durations[frameIdx];
          if (cycleTimeMs < nextElapsed) {
            return {
              frameIndex: frameIdx,
              asset: extractFrameAsset(clip.frames[frameIdx]),
              isStaticFallback: false,
              completed: false,
              adapterKind: 'sprite-sequence',
            };
          }
          elapsed = nextElapsed;
        }
        const lastIndex = sequenceIndices[sequenceIndices.length - 1] ?? 0;
        return {
          frameIndex: lastIndex,
          asset: extractFrameAsset(clip.frames[lastIndex]),
          isStaticFallback: false,
          completed: false,
          adapterKind: 'sprite-sequence',
        };
      }

      const totalDurationMs = durations.reduce((total, value) => total + value, 0);
      const wrappedTimeMs = totalDurationMs > 0 ? effectiveTimeMs % totalDurationMs : 0;
      let elapsed = 0;
      for (let index = 0; index < frameCount; index += 1) {
        const nextElapsed = elapsed + durations[index];
        if (wrappedTimeMs < nextElapsed) {
          return {
            frameIndex: index,
            asset: extractFrameAsset(clip.frames[index]),
            isStaticFallback: false,
            completed: false,
            adapterKind: 'sprite-sequence',
          };
        }
        elapsed = nextElapsed;
      }

      return {
        frameIndex: 0,
        asset: extractFrameAsset(clip.frames[0]),
        isStaticFallback: false,
        completed: false,
        adapterKind: 'sprite-sequence',
      };
    },

    dispose(): void {},
  };
}

export function createCharacterAdapterRegistry(): CharacterAdapterRegistry {
  const adapters = new Map<string, CharacterAdapter>();
  const baseline = createSpriteSequenceAdapter();
  adapters.set(baseline.kind, baseline);

  return {
    register(adapter: CharacterAdapter): void {
      if (!adapter || typeof adapter.kind !== 'string' || adapter.kind.trim().length === 0) {
        throw new Error('Character adapter requires a non-empty kind.');
      }
      const previous = adapters.get(adapter.kind);
      if (previous && previous !== adapter) {
        previous.dispose?.();
      }
      adapters.delete(adapter.kind);
      adapters.set(adapter.kind, adapter);
    },

    unregister(kind: string): boolean {
      const existing = adapters.get(kind);
      if (!existing) return false;
      existing.dispose?.();
      return adapters.delete(kind);
    },

    resolveAdapter(format: string): CharacterAdapter | null {
      const registered = Array.from(adapters.values());
      for (let index = registered.length - 1; index >= 0; index -= 1) {
        const candidate = registered[index];
        if (candidate.supports(format)) {
          return candidate;
        }
      }
      return null;
    },

    resolveFrame(
      clip: CharacterClipDescriptor,
      timeMs: number,
      options?: CharacterResolveOptions
    ): CharacterResolvedFrame {
      const adapter = this.resolveAdapter(clip.format);
      if (!adapter) {
        return {
          frameIndex: clampFrameIndex(clip.staticFrameIndex ?? 0, clip.frames.length),
          asset: clip.fallbackAsset,
          isStaticFallback: true,
          completed: false,
          adapterKind: 'static-fallback',
        };
      }
      return adapter.resolveFrame(clip, timeMs, options);
    },

    listAdapters(): readonly string[] {
      return Array.from(adapters.keys());
    },

    dispose(): void {
      for (const adapter of adapters.values()) {
        adapter.dispose?.();
      }
      adapters.clear();
    },
  };
}
