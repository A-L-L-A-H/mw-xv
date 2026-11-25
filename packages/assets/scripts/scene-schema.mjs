const FORBIDDEN_KEY =
  /(route|permission|user|metric|signal|record|business|secret|token|password|email)/iu;

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function assertKeys(value, allowed, path) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      fail(`${path}.${key}`, 'is not supported by the presentation-only schema');
}

function requirePoint(point, path) {
  if (!point || typeof point !== 'object' || Array.isArray(point))
    fail(path, 'must be a normalized point');
  assertKeys(point, ['x', 'y'], path);
  for (const axis of ['x', 'y']) {
    if (!Number.isFinite(point[axis]) || point[axis] < 0 || point[axis] > 1)
      fail(`${path}.${axis}`, 'must be between 0 and 1');
  }
}

function rejectBusinessFields(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key))
      fail(`${path}.${key}`, 'is outside the presentation-only scene contract');
    rejectBusinessFields(child, `${path}.${key}`);
  }
}

function requireReference(reference, knownAssets, path) {
  if (typeof reference !== 'string' || !knownAssets.has(reference))
    fail(path, `must reference a canonical manifest asset; received ${String(reference)}`);
}

function assertAcyclicScenes(scenes, sceneById) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(`scenes.${id}.includes`, 'creates a cyclic scene reference');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const includedId of sceneById.get(id).includes ?? []) {
      if (!sceneById.has(includedId))
        fail(`scenes.${id}.includes`, `references missing scene ${includedId}`);
      visit(includedId);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of sceneById.keys()) visit(id);
}

