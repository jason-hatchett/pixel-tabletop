/**
 * Terrain-layout analyzer — import-time CV that reads a Warhammer "Terrain
 * Layouts" image and reconstructs the printed area terrain as first-class
 * `TerrainPiece`s (ADR-0011). A SEPARATE path from the D&D map analyzer
 * (`mapAnalyzer.ts`): that one traces wall linework; this one detects each
 * area-terrain piece from its **dark rectangle outline** (ADR-0012).
 *
 * Pure and DOM-free (a pixel buffer in, mm-space pieces out) so it is
 * deterministic and unit-testable — the heuristics live here, never in
 * `src/domain/`. Per pillar 4 the output is an authoring seed shown in a review
 * gate before commit, never trusted geometry; detection is explicitly
 * best-effort across arbitrary community images and the footprint editor is the
 * guaranteed finisher (ADR-0012).
 *
 * Why outlines, not colour fill (ADR-0012): the outline is the one signal stable
 * across renders, and it dissolves at once the problems that sank the old
 * fill-based analyzer —
 *   - Grid — a decorative grid is dark-*grey*; the outline threshold excludes it.
 *   - Splits — a grey/blue "split" piece is ONE outline (the internal colour
 *     boundary has no dark line), so it detects as one footprint; height is read
 *     afterwards by sampling the fill inside the box.
 *   - Internal ruins walls — live *inside* the outline; they never spawn a piece.
 *   - Tint — the outline is neutral dark ink, so hue-tinted zones don't confuse it.
 *
 * Pipeline:
 *   1. Board detect — the dark border frame (or content bbox) sets scale + origin.
 *   2. Outline mask — dark, low-saturation ink, with blue terrain fill excluded
 *      (blue is fill, not ink). Threshold is adaptive (local contrast) by default,
 *      or a fixed brightness cutoff exposed as the per-image review-gate knob.
 *   3. Circular-marker removal — clear objective skulls/eyes/rings so a marker
 *      overlapping a piece can't corrupt its outline.
 *   4. Frame-border-band strip — zero only a thin band at the board edge (not the
 *      whole frame component) so a piece touching the frame survives as a 3-sided
 *      outline instead of being fused into the discarded frame.
 *   5. Gap bridge (morphological close) → connected components → one oriented box
 *      per outline, centred on the extent MIDPOINT (a partial outline pulls the
 *      centroid off-centre).
 *   6. Accept by plausible size/aspect and by perimeter coverage (a ~3-sided
 *      outline still counts); classify height (tall/low/split) from the grey/blue
 *      fill sampled INSIDE the box; snap to the catalog; separate overlaps.
 */

import type { Vec2, BaseShape } from "../domain/geometry.js";
import { basePolygon } from "../domain/geometry.js";
import type { TerrainPiece, AreaTerrainEdition } from "../domain/terrain.js";
import { HEIGHT_TALL_MM, HEIGHT_LOW_MM, heightColor, AREA_TERRAIN_FOOTPRINTS_MM, DEFAULT_AREA_TERRAIN_EDITION } from "../domain/terrain.js";
import type { PixelBuffer } from "./decode.js";

type Footprint = { longMm: number; shortMm: number };

/** One detected footprint, in board-relative millimetres. */
export interface DetectedTerrain {
  /** Oriented centre, mm, relative to the detected board's top-left. */
  pos: Vec2;
  /** Rect footprint (mm); `halfWidthMm` is the long side (along `facing`). */
  base: BaseShape;
  /** Facing in radians (0 = +x), from the outline's principal axis. */
  facing: number;
  /** Suggested terrain height in mm (tall vs low), from the fill colour. */
  heightMm: number;
  /** True = a full outline (high perimeter coverage); false = a partial outline
   * accepted on lower coverage, surfaced flagged for review. */
  rect: boolean;
}

export interface TerrainLayoutAnalysis {
  /** Detected board rectangle in image pixels (scale + origin reference). */
  boardPx: { x: number; y: number; width: number; height: number };
  /** Scale from image pixels to board millimetres. */
  mmPerPx: number;
  /** All detected footprints (clean and flagged), board-relative mm. */
  pieces: DetectedTerrain[];
}

