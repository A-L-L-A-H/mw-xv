export const MAX_TIMELINE_DEPTH = 16;

export type TimelineTrackKind = 'entrance' | 'layer-transition' | 'clip' | 'event';

export type TimelineEasing = 'linear' | 'ease-out' | 'ease-in-out';

export interface TimelineTrack {
  readonly id: string;
  readonly kind: TimelineTrackKind;
  readonly startMs: number;
  readonly durationMs: number;
  readonly targetId?: string;
  readonly easing?: TimelineEasing;
  readonly triggers?: readonly string[];
  readonly payload?: Record<string, unknown>;
}

export interface TimelineEvent {
  readonly id: string;
  readonly trackId: string;
  readonly timeMs: number;
  readonly kind: TimelineTrackKind;
  readonly targetId?: string;
  readonly payload?: Record<string, unknown>;
}

export interface TimelineActiveTrack {
  readonly track: TimelineTrack;
  readonly localTimeMs: number;
  readonly progress: number;
}

export type TimelineStatus = 'idle' | 'playing' | 'paused' | 'completed' | 'cancelled' | 'disposed';

export interface TimelineState {
  readonly status: TimelineStatus;
  readonly timeMs: number;
  readonly totalDurationMs: number;
  readonly progress: number;
  readonly activeTrackIds: readonly string[];
  readonly firedEventIds: readonly string[];
}

export interface SceneTimelineOptions {
  readonly tracks: readonly TimelineTrack[];
  readonly totalDurationMs?: number;
  readonly onEvent?: (event: TimelineEvent) => void;
  readonly maxDepth?: number;
}

export type SceneTimelineListener = (state: TimelineState) => void;

export interface SceneTimeline {
  play(): TimelineState;
  pause(): TimelineState;
  restart(): TimelineState;
  seek(timeMs: number): TimelineState;
  advance(deltaMs: number): TimelineState;
  complete(): TimelineState;
  cancel(): TimelineState;
  getState(): TimelineState;
  getActiveTracks(): readonly TimelineActiveTrack[];
  subscribe(listener: SceneTimelineListener): () => void;
  dispose(): void;
}

function applyEasing(progress: number, easing: TimelineEasing | undefined): number {
  const clamped = Math.min(1, Math.max(0, progress));
  if (easing === 'ease-out') {
    return 1 - (1 - clamped) * (1 - clamped);
  }
  if (easing === 'ease-in-out') {
    return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
  }
  return clamped;
}

export function validateTimelineTracks(
  tracks: readonly TimelineTrack[],
  maxDepth: number = MAX_TIMELINE_DEPTH
): void {
  if (!Array.isArray(tracks)) {
    throw new Error('Scene timeline tracks must be an array.');
  }

  const effectiveMaxDepth = Math.min(
    MAX_TIMELINE_DEPTH,
    Number.isInteger(maxDepth) && maxDepth > 0 ? maxDepth : MAX_TIMELINE_DEPTH
  );

  const trackMap = new Map<string, TimelineTrack>();
  for (const track of tracks) {
    if (!track || typeof track.id !== 'string' || track.id.trim().length === 0) {
      throw new Error('Timeline track requires a non-empty string id.');
    }
    if (trackMap.has(track.id)) {
      throw new Error(`Duplicate timeline track id "${track.id}".`);
    }
    if (!Number.isFinite(track.startMs) || track.startMs < 0) {
      throw new Error(`Timeline track "${track.id}" has invalid startMs.`);
    }
    if (!Number.isFinite(track.durationMs) || track.durationMs < 0) {
      throw new Error(`Timeline track "${track.id}" has invalid durationMs.`);
    }
    if (track.triggers) {
      for (const triggerId of track.triggers) {
        if (triggerId === track.id) {
          throw new Error(`Timeline track "${track.id}" cannot self-reference in triggers.`);
        }
      }
    }
    trackMap.set(track.id, track);
  }

  const memoDepth = new Map<string, number>();
  const visiting = new Set<string>();

  function measureChainDepth(trackId: string): number {
    if (visiting.has(trackId)) {
      throw new Error(`Cyclic timeline trigger chain detected involving "${trackId}".`);
    }
    const cached = memoDepth.get(trackId);
    if (cached !== undefined) {
      return cached;
    }

    const track = trackMap.get(trackId);
    if (!track || !track.triggers || track.triggers.length === 0) {
      memoDepth.set(trackId, 0);
      return 0;
    }

    visiting.add(trackId);
    let deepest = 0;
    for (const nextId of track.triggers) {
      const childDepth = trackMap.has(nextId) ? 1 + measureChainDepth(nextId) : 1;
      if (childDepth > effectiveMaxDepth) {
        throw new Error(
          `Timeline trigger chain from "${trackId}" exceeds maximum depth ${effectiveMaxDepth}.`
        );
      }
      if (childDepth > deepest) {
        deepest = childDepth;
      }
    }
    visiting.delete(trackId);
    memoDepth.set(trackId, deepest);
    return deepest;
  }

  for (const trackId of trackMap.keys()) {
    measureChainDepth(trackId);
  }
}

