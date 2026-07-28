/**
 * Terrain-layout analyzer — import-time CV that reads an official Warhammer
 * "Terrain Layouts" image and reconstructs the printed area terrain as
 * first-class `TerrainPiece`s (ADR-0011). A SEPARATE path from the D&D map
 * analyzer (`mapAnalyzer.ts`): that one traces wall linework; this one segments
 * two coloured fill classes and fits an oriented box to each.
 *
 * Pure and DOM-free (a pixel buffer in, mm-space pieces out) so it is
 * deterministic and unit-testable — the heuristics live here, never in
 * `src/domain/`. Per pillar 4 the output is an authoring seed shown in a review
 * gate before commit, never trusted geometry.
 *
 * Pipeline (validated against the GW pack's rendered pages):
 *   1. Board detect — bbox of all board content (battlemat ∪ terrain fills),
 *      excluding the mottled concrete margin; sets scale + origin.
 *   2. Colour masks — grey hatch = tall ruins, blue dots = low terrain. The GW
 *      key IS colour-coded by height, so segmentation and height fall out together.
 *   3. Morphology — close to merge hatch/dots into solid blobs, open to drop
 *      grid lines, red dimension arrows, and eye badges.
 *   4. Connected components → PCA oriented box per blob (centre, size, angle).
 *   5. Fill ratio (pixels ÷ box area) rejects merged / L-shaped blobs as
 *      not-a-single-rectangle; they are flagged, not silently placed.
 * A split tall/low outline segments into a grey blob + a blue blob — i.e. two
 * adjacent pieces, matching ADR-0011's split-height decision.
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
  /** Facing in radians (0 = +x), from the blob's principal axis. */
  facing: number;
  /** Suggested terrain height in mm (tall vs low), from the fill colour. */
  heightMm: number;
  /** True = a clean single rectangle; false = ambiguous blob (merged/L), flagged. */
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
  /** Morphological close radius (px). Default scales to ~4.5 mm of board. */
  closeRadius?: number;
  /** Morphological open radius (px). Default scales to ~3 mm of board. */
  openRadius?: number;
  /**
   * Drop blobs smaller than this (mm²). Default ~8 in² — above map icons (eye
   * badges ≈ 4 in²) but below the smallest real fill: a 6×4 outline's teal fill
   * insets inside its outline and can measure only ~13–14 in², so the floor must
   * stay well under that or real low pieces are lost.
   */
  minFootprintMm2?: number;
  /** Min pixels ÷ oriented-box area for a blob to count as one rectangle. */
  rectFillMin?: number;
  /**
   * Snap each piece's facing to the nearest multiple of this many degrees, so
   * detection noise doesn't leave terrain at slight angles. Layouts use a range of
   * angles (not just straight/45°), so 15 (default) cleans measurement noise while
   * preserving intended rotations; 0 keeps the raw measured angle.
   */
  snapAngleStepDeg?: number;
  /**
   * Nudge overlapping detected pieces apart until they just touch (default on).
   * Small detection overlaps are cosmetic noise; separating to zero penetration
   * leaves pieces edge-to-edge or corner-to-corner, matching how terrain is laid.
   */
  separateOverlaps?: boolean;
  /**
   * Snap each detected footprint to the nearest official area-terrain size
   * (`AREA_TERRAIN_FOOTPRINTS_MM` for the chosen `edition`) instead of using the
   * raw measured pixels (default on). Every layout piece is one of the edition's
   * sizes, so snapping removes measurement noise and never invents a size.
   */
  snapToCatalogSizes?: boolean;
  /** Which edition's size roster to snap to. Defaults to the current edition. */
  edition?: AreaTerrainEdition;
  /**
   * Detect split footprints — one outline shaded half tall (grey) / half low
   * (blue) — and emit them as two correctly-sized adjacent pieces (ADR-0011 "A")
   * instead of two mis-snapped halves (default on; needs `snapToCatalogSizes`).
   */
  mergeSplits?: boolean;
  /**
   * Fold the internal "recommended ruins placement" wall marks into the grey
   * footprint so a ruins outline reads as a solid rectangle rather than one
   * notched by its own walls (default on). The walls stay contained inside the
   * footprint; capturing them as LoS blockers is future work (roadmap).
   */
  containWalls?: boolean;
}