export interface AnalyzeLayoutOptions {
  /** Physical board width in mm (from the chosen battlefield preset); sets scale. */
  boardWidthMm: number;
  /**
   * Fixed outline brightness cutoff (luma 0–255): a pixel darker than this (and
   * low-saturation) is outline ink. This is the ONE per-image knob (ADR-0012 §3)
   * and is the value the review-gate slider drives. When omitted, an adaptive
   * local-contrast threshold is used instead, so a single import config works
   * across images of different contrast.
   */
  outlineBrightnessMax?: number;
  /** Adaptive local-mean window (px, odd). Default 21. Ignored if `outlineBrightnessMax` is set. */
  adaptiveWindow?: number;
  /** Adaptive cutoff: outline where luma < localMean − this. Default 10. */
  adaptiveOffset?: number;
  /** Max saturation for a pixel to count as neutral outline ink. Default 45. */
  outlineSatMax?: number;
  /** Exclude blue-hued fill from the outline mask (blue is terrain fill, not ink). Default on. */
  excludeBlueFromOutline?: boolean;
  /**
   * Strip only a thin border BAND at the board edge (not the whole frame
   * component), so a piece touching the frame survives as a partial outline
   * rather than being fused into the frame and discarded (default on).
   */
  stripFrameBorder?: boolean;
  /** Remove marker-sized circular shapes (objective skulls/eyes/rings) before detection. Default on. */
  removeMarkers?: boolean;
  /** Largest marker diameter to remove, inches. Default 2.5. */
  markerMaxIn?: number;
  /** Morphological close radius (px) to bridge small outline gaps. Default 1. */
  gapBridge?: number;
  /** Min fraction of an oriented box's perimeter backed by outline ink to accept it. Default 0.5. */
  minCoverage?: number;
  /** Coverage at/above which a box is a clean rectangle (else flagged for review). Default 0.5. */
  rectCoverage?: number;
  /**
   * Snap each piece's facing to the nearest multiple of this many degrees, so
   * detection noise doesn't leave terrain at slight angles (default 15; 0 keeps raw).
   */
  snapAngleStepDeg?: number;
  /** Nudge overlapping detected pieces apart until they just touch (default on). */
  separateOverlaps?: boolean;
  /**
   * Snap each detected footprint to the nearest official area-terrain size for the
   * chosen `edition` instead of the raw measured pixels (default on).
   */
  snapToCatalogSizes?: boolean;
  /** Which edition's size roster to snap to. Defaults to the current edition. */
  edition?: AreaTerrainEdition;
  /**
   * Detect split footprints — one outline shaded half tall (grey) / half low
   * (blue) — and emit them as two correctly-sized adjacent pieces (ADR-0011 "A").
   * Default OFF: on real community images the auto-decomposition mis-fires on
   * adjacent grey/blue pieces and produces misaligned stacked halves, which reads
   * worse than one clean box. A split reads as a single (dominant-height) piece;
   * the review-gate editor is the reliable place to split it. Needs
   * `snapToCatalogSizes` when enabled.
   */
  mergeSplits?: boolean;
}

const MM_PER_INCH = 25.4;
// Each colour must be at least this fraction of a footprint's fill for it to count
// as a grey/blue split rather than a single-height piece.
const SPLIT_MIN_FRAC = 0.2;
const DEFAULT_SNAP_ANGLE_STEP_DEG = 15;
const DEFAULT_OUTLINE_SAT_MAX = 45;
const DEFAULT_ADAPTIVE_WINDOW = 21;
// Darker-than-local-mean cutoff. 16 (not 10) is the value that generalises across
// the calibration fixtures: it still catches faint outlines but rejects a
// decorative grid (which is only mildly darker than its neighbourhood) — the grid
// is what a smaller offset lets through (ADR-0012 §3, validated live).
const DEFAULT_ADAPTIVE_OFFSET = 16;
const DEFAULT_MARKER_MAX_IN = 2.5;
const DEFAULT_GAP_BRIDGE = 1;
const DEFAULT_MIN_COVERAGE = 0.4;
// Above this coverage a box is "clean" (placed by default); below → flagged for
// review. Kept modest: on real community images a fully-closed 4-sided outline is
// rare (grid interference, small breaks), so a strict bar would flag almost every
// (well-placed) box and place hardly any by default.
const DEFAULT_RECT_COVERAGE = 0.5;
// Plausible area-terrain footprint bounds (inches) — spans both editions' rosters
// with a little slack, so noise blobs and whole-board frames are rejected.
const MIN_LONG_IN = 3.5;
const MAX_LONG_IN = 13.5;
const MIN_SHORT_IN = 1.8;
const MAX_SHORT_IN = 9;
const MAX_ASPECT = 4;

/**
 * Snap a facing to the nearest multiple of `stepDeg`, then fold into the
 * rectangle's canonical range (−π/2, π/2] (a rectangle is 180°-symmetric). With
 * the default 15° step, angles land on a 15° grid (0/±15/±30/±45/±60/±75/90).
 */
