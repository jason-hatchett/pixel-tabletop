/**
 * Walls: persistent line-segment barriers on the board. A wall can block
 * line-of-sight (for cover and area templates) and/or movement. This is the
 * shared geometric primitive underneath both the cover rules and template
 * blocking — hence built before templates lean on it.
 */

import type { Vec2, BaseShape } from "./geometry.js";
import { segmentsIntersect, baseBBoxCorners } from "./geometry.js";

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  blocksLoS: boolean;
  blocksMove: boolean;
}

/**
 * The quadrilateral shadow a wall casts from a viewpoint: the two rays from the
 * origin through the wall's endpoints, extended `far` mm outward. Anything inside
 * this quad (and past the wall) is hidden from the origin. Callers clip it to the
 * region of interest (a template's area, or a unit's LoS circle).
 */
export function shadowQuad(origin: Vec2, a: Vec2, b: Vec2, far = 100000): Vec2[] {
  const project = (p: Vec2): Vec2 => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const s = far / (Math.hypot(dx, dy) || 1);
    return { x: origin.x + dx * s, y: origin.y + dy * s };
  };
  return [a, project(a), project(b), b];
}

/** Signed doubled area of a polygon; sign encodes its winding direction. */
function signedArea2(poly: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    area += p.x * q.y - q.x * p.y;
  }
  return area;
}

/**
 * Sutherland-Hodgman: clip `subject` to the interior of convex polygon `clip`.
 * Auto-detects `clip`'s winding so it works regardless of how its caller built
 * it (shadowQuad's winding flips depending on which side the origin is on).
 */
function clipConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  if (subject.length === 0 || clip.length < 3) return subject;
  const ccw = signedArea2(clip) >= 0;
  let output = subject;
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const p0 = clip[i]!;
    const p1 = clip[(i + 1) % clip.length]!;
    const cross = (p: Vec2): number => (p1.x - p0.x) * (p.y - p0.y) - (p1.y - p0.y) * (p.x - p0.x);
    const inside = (p: Vec2): boolean => (ccw ? cross(p) >= -1e-6 : cross(p) <= 1e-6);
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const curr = input[j]!;
      const next = input[(j + 1) % input.length]!;
      const currIn = inside(curr);
      const nextIn = inside(next);
      if (currIn) output.push(curr);
      if (currIn !== nextIn) {
        const cCurr = cross(curr);
        const cNext = cross(next);
        const denom = cCurr - cNext;
        const t = denom !== 0 ? cCurr / denom : 0;
        output.push({ x: curr.x + t * (next.x - curr.x), y: curr.y + t * (next.y - curr.y) });
      }
    }
  }
  return output;
}

/**
 * The umbra a wall casts from an AREA source (a model's base) — the region
 * hidden from EVERY point of the source. Unlike `shadowQuad` (a point source),
 * this accounts for the base's width: a wide oval sees a little around the wall,
 * so its umbra is narrower.
 *
 * Built directly from the definition rather than an angular heuristic: a point
 * is hidden from the WHOLE source iff it's hidden from EVERY point of it, so
 * the umbra is exactly the intersection, over every vertex V of the (already
 * polygon-approximated) source, of `shadowQuad(V, a, b)` — each one individually
 * correct and already tested, intersected with a generic convex-polygon clip.
 * (An earlier version picked a single "best" tangent point per wall endpoint
 * analytically; that heuristic picked the wrong tangent for some asymmetric
 * configurations and produced a shadow reaching in a nonsensical direction.)
 */
export function umbraQuad(source: Vec2[], a: Vec2, b: Vec2, far = 100000): Vec2[] {
  if (source.length === 0) return [];
  let result = shadowQuad(source[0]!, a, b, far);
  for (let i = 1; i < source.length && result.length > 0; i++) {
    result = clipConvex(result, shadowQuad(source[i]!, a, b, far));
  }
  return result;
}

/** The two silhouette (tangent) vertices of convex `occluder` as seen from an
 * external point `v` — the vertices at the extreme angular positions. For a
 * convex polygon viewed from outside, the angular span is < π, so unwrapping
 * each vertex's angle relative to the direction of the occluder's centroid
 * avoids the atan2 wraparound. */