const MM_PER_INCH = 25.4;
const DEFAULT_RECT_FILL_MIN = 0.72;
const DEFAULT_SNAP_ANGLE_STEP_DEG = 15;

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

/** Light, low-saturation battlemat (the play surface), excluding concrete margin. */
function isBattlemat(r: number, g: number, b: number): boolean {
  const bright = (r + g + b) / 3;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return bright > 180 && sat < 30;
}
/** Saturated blue fill = low terrain ("2\" or less"). */
function isBlue(r: number, g: number, b: number): boolean {
  return b > 100 && b - r > 40 && b - g > 15;
}
/** Mid-grey, low-saturation fill = tall ruins ("more than 4\""). */
function isGrey(r: number, g: number, b: number): boolean {
  const bright = (r + g + b) / 3;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return sat < 25 && bright > 60 && bright < 155;
}
/** Near-black, low-saturation ink = the board border frame and piece outlines. */
function isDark(r: number, g: number, b: number): boolean {
  const bright = (r + g + b) / 3;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return bright < 75 && sat < 40;
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
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            v = 0;
            break;
          }
          if (mask[ny * w + nx] === 0) {
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

function close(mask: Mask, w: number, h: number, radius: number): Mask {
  let m = mask;
  for (let i = 0; i < radius; i++) m = dilate(m, w, h);
  for (let i = 0; i < radius; i++) m = erode(m, w, h);
  return m;
}

function open(mask: Mask, w: number, h: number, radius: number): Mask {
  let m = mask;
  for (let i = 0; i < radius; i++) m = erode(m, w, h);
  for (let i = 0; i < radius; i++) m = dilate(m, w, h);
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
  /** pixels ÷ (long·short): ~1 for a filled rectangle. */
  fill: number;
}

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
  // Principal-axis angle of the 2×2 covariance (closed form).
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const v = { x: -u.y, y: u.x };
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const i of pixels) {
    const dx = (i % w) - cx;
    const dy = ((i / w) | 0) - cy;
    const pu = dx * u.x + dy * u.y;
    const pv = dx * v.x + dy * v.y;
    if (pu < uMin) uMin = pu;
    if (pu > uMax) uMax = pu;
    if (pv < vMin) vMin = pv;
    if (pv > vMax) vMax = pv;
  }
  let extU = uMax - uMin;
  let extV = vMax - vMin;
  // Keep the long side as "u"/`angle`; if v is longer, rotate 90°.
  if (extV > extU) {
    [extU, extV] = [extV, extU];
    angle += Math.PI / 2;
  }
  // Normalise angle to (−π/2, π/2] — a rectangle is symmetric under 180°.
  while (angle > Math.PI / 2) angle -= Math.PI;
  while (angle <= -Math.PI / 2) angle += Math.PI;
  const fill = n / Math.max(1, extU * extV);
  return { cx, cy, long: extU, short: extV, angle, fill };
}


// --- board detection ---