export function snapFacing(angleRad: number, stepDeg: number): number {
  if (stepDeg <= 0) return angleRad;
  const step = (stepDeg * Math.PI) / 180;
  let a = Math.round(angleRad / step) * step;
  while (a > Math.PI / 2) a -= Math.PI;
  while (a <= -Math.PI / 2) a += Math.PI;
  return a;
}

/**
 * Snap a measured footprint (long × short, mm) to the nearest size in `roster`
 * (an edition's `AREA_TERRAIN_FOOTPRINTS_MM`). Every layout piece is one of the
 * edition's sizes, so this replaces noisy pixel measurements with the real size.
 */
export function snapToCatalogSize(longMm: number, shortMm: number, roster: Footprint[]): Footprint {
  let best = roster[0]!;
  let bestD = Infinity;
  for (const f of roster) {
    const d = Math.hypot(longMm - f.longMm, shortMm - f.shortMm);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

// --- overlap resolution (Separating Axis min-translation, then relax) ---------

function projectPoly(poly: Vec2[], ax: number, ay: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

function centroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/**
 * Minimum translation vector to push convex polygon `a` off `b` (the smallest
 * move that removes the overlap), or null if they are already separated/touching.
 * Tests every edge normal of both polygons and keeps the axis of least overlap.
 */
export function overlapMTV(a: Vec2[], b: Vec2[]): Vec2 | null {
  let bestOverlap = Infinity;
  let bx = 0;
  let by = 0;
  const edges = (poly: Vec2[]): void => {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p1 = poly[i]!;
      const p2 = poly[(i + 1) % n]!;
      let ax = -(p2.y - p1.y);
      let ay = p2.x - p1.x;
      const len = Math.hypot(ax, ay);
      if (len < 1e-9) continue;
      ax /= len;
      ay /= len;
      const pa = projectPoly(a, ax, ay);
      const pb = projectPoly(b, ax, ay);
      const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
      if (overlap <= 1e-9) {
        bestOverlap = -1; // separating axis found → not overlapping
        return;
      }
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bx = ax;
        by = ay;
      }
    }
  };
  edges(a);
  if (bestOverlap < 0) return null;
  edges(b);
  if (bestOverlap < 0 || bestOverlap === Infinity) return null;
  // Point the axis from b toward a so it pushes a away from b.
  const ca = centroid(a);
  const cb = centroid(b);
  if ((ca.x - cb.x) * bx + (ca.y - cb.y) * by < 0) {
    bx = -bx;
    by = -by;
  }
  return { x: bx * bestOverlap, y: by * bestOverlap };
}

/**
 * Relax a set of detected pieces so none overlap: repeatedly find each
 * overlapping pair's MTV and split it between them, until everything just
 * touches (or a step cap is hit). Facings are untouched — only positions move —
 * so angle-snapped pieces settle edge-to-edge / corner-to-corner.
 */
export function resolveOverlaps(pieces: DetectedTerrain[], maxIter = 24): DetectedTerrain[] {
  const pos = pieces.map((p) => ({ x: p.pos.x, y: p.pos.y }));
  const poly = pieces.map((p, i) => basePolygon(pos[i]!, p.base, p.facing));
  const SETTLED_MM = 0.25;
  for (let iter = 0; iter < maxIter; iter++) {
    let maxMove = 0;
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const mtv = overlapMTV(poly[i]!, poly[j]!);
        if (!mtv) continue;
        pos[i]!.x += mtv.x / 2;
        pos[i]!.y += mtv.y / 2;
        pos[j]!.x -= mtv.x / 2;
        pos[j]!.y -= mtv.y / 2;
        poly[i] = basePolygon(pos[i]!, pieces[i]!.base, pieces[i]!.facing);
        poly[j] = basePolygon(pos[j]!, pieces[j]!.base, pieces[j]!.facing);
        maxMove = Math.max(maxMove, Math.hypot(mtv.x, mtv.y));
      }
    }
    if (maxMove < SETTLED_MM) break;
  }
  return pieces.map((p, i) => ({ ...p, pos: { x: pos[i]!.x, y: pos[i]!.y } }));
}

type Mask = Uint8Array;

// --- pixel classification (thresholds grounded in the rendered GW pack) ---

const bright = (r: number, g: number, b: number): number => (r + g + b) / 3;
const sat = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b);
const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/** Saturated blue fill = low terrain ("2\" or less"). */
function isBlue(r: number, g: number, b: number): boolean {
  return b > 100 && b - r > 40 && b - g > 15;
}
/** Mid-grey, low-saturation fill = tall ruins ("more than 4\"). Near-neutral
 * (sat < 18) so a hued deployment-zone tint (sat ~23) is not read as terrain. */
