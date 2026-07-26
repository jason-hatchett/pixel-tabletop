/**
 * Map analyzer — import-time CV that reconstructs a blueprint dungeon map's
 * walls as first-class domain `Wall` segments (ADR-0009). Pure and DOM-free: a
 * plain pixel buffer in, mm-space walls out, so it is deterministic and unit
 * testable. The heuristics live here and NOT in `src/domain/`; the walls it
 * emits are ordinary geometry the runtime LoS engine already handles unchanged
 * (pillar 4 — the image is an authoring seed, never a runtime occlusion source).
 *
 * v1 targets the stylized blueprint class: a solid-colour background with white
 * rooms/corridors, walls being the floor↔background boundary. Approach:
 *   1. classify each pixel as floor (bright/white) vs background (saturated),
 *   2. fill interior holes (text, numbers, gridlines) so they don't spawn walls,
 *   3. emit the floor/background boundary as merged axis-aligned segments,
 *   4. convert px → mm.
 * Curved/diagonal walls become faceted axis segments (fine for LoS). Icons
 * (doors/statues/stairs) are out of scope for this cut (ADR-0009 B2).
 */

import type { Wall } from "../domain/walls.js";
import type { Vec2 } from "../domain/geometry.js";
import type { PixelBuffer } from "./decode.js";
import { alignEdgeToGrid } from "./calibrate.js";

export interface MapAnalysis {
  walls: Wall[];
}

export interface AnalyzeOptions {
  /** Scale from image pixels to board millimetres (from calibration/grid detect). */
  mmPerPx: number;
  /**
   * Floor classifier threshold on the pixel's minimum channel (0–255). A white
   * room has a high min channel; a saturated background (e.g. blue) has a low
   * one. Default sits between the two so faint in-room gridlines still read as
   * floor.
   */
  floorThreshold?: number;
  /** Drop boundary segments shorter than this many pixels (specks). */
  minSegmentPx?: number;
  /** Morphological-close radius (px) to fill thin gridlines. 0 disables. */
  closeRadius?: number;
  /** Min solid-core radius (px) for an interior blob to survive as a column. */
  columnRadius?: number;
}

const DEFAULT_FLOOR_THRESHOLD = 90;
const DEFAULT_MIN_SEGMENT_PX = 2;
const DEFAULT_CLOSE_RADIUS = 1;
const DEFAULT_COLUMN_RADIUS = 2;

/** Floor mask: 1 where the pixel reads as room floor, else 0. */
function floorMask(img: PixelBuffer, threshold: number): Uint8Array {
  const { data, width, height } = img;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const min = Math.min(data[p]!, data[p + 1]!, data[p + 2]!);
    mask[i] = min > threshold ? 1 : 0;
  }
  return mask;
}

/** 3×3 dilation (floor grows 1px); out-of-bounds treated as non-floor. */
function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
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

/** 3×3 erosion (floor shrinks 1px); out-of-bounds treated as floor so the image
 * border isn't eaten. */
function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v === 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
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

/**
 * Morphological close (dilate then erode) by `radius` px: fills thin non-floor
 * lines inside the floor — a battlemap's grid — so they don't each trace a wall.
 * Robust to anti-aliased lines (bridges them) where an exact floor-bounded test
 * fails. Room boundaries, wider doorways, and solid columns all survive; there
 * is NO interior hole-fill, so columns remain and become wall loops.
 */
function closeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  let m = mask;
  for (let i = 0; i < radius; i++) m = dilate(m, w, h);
  for (let i = 0; i < radius; i++) m = erode(m, w, h);
  return m;
}

/**
 * Fill interior non-floor (not reachable from the image border) — the gridline
 * remnants and glyph strokes closing leaves behind — EXCEPT solid blobs, which
 * are kept as walls (columns/pillars). A column survives a morphological opening
 * of radius `solidRadius` (it has a solid core); a thin line or stroke does not,
 * so it gets filled. This keeps columns while still cleaning interior noise.
 */
