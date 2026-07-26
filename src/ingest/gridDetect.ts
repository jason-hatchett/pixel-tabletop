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

/** Regular pitch + phase of energy peaks, or null if no clear grid. */
function periodFromEnergy(e: Float64Array): { pxPerCell: number; offset: number } | null {
  const n = e.length;
  if (n < 12) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += e[i]!;
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (e[i]! - mean) ** 2;
  const std = Math.sqrt(variance / n);
  if (std === 0) return null;
  const threshold = mean + 1.5 * std;

  // Local maxima above threshold, merged if within a few px (anti-aliased lines).
  const peaks: number[] = [];
  for (let x = 1; x < n - 1; x++) {
    if (e[x]! >= threshold && e[x]! >= e[x - 1]! && e[x]! >= e[x + 1]!) {
      const last = peaks[peaks.length - 1];
      if (last !== undefined && x - last < 4) {
        if (e[x]! > e[last]!) peaks[peaks.length - 1] = x;
      } else {
        peaks.push(x);
      }
    }
  }
  if (peaks.length < 3) return null;

  // Cell size = median gap between consecutive peaks (robust to a missed line).
  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i]! - peaks[i - 1]!);
  gaps.sort((a, b) => a - b);
  const pxPerCell = gaps[Math.floor(gaps.length / 2)]!;
  if (pxPerCell < 4) return null;

  const offset = ((peaks[0]! % pxPerCell) + pxPerCell) % pxPerCell;
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