/** Validate presentation-only scene and clip descriptors against the canonical asset manifest. */
export function validateSceneBundle(bundle, manifest, filePath = 'scene-bundle.json') {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle))
    fail(filePath, 'must be an object');
  if (!Array.isArray(bundle.scenes) || !Array.isArray(bundle.clips))
    fail(filePath, 'scenes and clips must be arrays');
  rejectBusinessFields(bundle, filePath);

  const knownAssets = new Set(manifest.assets.map(({ path }) => path));
  const sceneById = new Map();
  const clipById = new Map();
  for (const [index, scene] of bundle.scenes.entries()) {
    const path = `${filePath}.scenes[${index}]`;
    assertKeys(
      scene,
      [
        'id',
        'layers',
        'actors',
        'staticFallback',
        'includes',
        'clips',
        'breakpoints',
        'accessibilityFallback',
      ],
      path
    );
    if (!scene || typeof scene.id !== 'string' || !scene.id)
      fail(`${path}.id`, 'must be a non-empty stable identifier');
    if (sceneById.has(scene.id)) fail(`${path}.id`, `duplicates scene ${scene.id}`);
    if (!Array.isArray(scene.layers) || scene.layers.length === 0)
      fail(`${path}.layers`, 'must contain at least one layer');
    sceneById.set(scene.id, scene);
    const layerIds = new Set();
    const orders = new Set();
    for (const [layerIndex, layer] of scene.layers.entries()) {
      const layerPath = `${path}.layers[${layerIndex}]`;
      assertKeys(
        layer,
        ['id', 'asset', 'order', 'position', 'pivot', 'opacity', 'parallax'],
        layerPath
      );
      if (typeof layer.id !== 'string' || !layer.id || layerIds.has(layer.id))
        fail(`${layerPath}.id`, 'must be a unique non-empty identifier within the scene');
      if (!Number.isInteger(layer.order) || orders.has(layer.order))
        fail(`${layerPath}.order`, 'must be a unique integer within the scene');
      layerIds.add(layer.id);
      orders.add(layer.order);
      requireReference(layer.asset, knownAssets, `${layerPath}.asset`);
      requirePoint(layer.position, `${layerPath}.position`);
      if (layer.pivot !== undefined) requirePoint(layer.pivot, `${layerPath}.pivot`);
      if (
        layer.opacity !== undefined &&
        (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)
      )
        fail(`${layerPath}.opacity`, 'must be between 0 and 1');
      if (layer.parallax !== undefined) {
        if (!layer.parallax || typeof layer.parallax !== 'object' || Array.isArray(layer.parallax))
          fail(`${layerPath}.parallax`, 'must be a bounded x/y object');
        assertKeys(layer.parallax, ['x', 'y'], `${layerPath}.parallax`);
        for (const axis of ['x', 'y'])
          if (!Number.isFinite(layer.parallax[axis]) || Math.abs(layer.parallax[axis]) > 1)
            fail(`${layerPath}.parallax.${axis}`, 'must be bounded between -1 and 1');
      }
    }
    if (scene.actors !== undefined) {
      if (!Array.isArray(scene.actors)) fail(`${path}.actors`, 'must be an array of actor descriptors');
      const actorIds = new Set();
      for (const [actorIndex, actor] of scene.actors.entries()) {
        const actorPath = `${path}.actors[${actorIndex}]`;
        assertKeys(actor, ['id', 'clipId', 'order'], actorPath);
        if (typeof actor.id !== 'string' || !actor.id || actorIds.has(actor.id))
          fail(`${actorPath}.id`, 'must be a unique non-empty identifier within the scene');
        if (typeof actor.clipId !== 'string' || !actor.clipId)
          fail(`${actorPath}.clipId`, 'must reference a non-empty clip ID');
        if (!Number.isInteger(actor.order) || orders.has(actor.order))
          fail(`${actorPath}.order`, 'must be a unique integer within the scene');
        actorIds.add(actor.id);
        orders.add(actor.order);
      }
    }
    requireReference(scene.staticFallback, knownAssets, `${path}.staticFallback`);
    if (scene.includes !== undefined && !Array.isArray(scene.includes))
      fail(`${path}.includes`, 'must be an array of scene IDs');
    if (scene.clips !== undefined && !Array.isArray(scene.clips))
      fail(`${path}.clips`, 'must be an array of clip IDs');
    if (scene.accessibilityFallback !== undefined)
      requireReference(scene.accessibilityFallback, knownAssets, `${path}.accessibilityFallback`);
    if (scene.breakpoints !== undefined) {
      if (!Array.isArray(scene.breakpoints))
        fail(`${path}.breakpoints`, 'must be an array of breakpoint descriptors');
      const bpNames = new Set();
      for (const [bpIndex, bp] of scene.breakpoints.entries()) {
        const bpPath = `${path}.breakpoints[${bpIndex}]`;
        if (!bp || typeof bp !== 'object' || Array.isArray(bp)) fail(bpPath, 'must be an object');
        assertKeys(bp, ['name', 'minWidth', 'maxWidth', 'overlay', 'layerOverrides'], bpPath);
        if (typeof bp.name !== 'string' || !bp.name || bpNames.has(bp.name))
          fail(`${bpPath}.name`, 'must be a unique non-empty breakpoint name');
        bpNames.add(bp.name);
        if (!Number.isInteger(bp.minWidth) || bp.minWidth < 0)
          fail(`${bpPath}.minWidth`, 'must be a non-negative integer');
        if (
          bp.maxWidth !== undefined &&
          (!Number.isInteger(bp.maxWidth) || bp.maxWidth < bp.minWidth)
        )
          fail(`${bpPath}.maxWidth`, 'must be an integer greater than or equal to minWidth');
        if (bp.overlay !== undefined)
          requireReference(bp.overlay, knownAssets, `${bpPath}.overlay`);
        if (bp.layerOverrides !== undefined) {
          if (!Array.isArray(bp.layerOverrides))
            fail(`${bpPath}.layerOverrides`, 'must be an array of layer overrides');
          const overrideLayerIds = new Set();
          for (const [ovIndex, ov] of bp.layerOverrides.entries()) {
            const ovPath = `${bpPath}.layerOverrides[${ovIndex}]`;
            if (!ov || typeof ov !== 'object' || Array.isArray(ov))
              fail(ovPath, 'must be an object');
            assertKeys(ov, ['layerId', 'position', 'opacity', 'parallax'], ovPath);
            if (typeof ov.layerId !== 'string' || !ov.layerId || overrideLayerIds.has(ov.layerId))
              fail(`${ovPath}.layerId`, 'must reference a unique layer id within the scene');
            overrideLayerIds.add(ov.layerId);
            if (!layerIds.has(ov.layerId))
              fail(`${ovPath}.layerId`, `references unknown layer ${ov.layerId}`);
            if (ov.position !== undefined) requirePoint(ov.position, `${ovPath}.position`);
            if (
              ov.opacity !== undefined &&
              (!Number.isFinite(ov.opacity) || ov.opacity < 0 || ov.opacity > 1)
            )
              fail(`${ovPath}.opacity`, 'must be between 0 and 1');
            if (ov.parallax !== undefined) {
              if (!ov.parallax || typeof ov.parallax !== 'object' || Array.isArray(ov.parallax))
                fail(`${ovPath}.parallax`, 'must be a bounded x/y object');
              assertKeys(ov.parallax, ['x', 'y'], `${ovPath}.parallax`);
              for (const axis of ['x', 'y'])
                if (!Number.isFinite(ov.parallax[axis]) || Math.abs(ov.parallax[axis]) > 1)
                  fail(`${ovPath}.parallax.${axis}`, 'must be bounded between -1 and 1');
            }
          }
        }
      }
    }
  }
  assertAcyclicScenes(bundle.scenes, sceneById);

  for (const [index, clip] of bundle.clips.entries()) {
    const path = `${filePath}.clips[${index}]`;
    assertKeys(clip, ['id', 'loop', 'direction', 'pivot', 'frames'], path);
    if (!clip || typeof clip.id !== 'string' || !clip.id)
      fail(`${path}.id`, 'must be a non-empty stable identifier');
    if (clipById.has(clip.id)) fail(`${path}.id`, `duplicates clip ${clip.id}`);
    if (typeof clip.loop !== 'boolean') fail(`${path}.loop`, 'must be a boolean');
    if (!['forward', 'reverse', 'ping-pong'].includes(clip.direction))
      fail(`${path}.direction`, 'must be forward, reverse, or ping-pong');
    requirePoint(clip.pivot, `${path}.pivot`);
    if (!Array.isArray(clip.frames) || clip.frames.length === 0)
      fail(`${path}.frames`, 'must contain at least one frame reference');
    for (const [frameIndex, frame] of clip.frames.entries()) {
      assertKeys(frame, ['asset', 'durationMs'], `${path}.frames[${frameIndex}]`);
      requireReference(frame.asset, knownAssets, `${path}.frames[${frameIndex}].asset`);
      if (!Number.isInteger(frame.durationMs) || frame.durationMs <= 0)
        fail(`${path}.frames[${frameIndex}].durationMs`, 'must be a positive integer');
    }
    clipById.set(clip.id, clip);
  }
  for (const [sceneIndex, scene] of bundle.scenes.entries()) {
    for (const clipId of scene.clips ?? [])
      if (!clipById.has(clipId))
        fail(`${filePath}.scenes[${sceneIndex}].clips`, `references missing clip ${clipId}`);
    for (const actor of scene.actors ?? [])
      if (!clipById.has(actor.clipId))
        fail(`${filePath}.scenes[${sceneIndex}].actors`, `references missing clip ${actor.clipId}`);
  }
  return { sceneCount: sceneById.size, clipCount: clipById.size };
}