export function createSceneTimeline(options: SceneTimelineOptions): SceneTimeline {
  validateTimelineTracks(options.tracks, options.maxDepth);

  const sortedTracks = [...options.tracks].sort((left, right) => {
    if (left.startMs !== right.startMs) return left.startMs - right.startMs;
    return left.id.localeCompare(right.id);
  });

  const computedDurationMs = sortedTracks.reduce((maxEnd, track) => {
    const endMs = track.startMs + track.durationMs;
    return endMs > maxEnd ? endMs : maxEnd;
  }, 0);

  const totalDurationMs =
    options.totalDurationMs !== undefined ? options.totalDurationMs : computedDurationMs;

  if (!Number.isFinite(totalDurationMs) || totalDurationMs < 0) {
    throw new Error('Scene timeline totalDurationMs must be a finite non-negative number.');
  }

  let status: TimelineStatus = 'idle';
  let timeMs = 0;
  const firedEventIds = new Set<string>();
  const listeners = new Set<SceneTimelineListener>();

  function computeActiveTracks(): readonly TimelineActiveTrack[] {
    if (status === 'cancelled' || status === 'disposed') {
      return [];
    }
    const active: TimelineActiveTrack[] = [];
    for (const track of sortedTracks) {
      const endMs = track.startMs + track.durationMs;
      if (track.durationMs === 0) {
        if (timeMs === track.startMs && status !== 'idle') {
          active.push({ track, localTimeMs: 0, progress: 1 });
        }
        continue;
      }
      if (timeMs >= track.startMs && timeMs < endMs) {
        const localTimeMs = timeMs - track.startMs;
        const rawProgress = localTimeMs / track.durationMs;
        active.push({
          track,
          localTimeMs,
          progress: applyEasing(rawProgress, track.easing),
        });
      } else if (status === 'completed' && timeMs >= endMs && endMs === totalDurationMs) {
        active.push({
          track,
          localTimeMs: track.durationMs,
          progress: 1,
        });
      }
    }
    return active;
  }

  function buildState(): TimelineState {
    const activeTracks = computeActiveTracks();
    const progress = totalDurationMs > 0 ? Math.min(1, Math.max(0, timeMs / totalDurationMs)) : 1;
    return {
      status,
      timeMs,
      totalDurationMs,
      progress,
      activeTrackIds: activeTracks.map((entry) => entry.track.id),
      firedEventIds: Array.from(firedEventIds),
    };
  }

  function emitState(): TimelineState {
    const snapshot = buildState();
    for (const listener of listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  function fireDueEvents(
    previousTimeMs: number,
    currentTimeMs: number,
    includeAtStart: boolean
  ): void {
    for (const track of sortedTracks) {
      if (firedEventIds.has(track.id)) continue;
      const crossedStart = includeAtStart
        ? track.startMs <= currentTimeMs
        : track.startMs > previousTimeMs && track.startMs <= currentTimeMs;
      if (crossedStart) {
        firedEventIds.add(track.id);
        options.onEvent?.({
          id: `event:${track.id}`,
          trackId: track.id,
          timeMs: track.startMs,
          kind: track.kind,
          targetId: track.targetId,
          payload: track.payload,
        });
      }
    }
  }

  return {
    play(): TimelineState {
      if (status === 'disposed') return buildState();
      if (status === 'completed' || status === 'cancelled') {
        timeMs = 0;
        firedEventIds.clear();
      }
      const wasIdle = status === 'idle' || firedEventIds.size === 0;
      status = 'playing';
      fireDueEvents(timeMs, timeMs, wasIdle);
      if (totalDurationMs === 0) {
        status = 'completed';
      }
      return emitState();
    },

    pause(): TimelineState {
      if (status !== 'playing') return buildState();
      status = 'paused';
      return emitState();
    },

    restart(): TimelineState {
      if (status === 'disposed') return buildState();
      timeMs = 0;
      firedEventIds.clear();
      status = 'playing';
      fireDueEvents(0, 0, true);
      if (totalDurationMs === 0) {
        status = 'completed';
      }
      return emitState();
    },

    seek(targetTimeMs: number): TimelineState {
      if (status === 'disposed') return buildState();
      const clamped = Number.isFinite(targetTimeMs)
        ? Math.min(totalDurationMs, Math.max(0, targetTimeMs))
        : 0;
      const previousTimeMs = timeMs;
      timeMs = clamped;
      if (clamped < previousTimeMs) {
        firedEventIds.clear();
        for (const track of sortedTracks) {
          if (track.startMs <= clamped) {
            firedEventIds.add(track.id);
          }
        }
      } else {
        fireDueEvents(previousTimeMs, clamped, previousTimeMs === 0 && firedEventIds.size === 0);
      }
      if (status === 'cancelled') {
        status = 'paused';
      }
      if (clamped >= totalDurationMs && totalDurationMs > 0) {
        status = 'completed';
      } else if (status === 'completed' && clamped < totalDurationMs) {
        status = 'paused';
      }
      return emitState();
    },

    advance(deltaMs: number): TimelineState {
      if (status !== 'playing') return buildState();
      const safeDelta = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
      const previousTimeMs = timeMs;
      const nextTimeMs = Math.min(totalDurationMs, timeMs + safeDelta);
      timeMs = nextTimeMs;
      fireDueEvents(previousTimeMs, nextTimeMs, false);
      if (nextTimeMs >= totalDurationMs) {
        status = 'completed';
      }
      return emitState();
    },

    complete(): TimelineState {
      if (status === 'disposed') return buildState();
      const previousTimeMs = timeMs;
      timeMs = totalDurationMs;
      fireDueEvents(previousTimeMs, totalDurationMs, firedEventIds.size === 0);
      status = 'completed';
      return emitState();
    },

    cancel(): TimelineState {
      if (status === 'disposed') return buildState();
      status = 'cancelled';
      return emitState();
    },

    getState(): TimelineState {
      return buildState();
    },

    getActiveTracks(): readonly TimelineActiveTrack[] {
      return computeActiveTracks();
    },

    subscribe(listener: SceneTimelineListener): () => void {
      if (status === 'disposed') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      status = 'disposed';
      listeners.clear();
      firedEventIds.clear();
    },
  };
}