function isGrey(r: number, g: number, b: number): boolean {
  return sat(r, g, b) < 18 && bright(r, g, b) > 60 && bright(r, g, b) < 155;
}
/** Bright, low-saturation — an objective marker's centre (skull/eye). */
function isWhite(r: number, g: number, b: number): boolean {
  return bright(r, g, b) > 205 && sat(r, g, b) < 25;
}

function classify(img: PixelBuffer, pred: (r: number, g: number, b: number) => boolean): Mask {
  const { data, width, height } = img;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    mask[i] = pred(data[p]!, data[p + 1]!, data[p + 2]!) ? 1 : 0;
  }
  return mask;
}

// --- morphology (3×3, radius = iterations) ---

function dilate(mask: Mask, w: number, h: number): Mask {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && v === 0; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx] === 1) {
            v = 1;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function erode(mask: Mask, w: number, h: number): Mask {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v === 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || mask[ny * w + nx] === 0) {
            v = 0;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Morphological close (dilate then erode): bridges small gaps in an outline so a
 * broken rectangle reconnects into one component. */
function close(mask: Mask, w: number, h: number, radius: number): Mask {
  let m = mask;
  for (let i = 0; i < radius; i++) m = dilate(m, w, h);
  for (let i = 0; i < radius; i++) m = erode(m, w, h);
  return m;
}

// --- connected components (8-connectivity, iterative flood fill) ---

interface Blob {
  pixels: number[]; // pixel indices (y*w + x)
}

function components(mask: Mask, w: number, h: number, minPixels: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    const pixels: number[] = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] === 1 && seen[j] === 0) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (pixels.length >= minPixels) blobs.push({ pixels });
  }
  return blobs;
}

// --- oriented box via principal component analysis ---

interface OrientedBox {
  cx: number;
  cy: number;
  /** Long / short extents in px. */
  long: number;
  short: number;
  /** Angle of the long axis (radians, image space). */
  angle: number;
}

/**
 * Fit an oriented box to a set of pixels by PCA. The box is centred on the
 * MIDPOINT of the measured u/v extent, not the pixel centroid: a partial (e.g.
 * 3-sided) outline pulls the centroid off-centre, which would mis-place a box
 * whose size and angle are otherwise correct (ADR-0012 §2).
 */
function orientedBox(pixels: number[], w: number): OrientedBox {
  const n = pixels.length;
  let sx = 0;
  let sy = 0;
  for (const i of pixels) {
    sx += i % w;
    sy += (i / w) | 0;
  }
  const cx = sx / n;
  const cy = sy / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const i of pixels) {
    const dx = (i % w) - cx;
    const dy = ((i / w) | 0) - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const i of pixels) {
    const dx = (i % w) - cx;
    const dy = ((i / w) | 0) - cy;
    const pu = dx * ux + dy * uy;
    const pv = -dx * uy + dy * ux;
    if (pu < uMin) uMin = pu;
    if (pu > uMax) uMax = pu;
    if (pv < vMin) vMin = pv;
    if (pv > vMax) vMax = pv;
  }
  const uMid = (uMin + uMax) / 2;
  const vMid = (vMin + vMax) / 2;
  const bcx = cx + uMid * ux - vMid * uy;
  const bcy = cy + uMid * uy + vMid * ux;
  let extU = uMax - uMin;
  let extV = vMax - vMin;
  // Keep the long side as "u"/`angle`; if v is longer, rotate 90°.
  if (extV > extU) {
    [extU, extV] = [extV, extU];
    angle += Math.PI / 2;
  }
  while (angle > Math.PI / 2) angle -= Math.PI;
  while (angle <= -Math.PI / 2) angle += Math.PI;
  return { cx: bcx, cy: bcy, long: extU, short: extV, angle };
}

/**
 * Fraction of an oriented box's perimeter that has a mask pixel within `tol` px.
 * A rectangle is over-determined, so a ~3-sided outline (≈75% coverage) still
 * yields the full inferred box, while a noise blob (low coverage) is rejected.
 */
function perimeterCoverage(box: OrientedBox, mask: Mask, w: number, h: number, tol: number): number {
  const ux = Math.cos(box.angle);
  const uy = Math.sin(box.angle);
  const hw = box.long / 2;
  const hh = box.short / 2;
  const corner = (a: number, b: number): [number, number] => [box.cx + a * ux - b * uy, box.cy + a * uy + b * ux];
  const pts = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
  const near = (x: number, y: number): number => {
    for (let dy = -tol; dy <= tol; dy++) {
      for (let dx = -tol; dx <= tol; dx++) {
        const nx = Math.round(x + dx);
        const ny = Math.round(y + dy);
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx] === 1) return 1;
      }
    }
    return 0;
  };
  let cov = 0;
  let tot = 0;
  for (let e = 0; e < 4; e++) {
    const a = pts[e]!;
    const b = pts[(e + 1) % 4]!;
    const steps = Math.max(4, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      tot++;
      cov += near(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    }
  }
  return tot ? cov / tot : 0;
}