function silhouetteVertices(occluder: Vec2[], v: Vec2): [Vec2, Vec2] {
  let cx = 0;
  let cy = 0;
  for (const p of occluder) {
    cx += p.x;
    cy += p.y;
  }
  const ref = Math.atan2(cy / occluder.length - v.y, cx / occluder.length - v.x);
  let minRel = Infinity;
  let maxRel = -Infinity;
  let lo = occluder[0]!;
  let hi = occluder[0]!;
  for (const p of occluder) {
    let rel = Math.atan2(p.y - v.y, p.x - v.x) - ref;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    if (rel < minRel) {
      minRel = rel;
      lo = p;
    }
    if (rel > maxRel) {
      maxRel = rel;
      hi = p;
    }
  }
  return [lo, hi];
}

/** Point-shadow of convex `occluder` from point `v`: the wedge between the two
 * tangent lines from `v`, from the occluder's silhouette out to `far`. */
function pointShadowOfOccluder(v: Vec2, occluder: Vec2[], far: number): Vec2[] {
  const [t1, t2] = silhouetteVertices(occluder, v);
  const project = (p: Vec2): Vec2 => {
    const dx = p.x - v.x;
    const dy = p.y - v.y;
    const s = far / (Math.hypot(dx, dy) || 1);
    return { x: v.x + dx * s, y: v.y + dy * s };
  };
  return [t1, project(t1), project(t2), t2];
}

/**
 * Umbra of a whole convex OCCLUDER (a terrain block's polygon) from a convex
 * area `source` — the region hidden from EVERY point of the source.
 *
 * A terrain block must be treated as ONE occluder, not as independent edges.
 * Casting `umbraQuad` per edge and unioning them leaves gaps: a point can be
 * hidden from the source's left half by one edge and its right half by another
 * — hidden from all of the source, but by no single edge alone — and it also
 * requires the source's extreme points to see "through" side edges that a
 * single-viewpoint front-face cull would drop. Both problems vanish when the
 * block's own silhouette is used per source vertex.
 *
 * Correct by construction: occlusion by a convex blocker is a symmetric, convex
 * relation, so a point hidden from two source points is hidden from the whole
 * segment between them; hence hidden-from-every-vertex ⇒ hidden-from-every-point
 * of the (convex) source. The umbra is therefore the intersection, over each
 * source vertex, of that vertex's point-shadow of the whole occluder. (The near
 * boundary uses the silhouette chord rather than the occluder's back faces, so
 * the result can under-cover a sliver INSIDE the occluder itself — irrelevant,
 * since nothing is placed inside solid terrain.)
 */
export function umbraOfOccluder(source: Vec2[], occluder: Vec2[], far = 100000): Vec2[] {
  if (source.length === 0 || occluder.length === 0) return [];
  let result = pointShadowOfOccluder(source[0]!, occluder, far);
  for (let i = 1; i < source.length && result.length > 0; i++) {
    result = clipConvex(result, pointShadowOfOccluder(source[i]!, occluder, far));
  }
  return result;
}

/** Is the straight sightline from `from` to `to` broken by any LoS wall? */
export function lineOfSightBlocked(from: Vec2, to: Vec2, walls: Iterable<Wall>): boolean {
  for (const w of walls) {
    if (w.blocksLoS && segmentsIntersect(from, to, w.a, w.b)) return true;
  }
  return false;
}

/**
 * How many of a target base's four bounding-box corners are hidden from a
 * viewpoint (0..4). This is the sampling used by the cover rules — 5E's corner
 * method maps the count to half / three-quarters / total cover.
 */
export function blockedCornerCount(
  from: Vec2,
  center: Vec2,
  shape: BaseShape,
  facing: number,
  walls: Iterable<Wall>,
): number {
  let n = 0;
  for (const c of baseBBoxCorners(center, shape, facing)) {
    if (lineOfSightBlocked(from, c, walls)) n++;
  }
  return n;
}