function largestComponentBBox(mask: Mask, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const blobs = components(mask, w, h, 1);
  if (blobs.length === 0) return null;
  let best = blobs[0]!;
  for (const b of blobs) if (b.pixels.length > best.pixels.length) best = b;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of best.pixels) {
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
 * Detect the board rectangle. Preferred: the **dark border frame** — the columns
 * and rows that are mostly dark ink span the four sides of the play area, and
 * their extremes bound it. This is the true edge the terrain is laid against, so
 * a piece at the border lands at the board edge. It also fixes scale: the content
 * bounding box overshoots the frame (light margin outside it reads as battlemat),
 * which would under-scale every position.
 *
 * Fallback (no clear frame): the bounding box of the largest connected content
 * region (battlemat ∪ fills), dilated so arrows/gaps don't split it.
 */
function detectBoard(img: PixelBuffer, battlemat: Mask, blue: Mask, grey: Mask, dark: Mask): { x: number; y: number; width: number; height: number } {
  const { width: w, height: h } = img;
  const colDark = new Int32Array(w);
  const rowDark = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dark[y * w + x] === 1) {
        colDark[x] = colDark[x]! + 1;
        rowDark[y] = rowDark[y]! + 1;
      }
    }
  }
  // A frame side is a column/row that is dark across most of the board's span.
  // Pick the frame that BRACKETS THE IMAGE CENTRE, not the outermost lines — so a
  // stray border from a neighbouring layout (e.g. two layouts on one PDF page,
  // or a loose crop) is ignored rather than stretching the board over both.
  const cx = w / 2;
  const cy = h / 2;
  let x0 = -1;
  let x1 = -1;
  let y0 = -1;
  let y1 = -1;
  for (let x = 0; x < w; x++)
    if (colDark[x]! > h * 0.5) {
      if (x <= cx) x0 = x; // nearest frame column at/left of centre
      else if (x1 < 0) x1 = x; // first frame column right of centre
    }
  for (let y = 0; y < h; y++)
    if (rowDark[y]! > w * 0.5) {
      if (y <= cy) y0 = y;
      else if (y1 < 0) y1 = y;
    }
  if (x0 >= 0 && y0 >= 0 && x1 - x0 > w * 0.3 && y1 - y0 > h * 0.3) {
    // Refine to the play surface: the extent of battlemat inside the frame. The
    // frame's outer extremes include the border's own thickness; the battlemat
    // starts at the inner edge, which is the surface terrain is measured against.
    let ix0 = x1;
    let iy0 = y1;
    let ix1 = x0;
    let iy1 = y0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (battlemat[y * w + x] === 1) {
          if (x < ix0) ix0 = x;
          if (x > ix1) ix1 = x;
          if (y < iy0) iy0 = y;
          if (y > iy1) iy1 = y;
        }
      }
    }
    if (ix1 - ix0 > w * 0.3 && iy1 - iy0 > h * 0.3) {
      return { x: ix0, y: iy0, width: ix1 - ix0 + 1, height: iy1 - iy0 + 1 };
    }
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  const content = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) content[i] = battlemat[i] || blue[i] || grey[i] ? 1 : 0;
  let m: Mask = content;
  for (let i = 0; i < 6; i++) m = dilate(m, w, h);
  const bbox = largestComponentBBox(m, w, h);
  if (!bbox) return { x: 0, y: 0, width: w, height: h };
  return { x: bbox.x0, y: bbox.y0, width: bbox.x1 - bbox.x0 + 1, height: bbox.y1 - bbox.y0 + 1 };
}

// --- public API ---

/** Restrict a mask to the detected board rectangle (zero everything outside). */
function restrictToBoard(mask: Mask, w: number, board: { x: number; y: number; width: number; height: number }): Mask {
  const out = new Uint8Array(mask.length);
  for (let y = board.y; y < board.y + board.height; y++) {
    for (let x = board.x; x < board.x + board.width; x++) {
      const i = y * w + x;
      out[i] = mask[i]!;
    }
  }
  return out;
}

function boxesToPieces(
  blobs: Blob[],
  w: number,
  board: { x: number; y: number },
  mmPerPx: number,
  heightMm: number,
  rectFillMin: number,
  snapStepDeg: number,
  roster: Footprint[] | null,
): DetectedTerrain[] {
  const out: DetectedTerrain[] = [];
  for (const blob of blobs) {
    const box = orientedBox(blob.pixels, w);
    const longMm = box.long * mmPerPx;
    const shortMm = box.short * mmPerPx;
    const size = roster ? snapToCatalogSize(longMm, shortMm, roster) : { longMm, shortMm };
    out.push({
      pos: { x: (box.cx - board.x) * mmPerPx, y: (box.cy - board.y) * mmPerPx },
      base: { kind: "rect", halfWidthMm: size.longMm / 2, halfHeightMm: size.shortMm / 2 },
      facing: snapFacing(box.angle, snapStepDeg),
      heightMm,
      // Rectangularity is judged on the RAW measurement, before snapping.
      rect: box.fill >= rectFillMin,
    });
  }
  return out;
}

// --- split-footprint detection (one outline, half tall / half low) ---

function snapDistMm(longMm: number, shortMm: number, roster: Footprint[]): number {
  const s = snapToCatalogSize(longMm, shortMm, roster);
  return Math.hypot(longMm - s.longMm, shortMm - s.shortMm);
}