// --- board detection ---

function blobBBox(pixels: number[], w: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of pixels) {
    const x = i % w;
    const y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Detect the board rectangle from the outline mask (ADR-0012 §2): the board's
 * dark border frame is the **largest dark component**, and its BOUNDING BOX gives
 * scale + origin (a distorted PCA "long" over-measures). If the largest component
 * does not span most of the image (a frameless crop, or a synthetic image with no
 * frame), fall back to the full image so scale stays sane. Detection then strips
 * only a thin border band of this box, so a piece touching the frame survives.
 */
function detectBoard(outline: Mask, w: number, h: number): { x: number; y: number; width: number; height: number } {
  const full = { x: 0, y: 0, width: w, height: h };
  const blobs = components(dilate(outline, w, h), w, h, 40);
  if (blobs.length === 0) return full;
  let best = blobs[0]!;
  for (const b of blobs) if (b.pixels.length > best.pixels.length) best = b;
  const { x0, y0, x1, y1 } = blobBBox(best.pixels, w);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  // A real board frame spans most of the image; a mere piece does not.
  if (bw > w * 0.6 && bh > h * 0.5) return { x: x0, y: y0, width: bw, height: bh };
  return full;
}

// --- outline mask construction ---

/** Summed-area table of luma for O(1) local-mean lookups (adaptive threshold). */
function lumaIntegral(img: PixelBuffer): Float64Array {
  const { data, width: w, height: h } = img;
  const sw = w + 1;
  const integral = new Float64Array(sw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      rowSum += luma(data[p]!, data[p + 1]!, data[p + 2]!);
      integral[(y + 1) * sw + (x + 1)] = integral[y * sw + (x + 1)]! + rowSum;
    }
  }
  return integral;
}

function localMean(integral: Float64Array, w: number, h: number, x: number, y: number, r: number): number {
  const sw = w + 1;
  const x0 = Math.max(0, x - r);
  const y0 = Math.max(0, y - r);
  const x1 = Math.min(w - 1, x + r);
  const y1 = Math.min(h - 1, y + r);
  const s =
    integral[(y1 + 1) * sw + (x1 + 1)]! -
    integral[y0 * sw + (x1 + 1)]! -
    integral[(y1 + 1) * sw + x0]! +
    integral[y0 * sw + x0]!;
  return s / ((x1 - x0 + 1) * (y1 - y0 + 1));
}

/**
 * Build the outline mask over the board rectangle: low-saturation dark ink, with
 * blue terrain fill optionally excluded (blue is fill, not ink). Threshold is a
 * fixed brightness cutoff when `brightMax` is given, else adaptive local contrast.
 */
function buildOutlineMask(
  img: PixelBuffer,
  board: { x: number; y: number; width: number; height: number },
  brightMax: number | null,
  satMax: number,
  excludeBlue: boolean,
  adaptiveWindow: number,
  adaptiveOffset: number,
): Mask {
  const { data, width: w, height: h } = img;
  const out = new Uint8Array(w * h);
  const integral = brightMax === null ? lumaIntegral(img) : null;
  const r = (adaptiveWindow - 1) >> 1;
  const x1 = board.x + board.width;
  const y1 = board.y + board.height;
  for (let y = board.y; y < y1; y++) {
    for (let x = board.x; x < x1; x++) {
      const i = y * w + x;
      const p = i * 4;
      const R = data[p]!;
      const G = data[p + 1]!;
      const B = data[p + 2]!;
      if (sat(R, G, B) >= satMax) continue;
      if (excludeBlue && isBlue(R, G, B)) continue;
      const l = luma(R, G, B);
      const on = brightMax === null ? l < localMean(integral!, w, h, x, y, r) - adaptiveOffset : bright(R, G, B) < brightMax;
      if (on) out[i] = 1;
    }
  }
  return out;
}

/** Zero every mask pixel outside the board rectangle (drop margin/text ink). */
function restrictToBoard(mask: Mask, w: number, h: number, board: { x: number; y: number; width: number; height: number }): void {
  const x0 = board.x;
  const y0 = board.y;
  const x1 = board.x + board.width;
  const y1 = board.y + board.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) mask[y * w + x] = 0;
    }
  }
}

