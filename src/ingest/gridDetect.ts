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

const lumaAt = (d: Uint8ClampedArray, w: number, h: number, x: number, y: number): number =>
  x < 0 || y < 0 || x >= w || y >= h ? NaN : luma(d, (y * w + x) * 4);

/**
 * A raw luma-gradient profile responds hardest to whatever has the most ink —
 * dense hatching ("solid rock"), thick black walls, and drawn drop-shadows —
 * none of which is the grid. On a hand-drawn map that non-grid energy biases
 * both the pitch and (badly) the phase. Instead we count, per line, pixels that
 * look like a drawn gridline: a thin luma *valley* — the centre darker than both
 * neighbours `GRID_PROBE` px to each side — sitting on a *uniform* background.
 * This is specific to gridlines and structurally rejects the three culprits:
 * hatching (sides are not uniform), thick walls (neighbours are also dark, so no
 * valley), and shadows (a gradual ramp, not a valley). The result is a clean
 * periodic comb even where the grid is faint and heavily interrupted.
 */
const GRID_PROBE = 3; // px to each side where we sample the line's background
const GRID_CONTRAST = 16; // min luma the centre must sit below both sides (valley depth)
const GRID_BG_TOL = 40; // max luma gap between the two sides (else it's a step edge, not a line)

/** Per-column count of vertical-gridline pixels (luma valley, uniform bg L/R). */
function columnEnergy(img: PixelBuffer): Float64Array {
  const { data, width: w, height: h } = img;
  const e = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const l = lumaAt(data, w, h, x - GRID_PROBE, y);
      const r = lumaAt(data, w, h, x + GRID_PROBE, y);
      if (Number.isNaN(l) || Number.isNaN(r)) continue;
      const c = luma(data, (y * w + x) * 4);
      if (l - c > GRID_CONTRAST && r - c > GRID_CONTRAST && Math.abs(l - r) < GRID_BG_TOL) s++;
    }
    e[x] = s;
  }
  return e;
}

/** Per-row count of horizontal-gridline pixels (luma valley, uniform bg above/below). */
function rowEnergy(img: PixelBuffer): Float64Array {
  const { data, width: w, height: h } = img;
  const e = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const t = lumaAt(data, w, h, x, y - GRID_PROBE);
      const b = lumaAt(data, w, h, x, y + GRID_PROBE);
      if (Number.isNaN(t) || Number.isNaN(b)) continue;
      const c = luma(data, (y * w + x) * 4);
      if (t - c > GRID_CONTRAST && b - c > GRID_CONTRAST && Math.abs(t - b) < GRID_BG_TOL) s++;
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
 * The energy here is already a gridline-specific count (see columnEnergy), so it
 * needs no spike clipping — the aperiodic edges a raw gradient produced are gone.
 * We (1) detrend to remove the room-scale envelope (a grid only occupies rooms,
 * not the hatched fill between them), then (2) find the period by autocorrelation:
 * the periodic grid reinforces at its true lag while residual noise does not.
 */
function periodFromEnergy(e: Float64Array): { pxPerCell: number; offset: number } | null {
  const n = e.length;
  const maxCell = Math.min(160, Math.floor(n / 4));
  if (maxCell < MIN_CELL) return null;

  // Detrend: subtract a broad moving average so room-scale structure drops out.
  const base = movingAverage(e, maxCell * 2);
  const s = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    s[i] = e[i]! - base[i]!;
    mean += s[i]!;
  }
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const v = s[i]! - mean;
    s[i] = v;
    ss += v * v;
  }
  if (ss <= 0) return null;

  // Normalized autocorrelation across candidate lags; the grid peaks at its pitch.
  const acf = new Float64Array(maxCell + 1);
  for (let lag = MIN_CELL; lag <= maxCell; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += s[i]! * s[i + lag]!;
    acf[lag] = sum / ss;
  }
  // Strength of the best peak anywhere — the gate for "is there a grid at all".
  let best = -Infinity;
  for (let lag = MIN_CELL + 1; lag < maxCell; lag++) {
    if (acf[lag]! >= acf[lag - 1]! && acf[lag]! >= acf[lag + 1]! && acf[lag]! > best) best = acf[lag]!;
  }
  if (best < 0.2) return null;

  // Pitch = the FUNDAMENTAL, i.e. the smallest-lag peak nearly as strong as the
  // best. A perfectly regular grid autocorrelates just as hard at every multiple
  // of its pitch, so the tallest peak is often a harmonic (2×/3×/…); taking the
  // first strong peak lands on the true pitch directly (no fold-down heuristic,
  // which mis-fired both ways on real maps).
  let bestLag = 0;
  for (let lag = MIN_CELL + 1; lag < maxCell; lag++) {
    if (acf[lag]! >= acf[lag - 1]! && acf[lag]! >= acf[lag + 1]! && acf[lag]! >= 0.7 * best) {
      bestLag = lag;
      break;
    }
  }
  if (bestLag === 0) return null;

  // Sub-pixel peak location by parabolic interpolation of the three ACF samples
  // around the integer lag — a real grid's pitch is rarely a whole number, and
  // an integer estimate drifts out of alignment across a wide image.
  const refine = (lag: number): number => {
    if (lag <= MIN_CELL || lag >= maxCell) return lag;
    const a = acf[lag - 1]!;
    const b = acf[lag]!;
    const c = acf[lag + 1]!;
    const denom = a - 2 * b + c;
    if (denom >= 0) return lag; // not a concave peak
    const delta = (0.5 * (a - c)) / denom;
    return Math.abs(delta) <= 1 ? lag + delta : lag;
  };

  const pxPerCell = refine(bestLag);

  // Sub-pixel phase: circular mean of the positive (gridline) energy at the grid
  // frequency. Robust and independent of where the first line happens to fall.
  let sumSin = 0;
  let sumCos = 0;
  for (let x = 0; x < n; x++) {
    const w = s[x]! > 0 ? s[x]! : 0;
    const angle = (2 * Math.PI * x) / pxPerCell;
    sumSin += w * Math.sin(angle);
    sumCos += w * Math.cos(angle);
  }
  let offset = (Math.atan2(sumSin, sumCos) / (2 * Math.PI)) * pxPerCell;
  offset = ((offset % pxPerCell) + pxPerCell) % pxPerCell;

  return { pxPerCell, offset };
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