function makeRectPiece(cx: number, cy: number, longMm: number, shortMm: number, facing: number, heightMm: number): DetectedTerrain {
  return {
    pos: { x: cx, y: cy },
    base: { kind: "rect", halfWidthMm: longMm / 2, halfHeightMm: shortMm / 2 },
    facing,
    heightMm,
    rect: true,
  };
}

/** Emit a split footprint's two halves, sized from the snapped whole footprint. */
function emitSplit(
  gb: OrientedBox,
  gCount: number,
  bb: OrientedBox,
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
  // Grey-minus-blue centroid separation, decomposed onto the footprint axes.
  const dx = (gb.cx - bb.cx) * mmPerPx;
  const dy = (gb.cy - bb.cy) * mmPerPx;
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
  // long side (along facing u) vs short (along v) per piece:
  const gLong = alongLong ? gSplit : crossMm;
  const gShort = alongLong ? crossMm : gSplit;
  const bLong = alongLong ? bSplit : crossMm;
  const bShort = alongLong ? crossMm : bSplit;
  return [
    makeRectPiece(cx + axis.x * gOff, cy + axis.y * gOff, gLong, gShort, facing, HEIGHT_TALL_MM),
    makeRectPiece(cx + axis.x * bOff, cy + axis.y * bOff, bLong, bShort, facing, HEIGHT_LOW_MM),
  ];
}

/**
 * Detect split footprints: a grey blob and blue blob that together fill one
 * rectangle matching a catalog size — but where neither half matches a size on
 * its own — are one outline shaded half tall / half low. Emit the two halves
 * sized from the snapped whole (ADR-0011 "A"); leave everything else to be
 * snapped individually. Only runs when a `roster` (catalog) is in play.
 */
function mergeSplitFootprints(
  grey: Blob[],
  blue: Blob[],
  w: number,
  origin: { x: number; y: number },
  mmPerPx: number,
  roster: Footprint[],
  snapStepDeg: number,
): { splits: DetectedTerrain[]; usedGrey: Set<number>; usedBlue: Set<number> } {
  const splits: DetectedTerrain[] = [];
  const usedGrey = new Set<number>();
  const usedBlue = new Set<number>();
  const gBoxes = grey.map((b) => orientedBox(b.pixels, w));
  const bBoxes = blue.map((b) => orientedBox(b.pixels, w));
  const CATALOG_TOL = 1.5 * MM_PER_INCH; // combined must snap within this
  const OFF_CATALOG = 1.0 * MM_PER_INCH; // a half must miss every size by more than this
  for (let gi = 0; gi < grey.length; gi++) {
    const gDist = snapDistMm(gBoxes[gi]!.long * mmPerPx, gBoxes[gi]!.short * mmPerPx, roster);
    if (gDist <= OFF_CATALOG) continue; // grey alone is already a clean size — not a split half
    let best: { bi: number; ub: OrientedBox; cDist: number } | null = null;
    for (let bi = 0; bi < blue.length; bi++) {
      if (usedBlue.has(bi)) continue;
      const bDist = snapDistMm(bBoxes[bi]!.long * mmPerPx, bBoxes[bi]!.short * mmPerPx, roster);
      if (bDist <= OFF_CATALOG) continue;
      const union = grey[gi]!.pixels.concat(blue[bi]!.pixels);
      const ub = orientedBox(union, w);
      const unionFill = union.length / Math.max(1, ub.long * ub.short);
      if (unionFill < 0.7) continue; // the two colours tile a solid rectangle (adjacent, not scattered)
      const cDist = snapDistMm(ub.long * mmPerPx, ub.short * mmPerPx, roster);
      if (cDist > CATALOG_TOL || cDist >= gDist || cDist >= bDist) continue; // whole beats either half
      if (!best || cDist < best.cDist) best = { bi, ub, cDist };
    }
    if (best) {
      usedGrey.add(gi);
      usedBlue.add(best.bi);
      splits.push(...emitSplit(gBoxes[gi]!, grey[gi]!.pixels.length, bBoxes[best.bi]!, blue[best.bi]!.pixels.length, best.ub, origin, mmPerPx, roster, snapStepDeg));
    }
  }
  return { splits, usedGrey, usedBlue };
}

