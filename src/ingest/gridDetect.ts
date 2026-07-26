/**
 * Grid detection — a pure, heuristic authoring aid (kept out of `src/domain/`).
 *
 * Given an image's pixels, estimate the pitch (px per cell) and phase (offset of
 * the first gridline) of a regular grid drawn on it, so a D&D battlemap can be
 * scaled to "one image square = one board cell" and aligned to the board grid.
 *
 * This is best-effort, not ground truth (a JPEG has no geometry) — the result is
 * shown to the user to confirm/adjust before it is trusted, and it never feeds
 * runtime occlusion (pillar 4). The approach: gridlines are columns/rows of high
 * gradient energy; find the regular spacing of those energy peaks per axis.
 */

import type { PixelBuffer } from "./decode.js";

export interface GridDetection {
  /** Estimated cell size in pixels (square cells assumed). */
  pxPerCell: number;
  /** Pixel offset of the first vertical gridline from the left edge. */
  offsetX: number;
  /** Pixel offset of the first horizontal gridline from the top edge. */
  offsetY: number;
}

const luma = (d: Uint8ClampedArray, i: number): number =>
  0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;

/** Per-column horizontal-gradient energy: high where a vertical gridline sits. */
function columnEnergy(img: PixelBuffer): Float64Array {
  const { data, width, height } = img;
  const e = new Float64Array(width);
  for (let x = 1; x < width; x++) {
    let s = 0;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      s += Math.abs(luma(data, (row + x) * 4) - luma(data, (row + x - 1) * 4));
    }
    e[x] = s;
  }
  return e;
}

/** Per-row vertical-gradient energy: high where a horizontal gridline sits. */
function rowEnergy(img: PixelBuffer): Float64Array {
  const { data, width, height } = img;
  const e = new Float64Array(height);
  for (let y = 1; y < height; y++) {
    let s = 0;
    for (let x = 0; x < width; x++) {
      s += Math.abs(luma(data, (y * width + x) * 4) - luma(data, ((y - 1) * width + x) * 4));
    }
    e[y] = s;
  }
  return e;
}

const MIN_CELL = 6;

/** Centered moving average (box filter) via prefix sums. */
function movingAverage(e: Float64Array, win: number): Float64Array {
  const n = e.length;
  const half = Math.max(1, Math.floor(win / 2));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + e[i]!;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (prefix[b]! - prefix[a]!) / (b - a);
  }
  return out;
}

/**
 * Regular pitch + phase of a grid, or null if none is clear.
 *
 * Peak-median gap estimation is fragile: aperiodic strong edges (room outlines,
 * diagonal corridors, legend text) inject spurious peaks that corrupt the gap.
 * Instead we (1) detrend to remove room-scale structure, (2) clip spikes so a
 * few huge edges can't dominate, then (3) find the period by autocorrelation —
 * the periodic grid reinforces at its true lag while aperiodic edges do not.
 */
function periodFromEnergy(e: Float64Array): { pxPerCell: number; offset: number } | null {
  const n = e.length;
  const maxCell = Math.min(160, Math.floor(n / 4));
  if (maxCell < MIN_CELL) return null;

  // Detrend: subtract a broad moving average so room-scale structure drops out.
  const base = movingAverage(e, maxCell * 2);
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = e[i]! - base[i]!;

  // Clip spikes to a robust cap (a few × the median magnitude) so a diagonal
  // wall or legend edge can't swamp the periodic grid signal.
  const mags = Float64Array.from(d, Math.abs).sort();
  const median = mags[Math.floor(mags.length / 2)]!;
  const cap = median > 0 ? median * 4 : Infinity;
  const s = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    s[i] = Math.max(-cap, Math.min(cap, d[i]!));
    mean += s[i]!;
  }
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    s[i] -= mean;
    ss += s[i]! * s[i]!;
  }
  if (ss <= 0) return null;

  // Normalized autocorrelation across candidate lags; the grid peaks at its pitch.
  const acf = new Float64Array(maxCell + 1);
  for (let lag = MIN_CELL; lag <= maxCell; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += s[i]! * s[i + lag]!;
    acf[lag] = sum / ss;
  }
  let best = -Infinity;
  let bestLag = 0;
  for (let lag = MIN_CELL + 1; lag < maxCell; lag++) {
    if (acf[lag]! >= acf[lag - 1]! && acf[lag]! >= acf[lag + 1]! && acf[lag]! > best) {
      best = acf[lag]!;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || best < 0.2) return null;

  // The strongest peak may be a harmonic; prefer a sub-multiple that is itself
  // a strong peak (the fundamental cell size).
  for (const k of [2, 3]) {
    const sub = Math.round(bestLag / k);
    if (sub >= MIN_CELL && acf[sub]! >= 0.6 * best) {
      bestLag = sub;
      best = acf[sub]!;
    }
  }
  const pxPerCell = bestLag;

  // Phase: the comb offset that collects the most gridline energy.
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < pxPerCell; phase++) {
    let sum = 0;
    for (let x = phase; x < n; x += pxPerCell) sum += s[x]!;
    if (sum > bestScore) {
      bestScore = sum;
      bestPhase = phase;
    }
  }
  return { pxPerCell, offset: bestPhase };
}

/** Detect a regular grid, or null if the image has no clear one. */
export function detectGrid(img: PixelBuffer): GridDetection | null {
  const cx = periodFromEnergy(columnEnergy(img));
  const cy = periodFromEnergy(rowEnergy(img));
  if (!cx || !cy) return null;
  return {
    pxPerCell: (cx.pxPerCell + cy.pxPerCell) / 2, // cells are square
    offsetX: cx.offset,
    offsetY: cy.offset,
  };
}