/** Zero a thin border band at the board edge, keeping pieces that touch the frame. */
function stripBorderBand(mask: Mask, w: number, board: { x: number; y: number; width: number; height: number }): void {
  const band = Math.max(3, Math.round(board.width * 0.02));
  const x0 = board.x;
  const y0 = board.y;
  const x1 = board.x + board.width - 1;
  const y1 = board.y + board.height - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < x0 + band || x > x1 - band || y < y0 + band || y > y1 - band) mask[y * w + x] = 0;
    }
  }
}

/**
 * Clear marker-sized circular shapes (objective skulls/eyes/rings) from the
 * outline mask, so a marker overlapping a piece can't merge into its outline.
 * Two sources: bright icon centres enclosed by a dark ring, and dark rings/discs
 * of marker size. The enclosure test stops a light background reading as
 * thousands of "markers".
 */
function removeCircularMarkers(mask: Mask, img: PixelBuffer, pxPerIn: number, markerMaxIn: number): void {
  const { width: w, height: h } = img;
  const maxD = Math.max(6, markerMaxIn * pxPerIn);
  const minD = 0.6 * pxPerIn;
  const centers: { cx: number; cy: number; r: number }[] = [];
  const enclosed = (cx: number, cy: number, rad: number): number => {
    let hit = 0;
    for (let a = 0; a < 8; a++) {
      const x = Math.round(cx + rad * Math.cos((a * Math.PI) / 4));
      const y = Math.round(cy + rad * Math.sin((a * Math.PI) / 4));
      if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1) hit++;
    }
    return hit;
  };
  const white = classify(img, isWhite);
  for (const blob of components(white, w, h, 20)) {
    if (blob.pixels.length > maxD * maxD) continue;
    let sx = 0;
    let sy = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const i of blob.pixels) {
      sx += i % w;
      sy += (i / w) | 0;
      const x = i % w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    const cx = sx / blob.pixels.length;
    const cy = sy / blob.pixels.length;
    const rad = Math.max(6, (x1 - x0) / 2 + 4);
    if (enclosed(cx, cy, rad) >= 4) centers.push({ cx, cy, r: rad + 4 });
  }
  for (const blob of components(mask, w, h, Math.round(minD * 1.5))) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of blob.pixels) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const wC = x1 - x0 + 1;
    const hC = y1 - y0 + 1;
    const D = Math.max(wC, hC);
    if (D < minD || D > maxD) continue; // marker-sized only
    if (Math.min(wC, hC) / D < 0.65) continue; // roughly square bbox
    const set = new Set(blob.pixels);
    const cornerFull = (px: number, py: number): number => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (set.has((py + dy) * w + (px + dx))) return 1;
      return 0;
    };
    // Filled corners → a rectangle, not a circle; keep it.
    if (cornerFull(x0, y0) + cornerFull(x1, y0) + cornerFull(x1, y1) + cornerFull(x0, y1) > 1) continue;
    centers.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: D / 2 + 3 });
  }
  for (const m of centers) {
    const R = m.r;
    const yLo = Math.max(0, (m.cy - R) | 0);
    const yHi = Math.min(h, m.cy + R);
    const xLo = Math.max(0, (m.cx - R) | 0);
    const xHi = Math.min(w, m.cx + R);
    for (let y = yLo; y < yHi; y++) {
      for (let x = xLo; x < xHi; x++) {
        const dx = x - m.cx;
        const dy = y - m.cy;
        if (dx * dx + dy * dy <= R * R) mask[y * w + x] = 0;
      }
    }
  }
}

// --- split-footprint decomposition (one outline, half tall / half low) ---

function makeRectPiece(cx: number, cy: number, longMm: number, shortMm: number, facing: number, heightMm: number): DetectedTerrain {
  return {
    pos: { x: cx, y: cy },
    base: { kind: "rect", halfWidthMm: longMm / 2, halfHeightMm: shortMm / 2 },
    facing,
    heightMm,
    rect: true,
  };
}

/**
 * Emit a split footprint's two halves, sized from the snapped whole footprint.
 * `gCentroid` / `bCentroid` are the grey / blue fill centroids (px) inside the
 * detected box `ub`; their separation, decomposed onto the box axes, decides
 * which dimension is split and on which side each colour sits.
 */
