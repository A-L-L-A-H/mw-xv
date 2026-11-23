export interface SceneHarnessCamera {
  readonly x?: number;
  readonly y?: number;
  readonly zoom?: number;
}

export interface SceneHarnessConfig {
  readonly fixedTimeMs?: number;
  readonly fixedFrame?: number;
  readonly reducedMotion?: boolean;
  readonly paused?: boolean;
  readonly camera?: SceneHarnessCamera;
  readonly disableTransitions?: boolean;
}

interface SceneHarnessGlobalScope {
  __MW_SCENE_HARNESS__?: SceneHarnessConfig;
  location?: {
    search?: string;
  };
}

function parseBooleanParam(rawValue: string | null): boolean | undefined {
  if (rawValue === null) return undefined;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return undefined;
}

function parseFiniteNumberParam(rawValue: string | null): number | undefined {
  if (rawValue === null || rawValue.trim() === '') return undefined;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeCamera(camera: SceneHarnessCamera | undefined): SceneHarnessCamera | undefined {
  if (!camera || typeof camera !== 'object') return undefined;
  const result: { x?: number; y?: number; zoom?: number } = {};
  if (typeof camera.x === 'number' && Number.isFinite(camera.x)) result.x = camera.x;
  if (typeof camera.y === 'number' && Number.isFinite(camera.y)) result.y = camera.y;
  if (typeof camera.zoom === 'number' && Number.isFinite(camera.zoom) && camera.zoom > 0) {
    result.zoom = camera.zoom;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeConfig(config: SceneHarnessConfig | null | undefined): SceneHarnessConfig | null {
  if (!config || typeof config !== 'object') return null;
  const normalized: {
    fixedTimeMs?: number;
    fixedFrame?: number;
    reducedMotion?: boolean;
    paused?: boolean;
    camera?: SceneHarnessCamera;
    disableTransitions?: boolean;
  } = {};

  if (
    typeof config.fixedTimeMs === 'number' &&
    Number.isFinite(config.fixedTimeMs) &&
    config.fixedTimeMs >= 0
  ) {
    normalized.fixedTimeMs = config.fixedTimeMs;
  }
  if (
    typeof config.fixedFrame === 'number' &&
    Number.isFinite(config.fixedFrame) &&
    config.fixedFrame >= 0
  ) {
    normalized.fixedFrame = Math.trunc(config.fixedFrame);
  }
  if (typeof config.reducedMotion === 'boolean') {
    normalized.reducedMotion = config.reducedMotion;
  }
  if (typeof config.paused === 'boolean') {
    normalized.paused = config.paused;
  }
  const camera = sanitizeCamera(config.camera);
  if (camera) {
    normalized.camera = camera;
  }
  if (typeof config.disableTransitions === 'boolean') {
    normalized.disableTransitions = config.disableTransitions;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function getHarnessScope(): SceneHarnessGlobalScope {
  return globalThis as unknown as SceneHarnessGlobalScope;
}

export function parseSceneHarnessFromSearch(search: string): SceneHarnessConfig | null {
  if (typeof search !== 'string' || search.trim().length === 0) {
    return null;
  }

  let queryString = search.trim();
  const questionIndex = queryString.indexOf('?');
  if (questionIndex >= 0) {
    queryString = queryString.slice(questionIndex + 1);
  }
  const hashIndex = queryString.indexOf('#');
  if (hashIndex >= 0) {
    queryString = queryString.slice(0, hashIndex);
  }
  if (queryString.length === 0) {
    return null;
  }

  const params = new URLSearchParams(queryString);
  const fixedTimeMs = parseFiniteNumberParam(params.get('sceneTime'));
  const fixedFrameRaw = parseFiniteNumberParam(params.get('sceneFrame'));
  const reducedMotion = parseBooleanParam(params.get('sceneReducedMotion'));
  const paused = parseBooleanParam(params.get('scenePaused'));
  const disableTransitions = parseBooleanParam(params.get('sceneDisableTransitions'));
  const cameraX = parseFiniteNumberParam(params.get('sceneCameraX'));
  const cameraY = parseFiniteNumberParam(params.get('sceneCameraY'));
  const cameraZoom = parseFiniteNumberParam(params.get('sceneCameraZoom'));

  const camera =
    cameraX !== undefined || cameraY !== undefined || cameraZoom !== undefined
      ? { x: cameraX, y: cameraY, zoom: cameraZoom }
      : undefined;

  return sanitizeConfig({
    fixedTimeMs,
    fixedFrame: fixedFrameRaw !== undefined ? Math.trunc(fixedFrameRaw) : undefined,
    reducedMotion,
    paused,
    camera,
    disableTransitions,
  });
}

export function setSceneHarness(config: SceneHarnessConfig | null): void {
  const scope = getHarnessScope();
  const sanitized = sanitizeConfig(config);
  if (sanitized === null) {
    delete scope.__MW_SCENE_HARNESS__;
    return;
  }
  scope.__MW_SCENE_HARNESS__ = sanitized;
}

export function resetSceneHarness(): void {
  const scope = getHarnessScope();
  delete scope.__MW_SCENE_HARNESS__;
}

export function getActiveSceneHarness(searchOverride?: string): SceneHarnessConfig | null {
  const scope = getHarnessScope();
  const rawSearch =
    searchOverride !== undefined
      ? searchOverride
      : typeof scope.location?.search === 'string'
        ? scope.location.search
        : '';

  const fromSearch = parseSceneHarnessFromSearch(rawSearch);
  const fromGlobal = sanitizeConfig(scope.__MW_SCENE_HARNESS__);

  if (!fromSearch && !fromGlobal) return null;
  if (!fromSearch) return fromGlobal;
  if (!fromGlobal) return fromSearch;

  const mergedCamera =
    fromSearch.camera || fromGlobal.camera
      ? sanitizeCamera({
          ...fromSearch.camera,
          ...fromGlobal.camera,
        })
      : undefined;

  return sanitizeConfig({
    ...fromSearch,
    ...fromGlobal,
    camera: mergedCamera,
  });
}