/**
 * Fold the internal ruins-wall notch into the grey footprint so a ruins outline
 * reads as a solid rectangle, not one notched by its own "recommended ruins
 * placement" L-wall (which otherwise drags the fill ratio down and biases the
 * centroid). A morphological close of `closeR` px bridges the wall groove; it is
 * leak-free (grey mask only) — pick `closeR` wide enough to fill the wall but
 * below the wider battlemat gaps between separate footprints, so they don't merge.
 */
function solidifyGreyFootprints(grey: Mask, w: number, h: number, closeR: number): Mask {
  return close(grey, w, h, closeR);
}

/**
 * Analyze a Warhammer terrain-layout image into board-relative `DetectedTerrain`.
 * `boardWidthMm` (from the chosen battlefield preset) sets the pixel→mm scale.
 */
export function analyzeTerrainLayout(img: PixelBuffer, opts: AnalyzeLayoutOptions): TerrainLayoutAnalysis {
  const { width: w, height: h } = img;
  const battlemat = classify(img, isBattlemat);
  const blueRaw = classify(img, isBlue);
  const greyRaw = classify(img, isGrey);
  const dark = classify(img, isDark);

  const board = detectBoard(img, battlemat, blueRaw, greyRaw, dark);
  const mmPerPx = opts.boardWidthMm / board.width;
  const pxPerMm = board.width / opts.boardWidthMm;

  const closeRadius = opts.closeRadius ?? Math.max(1, Math.round(pxPerMm * 4.5));
  const openRadius = opts.openRadius ?? Math.max(1, Math.round(pxPerMm * 3));
  const minFootprintMm2 = opts.minFootprintMm2 ?? 8 * MM_PER_INCH * MM_PER_INCH;
  const minPixels = Math.round(minFootprintMm2 * pxPerMm * pxPerMm);
  const rectFillMin = opts.rectFillMin ?? DEFAULT_RECT_FILL_MIN;
  const snapStepDeg = opts.snapAngleStepDeg ?? DEFAULT_SNAP_ANGLE_STEP_DEG;
  const snapSize = opts.snapToCatalogSizes ?? true;
  const roster = snapSize ? AREA_TERRAIN_FOOTPRINTS_MM[opts.edition ?? DEFAULT_AREA_TERRAIN_EDITION] : null;

  const prep = (raw: Mask): Blob[] => {
    let m = restrictToBoard(raw, w, board);
    m = close(m, w, h, closeRadius);
    m = open(m, w, h, openRadius);
    return components(m, w, h, minPixels);
  };

  const origin = { x: board.x, y: board.y };
  // Contain the internal ruins walls so a footprint reads as a solid rectangle:
  // add the wall marks that touch the grey fill, then close the notch they leave.
  // Restricted to grey ∪ (wall-touching-grey) so it can't reach across the dark
  // outline into the battlemat and merge separate footprints.
  const wallClose = Math.max(closeRadius, Math.round(pxPerMm * 8));
  const greyMask = (opts.containWalls ?? true) ? solidifyGreyFootprints(greyRaw, w, h, wallClose) : greyRaw;
  const greyBlobs = prep(greyMask);
  const blueBlobs = prep(blueRaw);

  // Split footprints first (needs the catalog): a grey + blue pair that together
  // form one catalog rectangle becomes two correctly-sized adjacent halves; the
  // rest are snapped individually.
  let splits: DetectedTerrain[] = [];
  let usedGrey = new Set<number>();
  let usedBlue = new Set<number>();
  if (roster && (opts.mergeSplits ?? true)) {
    ({ splits, usedGrey, usedBlue } = mergeSplitFootprints(greyBlobs, blueBlobs, w, origin, mmPerPx, roster, snapStepDeg));
  }
  const remGrey = greyBlobs.filter((_, i) => !usedGrey.has(i));
  const remBlue = blueBlobs.filter((_, i) => !usedBlue.has(i));

  const all = [
    ...splits,
    ...boxesToPieces(remGrey, w, origin, mmPerPx, HEIGHT_TALL_MM, rectFillMin, snapStepDeg, roster),
    ...boxesToPieces(remBlue, w, origin, mmPerPx, HEIGHT_LOW_MM, rectFillMin, snapStepDeg, roster),
  ];
  // Separate the clean rectangles so small detection overlaps become clean
  // edge/corner contact; ambiguous (flagged) blobs are left where they were.
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
