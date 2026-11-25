import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import subsetFont from 'subset-font';
import { atomicWrite } from './atomic-write.mjs';
import { replaceGeneratedAssets } from './manifest-ownership.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRelativePath = 'source/fonts/MoonWitnessGrunge-Regular.otf';
const woff2RelativePath = 'fonts/MoonWitnessGrunge-latin.woff2';
const sourceOutputPath = resolve(packageRoot, sourceRelativePath);
const woff2OutputPath = resolve(packageRoot, woff2RelativePath);

export const FONT_FAMILY = 'MoonWitness Grunge';
export const FONT_STYLE = 'Regular';
export const UNITS_PER_EM = 1000;
export const ASCENDER = 840;
export const DESCENDER = -200;
// Fixed UTC timestamp (2026-10-16T00:00:00Z) so font builds are byte-for-byte reproducible.
const FIXED_TIMESTAMP = 1792108800;
const SFNT_CHECKSUM_MAGIC = 0xb1b0afba;

const UPPERCASE_HEIGHT = 720;
const LOWERCASE_HEIGHT = 536;
const LOWERCASE_ASCENDER = 748;
const LOWERCASE_DESCENDER = -172;

/** Mulberry32 deterministic PRNG seeded per glyph contour. */
function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Construct a contour vertex. smooth=true marks curve-sampled points for cubic Bezier fitting. */
function pt(x, y, smooth = false, noGrunge = false) {
  return { x, y, smooth, noGrunge };
}

/** Signed polygon area in Y-up font coordinates (>0 is CCW / outer; <0 is CW / hole). */
function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

/** Normalize a contour to CCW (outer solid) or CW (inner hole) winding. */
function ensureWinding(points, wantCcw = true) {
  const cleaned = [];
  for (const point of points) {
    const previous = cleaned.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1.5) {
      cleaned.push(point);
    }
  }
  if (
    cleaned.length > 2 &&
    Math.hypot(cleaned[0].x - cleaned.at(-1).x, cleaned[0].y - cleaned.at(-1).y) <= 1.5
  ) {
    cleaned.pop();
  }
  if (cleaned.length < 3) return cleaned;
  const area = signedArea(cleaned);
  if ((wantCcw && area < 0) || (!wantCcw && area > 0)) {
    cleaned.reverse();
  }
  return cleaned;
}

/** Create a contour descriptor `{ points, hole, noGrunge }`. */
function contour(points, { hole = false, noGrunge = false } = {}) {
  return {
    points: ensureWinding(points, !hole),
    hole,
    noGrunge,
  };
}

/** Translate and optionally tilt/scale a list of contour descriptors. */
function transformContours(
  contours,
  { dx = 0, dy = 0, skewX = 0, scaleX = 1, scaleY = 1, pivotY = 300 } = {}
) {
  return contours.map((shape) => ({
    ...shape,
    points: ensureWinding(
      shape.points.map((vertex) => ({
        ...vertex,
        x: vertex.x * scaleX + (vertex.y - pivotY) * skewX + dx,
        y: vertex.y * scaleY + dy,
      })),
      !shape.hole
    ),
  }));
}

/** Compute tight bounding box across all contour vertices. */
function computeBounds(contours) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const shape of contours) {
    for (const vertex of shape.points) {
      if (vertex.x < minX) minX = vertex.x;
      if (vertex.x > maxX) maxX = vertex.x;
      if (vertex.y < minY) minY = vertex.y;
      if (vertex.y > maxY) maxY = vertex.y;
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return { minX, maxX, minY, maxY };
}

/** Sample a funky superellipse (squircle/oval) arc or closed loop. */
function sampleSuperellipse(
  cx,
  cy,
  rx,
  ry,
  {
    exp = 2.75,
    steps = 28,
    startAngle = 0,
    endAngle = Math.PI * 2,
    tilt = 0,
    topScale = 1,
    bottomScale = 1,
    closed = true,
    smooth = true,
    noGrunge = false,
  } = {}
) {
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const power = 2 / exp;
  const count = closed ? steps : steps + 1;
  const points = [];
  for (let step = 0; step < count; step += 1) {
    const ratio = closed ? step / steps : step / steps;
    const angle = startAngle + (endAngle - startAngle) * ratio;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    let localX = Math.sign(cosA) * Math.abs(cosA) ** power * rx;
    const localY = Math.sign(sinA) * Math.abs(sinA) ** power * ry;
    const verticalBlend = (localY / Math.max(ry, 1) + 1) * 0.5;
    localX *= bottomScale + (topScale - bottomScale) * verticalBlend;
    const rotatedX = localX * cosTilt - localY * sinTilt + cx;
    const rotatedY = localX * sinTilt + localY * cosTilt + cy;
    points.push(pt(rotatedX, rotatedY, smooth, noGrunge));
  }
  return points;
}

/** Evaluate a cubic Bezier curve into an array of centerline sample points. */
function sampleCubic(p0, p1, p2, p3, steps = 16) {
  const result = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    const x = u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0];
    const y = u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1];
    result.push([x, y]);
  }
  return result;
}

/** Concatenate polyline segments without duplicating shared junction points. */
function joinCenterline(...segments) {
  const merged = [];
  for (const segment of segments) {
    for (const point of segment) {
      const previous = merged.at(-1);
      if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1) {
        merged.push(point);
      }
    }
  }
  return merged;
}

/**
 * Sweep an open centerline into a single non-self-intersecting funky flared ribbon contour.
 * Width modulation + terminal flare produces chunky Gen-Z street-poster curves with zero overlap.
 */