function emitSplit(
  gCentroid: { x: number; y: number },
  gCount: number,
  bCentroid: { x: number; y: number },
  bCount: number,
  ub: OrientedBox,
  origin: { x: number; y: number },
  mmPerPx: number,
  roster: Footprint[],
  snapStepDeg: number,
): DetectedTerrain[] {
  const facing = snapFacing(ub.angle, snapStepDeg);
  const size = snapToCatalogSize(ub.long * mmPerPx, ub.short * mmPerPx, roster);
  const u = { x: Math.cos(facing), y: Math.sin(facing) };
  const v = { x: -u.y, y: u.x };
  const cx = (ub.cx - origin.x) * mmPerPx;
  const cy = (ub.cy - origin.y) * mmPerPx;
  const dx = (gCentroid.x - bCentroid.x) * mmPerPx;
  const dy = (gCentroid.y - bCentroid.y) * mmPerPx;
  const dU = dx * u.x + dy * u.y;
  const dV = dx * v.x + dy * v.y;
  const fg = gCount / (gCount + bCount); // grey's fraction of the footprint area
  const alongLong = Math.abs(dU) >= Math.abs(dV);
  const axis = alongLong ? u : v;
  const splitMm = alongLong ? size.longMm : size.shortMm; // dimension being divided
  const crossMm = alongLong ? size.shortMm : size.longMm; // shared dimension
  const gSplit = splitMm * fg;
  const bSplit = splitMm * (1 - fg);
  const s = (alongLong ? dU : dV) >= 0 ? 1 : -1; // which side grey sits on
  const gOff = s * (splitMm / 2 - gSplit / 2);
  const bOff = -s * (splitMm / 2 - bSplit / 2);
  const gLong = alongLong ? gSplit : crossMm;
  const gShort = alongLong ? crossMm : gSplit;
  const bLong = alongLong ? bSplit : crossMm;
  const bShort = alongLong ? crossMm : bSplit;
  return [
    makeRectPiece(cx + axis.x * gOff, cy + axis.y * gOff, gLong, gShort, facing, HEIGHT_TALL_MM),
    makeRectPiece(cx + axis.x * bOff, cy + axis.y * bOff, bLong, bShort, facing, HEIGHT_LOW_MM),
  ];
}

/** Sample the fill inside an oriented box, accumulating grey / blue counts and
 * their pixel centroids (px). Used for height classification and split geometry. */
function sampleFill(
  box: OrientedBox,
  grey: Mask,
  blue: Mask,
  w: number,
  h: number,
): { g: number; b: number; gx: number; gy: number; bx: number; by: number } {
  const ux = Math.cos(box.angle);
  const uy = Math.sin(box.angle);
  const vx = -uy;
  const vy = ux;
  let g = 0;
  let b = 0;
  let gsx = 0;
  let gsy = 0;
  let bsx = 0;
  let bsy = 0;
  const hu = box.long / 2;
  const hv = box.short / 2;
  for (let du = -hu; du <= hu; du += 2) {
    for (let dv = -hv; dv <= hv; dv += 2) {
      const x = Math.round(box.cx + du * ux + dv * vx);
      const y = Math.round(box.cy + du * uy + dv * vy);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (grey[i] === 1) {
        g++;
        gsx += x;
        gsy += y;
      } else if (blue[i] === 1) {
        b++;
        bsx += x;
        bsy += y;
      }
    }
  }
  return { g, b, gx: g ? gsx / g : box.cx, gy: g ? gsy / g : box.cy, bx: b ? bsx / b : box.cx, by: b ? bsy / b : box.cy };
}

// --- public API ---

/**
 * Analyze a Warhammer terrain-layout image into board-relative `DetectedTerrain`.
 * `boardWidthMm` (from the chosen battlefield preset) sets the pixel→mm scale.
 */