function fillInteriorHolesKeepSolid(mask: Uint8Array, w: number, h: number, solidRadius: number): void {
  const reachable = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (mask[i] === 0 && reachable[i] === 0) {
      reachable[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  const interior = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) interior[i] = mask[i] === 0 && reachable[i] === 0 ? 1 : 0;

  // Opening of the interior set → the solid cores (columns) to preserve.
  let solid: Uint8Array = interior;
  for (let i = 0; i < solidRadius; i++) solid = erode(solid, w, h);
  for (let i = 0; i < solidRadius; i++) solid = dilate(solid, w, h);

  for (let i = 0; i < w * h; i++) if (interior[i] === 1 && solid[i] === 0) mask[i] = 1;
}

/** Vertical boundary run-segments [xLine, yStart, yEnd) in pixels. */
function verticalSegments(mask: Uint8Array, w: number, h: number): [number, number, number][] {
  const segs: [number, number, number][] = [];
  for (let x = 0; x <= w; x++) {
    let run = -1;
    for (let y = 0; y < h; y++) {
      const leftFloor = x > 0 && mask[y * w + (x - 1)] === 1;
      const rightFloor = x < w && mask[y * w + x] === 1;
      const edge = leftFloor !== rightFloor;
      if (edge) {
        if (run < 0) run = y;
      } else if (run >= 0) {
        segs.push([x, run, y]);
        run = -1;
      }
    }
    if (run >= 0) segs.push([x, run, h]);
  }
  return segs;
}

/** Horizontal boundary run-segments [yLine, xStart, xEnd) in pixels. */
function horizontalSegments(mask: Uint8Array, w: number, h: number): [number, number, number][] {
  const segs: [number, number, number][] = [];
  for (let y = 0; y <= h; y++) {
    let run = -1;
    for (let x = 0; x < w; x++) {
      const topFloor = y > 0 && mask[(y - 1) * w + x] === 1;
      const bottomFloor = y < h && mask[y * w + x] === 1;
      const edge = topFloor !== bottomFloor;
      if (edge) {
        if (run < 0) run = x;
      } else if (run >= 0) {
        segs.push([y, run, x]);
        run = -1;
      }
    }
    if (run >= 0) segs.push([y, run, w]);
  }
  return segs;
}

/** Reconstruct a blueprint map's walls as mm-space `Wall` segments. */
export function analyzeMap(img: PixelBuffer, opts: AnalyzeOptions): MapAnalysis {
  const { width: w, height: h } = img;
  const threshold = opts.floorThreshold ?? DEFAULT_FLOOR_THRESHOLD;
  const minSeg = opts.minSegmentPx ?? DEFAULT_MIN_SEGMENT_PX;
  const s = opts.mmPerPx;

  const closeRadius = opts.closeRadius ?? DEFAULT_CLOSE_RADIUS;
  const columnRadius = opts.columnRadius ?? DEFAULT_COLUMN_RADIUS;
  let mask = floorMask(img, threshold);
  if (closeRadius > 0) mask = closeMask(mask, w, h, closeRadius); // bridge thin gridlines
  fillInteriorHolesKeepSolid(mask, w, h, columnRadius); // clean remnants; keep columns as walls

  const walls: Wall[] = [];
  let n = 0;
  for (const [x, y0, y1] of verticalSegments(mask, w, h)) {
    if (y1 - y0 < minSeg) continue;
    walls.push({
      id: `map-wall-${n++}`,
      a: { x: x * s, y: y0 * s },
      b: { x: x * s, y: y1 * s },
      blocksLoS: true,
      blocksMove: true,
    });
  }
  for (const [y, x0, x1] of horizontalSegments(mask, w, h)) {
    if (x1 - x0 < minSeg) continue;
    walls.push({
      id: `map-wall-${n++}`,
      a: { x: x0 * s, y: y * s },
      b: { x: x1 * s, y: y * s },
      blocksLoS: true,
      blocksMove: true,
    });
  }
  return { walls };
}

export interface MapBoardLayout {
  /** Board size = the image's physical size. */
  widthMm: number;
  heightMm: number;
  /** Where the image's top-left corner sits in board space (grid-aligned). */
  imageTopLeftMm: Vec2;
  /** Analyzer walls translated into board space. */
  walls: Wall[];
}

/**
 * Lay a reconstructed map out on a fresh board: board size = image size, the
 * image placed so its detected grid lands on the board grid (anchored at 0,
 * pitch `cellMm`), and the analyzer's image-space walls translated to match.
 * Pure — the caller assembles the `BoardState` and dispatches `loadState`.
 */
export function layoutMapBoard(
  analysis: MapAnalysis,
  opts: {
    imgWidth: number;
    imgHeight: number;
    mmPerPx: number;
    cellMm: number;
    gridOffsetXpx: number;
    gridOffsetYpx: number;
  },
): MapBoardLayout {
  const { imgWidth, imgHeight, mmPerPx, cellMm, gridOffsetXpx, gridOffsetYpx } = opts;
  const topLeft: Vec2 = {
    x: alignEdgeToGrid(0, gridOffsetXpx * mmPerPx, cellMm),
    y: alignEdgeToGrid(0, gridOffsetYpx * mmPerPx, cellMm),
  };
  const walls = analysis.walls.map((w) => ({
    ...w,
    a: { x: w.a.x + topLeft.x, y: w.a.y + topLeft.y },
    b: { x: w.b.x + topLeft.x, y: w.b.y + topLeft.y },
  }));
  return { widthMm: imgWidth * mmPerPx, heightMm: imgHeight * mmPerPx, imageTopLeftMm: topLeft, walls };
}