function strokeRibbon(
  centerPoints,
  widthFn,
  { flareStart = 18, flareEnd = 18, slantStart = 0, slantEnd = 0, noGrunge = false } = {}
) {
  const count = centerPoints.length;
  const cumulative = [0];
  for (let index = 1; index < count; index += 1) {
    const [x0, y0] = centerPoints[index - 1];
    const [x1, y1] = centerPoints[index];
    cumulative.push(cumulative[index - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  const totalLength = Math.max(cumulative[count - 1], 1);

  const leftSide = [];
  const rightSide = [];
  for (let index = 0; index < count; index += 1) {
    const ratio = cumulative[index] / totalLength;
    const baseWidth = typeof widthFn === 'function' ? widthFn(ratio) : widthFn;
    let flare = 0;
    if (ratio < 0.16) {
      flare += flareStart * ((0.16 - ratio) / 0.16) ** 1.6;
    }
    if (ratio > 0.84) {
      flare += flareEnd * ((ratio - 0.84) / 0.16) ** 1.6;
    }
    const halfWidth = (baseWidth + flare) * 0.5;

    const prev = centerPoints[Math.max(0, index - 1)];
    const next = centerPoints[Math.min(count - 1, index + 1)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const length = Math.hypot(tx, ty) || 1;
    tx /= length;
    ty /= length;
    const nx = -ty;
    const ny = tx;

    const isCap = index === 0 || index === count - 1;
    const capSlant = index === 0 ? slantStart : index === count - 1 ? slantEnd : 0;
    const [cx, cy] = centerPoints[index];
    leftSide.push(
      pt(cx + nx * halfWidth + tx * capSlant, cy + ny * halfWidth + ty * capSlant, !isCap, noGrunge)
    );
    rightSide.push(
      pt(cx - nx * halfWidth - tx * capSlant, cy - ny * halfWidth - ty * capSlant, !isCap, noGrunge)
    );
  }
  rightSide.reverse();
  return contour([...leftSide, ...rightSide], { hole: false, noGrunge });
}

/** Build a flared funky quadrilateral/bar between two endpoints with optional zine-cut end angles. */
function flaredBar(
  x0,
  y0,
  x1,
  y1,
  width,
  { flare0 = 10, flare1 = 10, bevel0 = 0, bevel1 = 0 } = {}
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const tx = dx / length;
  const ty = dy / length;
  const nx = -ty;
  const ny = tx;
  const half0 = (width + flare0) * 0.5;
  const half1 = (width + flare1) * 0.5;
  return contour([
    pt(x0 - nx * half0 - tx * bevel0, y0 - ny * half0 - ty * bevel0),
    pt(x1 - nx * half1 + tx * bevel1, y1 - ny * half1 + ty * bevel1),
    pt(x1 + nx * half1 - tx * bevel1, y1 + ny * half1 - ty * bevel1),
    pt(x0 + nx * half0 + tx * bevel0, y0 + ny * half0 + ty * bevel0),
  ]);
}

/** Funky tilted diamond-blob dot for i, j, !, ?, :, ;, ., etc. */
function funkyDot(cx, cy, rx = 74, ry = 76, tilt = 0.22) {
  return contour(
    sampleSuperellipse(cx, cy, rx, ry, {
      exp: 2.35,
      steps: 16,
      tilt,
      topScale: 1.06,
      bottomScale: 0.94,
      noGrunge: true,
    }),
    { hole: false, noGrunge: true }
  );
}

/**
 * Apply deterministic xerox/zine-print grunge notches and subtle ink-bleed bumps to outer contours.
 * Inner counters stay clean so cutouts remain sharp and open at small sizes.
 */
function distressContour(shape, rng) {
  const vertices = shape.points;
  if (shape.hole || shape.noGrunge || vertices.length < 3) {
    return {
      ...shape,
      points: vertices.map((vertex) => ({
        ...vertex,
        x: Math.round(vertex.x),
        y: Math.round(vertex.y),
      })),
    };
  }

  const distressed = [];
  const total = vertices.length;
  let curveNotchesPlaced = 0;

  for (let index = 0; index < total; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % total];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const edgeLength = Math.hypot(dx, dy);

    // Outward normal for CCW contour points to the right of edge direction.
    const outX = edgeLength > 0 ? dy / edgeLength : 0;
    const outY = edgeLength > 0 ? -dx / edgeLength : 0;

    if (start.smooth) {
      // Gentle deterministic organic ink texture along curved edges.
      const microJitter = (rng() - 0.48) * 8.5;
      distressed.push(pt(start.x + outX * microJitter, start.y + outY * microJitter, true));

      // Inject 2-3 crisp micro xerox chips on curved outer flanks so curves match straight stems.
      if (
        !start.noGrunge &&
        edgeLength >= 28 &&
        edgeLength <= 150 &&
        curveNotchesPlaced < 3 &&
        rng() < 0.2
      ) {
        curveNotchesPlaced += 1;
        const midX = (start.x + end.x) * 0.5;
        const midY = (start.y + end.y) * 0.5;
        const depth = 11 + rng() * 8;
        distressed.push(pt(midX - outX * depth, midY - outY * depth, false));
      }
      continue;
    }

    distressed.push(pt(start.x, start.y, false));

    if (start.noGrunge || end.noGrunge || edgeLength < 115) {
      continue;
    }

    const notchCount = edgeLength >= 370 ? 2 : edgeLength >= 150 ? 1 : rng() < 0.55 ? 1 : 0;
    if (notchCount === 0) continue;

    const slots =
      notchCount === 2 ? [0.26 + rng() * 0.16, 0.58 + rng() * 0.16] : [0.3 + rng() * 0.4];

    const ux = dx / edgeLength;
    const uy = dy / edgeLength;

    for (const slot of slots) {
      const span = Math.min(22 + rng() * 22, edgeLength * 0.2);
      const centerDist = slot * edgeLength;
      const d0 = centerDist - span * 0.5;
      const d1 = centerDist + span * 0.5;
      if (d0 < 28 || d1 > edgeLength - 28) continue;

      const isOutwardBleed = rng() < 0.24;
      const depth = isOutwardBleed
        ? 5.5 + rng() * 5.5
        : Math.min(10 + rng() * 10, edgeLength * 0.11);
      const direction = isOutwardBleed ? 1 : -1;

      const entryX = start.x + ux * d0;
      const entryY = start.y + uy * d0;
      const exitX = start.x + ux * d1;
      const exitY = start.y + uy * d1;

      if (rng() < 0.55) {
        // Sharp asymmetric V-chip bite.
        const apexOffset = d0 + span * (0.35 + rng() * 0.3);
        const apexX = start.x + ux * apexOffset + outX * depth * direction;
        const apexY = start.y + uy * apexOffset + outY * depth * direction;
        distressed.push(pt(entryX, entryY, false));
        distressed.push(pt(apexX, apexY, false));
        distressed.push(pt(exitX, exitY, false));
      } else {
        // Torn xerox flat-bottom ink notch.
        const innerStart = d0 + span * 0.24;
        const innerEnd = d0 + span * 0.78;
        const depth2 = depth * (0.78 + rng() * 0.32);
        distressed.push(pt(entryX, entryY, false));
        distressed.push(
          pt(
            start.x + ux * innerStart + outX * depth * direction,
            start.y + uy * innerStart + outY * depth * direction,
            false
          )
        );
        distressed.push(
          pt(
            start.x + ux * innerEnd + outX * depth2 * direction,
            start.y + uy * innerEnd + outY * depth2 * direction,
            false
          )
        );
        distressed.push(pt(exitX, exitY, false));
      }
    }
  }

  return {
    ...shape,
    points: ensureWinding(
      distressed.map((vertex) => ({
        ...vertex,
        x: Math.round(vertex.x),
        y: Math.round(vertex.y),
      })),
      !shape.hole
    ),
  };
}

/**
 * Convert contours into an opentype.Path.
 * Consecutive smooth points emit exact degree-elevated CFF cubic Beziers for smooth bowls;
 * sharp vertices emit crisp straight lines for punk cuts and xerox grunge notches.
 */
function contoursToPath(contours) {
  const path = new opentype.Path();

  for (const shape of contours) {
    const pts = shape.points;
    const count = pts.length;
    if (count < 3) continue;

    const allSmooth = pts.every((vertex) => vertex.smooth);
    if (allSmooth) {
      const startMidX = Math.round((pts[count - 1].x + pts[0].x) * 0.5);
      const startMidY = Math.round((pts[count - 1].y + pts[0].y) * 0.5);
      path.moveTo(startMidX, startMidY);
      let curX = startMidX;
      let curY = startMidY;
      for (let index = 0; index < count; index += 1) {
        const ctrl = pts[index];
        const next = pts[(index + 1) % count];
        const endX = Math.round((ctrl.x + next.x) * 0.5);
        const endY = Math.round((ctrl.y + next.y) * 0.5);
        const c1x = Math.round(curX + (2 / 3) * (ctrl.x - curX));
        const c1y = Math.round(curY + (2 / 3) * (ctrl.y - curY));
        const c2x = Math.round(endX + (2 / 3) * (ctrl.x - endX));
        const c2y = Math.round(endY + (2 / 3) * (ctrl.y - endY));
        path.curveTo(c1x, c1y, c2x, c2y, endX, endY);
        curX = endX;
        curY = endY;
      }
      path.close();
      continue;
    }

    // Rotate so index 0 is a sharp corner anchor.
    const firstSharpIndex = pts.findIndex((vertex) => !vertex.smooth);
    const ordered =
      firstSharpIndex <= 0
        ? pts
        : [...pts.slice(firstSharpIndex), ...pts.slice(0, firstSharpIndex)];

    path.moveTo(Math.round(ordered[0].x), Math.round(ordered[0].y));
    let curX = Math.round(ordered[0].x);
    let curY = Math.round(ordered[0].y);
    let index = 1;

    while (index < count) {
      if (!ordered[index].smooth) {
        const nextX = Math.round(ordered[index].x);
        const nextY = Math.round(ordered[index].y);
        if (nextX !== curX || nextY !== curY) {
          path.lineTo(nextX, nextY);
          curX = nextX;
          curY = nextY;
        }
        index += 1;
        continue;
      }

      // Collect contiguous smooth run ending at the next sharp point (or wrap to ordered[0]).
      const run = [];
      while (index < count && ordered[index].smooth) {
        run.push(ordered[index]);
        index += 1;
      }
      const endAnchor = index < count ? ordered[index] : ordered[0];
      const anchorX = Math.round(endAnchor.x);
      const anchorY = Math.round(endAnchor.y);

      for (let runIndex = 0; runIndex < run.length; runIndex += 1) {
        const ctrl = run[runIndex];
        const endX =
          runIndex < run.length - 1 ? Math.round((ctrl.x + run[runIndex + 1].x) * 0.5) : anchorX;
        const endY =
          runIndex < run.length - 1 ? Math.round((ctrl.y + run[runIndex + 1].y) * 0.5) : anchorY;
        const c1x = Math.round(curX + (2 / 3) * (ctrl.x - curX));
        const c1y = Math.round(curY + (2 / 3) * (ctrl.y - curY));
        const c2x = Math.round(endX + (2 / 3) * (ctrl.x - endX));
        const c2y = Math.round(endY + (2 / 3) * (ctrl.y - endY));
        path.curveTo(c1x, c1y, c2x, c2y, endX, endY);
        curX = endX;
        curY = endY;
      }
      if (index < count) {
        index += 1;
      }
    }
    path.close();
  }

  return path;
}

/** Curated Gen-Z baseline bounce (dy) and micro-slant (skewX) rhythm per character. */
const GLYPH_RHYTHM = {
  A: { dy: 14, skewX: -0.035 },
  B: { dy: -16, skewX: 0.025 },
  C: { dy: 18, skewX: -0.02 },
  D: { dy: -12, skewX: 0.03 },
  E: { dy: 16, skewX: -0.04 },
  F: { dy: -14, skewX: 0.035 },
  G: { dy: 12, skewX: -0.025 },
  H: { dy: -18, skewX: 0.02 },
  I: { dy: 20, skewX: -0.03 },
  J: { dy: -14, skewX: 0.04 },
  K: { dy: 16, skewX: -0.045 },
  L: { dy: -16, skewX: 0.03 },
  M: { dy: 14, skewX: -0.02 },
  N: { dy: -16, skewX: 0.04 },
  O: { dy: 18, skewX: -0.03 },
  P: { dy: -12, skewX: 0.035 },
  Q: { dy: 12, skewX: -0.02 },
  R: { dy: -18, skewX: 0.045 },
  S: { dy: 20, skewX: -0.035 },
  T: { dy: -14, skewX: 0.025 },
  U: { dy: 16, skewX: -0.03 },
  V: { dy: -18, skewX: 0.03 },
  W: { dy: 16, skewX: -0.025 },
  X: { dy: -14, skewX: 0.035 },
  Y: { dy: 18, skewX: -0.04 },
  Z: { dy: -16, skewX: 0.045 },
  a: { dy: 14, skewX: -0.03 },
  b: { dy: -12, skewX: 0.025 },
  c: { dy: 16, skewX: -0.025 },
  d: { dy: -14, skewX: 0.03 },
  e: { dy: 18, skewX: -0.04 },
  f: { dy: -10, skewX: 0.03 },
  g: { dy: 10, skewX: -0.025 },
  h: { dy: -16, skewX: 0.025 },
  i: { dy: 18, skewX: -0.035 },
  j: { dy: -8, skewX: 0.03 },
  k: { dy: 14, skewX: -0.04 },
  l: { dy: -14, skewX: 0.025 },
  m: { dy: 12, skewX: -0.02 },
  n: { dy: -14, skewX: 0.03 },
  o: { dy: 16, skewX: -0.03 },
  p: { dy: -10, skewX: 0.025 },
  q: { dy: 10, skewX: -0.025 },
  r: { dy: -16, skewX: 0.04 },
  s: { dy: 18, skewX: -0.04 },
  t: { dy: -12, skewX: 0.03 },
  u: { dy: 14, skewX: -0.025 },
  v: { dy: -16, skewX: 0.035 },
  w: { dy: 14, skewX: -0.025 },
  x: { dy: -14, skewX: 0.035 },
  y: { dy: 10, skewX: -0.03 },
  z: { dy: -16, skewX: 0.045 },
  0: { dy: 12, skewX: -0.025 },
  1: { dy: -16, skewX: 0.03 },
  2: { dy: 16, skewX: -0.035 },
  3: { dy: -14, skewX: 0.03 },
  4: { dy: 14, skewX: -0.025 },
  5: { dy: -16, skewX: 0.035 },
  6: { dy: 16, skewX: -0.03 },
  7: { dy: -14, skewX: 0.04 },
  8: { dy: 14, skewX: -0.02 },
  9: { dy: -14, skewX: 0.03 },
  '!': { dy: 16, skewX: 0.055 },
  '?': { dy: 14, skewX: -0.045 },
  '&': { dy: -10, skewX: -0.03 },
  '@': { dy: 8, skewX: -0.02 },
  '#': { dy: 10, skewX: 0.06 },
  $: { dy: -8, skewX: -0.03 },
  '%': { dy: 8, skewX: 0.02 },
  '*': { dy: 14, skewX: 0.03 },
};

/* ============================================================================
 * UPPERCASE GLYPH BUILDERS (A-Z)
 * Unified non-overlapping outer CCW contours + crisp opposite-winding CW holes
 * ============================================================================ */

function buildUpperA() {
  const outer = contour([
    pt(0, 0),
    pt(212, 0),
    pt(246, 178),
    pt(418, 178),
    pt(452, 0),
    pt(668, 0),
    pt(458, 728),
    pt(216, 712),
  ]);
  const hole = contour([pt(276, 322), pt(390, 322), pt(334, 548)], { hole: true });
  return [outer, hole];
}

function buildUpperB() {
  const upperArc = sampleSuperellipse(336, 536, 224, 186, {
    exp: 2.7,
    steps: 14,
    startAngle: -Math.PI * 0.44,
    endAngle: Math.PI * 0.5,
    closed: false,
  });
  const lowerArc = sampleSuperellipse(354, 190, 248, 192, {
    exp: 2.75,
    steps: 14,
    startAngle: -Math.PI * 0.5,
    endAngle: Math.PI * 0.43,
    closed: false,
  });
  const outer = contour([
    pt(0, 0),
    ...lowerArc,
    pt(474, 374),
    ...upperArc,
    pt(14, 724),
    pt(34, 558),
    pt(34, 166),
  ]);
  const upperHole = contour(
    sampleSuperellipse(298, 534, 108, 72, { exp: 2.6, steps: 16, tilt: -0.1 }),
    { hole: true }
  );
  const lowerHole = contour(
    sampleSuperellipse(314, 192, 124, 80, { exp: 2.6, steps: 16, tilt: 0.08 }),
    { hole: true }
  );
  return [outer, upperHole, lowerHole];
}

function buildUpperC() {
  const arc = sampleSuperellipse(334, 360, 232, 276, {
    exp: 2.85,
    steps: 30,
    startAngle: 0.52,
    endAngle: Math.PI * 2 - 0.56,
    topScale: 0.96,
    bottomScale: 1.04,
    closed: false,
  }).map((vertex) => [vertex.x, vertex.y]);
  return [
    strokeRibbon(arc, (t) => 164 - 16 * Math.sin(t * Math.PI) ** 2, {
      flareStart: 22,
      flareEnd: 24,
      slantStart: 12,
      slantEnd: -10,
    }),
  ];
}

function buildUpperD() {
  const rightArc = sampleSuperellipse(274, 360, 322, 362, {
    exp: 2.75,
    steps: 22,
    startAngle: -Math.PI * 0.5,
    endAngle: Math.PI * 0.5,
    topScale: 0.96,
    bottomScale: 1.04,
    closed: false,
  });
  const outer = contour([pt(0, 0), ...rightArc, pt(6, 724), pt(32, 560), pt(32, 160)]);
  const hole = contour(
    sampleSuperellipse(292, 360, 128, 204, { exp: 2.6, steps: 20, tilt: -0.07 }),
    { hole: true }
  );
  return [outer, hole];
}

function buildUpperE() {
  return [
    contour([
      pt(0, 0),
      pt(530, 0),
      pt(514, 162),
      pt(194, 152),
      pt(194, 304),
      pt(452, 314),
      pt(468, 456),
      pt(194, 444),
      pt(194, 566),
      pt(528, 578),
      pt(542, 726),
      pt(10, 720),
      pt(30, 540),
      pt(28, 175),
    ]),
  ];
}

function buildUpperF() {
  return [
    contour([
      pt(0, 0),
      pt(204, 0),
      pt(192, 296),
      pt(448, 308),
      pt(464, 452),
      pt(192, 440),
      pt(192, 566),
      pt(524, 578),
      pt(540, 726),
      pt(10, 720),
      pt(30, 540),
      pt(24, 175),
    ]),
  ];
}

function buildUpperG() {
  const outerArc = sampleSuperellipse(336, 362, 336, 368, {
    exp: 2.85,
    steps: 28,
    startAngle: 0.44,
    endAngle: Math.PI * 1.94,
    topScale: 0.96,
    bottomScale: 1.04,
    closed: false,
  });
  const innerArc = sampleSuperellipse(340, 362, 162, 206, {
    exp: 2.7,
    steps: 22,
    startAngle: Math.PI * 1.88,
    endAngle: 0.46,
    closed: false,
  });
  const outer = contour([
    ...outerArc,
    pt(664, 396),
    pt(344, 410),
    pt(334, 276),
    pt(500, 272),
    ...innerArc,
  ]);
  return [outer];
}

function buildUpperH() {
  return [
    contour([
      pt(0, 0),
      pt(196, 0),
      pt(184, 290),
      pt(416, 304),
      pt(404, 0),
      pt(604, 0),
      pt(582, 180),
      pt(584, 550),
      pt(606, 726),
      pt(406, 720),
      pt(416, 444),
      pt(184, 430),
      pt(196, 726),
      pt(0, 720),
      pt(24, 540),
      pt(24, 180),
    ]),
  ];
}

function buildUpperI() {
  return [
    contour([
      pt(0, 0),
      pt(368, 0),
      pt(356, 138),
      pt(268, 148),
      pt(268, 574),
      pt(364, 586),
      pt(376, 724),
      pt(8, 720),
      pt(22, 584),
      pt(108, 574),
      pt(108, 148),
      pt(12, 138),
    ]),
  ];
}

function buildUpperJ() {
  const centerline = joinCenterline(
    [
      [406, 704],
      [404, 268],
    ],
    sampleCubic([404, 268], [404, 86], [286, 56], [190, 62], 12),
    sampleCubic([190, 62], [108, 68], [76, 134], [72, 236], 8)
  );
  const body = strokeRibbon(centerline, (t) => 162 + 12 * Math.sin(t * Math.PI), {
    flareStart: 36,
    flareEnd: 24,
    slantStart: -8,
    slantEnd: 12,
  });
  return [body];
}

function buildUpperK() {
  return [
    contour([
      pt(0, 0),
      pt(196, 0),
      pt(186, 266),
      pt(246, 314),
      pt(424, 0),
      pt(636, 0),
      pt(380, 390),
      pt(618, 724),
      pt(404, 724),
      pt(186, 446),
      pt(198, 724),
      pt(4, 720),
      pt(26, 540),
      pt(26, 180),
    ]),
  ];
}

function buildUpperL() {
  return [
    contour([
      pt(0, 0),
      pt(514, 0),
      pt(532, 166),
      pt(196, 154),
      pt(192, 540),
      pt(208, 724),
      pt(6, 720),
      pt(28, 540),
      pt(24, 175),
    ]),
  ];
}

function buildUpperM() {
  return [
    contour([
      pt(0, 0),
      pt(188, 0),
      pt(180, 424),
      pt(320, 176),
      pt(430, 176),
      pt(568, 434),
      pt(560, 0),
      pt(756, 0),
      pt(728, 726),
      pt(536, 726),
      pt(376, 412),
      pt(222, 720),
      pt(24, 726),
    ]),
  ];
}

function buildUpperN() {
  return [
    contour([
      pt(0, 0),
      pt(190, 0),
      pt(182, 412),
      pt(432, 0),
      pt(614, 0),
      pt(592, 540),
      pt(616, 726),
      pt(426, 724),
      pt(434, 314),
      pt(186, 726),
      pt(2, 720),
      pt(24, 540),
    ]),
  ];
}

function buildUpperO() {
  const outer = contour(
    sampleSuperellipse(336, 362, 336, 372, {
      exp: 2.85,
      steps: 32,
      topScale: 0.96,
      bottomScale: 1.04,
    })
  );
  const hole = contour(
    sampleSuperellipse(336, 362, 148, 206, {
      exp: 2.55,
      steps: 24,
      tilt: -0.14,
    }),
    { hole: true }
  );
  return [outer, hole];
}

function buildUpperP() {
  const bowlArc = sampleSuperellipse(310, 502, 276, 224, {
    exp: 2.75,
    steps: 18,
    startAngle: -Math.PI * 0.5,
    endAngle: Math.PI * 0.5,
    closed: false,
  });
  const outer = contour([
    pt(0, 0),
    pt(204, 0),
    pt(194, 278),
    ...bowlArc,
    pt(6, 726),
    pt(30, 540),
    pt(26, 175),
  ]);
  const hole = contour(
    sampleSuperellipse(314, 502, 114, 90, { exp: 2.5, steps: 18, tilt: -0.11 }),
    { hole: true }
  );
  return [outer, hole];
}

function buildUpperQ() {
  // Unified Q outer contour with bold diagonal punk tail seamlessly grafted at bottom-right.
  const arcMain = sampleSuperellipse(336, 368, 332, 364, {
    exp: 2.85,
    steps: 28,
    startAngle: -0.34,
    endAngle: Math.PI * 2 - 0.86,
    topScale: 0.96,
    bottomScale: 1.04,
    closed: false,
  });
  const outer = contour([...arcMain, pt(584, -84), pt(724, -18), pt(622, 134)]);
  const hole = contour(
    sampleSuperellipse(334, 368, 146, 200, {
      exp: 2.55,
      steps: 24,
      tilt: -0.14,
    }),
    { hole: true }
  );
  return [outer, hole];
}

function buildUpperR() {
  const bowlArc = sampleSuperellipse(312, 514, 276, 212, {
    exp: 2.7,
    steps: 18,
    startAngle: -Math.PI * 0.28,
    endAngle: Math.PI * 0.5,
    closed: false,
  });
  const outer = contour([
    pt(0, 0),
    pt(202, 0),
    pt(194, 304),
    pt(278, 304),
    pt(424, 0),
    pt(638, 0),
    pt(468, 340),
    ...bowlArc,
    pt(6, 726),
    pt(30, 540),
    pt(26, 175),
  ]);
  const hole = contour(sampleSuperellipse(310, 514, 118, 86, { exp: 2.5, steps: 18, tilt: -0.1 }), {
    hole: true,
  });
  return [outer, hole];
}

function buildUpperS() {
  const centerline = joinCenterline(
    sampleCubic([470, 578], [452, 672], [358, 690], [268, 684], 10),
    sampleCubic([268, 684], [150, 676], [108, 608], [116, 526], 10),
    sampleCubic([116, 526], [126, 428], [266, 396], [362, 364], 10),
    sampleCubic([362, 364], [492, 320], [520, 232], [492, 134], 10),
    sampleCubic([492, 134], [462, 42], [336, 28], [220, 44], 10),
    sampleCubic([220, 44], [134, 56], [96, 108], [86, 168], 6)
  );
  return [
    strokeRibbon(centerline, (t) => 148 + 26 * Math.sin(t * Math.PI), {
      flareStart: 22,
      flareEnd: 26,
      slantStart: 8,
      slantEnd: -10,
    }),
  ];
}

function buildUpperT() {
  return [
    contour([
      pt(198, 0),
      pt(404, 0),
      pt(388, 175),
      pt(390, 566),
      pt(592, 578),
      pt(604, 728),
      pt(0, 718),
      pt(14, 566),
      pt(212, 566),
      pt(214, 175),
    ]),
  ];
}

function buildUpperU() {
  const centerline = joinCenterline(
    [
      [112, 712],
      [114, 274],
    ],
    sampleCubic([114, 274], [116, 78], [226, 58], [306, 58], 10),
    sampleCubic([306, 58], [396, 58], [496, 86], [498, 278], 10),
    [
      [498, 278],
      [500, 712],
    ]
  );
  return [
    strokeRibbon(centerline, (t) => 158 + 16 * Math.sin(t * Math.PI), {
      flareStart: 24,
      flareEnd: 24,
      slantStart: -8,
      slantEnd: 8,
    }),
  ];
}

function buildUpperV() {
  return [
    contour([
      pt(226, 0),
      pt(424, 0),
      pt(654, 724),
      pt(454, 724),
      pt(328, 224),
      pt(196, 724),
      pt(0, 720),
    ]),
  ];
}

function buildUpperW() {
  return [
    contour([
      pt(146, 0),
      pt(322, 0),
      pt(426, 330),
      pt(528, 0),
      pt(706, 0),
      pt(854, 726),
      pt(666, 726),
      pt(594, 274),
      pt(492, 594),
      pt(360, 594),
      pt(258, 274),
      pt(186, 726),
      pt(0, 720),
    ]),
  ];
}

function buildUpperX() {
  return [
    contour([
      pt(0, 0),
      pt(204, 0),
      pt(318, 224),
      pt(432, 0),
      pt(640, 0),
      pt(428, 362),
      pt(624, 724),
      pt(422, 724),
      pt(318, 504),
      pt(212, 724),
      pt(12, 724),
      pt(206, 362),
    ]),
  ];
}

function buildUpperY() {
  return [
    contour([
      pt(214, 0),
      pt(412, 0),
      pt(404, 304),
      pt(632, 724),
      pt(426, 724),
      pt(314, 466),
      pt(202, 724),
      pt(0, 720),
      pt(222, 304),
    ]),
  ];
}

function buildUpperZ() {
  return [
    contour([
      pt(0, 0),
      pt(574, 0),
      pt(586, 158),
      pt(232, 150),
      pt(572, 578),
      pt(572, 726),
      pt(14, 720),
      pt(4, 564),
      pt(344, 574),
      pt(0, 144),
    ]),
  ];
}

/* ============================================================================
 * LOWERCASE GLYPH BUILDERS (a-z + dotless i)
 * Distinct funky Gen-Z lowercase anatomy: double-story a, tilted e eye,
 * bouncy ascenders, sweeping curved descenders, tilted diamond tittles.
 * ============================================================================ */

function buildLowerA() {
  // Authentic funky double-story lowercase a: hooded arch + plump lower belly + tilted counter.
  const hoodOuter = sampleSuperellipse(268, 356, 244, 186, {
    exp: 2.65,
    steps: 16,
    startAngle: 0.04,
    endAngle: Math.PI * 0.92,
    closed: false,
  });
  const hoodInner = sampleSuperellipse(254, 360, 118, 72, {
    exp: 2.5,
    steps: 10,
    startAngle: Math.PI * 0.9,
    endAngle: 0.06,
    closed: false,
  });
  const bellyOuter = sampleSuperellipse(244, 168, 240, 174, {
    exp: 2.75,
    steps: 18,
    startAngle: Math.PI * 0.38,
    endAngle: Math.PI * 1.62,
    closed: false,
  });
  const outer = contour([
    pt(346, 0),
    pt(536, 0),
    pt(512, 140),
    ...hoodOuter,
    pt(30, 376),
    pt(142, 368),
    ...hoodInner,
    pt(358, 324),
    ...bellyOuter,
    pt(350, 44),
  ]);
  const hole = contour(sampleSuperellipse(252, 170, 96, 74, { exp: 2.5, steps: 16, tilt: 0.16 }), {
    hole: true,
  });
  return [outer, hole];
}

function buildLowerB() {
  const bowlArc = sampleSuperellipse(276, 268, 274, 272, {
    exp: 2.75,
    steps: 20,
    startAngle: -Math.PI * 0.62,
    endAngle: Math.PI * 0.62,
    closed: false,
  });
  const outer = contour([
    pt(0, 0),
    pt(166, 0),
    pt(176, 46),
    ...bowlArc,
    pt(168, 492),
    pt(176, LOWERCASE_ASCENDER),
    pt(4, 730),
    pt(22, 540),
    pt(18, 160),
  ]);
  const hole = contour(
    sampleSuperellipse(282, 268, 112, 132, { exp: 2.55, steps: 18, tilt: -0.14 }),
    { hole: true }
  );
  return [outer, hole];
}

function buildLowerC() {
  const arc = sampleSuperellipse(274, 268, 186, 202, {
    exp: 2.8,
    steps: 26,
    startAngle: 0.56,
    endAngle: Math.PI * 2 - 0.56,
    closed: false,
  }).map((vertex) => [vertex.x, vertex.y]);
  return [
    strokeRibbon(arc, (t) => 142 - 14 * Math.sin(t * Math.PI) ** 2, {
      flareStart: 20,
      flareEnd: 20,
      slantStart: 10,
      slantEnd: -10,
    }),
  ];
}

function buildLowerD() {
  const bowlArc = sampleSuperellipse(272, 268, 272, 272, {
    exp: 2.75,
    steps: 20,
    startAngle: Math.PI * 0.38,
    endAngle: Math.PI * 1.62,
    closed: false,
  });
  const outer = contour([
    pt(376, 0),
    pt(548, 0),
    pt(528, 165),
    pt(532, 540),
    pt(544, LOWERCASE_ASCENDER),
    pt(374, 734),
    pt(380, 492),
    ...bowlArc,
    pt(372, 46),
  ]);
  const hole = contour(
    sampleSuperellipse(266, 268, 112, 132, { exp: 2.55, steps: 18, tilt: 0.14 }),
    { hole: true }
  );
  return [outer, hole];
}

function buildLowerE() {
  // Iconic funky tilted-eye lowercase e!
  const outerArc = sampleSuperellipse(278, 268, 278, 274, {
    exp: 2.8,
    steps: 26,
    startAngle: -0.34,
    endAngle: Math.PI * 1.82,
    topScale: 0.98,
    bottomScale: 1.04,
    closed: false,
  });
  const innerLower = sampleSuperellipse(282, 256, 136, 134, {
    exp: 2.6,
    steps: 14,
    startAngle: Math.PI * 1.74,
    endAngle: Math.PI * 0.96,
    closed: false,
  });
  const outer = contour([...outerArc, pt(424, 152), ...innerLower, pt(552, 278)]);
  // Bright tilted diagonal eye counter clearly above crossbar.
  const eyeHole = contour(
    [
      pt(150, 294),
      pt(418, 358),
      ...sampleSuperellipse(282, 358, 136, 86, {
        exp: 2.55,
        steps: 14,
        startAngle: 0.08,
        endAngle: Math.PI - 0.14,
        closed: false,
      }),
    ],
    { hole: true }
  );
  return [outer, eyeHole];
}

function buildLowerF() {
  // Unified single-perimeter f with integrated crossbar and curved top hook (zero overlap!).
  const topOuter = sampleCubic([128, 520], [126, 742], [248, 764], [404, 728], 12);
  const topInner = sampleCubic([386, 588], [304, 608], [268, 578], [268, 514], 10);
  return [
    contour([
      pt(112, 0),
      pt(286, 0),
      pt(270, 384),
      pt(390, 394),
      pt(398, 516),
      pt(268, 512),
      ...topInner
        .slice()
        .reverse()
        .map(([x, y]) => pt(x, y, true)),
      pt(404, 728),
      ...topOuter
        .slice()
        .reverse()
        .map(([x, y]) => pt(x, y, true)),
      pt(124, 504),
      pt(6, 496),
      pt(0, 376),
      pt(124, 382),
    ]),
  ];
}

function buildLowerG() {
  // Unified smooth single-story g: clean bowl flowing into sweeping curved descender hook.
  const bowlOuter = sampleSuperellipse(268, 320, 266, 224, {
    exp: 2.75,
    steps: 22,
    startAngle: Math.PI * 0.28,
    endAngle: Math.PI * 1.72,
    closed: false,
  });
  const tailOuter = sampleCubic(
    [526, 134],
    [528, -148],
    [388, LOWERCASE_DESCENDER],
    [220, LOWERCASE_DESCENDER],
    12
  );
  const tailTip = sampleCubic(
    [220, LOWERCASE_DESCENDER],
    [110, LOWERCASE_DESCENDER],
    [52, -132],
    [38, -62],
    8
  );
  const tailInner = sampleCubic([164, -22], [190, -64], [280, -60], [364, -18], 10);
  const outer = contour([
    pt(374, 536),
    pt(538, 536),
    pt(526, 134),
    ...tailOuter.slice(1).map(([x, y]) => pt(x, y, true)),
    ...tailTip.slice(1).map(([x, y]) => pt(x, y, true)),
    pt(164, -22),
    ...tailInner.slice(1).map(([x, y]) => pt(x, y, true)),
    pt(380, 128),
    ...bowlOuter.slice().reverse(),
  ]);
  const hole = contour(
    sampleSuperellipse(266, 320, 112, 98, { exp: 2.55, steps: 18, tilt: 0.14 }),
    { hole: true }
  );
  return [outer, hole];
}

function buildLowerH() {
  const archOuter = sampleSuperellipse(336, 330, 198, 212, {
    exp: 2.7,
    steps: 14,
    startAngle: 0,
    endAngle: Math.PI * 0.72,
    closed: false,
  });
  const archInner = sampleSuperellipse(278, 314, 108, 106, {
    exp: 2.5,
    steps: 12,
    startAngle: Math.PI * 0.92,
    endAngle: 0,
    closed: false,
  });
  return [
    contour([
      pt(0, 0),
      pt(178, 0),
      pt(170, 312),
      ...archInner,
      pt(374, 0),
      pt(548, 0),
      pt(534, 330),
      ...archOuter,
      pt(174, 480),
      pt(180, LOWERCASE_ASCENDER),
      pt(4, 734),
      pt(24, 520),
      pt(20, 160),
    ]),
  ];
}

function buildLowerDotlessI() {
  return [
    contour([
      pt(10, 0),
      pt(210, 0),
      pt(190, 164),
      pt(194, 386),
      pt(212, LOWERCASE_HEIGHT),
      pt(12, 524),
      pt(32, 366),
      pt(28, 164),
    ]),
  ];
}

function buildLowerI() {
  return [...buildLowerDotlessI(), funkyDot(114, 668, 86, 80, 0.24)];
}

function buildLowerJ() {
  const centerline = joinCenterline(
    [
      [226, 522],
      [224, 80],
    ],
    sampleCubic([224, 80], [220, -104], [140, -138], [32, -106], 10)
  );
  const stem = strokeRibbon(centerline, () => 146, {
    flareStart: 22,
    flareEnd: 20,
    slantStart: -6,
    slantEnd: 10,
  });
  return [stem, funkyDot(232, 668, 86, 80, -0.22)];
}

function buildLowerK() {
  return [
    contour([
      pt(0, 0),
      pt(178, 0),
      pt(170, 210),
      pt(232, 256),
      pt(368, 0),
      pt(554, 0),
      pt(350, 314),
      pt(532, LOWERCASE_HEIGHT),
      pt(350, LOWERCASE_HEIGHT),
      pt(170, 354),
      pt(178, LOWERCASE_ASCENDER),
      pt(6, 734),
      pt(24, 520),
      pt(20, 160),
    ]),
  ];
}

function buildLowerL() {
  return [
    contour([
      pt(16, 0),
      pt(234, 0),
      pt(242, 128),
      pt(184, 136),
      pt(186, 560),
      pt(204, LOWERCASE_ASCENDER),
      pt(8, 728),
      pt(28, 540),
      pt(24, 150),
    ]),
  ];
}

function buildLowerM() {
  const rightArchOuter = sampleSuperellipse(614, 344, 166, 198, {
    exp: 2.7,
    steps: 12,
    startAngle: 0,
    endAngle: Math.PI * 0.76,
    closed: false,
  });
  const leftArchOuter = sampleSuperellipse(314, 344, 166, 198, {
    exp: 2.7,
    steps: 12,
    startAngle: Math.PI * 0.2,
    endAngle: Math.PI * 0.78,
    closed: false,
  });
  const rightArchInner = sampleSuperellipse(568, 336, 76, 84, {
    exp: 2.4,
    steps: 10,
    startAngle: Math.PI,
    endAngle: 0,
    closed: false,
  });
  const leftArchInner = sampleSuperellipse(268, 336, 76, 84, {
    exp: 2.4,
    steps: 10,
    startAngle: Math.PI,
    endAngle: 0,
    closed: false,
  });
  return [
    contour([
      pt(0, 0),
      pt(164, 0),
      pt(160, 330),
      ...leftArchInner,
      pt(344, 0),
      pt(496, 0),
      pt(492, 330),
      ...rightArchInner,
      pt(644, 0),
      pt(802, 0),
      pt(782, 344),
      ...rightArchOuter,
      pt(468, 468),
      ...leftArchOuter,
      pt(158, 476),
      pt(154, LOWERCASE_HEIGHT),
      pt(2, 526),
      pt(18, 320),
    ]),
  ];
}

function buildLowerN() {
  const archOuter = sampleSuperellipse(330, 330, 202, 212, {
    exp: 2.7,
    steps: 14,
    startAngle: 0,
    endAngle: Math.PI * 0.74,
    closed: false,
  });
  const archInner = sampleSuperellipse(274, 314, 104, 108, {
    exp: 2.5,
    steps: 12,
    startAngle: Math.PI * 0.94,
    endAngle: 0,
    closed: false,
  });
  return [
    contour([
      pt(0, 0),
      pt(176, 0),
      pt(170, 314),
      ...archInner,
      pt(372, 0),
      pt(546, 0),
      pt(532, 330),
      ...archOuter,
      pt(166, 466),
      pt(160, LOWERCASE_HEIGHT),
      pt(2, 526),
      pt(20, 320),
    ]),
  ];
}

function buildLowerO() {
  const outer = contour(
    sampleSuperellipse(276, 268, 276, 274, {
      exp: 2.8,
      steps: 28,
      topScale: 0.96,
      bottomScale: 1.05,
    })
  );
  const hole = contour(
    sampleSuperellipse(276, 268, 114, 134, {
      exp: 2.5,
      steps: 20,
      tilt: -0.18,
    }),
    { hole: true }
  );
  return [outer, hole];
}

function buildLowerP() {
  const bowlArc = sampleSuperellipse(276, 268, 274, 272, {
    exp: 2.75,
    steps: 20,
    startAngle: -Math.PI * 0.62,
    endAngle: Math.PI * 0.62,
    closed: false,
  });
  const outer = contour([
    pt(2, LOWERCASE_DESCENDER),
    pt(180, LOWERCASE_DESCENDER),
    pt(170, 46),
    ...bowlArc,
    pt(164, 492),
    pt(158, LOWERCASE_HEIGHT),
    pt(4, 526),
    pt(24, 240),
  ]);
  const hole = contour(
    sampleSuperellipse(282, 268, 112, 132, { exp: 2.55, steps: 18, tilt: -0.14 }),
    { hole: true }
  );
  return [outer, hole];
}

function buildLowerQ() {
  const bowlArc = sampleSuperellipse(272, 268, 272, 272, {
    exp: 2.75,
    steps: 20,
    startAngle: Math.PI * 0.38,
    endAngle: Math.PI * 1.62,
    closed: false,
  });
  const outer = contour([
    pt(374, LOWERCASE_DESCENDER),
    pt(552, -158),
    pt(532, 180),
    pt(546, LOWERCASE_HEIGHT),
    pt(380, 528),
    pt(376, 492),
    ...bowlArc,
    pt(372, 46),
  ]);
  const hole = contour(
    sampleSuperellipse(266, 268, 112, 132, { exp: 2.55, steps: 18, tilt: 0.14 }),
    { hole: true }
  );
  return [outer, hole];
}

function buildLowerR() {
  const shoulderOuter = sampleSuperellipse(294, 344, 152, 198, {
    exp: 2.6,
    steps: 12,
    startAngle: 0.25,
    endAngle: Math.PI * 0.78,
    closed: false,
  });
  const shoulderInner = sampleSuperellipse(286, 318, 92, 92, {
    exp: 2.4,
    steps: 10,
    startAngle: Math.PI * 0.92,
    endAngle: 0.15,
    closed: false,
  });
  return [
    contour([
      pt(0, 0),
      pt(184, 0),
      pt(174, 314),
      ...shoulderInner,
      pt(424, 386),
      ...shoulderOuter,
      pt(166, 462),
      pt(160, LOWERCASE_HEIGHT),
      pt(4, 526),
      pt(24, 320),
    ]),
  ];
}

function buildLowerS() {
  const centerline = joinCenterline(
    sampleCubic([398, 430], [382, 502], [298, 514], [224, 508], 10),
    sampleCubic([224, 508], [126, 500], [92, 444], [100, 382], 10),
    sampleCubic([100, 382], [110, 310], [226, 286], [308, 262], 10),
    sampleCubic([308, 262], [414, 230], [434, 162], [412, 96], 10),
    sampleCubic([412, 96], [388, 28], [282, 18], [186, 30], 10),
    sampleCubic([186, 30], [114, 40], [82, 82], [74, 128], 6)
  );
  return [
    strokeRibbon(centerline, (t) => 126 + 22 * Math.sin(t * Math.PI), {
      flareStart: 18,
      flareEnd: 22,
      slantStart: 8,
      slantEnd: -8,
    }),
  ];
}

function buildLowerT() {
  // Unified single-perimeter t with angled crown, integrated crossbar, and curved chunky foot (zero overlap!).
  const footOuter = sampleCubic([122, 166], [122, 6], [234, -14], [386, 10], 10);
  const footInner = sampleCubic([378, 138], [296, 128], [272, 148], [272, 206], 8);
  return [
    contour([
      ...footOuter.map(([x, y]) => pt(x, y, true)),
      pt(378, 138),
      ...footInner.slice(1).map(([x, y]) => pt(x, y, true)),
      pt(272, 384),
      pt(390, 394),
      pt(398, 514),
      pt(272, 510),
      pt(280, 684),
      pt(120, 654),
      pt(124, 502),
      pt(8, 494),
      pt(0, 376),
      pt(124, 382),
    ]),
  ];
}

function buildLowerU() {
  const troughOuter = sampleSuperellipse(216, 206, 202, 212, {
    exp: 2.7,
    steps: 14,
    startAngle: Math.PI,
    endAngle: Math.PI * 1.74,
    closed: false,
  });
  const troughInner = sampleSuperellipse(274, 222, 104, 108, {
    exp: 2.5,
    steps: 12,
    startAngle: Math.PI * 1.94,
    endAngle: Math.PI,
    closed: false,
  });
  return [
    contour([
      pt(380, 0),
      pt(546, 0),
      pt(528, 220),
      pt(546, LOWERCASE_HEIGHT),
      pt(372, LOWERCASE_HEIGHT),
      pt(376, 222),
      ...troughInner,
      pt(174, LOWERCASE_HEIGHT),
      pt(0, 526),
      pt(14, 206),
      ...troughOuter,
      pt(376, 70),
    ]),
  ];
}

function buildLowerV() {
  return [
    contour([
      pt(184, 0),
      pt(360, 0),
      pt(548, LOWERCASE_HEIGHT),
      pt(376, LOWERCASE_HEIGHT),
      pt(274, 186),
      pt(170, LOWERCASE_HEIGHT),
      pt(0, 526),
    ]),
  ];
}

function buildLowerW() {
  return [
    contour([
      pt(126, 0),
      pt(276, 0),
      pt(366, 246),
      pt(454, 0),
      pt(604, 0),
      pt(732, LOWERCASE_HEIGHT),
      pt(570, LOWERCASE_HEIGHT),
      pt(510, 210),
      pt(424, 444),
      pt(308, 444),
      pt(222, 210),
      pt(162, LOWERCASE_HEIGHT),
      pt(0, 526),
    ]),
  ];
}

function buildLowerX() {
  return [
    contour([
      pt(0, 0),
      pt(176, 0),
      pt(268, 166),
      pt(360, 0),
      pt(540, 0),
      pt(364, 270),
      pt(526, LOWERCASE_HEIGHT),
      pt(354, LOWERCASE_HEIGHT),
      pt(268, 376),
      pt(182, LOWERCASE_HEIGHT),
      pt(10, LOWERCASE_HEIGHT),
      pt(174, 270),
    ]),
  ];
}

function buildLowerY() {
  return [
    contour([
      pt(104, LOWERCASE_DESCENDER),
      pt(274, -158),
      pt(546, LOWERCASE_HEIGHT),
      pt(374, LOWERCASE_HEIGHT),
      pt(272, 184),
      pt(172, LOWERCASE_HEIGHT),
      pt(0, 526),
      pt(194, 28),
    ]),
  ];
}

function buildLowerZ() {
  return [
    contour([
      pt(0, 0),
      pt(476, 0),
      pt(488, 134),
      pt(204, 128),
      pt(478, 412),
      pt(478, LOWERCASE_HEIGHT),
      pt(12, 528),
      pt(2, 404),
      pt(278, 412),
      pt(0, 120),
    ]),
  ];
}

/* ============================================================================
 * DIGITS (0-9)
 * ============================================================================ */

function buildDigit0() {
  const outer = contour(
    sampleSuperellipse(294, 362, 294, 370, {
      exp: 2.85,
      steps: 30,
      topScale: 0.96,
      bottomScale: 1.04,
    })
  );
  const hole = contour(
    sampleSuperellipse(294, 362, 118, 206, {
      exp: 2.55,
      steps: 22,
      tilt: -0.15,
    }),
    { hole: true }
  );
  return [outer, hole];
}

function buildDigit1() {
  return [
    contour([
      pt(16, 0),
      pt(432, 0),
      pt(424, 146),
      pt(318, 154),
      pt(318, 728),
      pt(164, 728),
      pt(0, 542),
      pt(94, 444),
      pt(146, 502),
      pt(146, 154),
      pt(26, 146),
    ]),
  ];
}

function buildDigit2() {
  // Unified single-perimeter 2: smooth funky swan-neck top + sharp chunky flared base (zero corner kink!).
  const topOuter = sampleCubic([26, 484], [42, 718], [218, 742], [356, 730], 12);
  const neckOuter = sampleCubic([356, 730], [526, 714], [574, 586], [548, 456], 12);
  const slopeOuter = sampleCubic([548, 456], [520, 316], [344, 212], [250, 152], 10);
  const slopeInner = sampleCubic([26, 150], [160, 276], [356, 386], [374, 480], 10);
  const topInner = sampleCubic([374, 480], [386, 548], [336, 584], [276, 584], 8);
  const hookInner = sampleCubic([276, 584], [216, 584], [186, 544], [178, 476], 6);
  return [
    contour([
      pt(0, 0),
      pt(562, 0),
      pt(574, 162),
      pt(250, 152),
      ...slopeOuter
        .slice()
        .reverse()
        .slice(1)
        .map(([x, y]) => pt(x, y, true)),
      ...neckOuter
        .slice()
        .reverse()
        .slice(1)
        .map(([x, y]) => pt(x, y, true)),
      ...topOuter
        .slice()
        .reverse()
        .slice(1)
        .map(([x, y]) => pt(x, y, true)),
      pt(178, 476),
      ...hookInner
        .slice()
        .reverse()
        .slice(1)
        .map(([x, y]) => pt(x, y, true)),
      ...topInner
        .slice()
        .reverse()
        .slice(1)
        .map(([x, y]) => pt(x, y, true)),
      ...slopeInner
        .slice()
        .reverse()
        .slice(1)
        .map(([x, y]) => pt(x, y, true)),
      pt(0, 126),
    ]),
  ];
}

function buildDigit3() {
  // Unified single-perimeter 3: smooth double-bellied outer + crisp waist (zero self-overlap!).
  const lowerOuter = sampleSuperellipse(294, 204, 266, 214, {
    exp: 2.75,
    steps: 18,
    startAngle: -Math.PI * 0.86,
    endAngle: Math.PI * 0.36,
    closed: false,
  });
  const upperOuter = sampleSuperellipse(284, 534, 236, 198, {
    exp: 2.7,
    steps: 18,
    startAngle: -Math.PI * 0.36,
    endAngle: Math.PI * 0.86,
    closed: false,
  });
  const upperInner = sampleSuperellipse(274, 532, 106, 74, {
    exp: 2.5,
    steps: 12,
    startAngle: Math.PI * 0.82,
    endAngle: -Math.PI * 0.44,
    closed: false,
  });
  const lowerInner = sampleSuperellipse(284, 206, 122, 84, {
    exp: 2.5,
    steps: 12,
    startAngle: Math.PI * 0.44,
    endAngle: -Math.PI * 0.84,
    closed: false,
  });
  return [
    contour([
      ...lowerOuter,
      pt(452, 384),
      ...upperOuter,
      pt(184, 560),
      ...upperInner,
      pt(214, 444),
      pt(214, 308),
      ...lowerInner,
      pt(150, 168),
    ]),
  ];
}

function buildDigit4() {
  const outer = contour([
    pt(340, 0),
    pt(526, 0),
    pt(518, 170),
    pt(610, 178),
    pt(618, 326),
    pt(518, 320),
    pt(528, 728),
    pt(320, 728),
    pt(0, 294),
    pt(0, 166),
    pt(344, 170),
  ]);
  const hole = contour([pt(184, 316), pt(354, 316), pt(354, 536)], { hole: true });
  return [outer, hole];
}

function buildDigit5() {
  const centerline = joinCenterline(
    [
      [486, 650],
      [174, 646],
      [154, 412],
    ],
    sampleCubic([154, 412], [254, 446], [420, 424], [468, 314], 10),
    sampleCubic([468, 314], [516, 200], [452, 68], [306, 56], 10),
    sampleCubic([306, 56], [182, 46], [118, 92], [96, 164], 8)
  );
  return [
    strokeRibbon(centerline, (t) => 150 + 18 * Math.sin(t * Math.PI), {
      flareStart: 24,
      flareEnd: 24,
      slantStart: 12,
      slantEnd: -8,
    }),
  ];
}

function buildDigit6() {
  const lowerBowl = sampleSuperellipse(294, 240, 294, 248, {
    exp: 2.75,
    steps: 24,
    startAngle: -Math.PI,
    endAngle: Math.PI * 0.56,
    closed: false,
  });
  const topOuter = sampleCubic([0, 240], [2, 624], [184, 736], [462, 724], 14);
  const topInner = sampleCubic([458, 566], [276, 580], [186, 502], [174, 424], 10);
  const outer = contour([
    ...lowerBowl,
    ...topInner
      .slice()
      .reverse()
      .map(([x, y]) => pt(x, y, true)),
    pt(472, 574),
    pt(462, 724),
    ...topOuter
      .slice()
      .reverse()
      .slice(1)
      .map(([x, y]) => pt(x, y, true)),
  ]);
  const hole = contour(
    sampleSuperellipse(296, 238, 120, 102, { exp: 2.55, steps: 18, tilt: -0.14 }),
    { hole: true }
  );
  return [outer, hole];
}

function buildDigit7() {
  return [
    contour([
      pt(120, 0),
      pt(324, 0),
      pt(548, 594),
      pt(554, 728),
      pt(0, 720),
      pt(12, 560),
      pt(344, 572),
    ]),
  ];
}

function buildDigit8() {
  const lowerRight = sampleSuperellipse(296, 198, 296, 206, {
    exp: 2.7,
    steps: 14,
    startAngle: -Math.PI * 0.5,
    endAngle: Math.PI * 0.36,
    closed: false,
  });
  const upperLoop = sampleSuperellipse(296, 538, 260, 194, {
    exp: 2.7,
    steps: 18,
    startAngle: -Math.PI * 0.36,
    endAngle: Math.PI * 1.36,
    closed: false,
  });
  const lowerLeft = sampleSuperellipse(296, 198, 296, 206, {
    exp: 2.7,
    steps: 14,
    startAngle: Math.PI * 0.64,
    endAngle: Math.PI * 1.5,
    closed: false,
  });
  const outer = contour([...lowerRight, ...upperLoop, ...lowerLeft]);
  const upperHole = contour(
    sampleSuperellipse(296, 540, 106, 74, { exp: 2.5, steps: 16, tilt: 0.1 }),
    { hole: true }
  );
  const lowerHole = contour(
    sampleSuperellipse(296, 196, 128, 84, { exp: 2.5, steps: 16, tilt: -0.1 }),
    { hole: true }
  );
  return [outer, upperHole, lowerHole];
}

function buildDigit9() {
  // Exact 180-degree rotated twin of 6 (with slightly taller cap proportions) for cohesion.
  const baseSix = buildDigit6();
  return baseSix.map((shape) => ({
    ...shape,
    points: ensureWinding(
      shape.points.map((vertex) =>
        pt(588 - vertex.x, 724 - vertex.y, vertex.smooth, vertex.noGrunge)
      ),
      !shape.hole
    ),
  }));
}

/* ============================================================================
 * PUNCTUATION & SYMBOLS
 * ============================================================================ */

function buildExclamation() {
  const blade = contour([pt(42, 232), pt(176, 232), pt(222, 736), pt(0, 724)]);
  return [blade, funkyDot(112, 86, 84, 82, 0.22)];
}

function buildQuestion() {
  const centerline = joinCenterline(
    sampleCubic([96, 536], [110, 668], [234, 682], [318, 672], 10),
    sampleCubic([318, 672], [430, 658], [456, 566], [428, 476], 10),
    sampleCubic([428, 476], [398, 384], [256, 366], [250, 250], 10)
  );
  const hook = strokeRibbon(centerline, (t) => 144 - 16 * t, {
    flareStart: 22,
    flareEnd: 10,
    slantStart: -10,
    slantEnd: 0,
  });
  return [hook, funkyDot(252, 84, 84, 82, -0.2)];
}

function buildPeriod() {
  return [funkyDot(92, 84, 86, 84, 0.2)];
}

function buildComma() {
  return [
    contour(
      [pt(16, -98), pt(126, -74), pt(194, 58), pt(184, 172), pt(30, 162), pt(22, 54), pt(84, 24)],
      { noGrunge: true }
    ),
  ];
}

function buildColon() {
  return [funkyDot(92, 86, 82, 80, 0.2), funkyDot(98, 412, 82, 80, -0.18)];
}

function buildSemicolon() {
  return [...buildComma(), funkyDot(108, 412, 82, 80, -0.18)];
}

function buildHyphen() {
  return [flaredBar(0, 326, 314, 344, 134, { flare0: 14, flare1: 14, bevel0: 10, bevel1: -10 })];
}

function buildEnDash() {
  return [flaredBar(0, 330, 488, 348, 128, { flare0: 14, flare1: 14, bevel0: 10, bevel1: -10 })];
}

function buildEmDash() {
  return [flaredBar(0, 330, 740, 348, 126, { flare0: 16, flare1: 16, bevel0: 10, bevel1: -10 })];
}

function buildUnderscore() {
  return [flaredBar(0, -104, 520, -96, 114, { flare0: 12, flare1: 12, bevel0: 8, bevel1: -8 })];
}

function buildMiddleDot() {
  return [funkyDot(92, 346, 78, 76, 0.25)];
}

function buildBullet() {
  return [funkyDot(128, 348, 122, 118, 0.16)];
}

function buildEllipsis() {
  return [
    funkyDot(86, 84, 78, 76, 0.2),
    funkyDot(294, 96, 78, 76, -0.18),
    funkyDot(502, 78, 78, 76, 0.24),
  ];
}

function buildSingleQuote() {
  return [contour([pt(28, 470), pt(146, 470), pt(178, 734), pt(0, 722)], { noGrunge: true })];
}

function buildDoubleQuote() {
  return [
    contour([pt(24, 470), pt(138, 470), pt(168, 734), pt(0, 722)], { noGrunge: true }),
    contour([pt(214, 464), pt(328, 464), pt(360, 734), pt(192, 722)], { noGrunge: true }),
  ];
}

function buildGraveSymbol() {
  return [contour([pt(124, 530), pt(236, 558), pt(106, 746), pt(0, 704)], { noGrunge: true })];
}

function buildLeftSingleCurlyQuote() {
  return [
    contour(
      [
        pt(10, 470),
        pt(166, 478),
        pt(174, 584),
        pt(114, 616),
        pt(176, 736),
        pt(64, 722),
        pt(4, 588),
      ],
      { noGrunge: true }
    ),
  ];
}

function buildRightSingleCurlyQuote() {
  return [
    contour(
      [
        pt(12, 464),
        pt(124, 480),
        pt(184, 614),
        pt(178, 732),
        pt(24, 722),
        pt(16, 618),
        pt(76, 586),
      ],
      { noGrunge: true }
    ),
  ];
}

function buildLeftDoubleCurlyQuote() {
  const first = buildLeftSingleCurlyQuote();
  const second = transformContours(first, { dx: 196, dy: -8 });
  return [...first, ...second];
}

function buildRightDoubleCurlyQuote() {
  const first = buildRightSingleCurlyQuote();
  const second = transformContours(first, { dx: 196, dy: 8 });
  return [...first, ...second];
}

function buildSlash() {
  return [flaredBar(66, -78, 354, 736, 134, { flare0: 18, flare1: 18 })];
}

function buildBackslash() {
  return [flaredBar(354, -78, 66, 736, 134, { flare0: 18, flare1: 18 })];
}

function buildPipe() {
  return [flaredBar(96, -138, 102, 766, 132, { flare0: 16, flare1: 16 })];
}

function buildLeftParen() {
  const arc = sampleCubic([274, 742], [68, 560], [68, 136], [274, -104], 18);
  return [
    strokeRibbon(arc, (t) => 128 + 26 * Math.sin(t * Math.PI), { flareStart: 14, flareEnd: 14 }),
  ];
}

function buildRightParen() {
  const arc = sampleCubic([64, 742], [270, 560], [270, 136], [64, -104], 18);
  return [
    strokeRibbon(arc, (t) => 128 + 26 * Math.sin(t * Math.PI), { flareStart: 14, flareEnd: 14 }),
  ];
}

function buildLeftBracket() {
  return [
    contour([
      pt(0, -102),
      pt(306, -94),
      pt(296, 36),
      pt(154, 30),
      pt(156, 612),
      pt(302, 618),
      pt(312, 746),
      pt(0, 742),
    ]),
  ];
}

function buildRightBracket() {
  return [
    contour([
      pt(0, -94),
      pt(312, -102),
      pt(308, 742),
      pt(0, 746),
      pt(10, 618),
      pt(156, 612),
      pt(154, 30),
      pt(10, 36),
    ]),
  ];
}

function buildLeftBrace() {
  const centerline = joinCenterline(
    sampleCubic([306, 724], [164, 728], [168, 568], [168, 434], 8),
    [
      [168, 434],
      [70, 326],
      [168, 220],
    ],
    sampleCubic([168, 220], [168, 76], [164, -84], [306, -80], 8)
  );
  return [strokeRibbon(centerline, () => 122, { flareStart: 14, flareEnd: 14 })];
}

function buildRightBrace() {
  const centerline = joinCenterline(
    sampleCubic([64, 724], [206, 728], [202, 568], [202, 434], 8),
    [
      [202, 434],
      [300, 326],
      [202, 220],
    ],
    sampleCubic([202, 220], [202, 76], [206, -84], [64, -80], 8)
  );
  return [strokeRibbon(centerline, () => 122, { flareStart: 14, flareEnd: 14 })];
}

function buildLessThan() {
  const centerline = [
    [454, 594],
    [82, 344],
    [454, 96],
  ];
  return [strokeRibbon(centerline, () => 136, { flareStart: 18, flareEnd: 18 })];
}

function buildGreaterThan() {
  const centerline = [
    [82, 594],
    [454, 344],
    [82, 96],
  ];
  return [strokeRibbon(centerline, () => 136, { flareStart: 18, flareEnd: 18 })];
}

function buildPlus() {
  // Single non-overlapping 12-vertex chunky flared cross.
  return [
    contour([
      pt(196, 86),
      pt(348, 86),
      pt(340, 276),
      pt(530, 272),
      pt(536, 424),
      pt(340, 418),
      pt(348, 608),
      pt(196, 608),
      pt(204, 418),
      pt(8, 424),
      pt(14, 272),
      pt(204, 276),
    ]),
  ];
}

function buildMultiply() {
  const base = buildPlus();
  const angle = Math.PI * 0.25;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const cx = 272;
  const cy = 347;
  return base.map((shape) => ({
    ...shape,
    points: ensureWinding(
      shape.points.map((vertex) => {
        const rx = vertex.x - cx;
        const ry = vertex.y - cy;
        return pt(rx * cosA - ry * sinA + cx, rx * sinA + ry * cosA + cy);
      }),
      true
    ),
  }));
}

function buildEquals() {
  return [
    flaredBar(0, 436, 488, 452, 130, { flare0: 12, flare1: 12, bevel0: 8, bevel1: -8 }),
    flaredBar(0, 212, 488, 228, 130, { flare0: 12, flare1: 12, bevel0: 8, bevel1: -8 }),
  ];
}

function buildAsterisk() {
  // Bold 6-point punk star burst (single non-overlapping perimeter).
  const points = [];
  const spikes = 6;
  const cx = 228;
  const cy = 516;
  const outerR = 216;
  const innerR = 88;
  for (let index = 0; index < spikes * 2; index += 1) {
    const angle = (index * Math.PI) / spikes - Math.PI * 0.5 + 0.14;
    const radius = index % 2 === 0 ? outerR * (index % 4 === 0 ? 1.06 : 0.96) : innerR;
    points.push(pt(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
  }
  return [contour(points, { noGrunge: true })];
}

function buildHash() {
  // Clean single-perimeter outer + central CW window cutout so zero overlap occurs!
  const outer = contour([
    pt(82, 0),
    pt(214, 0),
    pt(232, 152),
    pt(344, 152),
    pt(326, 0),
    pt(458, 0),
    pt(476, 152),
    pt(592, 158),
    pt(602, 282),
    pt(490, 276),
    pt(508, 434),
    pt(614, 440),
    pt(624, 566),
    pt(522, 560),
    pt(542, 720),
    pt(408, 720),
    pt(390, 560),
    pt(278, 560),
    pt(298, 720),
    pt(164, 720),
    pt(144, 560),
    pt(30, 554),
    pt(20, 428),
    pt(130, 434),
    pt(112, 276),
    pt(0, 270),
    pt(10, 146),
    pt(98, 152),
  ]);
  const windowHole = contour([pt(246, 280), pt(358, 280), pt(376, 434), pt(264, 434)], {
    hole: true,
  });
  return [outer, windowHole];
}

function buildDollar() {
  // Juicy S-body + non-overlapping top and bottom protruding stencil-punk spikes (zero CFF overlap!).
  const sShape = buildUpperS();
  const topSpike = flaredBar(298, 704, 304, 822, 118, { flare0: 4, flare1: 18 });
  const bottomSpike = flaredBar(284, -104, 290, 16, 118, { flare0: 18, flare1: 4 });
  return [...sShape, topSpike, bottomSpike];
}

function buildPercent() {
  const slash = flaredBar(128, -28, 526, 744, 128, { flare0: 16, flare1: 16 });
  const topRingOuter = contour(
    sampleSuperellipse(148, 566, 148, 152, { exp: 2.6, steps: 20, noGrunge: true }),
    { noGrunge: true }
  );
  const topRingHole = contour(
    sampleSuperellipse(148, 566, 56, 60, { exp: 2.4, steps: 14, tilt: -0.15 }),
    { hole: true }
  );
  const bottomRingOuter = contour(
    sampleSuperellipse(506, 152, 148, 152, { exp: 2.6, steps: 20, noGrunge: true }),
    { noGrunge: true }
  );
  const bottomRingHole = contour(
    sampleSuperellipse(506, 152, 56, 60, { exp: 2.4, steps: 14, tilt: 0.15 }),
    { hole: true }
  );
  return [slash, topRingOuter, topRingHole, bottomRingOuter, bottomRingHole];
}

function buildAmpersand() {
  // Clean single-perimeter chunky funky ampersand with two crisp CW counter holes (zero pinch!).
  const lowerBelly = sampleSuperellipse(246, 206, 246, 212, {
    exp: 2.75,
    steps: 18,
    startAngle: Math.PI * 0.64,
    endAngle: Math.PI * 1.66,
    closed: false,
  });
  const upperLoop = sampleSuperellipse(268, 558, 202, 174, {
    exp: 2.65,
    steps: 20,
    startAngle: -Math.PI * 0.24,
    endAngle: Math.PI * 1.26,
    closed: false,
  });
  const outer = contour([
    ...lowerBelly,
    pt(486, 0),
    pt(668, 0),
    pt(536, 176),
    pt(636, 368),
    pt(490, 392),
    pt(424, 296),
    ...upperLoop,
    pt(132, 412),
  ]);
  const topHole = contour(
    sampleSuperellipse(270, 560, 82, 68, { exp: 2.4, steps: 16, tilt: -0.14 }),
    { hole: true }
  );
  const bottomHole = contour(
    sampleSuperellipse(244, 204, 102, 84, { exp: 2.5, steps: 16, tilt: 0.14 }),
    { hole: true }
  );
  return [outer, topHole, bottomHole];
}

function buildAt() {
  // Bold outer swirl ribbon cleanly framing an inner chunky 'a' with zero overlap!
  const outerSwirl = sampleSuperellipse(398, 344, 348, 356, {
    exp: 2.72,
    steps: 34,
    startAngle: -0.68,
    endAngle: Math.PI * 1.62,
    closed: false,
  }).map((vertex) => [vertex.x, vertex.y]);
  const swirl = strokeRibbon(outerSwirl, () => 104, { flareStart: 12, flareEnd: 14 });
  const innerAOuter = contour(
    [
      pt(452, 174),
      pt(562, 174),
      pt(562, 514),
      pt(452, 514),
      pt(452, 480),
      ...sampleSuperellipse(362, 344, 152, 166, {
        exp: 2.6,
        steps: 18,
        startAngle: Math.PI * 0.35,
        endAngle: Math.PI * 1.65,
        closed: false,
      }),
      pt(452, 206),
    ],
    { noGrunge: true }
  );
  const innerAHole = contour(
    sampleSuperellipse(366, 344, 62, 78, { exp: 2.4, steps: 16, tilt: -0.12 }),
    { hole: true }
  );
  return [swirl, innerAOuter, innerAHole];
}

function buildCaret() {
  const centerline = [
    [54, 412],
    [252, 706],
    [450, 412],
  ];
  return [strokeRibbon(centerline, () => 126, { flareStart: 16, flareEnd: 16 })];
}

function buildTilde() {
  const centerline = joinCenterline(
    sampleCubic([34, 320], [116, 476], [238, 456], [310, 366], 10),
    sampleCubic([310, 366], [386, 272], [488, 286], [568, 424], 10)
  );
  return [strokeRibbon(centerline, () => 118, { flareStart: 14, flareEnd: 14 })];
}

/* ============================================================================
 * DIACRITIC ACCENT COMPOSERS (Latin-1 accented vowels & consonants)
 * ============================================================================ */

function buildDiacritic(kind, centerX, anchorY, isUpper) {
  const y = anchorY + (isUpper ? 42 : 46);
  switch (kind) {
    case 'grave':
      return [
        contour(
          [
            pt(centerX + 18, y),
            pt(centerX + 96, y + 20),
            pt(centerX - 18, y + 148),
            pt(centerX - 108, y + 104),
          ],
          { noGrunge: true }
        ),
      ];
    case 'acute':
      return [
        contour(
          [
            pt(centerX - 96, y + 20),
            pt(centerX - 18, y),
            pt(centerX + 108, y + 104),
            pt(centerX + 18, y + 148),
          ],
          { noGrunge: true }
        ),
      ];
    case 'circumflex': {
      const centerline = [
        [centerX - 126, y + 26],
        [centerX, y + 132],
        [centerX + 126, y + 26],
      ];
      return [strokeRibbon(centerline, () => 78, { flareStart: 8, flareEnd: 8, noGrunge: true })];
    }
    case 'tilde': {
      const centerline = joinCenterline(
        sampleCubic(
          [centerX - 148, y + 44],
          [centerX - 88, y + 138],
          [centerX - 12, y + 122],
          [centerX + 8, y + 76],
          8
        ),
        sampleCubic(
          [centerX + 8, y + 76],
          [centerX + 38, y + 22],
          [centerX + 108, y + 36],
          [centerX + 148, y + 114],
          8
        )
      );
      return [strokeRibbon(centerline, () => 76, { flareStart: 8, flareEnd: 8, noGrunge: true })];
    }
    case 'diaeresis':
      return [
        funkyDot(centerX - 96, y + 66, 62, 60, 0.2),
        funkyDot(centerX + 96, y + 72, 62, 60, -0.2),
      ];
    case 'ring':
      return [
        contour(
          sampleSuperellipse(centerX, y + 76, 92, 92, { exp: 2.5, steps: 18, noGrunge: true }),
          { noGrunge: true }
        ),
        contour(sampleSuperellipse(centerX, y + 76, 36, 36, { exp: 2.4, steps: 14 }), {
          hole: true,
        }),
      ];
    case 'cedilla': {
      // Positioned cleanly below baseline so cedilla never self-overlaps C/c outer contour.
      const centerline = joinCenterline(
        [
          [centerX + 8, -22],
          [centerX - 10, -78],
        ],
        sampleCubic(
          [centerX - 10, -78],
          [centerX + 76, -80],
          [centerX + 78, -162],
          [centerX - 58, -166],
          10
        )
      );
      return [strokeRibbon(centerline, () => 64, { flareStart: 6, flareEnd: 8, noGrunge: true })];
    }
    default:
      throw new Error(`Unsupported diacritic kind: ${kind}`);
  }
}

/* ============================================================================
 * .notdef GLYPH
 * ============================================================================ */

function buildNotdef() {
  const outer = contour([pt(50, 0), pt(550, 0), pt(550, 720), pt(50, 720)]);
  const hole = contour([pt(156, 106), pt(444, 106), pt(444, 614), pt(156, 614)], { hole: true });
  return [outer, hole];
}

/* ============================================================================
 * GLYPH REGISTRY & ACCENTED CHARACTER MAP
 * ============================================================================ */

const BASE_BUILDERS = {
  A: buildUpperA,
  B: buildUpperB,
  C: buildUpperC,
  D: buildUpperD,
  E: buildUpperE,
  F: buildUpperF,
  G: buildUpperG,
  H: buildUpperH,
  I: buildUpperI,
  J: buildUpperJ,
  K: buildUpperK,
  L: buildUpperL,
  M: buildUpperM,
  N: buildUpperN,
  O: buildUpperO,
  P: buildUpperP,
  Q: buildUpperQ,
  R: buildUpperR,
  S: buildUpperS,
  T: buildUpperT,
  U: buildUpperU,
  V: buildUpperV,
  W: buildUpperW,
  X: buildUpperX,
  Y: buildUpperY,
  Z: buildUpperZ,
  a: buildLowerA,
  b: buildLowerB,
  c: buildLowerC,
  d: buildLowerD,
  e: buildLowerE,
  f: buildLowerF,
  g: buildLowerG,
  h: buildLowerH,
  i: buildLowerI,
  j: buildLowerJ,
  k: buildLowerK,
  l: buildLowerL,
  m: buildLowerM,
  n: buildLowerN,
  o: buildLowerO,
  p: buildLowerP,
  q: buildLowerQ,
  r: buildLowerR,
  s: buildLowerS,
  t: buildLowerT,
  u: buildLowerU,
  v: buildLowerV,
  w: buildLowerW,
  x: buildLowerX,
  y: buildLowerY,
  z: buildLowerZ,
  0: buildDigit0,
  1: buildDigit1,
  2: buildDigit2,
  3: buildDigit3,
  4: buildDigit4,
  5: buildDigit5,
  6: buildDigit6,
  7: buildDigit7,
  8: buildDigit8,
  9: buildDigit9,
  '!': buildExclamation,
  '"': buildDoubleQuote,
  '#': buildHash,
  $: buildDollar,
  '%': buildPercent,
  '&': buildAmpersand,
  "'": buildSingleQuote,
  '(': buildLeftParen,
  ')': buildRightParen,
  '*': buildAsterisk,
  '+': buildPlus,
  ',': buildComma,
  '-': buildHyphen,
  '.': buildPeriod,
  '/': buildSlash,
  ':': buildColon,
  ';': buildSemicolon,
  '<': buildLessThan,
  '=': buildEquals,
  '>': buildGreaterThan,
  '?': buildQuestion,
  '@': buildAt,
  '[': buildLeftBracket,
  '\\': buildBackslash,
  ']': buildRightBracket,
  '^': buildCaret,
  _: buildUnderscore,
  '`': buildGraveSymbol,
  '{': buildLeftBrace,
  '|': buildPipe,
  '}': buildRightBrace,
  '~': buildTilde,
  '–': buildEnDash,
  '—': buildEmDash,
  '·': buildMiddleDot,
  '•': buildBullet,
  '…': buildEllipsis,
  '‘': buildLeftSingleCurlyQuote,
  '’': buildRightSingleCurlyQuote,
  '“': buildLeftDoubleCurlyQuote,
  '”': buildRightDoubleCurlyQuote,
  '×': buildMultiply,
};

const ACCENTED_SPECS = [
  ['À', 'A', 'grave'],
  ['Á', 'A', 'acute'],
  ['Â', 'A', 'circumflex'],
  ['Ã', 'A', 'tilde'],
  ['Ä', 'A', 'diaeresis'],
  ['Å', 'A', 'ring'],
  ['Ç', 'C', 'cedilla'],
  ['È', 'E', 'grave'],
  ['É', 'E', 'acute'],
  ['Ê', 'E', 'circumflex'],
  ['Ë', 'E', 'diaeresis'],
  ['Ì', 'I', 'grave'],
  ['Í', 'I', 'acute'],
  ['Î', 'I', 'circumflex'],
  ['Ï', 'I', 'diaeresis'],
  ['Ñ', 'N', 'tilde'],
  ['Ò', 'O', 'grave'],
  ['Ó', 'O', 'acute'],
  ['Ô', 'O', 'circumflex'],
  ['Õ', 'O', 'tilde'],
  ['Ö', 'O', 'diaeresis'],
  ['Ù', 'U', 'grave'],
  ['Ú', 'U', 'acute'],
  ['Û', 'U', 'circumflex'],
  ['Ü', 'U', 'diaeresis'],
  ['Ý', 'Y', 'acute'],
  ['à', 'a', 'grave'],
  ['á', 'a', 'acute'],
  ['â', 'a', 'circumflex'],
  ['ã', 'a', 'tilde'],
  ['ä', 'a', 'diaeresis'],
  ['å', 'a', 'ring'],
  ['ç', 'c', 'cedilla'],
  ['è', 'e', 'grave'],
  ['é', 'e', 'acute'],
  ['ê', 'e', 'circumflex'],
  ['ë', 'e', 'diaeresis'],
  ['ì', 'ı', 'grave'],
  ['í', 'ı', 'acute'],
  ['î', 'ı', 'circumflex'],
  ['ï', 'ı', 'diaeresis'],
  ['ñ', 'n', 'tilde'],
  ['ò', 'o', 'grave'],
  ['ó', 'o', 'acute'],
  ['ô', 'o', 'circumflex'],
  ['õ', 'o', 'tilde'],
  ['ö', 'o', 'diaeresis'],
  ['ù', 'u', 'grave'],
  ['ú', 'u', 'acute'],
  ['û', 'u', 'circumflex'],
  ['ü', 'u', 'diaeresis'],
  ['ý', 'y', 'acute'],
  ['ÿ', 'y', 'diaeresis'],
];

const POSTSCRIPT_NAMES = {
  ' ': 'space',
  '!': 'exclam',
  '"': 'quotedbl',
  '#': 'numbersign',
  $: 'dollar',
  '%': 'percent',
  '&': 'ampersand',
  "'": 'quotesingle',
  '(': 'parenleft',
  ')': 'parenright',
  '*': 'asterisk',
  '+': 'plus',
  ',': 'comma',
  '-': 'hyphen',
  '.': 'period',
  '/': 'slash',
  ':': 'colon',
  ';': 'semicolon',
  '<': 'less',
  '=': 'equal',
  '>': 'greater',
  '?': 'question',
  '@': 'at',
  '[': 'bracketleft',
  '\\': 'backslash',
  ']': 'bracketright',
  '^': 'asciicircum',
  _: 'underscore',
  '`': 'grave',
  '{': 'braceleft',
  '|': 'bar',
  '}': 'braceright',
  '~': 'asciitilde',
  '–': 'endash',
  '—': 'emdash',
  '·': 'periodcentered',
  '•': 'bullet',
  '…': 'ellipsis',
  '‘': 'quoteleft',
  '’': 'quoteright',
  '“': 'quotedblleft',
  '”': 'quotedblright',
  '×': 'multiply',
};

function glyphNameForChar(character) {
  if (POSTSCRIPT_NAMES[character]) return POSTSCRIPT_NAMES[character];
  if (/^[A-Za-z]$/u.test(character)) return character;
  if (/^[0-9]$/u.test(character)) {
    return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][
      Number(character)
    ];
  }
  return `uni${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Build distressed, rhythm-bounced contours + normalized sidebearings for any glyph. */
function compileGlyphContours(
  character,
  rawContours,
  { rhythmKey = character, lsb = 40, rsb = 40 } = {}
) {
  const codePoint = character.codePointAt(0) ?? 0;
  const rhythm = GLYPH_RHYTHM[rhythmKey] ?? { dy: 0, skewX: 0 };
  const transformed = transformContours(rawContours, {
    dy: rhythm.dy,
    skewX: rhythm.skewX,
    pivotY: 320,
  });

  const distressed = transformed.map((shape, contourIndex) => {
    const seed = (Math.imul(codePoint, 2654435761) ^ Math.imul(contourIndex + 1, 1597334677)) >>> 0;
    return distressContour(shape, createPrng(seed));
  });

  const bounds = computeBounds(distressed);
  const shiftX = Math.round(lsb - bounds.minX);
  const aligned = transformContours(distressed, { dx: shiftX });
  const finalBounds = computeBounds(aligned);
  const advanceWidth = Math.max(220, Math.round(finalBounds.maxX + rsb));

  return {
    contours: aligned,
    bounds: finalBounds,
    advanceWidth,
  };
}

/** Compute OpenType SFNT 32-bit big-endian table checksum over a byte slice. */
function computeSfntChecksum(buffer, offset, length) {
  let sum = 0;
  const paddedLength = (length + 3) & ~3;
  for (let pos = 0; pos < paddedLength; pos += 4) {
    const idx = offset + pos;
    const b0 = idx < offset + length ? buffer[idx] : 0;
    const b1 = idx + 1 < offset + length ? buffer[idx + 1] : 0;
    const b2 = idx + 2 < offset + length ? buffer[idx + 2] : 0;
    const b3 = idx + 3 < offset + length ? buffer[idx + 3] : 0;
    sum = (sum + (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0)) >>> 0;
  }
  return sum;
}

/**
 * Freeze head.modified = head.created and recompute both head table checksum and
 * whole-font checkSumAdjustment so OTF output is 100% spec-valid and deterministic.
 */
function encodeDeterministicOtf(font) {
  const bytes = Buffer.from(font.toArrayBuffer());
  const numTables = bytes.readUInt16BE(4);
  let headRecordOffset = -1;
  let headTableOffset = -1;
  let headTableLength = -1;

  for (let tableIndex = 0; tableIndex < numTables; tableIndex += 1) {
    const recordOffset = 12 + tableIndex * 16;
    const tag = bytes.toString('ascii', recordOffset, recordOffset + 4);
    if (tag === 'head') {
      headRecordOffset = recordOffset;
      headTableOffset = bytes.readUInt32BE(recordOffset + 8);
      headTableLength = bytes.readUInt32BE(recordOffset + 12);
      break;
    }
  }
  if (headRecordOffset < 0 || headTableOffset < 0) {
    throw new Error('Compiled OpenType font is missing its head table.');
  }

  // Copy 8-byte LONGDATETIME `created` (offset +20) into `modified` (offset +28).
  bytes.copy(bytes, headTableOffset + 28, headTableOffset + 20, headTableOffset + 28);
  // Zero checkSumAdjustment before recomputing checksums.
  bytes.writeUInt32BE(0, headTableOffset + 8);
  const headCheckSum = computeSfntChecksum(bytes, headTableOffset, headTableLength);
  bytes.writeUInt32BE(headCheckSum, headRecordOffset + 4);

  const wholeFileCheckSum = computeSfntChecksum(bytes, 0, bytes.length);
  const checkSumAdjustment = (SFNT_CHECKSUM_MAGIC - wholeFileCheckSum) >>> 0;
  bytes.writeUInt32BE(checkSumAdjustment, headTableOffset + 8);
  return bytes;
}

/** Build the complete MoonWitness Grunge OpenType font and WOFF2 binary buffers deterministically. */
export async function generateBrandFontBuffers() {
  const glyphs = [];
  const allCharacters = [];

  // Index 0: .notdef
  const notdefContours = buildNotdef().map((shape) => distressContour(shape, createPrng(0x2026)));
  glyphs.push(
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 600,
      path: contoursToPath(notdefContours),
    })
  );

  // Space (U+0020)
  glyphs.push(
    new opentype.Glyph({
      name: 'space',
      unicode: 0x20,
      advanceWidth: 280,
      path: new opentype.Path(),
    })
  );
  allCharacters.push(' ');

  // Base printable ASCII + typography punctuation
  const baseCache = new Map();
  for (const [character, builder] of Object.entries(BASE_BUILDERS)) {
    const isNarrow = /^[Iil!|.,:;'"`‘’·]$/u.test(character);
    const lsb = isNarrow ? 54 : 38;
    const rsb = isNarrow ? 54 : 38;
    const compiled = compileGlyphContours(character, builder(), { lsb, rsb });
    baseCache.set(character, compiled);
    glyphs.push(
      new opentype.Glyph({
        name: glyphNameForChar(character),
        unicode: character.codePointAt(0),
        advanceWidth: compiled.advanceWidth,
        path: contoursToPath(compiled.contours),
      })
    );
    allCharacters.push(character);
  }

  // Dotless lowercase i cache for composed ì í î ï
  const dotlessICompiled = compileGlyphContours('i', buildLowerDotlessI(), {
    rhythmKey: 'i',
    lsb: 54,
    rsb: 54,
  });
  baseCache.set('ı', dotlessICompiled);

  // Composed Latin-1 accented letters
  for (const [character, baseChar, diacriticKind] of ACCENTED_SPECS) {
    const baseCompiled = baseCache.get(baseChar);
    if (!baseCompiled) {
      throw new Error(`Missing base glyph '${baseChar}' for accented character '${character}'.`);
    }
    const isUpper = baseChar === baseChar.toUpperCase() && baseChar !== 'ı';
    const centerX = (baseCompiled.bounds.minX + baseCompiled.bounds.maxX) * 0.5;
    const anchorY =
      diacriticKind === 'cedilla'
        ? 0
        : Math.max(baseCompiled.bounds.maxY, isUpper ? UPPERCASE_HEIGHT : LOWERCASE_HEIGHT);
    const accentContours = buildDiacritic(diacriticKind, centerX, anchorY, isUpper);
    const combined = [...baseCompiled.contours, ...accentContours];

    glyphs.push(
      new opentype.Glyph({
        name: glyphNameForChar(character),
        unicode: character.codePointAt(0),
        advanceWidth: baseCompiled.advanceWidth,
        path: contoursToPath(combined),
      })
    );
    allCharacters.push(character);
  }

  const font = new opentype.Font({
    familyName: FONT_FAMILY,
    styleName: FONT_STYLE,
    unitsPerEm: UNITS_PER_EM,
    ascender: ASCENDER,
    descender: DESCENDER,
    copyright: 'Copyright (c) 2026 MoonWitness Studio. Licensed under ISC.',
    designer: 'MoonWitness Studio',
    manufacturer: 'MoonWitness Studio',
    license: 'ISC',
    description:
      'Proprietary Grunge x Funky x Gen-Z display typeface authored for MoonWitness headlines, ribbons, and stamps.',
    version: 'Version 1.000',
    postScriptName: 'MoonWitnessGrunge-Regular',
    createdTimestamp: FIXED_TIMESTAMP,
    glyphs,
  });

  const otfBuffer = encodeDeterministicOtf(font);
  const parsedCheck = opentype.parse(
    otfBuffer.buffer.slice(otfBuffer.byteOffset, otfBuffer.byteOffset + otfBuffer.byteLength)
  );
  if (parsedCheck.getEnglishName('fontFamily') !== FONT_FAMILY) {
    throw new Error(`Unexpected parsed family name: ${parsedCheck.getEnglishName('fontFamily')}`);
  }

  const charset = allCharacters.join('');
  const woff2Buffer = await subsetFont(otfBuffer, charset, { targetFormat: 'woff2' });
  const otfSha256 = createHash('sha256').update(otfBuffer).digest('hex').toUpperCase();
  const woff2Sha256 = createHash('sha256').update(woff2Buffer).digest('hex').toUpperCase();

  return {
    otfBuffer,
    woff2Buffer,
    otfSha256,
    woff2Sha256,
    glyphCount: glyphs.length,
    characters: charset,
  };
}

export async function runBrandFontGenerator() {
  const { otfBuffer, woff2Buffer, otfSha256, woff2Sha256, glyphCount } =
    await generateBrandFontBuffers();

  await mkdir(dirname(sourceOutputPath), { recursive: true });
  await mkdir(dirname(woff2OutputPath), { recursive: true });
  await writeFile(sourceOutputPath, otfBuffer);
  await writeFile(woff2OutputPath, woff2Buffer);

  const manifestPath = resolve(packageRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const woff2Asset = {
    path: woff2RelativePath,
    source: sourceRelativePath,
    kind: 'font',
    variant: 'latin-display-subset',
    format: 'woff2',
    license: 'ISC',
    sha256: woff2Sha256,
  };
  const sourceAsset = {
    path: sourceRelativePath,
    source: 'scripts/generate-brand-font.mjs',
    kind: 'source',
    variant: 'moonwitness-grunge-regular',
    format: 'otf',
    license: 'ISC',
    sha256: otfSha256,
  };
  manifest.assets = replaceGeneratedAssets(
    manifest.assets,
    [woff2Asset, sourceAsset],
    new Set([woff2RelativePath, sourceRelativePath])
  );
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const licensesPath = resolve(packageRoot, 'licenses.json');
  const licenses = JSON.parse(await readFile(licensesPath, 'utf8'));
  licenses.fonts = licenses.fonts.filter(({ family }) => family !== FONT_FAMILY);
  licenses.originalFonts = [
    ...(licenses.originalFonts ?? []).filter(({ family }) => family !== FONT_FAMILY),
    {
      family: FONT_FAMILY,
      designer: 'MoonWitness Studio',
      source: 'packages/assets/scripts/generate-brand-font.mjs',
      license: 'ISC',
      files: [
        {
          path: woff2RelativePath,
          source: 'packages/assets/scripts/generate-brand-font.mjs',
          sourceFile: sourceRelativePath,
          sourceSha256: otfSha256,
          sha256: woff2Sha256,
        },
      ],
      usage:
        'Bundled proprietary Grunge x Funky x Gen-Z display WOFF2 for MoonWitness headlines, ribbons, and stamps.',
    },
  ].sort((left, right) => left.family.localeCompare(right.family));
  await atomicWrite(licensesPath, `${JSON.stringify(licenses, null, 2)}\n`);

  stdout.write(
    `Generated ${FONT_FAMILY}: ${glyphCount} glyphs, OTF ${otfBuffer.length} bytes (${otfSha256}), WOFF2 ${woff2Buffer.length} bytes (${woff2Sha256}).\n`
  );
  return { otfBuffer, woff2Buffer, otfSha256, woff2Sha256, glyphCount };
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  await runBrandFontGenerator();
}
