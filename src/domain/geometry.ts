/** 2D vector and base-shape geometry. All lengths in millimetres. */

export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b));

export const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

/**
 * Model bases:
 *  - circle: round bases (most infantry).
 *  - oval:   monsters / cavalry / vehicles (radii along local x and y).
 *  - rect:   rectangular bases (some vehicles, D&D square footprints).
 * Radii / half-extents are in mm and are defined in the base's LOCAL frame;
 * a token's `facing` rotates that frame.
 */
export type BaseShape =
  | { kind: "circle"; radiusMm: number }
  | { kind: "oval"; radiusXMm: number; radiusYMm: number }
  | { kind: "rect"; halfWidthMm: number; halfHeightMm: number };

/** Local-frame full width/height footprint of a base, in mm. */
export function footprint(shape: BaseShape): { w: number; h: number } {
  switch (shape.kind) {
    case "circle":
      return { w: shape.radiusMm * 2, h: shape.radiusMm * 2 };
    case "oval":
      return { w: shape.radiusXMm * 2, h: shape.radiusYMm * 2 };
    case "rect":
      return { w: shape.halfWidthMm * 2, h: shape.halfHeightMm * 2 };
  }
}

/** Coarse bounding radius, used for quick hit-testing rejects. */
export function boundingRadius(shape: BaseShape): number {
  switch (shape.kind) {
    case "circle":
      return shape.radiusMm;
    case "oval":
      return Math.max(shape.radiusXMm, shape.radiusYMm);
    case "rect":
      return Math.hypot(shape.halfWidthMm, shape.halfHeightMm);
  }
}

/** Is a world point inside a based model (respecting its facing)? */
export function pointInBase(p: Vec2, center: Vec2, shape: BaseShape, facing: number): boolean {
  // Rotate the point into the base's local frame.
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const c = Math.cos(-facing);
  const s = Math.sin(-facing);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  switch (shape.kind) {
    case "circle":
      return lx * lx + ly * ly <= shape.radiusMm * shape.radiusMm;
    case "oval": {
      const nx = lx / shape.radiusXMm;
      const ny = ly / shape.radiusYMm;
      return nx * nx + ny * ny <= 1;
    }
    case "rect":
      return Math.abs(lx) <= shape.halfWidthMm && Math.abs(ly) <= shape.halfHeightMm;
  }
}

const CURVE_SEGMENTS = 32; // worst-case ~0.4 mm chord error on the largest base

/** World-space convex polygon approximating a based model. */
export function basePolygon(center: Vec2, shape: BaseShape, facing: number): Vec2[] {
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const pts: Vec2[] = [];
  const push = (lx: number, ly: number): void => {
    pts.push({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos });
  };
  switch (shape.kind) {
    case "circle":
      for (let i = 0; i < CURVE_SEGMENTS; i++) {
        const a = (2 * Math.PI * i) / CURVE_SEGMENTS;
        push(Math.cos(a) * shape.radiusMm, Math.sin(a) * shape.radiusMm);
      }
      break;
    case "oval":
      for (let i = 0; i < CURVE_SEGMENTS; i++) {
        const a = (2 * Math.PI * i) / CURVE_SEGMENTS;
        push(Math.cos(a) * shape.radiusXMm, Math.sin(a) * shape.radiusYMm);
      }
      break;
    case "rect":
      push(shape.halfWidthMm, shape.halfHeightMm);
      push(shape.halfWidthMm, -shape.halfHeightMm);
      push(-shape.halfWidthMm, -shape.halfHeightMm);
      push(-shape.halfWidthMm, shape.halfHeightMm);
      break;
  }
  return pts;
}

/** Axis-aligned bounding-box corners of a (possibly rotated) base, world space. */
export function baseBBoxCorners(center: Vec2, shape: BaseShape, facing: number): Vec2[] {
  const poly = basePolygon(center, shape, facing);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

const cross3 = (a: Vec2, b: Vec2, c: Vec2): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Do segments p1p2 and p3p4 intersect (endpoints/collinear touches count)? */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross3(p3, p4, p1);
  const d2 = cross3(p3, p4, p2);
  const d3 = cross3(p1, p2, p3);
  const d4 = cross3(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const onSeg = (a: Vec2, b: Vec2, c: Vec2): boolean =>
    Math.min(a.x, b.x) - 1e-9 <= c.x &&
    c.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= c.y &&
    c.y <= Math.max(a.y, b.y) + 1e-9;
  if (d1 === 0 && onSeg(p3, p4, p1)) return true;
  if (d2 === 0 && onSeg(p3, p4, p2)) return true;
  if (d3 === 0 && onSeg(p1, p2, p3)) return true;
  if (d4 === 0 && onSeg(p1, p2, p4)) return true;
  return false;
}

// ---- convex-polygon distance (Separating Axis + closest features) ----------

function project(poly: Vec2[], ax: number, ay: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/** True if any edge-normal of `poly` separates the two polygons. */
function hasSeparatingAxis(poly: Vec2[], other: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p1 = poly[i]!;
    const p2 = poly[(i + 1) % n]!;
    const ax = -(p2.y - p1.y);
    const ay = p2.x - p1.x;
    const a = project(poly, ax, ay);
    const b = project(other, ax, ay);
    if (a.max < b.min || b.max < a.min) return true;
  }
  return false;
}

export function convexIntersect(a: Vec2[], b: Vec2[]): boolean {
  return !hasSeparatingAxis(a, b) && !hasSeparatingAxis(b, a);
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Minimum distance between two convex polygons (0 if they overlap or touch). */
export function polygonDistance(a: Vec2[], b: Vec2[]): number {
  if (convexIntersect(a, b)) return 0;
  let min = Infinity;
  // For disjoint convex polygons the closest pair is vertex-to-edge (or
  // vertex-to-vertex, which vertex-to-edge subsumes), so test every vertex of
  // one against every edge of the other, both ways.
  for (const va of a) {
    for (let i = 0; i < b.length; i++) {
      min = Math.min(min, pointSegmentDistance(va, b[i]!, b[(i + 1) % b.length]!));
    }
  }
  for (const vb of b) {
    for (let i = 0; i < a.length; i++) {
      min = Math.min(min, pointSegmentDistance(vb, a[i]!, a[(i + 1) % a.length]!));
    }
  }
  return min;
}

/**
 * Edge-to-edge (base-to-base) distance between two placed models — Warhammer's
 * measurement. Circle-circle is exact and cheap; anything else (oval, rect, or a
 * rotated base) falls back to convex-polygon clearance.
 */
export function edgeToEdge(
  centerA: Vec2,
  shapeA: BaseShape,
  facingA: number,
  centerB: Vec2,
  shapeB: BaseShape,
  facingB: number,
): number {
  if (shapeA.kind === "circle" && shapeB.kind === "circle") {
    return Math.max(0, dist(centerA, centerB) - shapeA.radiusMm - shapeB.radiusMm);
  }
  return polygonDistance(
    basePolygon(centerA, shapeA, facingA),
    basePolygon(centerB, shapeB, facingB),
  );
}