export function analyzeTerrainLayout(img: PixelBuffer, opts: AnalyzeLayoutOptions): TerrainLayoutAnalysis {
  const { width: w, height: h } = img;
  const blue = classify(img, isBlue);
  const grey = classify(img, isGrey);

  const brightMax = opts.outlineBrightnessMax ?? null;
  const satMax = opts.outlineSatMax ?? DEFAULT_OUTLINE_SAT_MAX;
  const excludeBlue = opts.excludeBlueFromOutline ?? true;
  const adaptiveWindow = opts.adaptiveWindow ?? DEFAULT_ADAPTIVE_WINDOW;
  const adaptiveOffset = opts.adaptiveOffset ?? DEFAULT_ADAPTIVE_OFFSET;
  const gapBridge = opts.gapBridge ?? DEFAULT_GAP_BRIDGE;
  const minCoverage = opts.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const rectCoverage = opts.rectCoverage ?? DEFAULT_RECT_COVERAGE;
  const snapStepDeg = opts.snapAngleStepDeg ?? DEFAULT_SNAP_ANGLE_STEP_DEG;
  const snapSize = opts.snapToCatalogSizes ?? true;
  const roster = snapSize ? AREA_TERRAIN_FOOTPRINTS_MM[opts.edition ?? DEFAULT_AREA_TERRAIN_EDITION] : null;
  const splittable = roster !== null && (opts.mergeSplits ?? false);

  // 1. Outline mask (dark low-sat ink, blue fill excluded) over the WHOLE image.
  const full = { x: 0, y: 0, width: w, height: h };
  const outline = buildOutlineMask(img, full, brightMax, satMax, excludeBlue, adaptiveWindow, adaptiveOffset);
  // 2. Board = the largest dark component's bbox (the frame); its width sets scale.
  const board = detectBoard(outline, w, h);
  const mmPerPx = opts.boardWidthMm / board.width;
  const pxPerMm = board.width / opts.boardWidthMm;
  const pxPerIn = pxPerMm * MM_PER_INCH;
  const origin = { x: board.x, y: board.y };
  // Restrict detection to the board (drop margin/text ink outside the frame).
  restrictToBoard(outline, w, h, board);
  // 3. Clear objective markers so they can't corrupt a piece's outline.
  if (opts.removeMarkers ?? true) removeCircularMarkers(outline, img, pxPerIn, opts.markerMaxIn ?? DEFAULT_MARKER_MAX_IN);
  // 4. Strip the frame border band so an edge piece survives as a partial outline.
  if (opts.stripFrameBorder ?? true) stripBorderBand(outline, w, board);
  // 5. Bridge small outline gaps, then seal (dilate) before component labelling.
  const bridged = close(outline, w, h, gapBridge);
  const sealed = dilate(bridged, w, h);
  const minPixels = Math.max(40, Math.round(pxPerMm * 30));
  const blobs = components(sealed, w, h, minPixels);
  const covTol = gapBridge + 2;

  const all: DetectedTerrain[] = [];
  for (const blob of blobs) {
    const box = orientedBox(blob.pixels, w);
    const longIn = (box.long * mmPerPx) / MM_PER_INCH;
    const shortIn = (box.short * mmPerPx) / MM_PER_INCH;
    if (longIn < MIN_LONG_IN || longIn > MAX_LONG_IN) continue;
    if (shortIn < MIN_SHORT_IN || shortIn > MAX_SHORT_IN) continue;
    if (box.long / Math.max(1, box.short) > MAX_ASPECT) continue;
    const cov = perimeterCoverage(box, sealed, w, h, covTol);
    if (cov < minCoverage) continue;
    const clean = cov >= rectCoverage;

    const fill = sampleFill(box, grey, blue, w, h);
    const tot = fill.g + fill.b || 1;
    if (splittable && fill.g > 0 && fill.b > 0 && Math.min(fill.g, fill.b) >= SPLIT_MIN_FRAC * tot) {
      // One outline shaded part tall (grey) / part low (blue): decompose into the
      // two adjacent halves, sized from the snapped whole (ADR-0011 "A").
      all.push(
        ...emitSplit({ x: fill.gx, y: fill.gy }, fill.g, { x: fill.bx, y: fill.by }, fill.b, box, origin, mmPerPx, roster!, snapStepDeg),
      );
    } else {
      const heightMm = fill.g >= fill.b ? HEIGHT_TALL_MM : HEIGHT_LOW_MM;
      const longMm = box.long * mmPerPx;
      const shortMm = box.short * mmPerPx;
      const size = roster ? snapToCatalogSize(longMm, shortMm, roster) : { longMm, shortMm };
      all.push({
        pos: { x: (box.cx - origin.x) * mmPerPx, y: (box.cy - origin.y) * mmPerPx },
        base: { kind: "rect", halfWidthMm: size.longMm / 2, halfHeightMm: size.shortMm / 2 },
        facing: snapFacing(box.angle, snapStepDeg),
        heightMm,
        rect: clean,
      });
    }
  }
  // Separate the clean rectangles so small detection overlaps become clean
  // edge/corner contact; flagged (partial) blobs are left where they were.
  const rect = all.filter((p) => p.rect);
  const flagged = all.filter((p) => !p.rect);
  const cleaned = (opts.separateOverlaps ?? true) ? resolveOverlaps(rect) : rect;
  return { boardPx: board, mmPerPx, pieces: [...cleaned, ...flagged] };
}

/** Turn a detected footprint into a placeable `TerrainPiece`, coloured by height. */
export function detectedTerrainToPiece(d: DetectedTerrain, index: number): TerrainPiece {
  const tall = d.heightMm > HEIGHT_LOW_MM;
  return {
    id: `wh-terrain-${index}`,
    label: tall ? "Area Terrain (tall)" : "Area Terrain (low)",
    pos: d.pos,
    base: d.base,
    facing: d.facing,
    losBlocking: tall ? "blocks" : "none",
    cover: tall ? "heavy" : "light",
    difficult: true,
    surface: null,
    heightMm: d.heightMm,
    ...heightColor(d.heightMm),
  };
}
