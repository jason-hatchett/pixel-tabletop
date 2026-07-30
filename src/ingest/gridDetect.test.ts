import { describe, it, expect } from "vitest";
import { detectGrid } from "./gridDetect.js";
import type { PixelBuffer } from "./decode.js";

/** Build a white image with dark gridlines every `pitch` px, first line at `offset`. */
function gridImage(width: number, height: number, pitch: number, offset: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const dark = (x: number, y: number): void => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 20;
    data[i + 3] = 255;
  };
  for (let x = offset; x < width; x += pitch) for (let y = 0; y < height; y++) dark(x, y);
  for (let y = offset; y < height; y += pitch) for (let x = 0; x < width; x++) dark(x, y);
  return { data, width, height };
}

describe("detectGrid", () => {
  it("recovers pitch and phase of a clean grid", () => {
    const d = detectGrid(gridImage(200, 200, 25, 10));
    expect(d).not.toBeNull();
    expect(d!.pxPerCell).toBeCloseTo(25, 0);
    expect(d!.offsetX).toBeCloseTo(10, 0); // sub-pixel phase, ~10
    expect(d!.offsetY).toBeCloseTo(10, 0);
  });

  it("recovers a fractional pitch sub-pixel (no cumulative drift)", () => {
    // Lines at round(k * 26.8): an integer estimate (27) would drift ~6px across
    // the width; sub-pixel refinement should land within a fraction of a pixel.
    const W = 800;
    const H = 400;
    const pitch = 26.8;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    const line = (px: number, py: number): void => {
      const i = (py * W + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = 90;
    };
    for (let k = 0; k * pitch < W; k++) for (let y = 0; y < H; y++) line(Math.round(k * pitch), y);
    for (let k = 0; k * pitch < H; k++) for (let x = 0; x < W; x++) line(x, Math.round(k * pitch));
    const d = detectGrid({ data, width: W, height: H });
    // Must land clearly below the integer 27 (drift-free), not just "near 27".
    expect(Math.abs(d!.pxPerCell - pitch)).toBeLessThan(0.15);
  });

  it("handles a zero offset (gridline on the edge)", () => {
    const d = detectGrid(gridImage(160, 160, 20, 0));
    expect(d!.pxPerCell).toBeCloseTo(20, 0);
    // A gridline on the edge registers its gradient peak ~1px in; accept a small
    // phase error (the confirm step lets the user nudge it).
    const phase = Math.min(d!.offsetX, 20 - d!.offsetX);
    expect(phase).toBeLessThanOrEqual(2);
  });

  it("returns null for a flat image with no grid", () => {
    const data = new Uint8ClampedArray(100 * 100 * 4).fill(200);
    expect(detectGrid({ data, width: 100, height: 100 })).toBeNull();
  });

  it("recovers the grid despite aperiodic non-grid structure (blueprint style)", () => {
    // A grid competing with strong aperiodic edges: solid rooms and a diagonal
    // wall (like a blueprint's outlines/corridors). Peak-median gap estimation
    // fails here; autocorrelation should still find the true pitch.
    const W = 320;
    const H = 320;
    const pitch = 16;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    const set = (px: number, py: number, v: number): void => {
      if (px < 0 || px >= W || py < 0 || py >= H) return;
      const i = (py * W + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    };
    // A big solid block (strong, aperiodic outline edges).
    for (let y = 40; y < 200; y++) for (let x = 30; x < 250; x++) set(x, y, 90);
    // A diagonal wall.
    for (let t = 0; t < 260; t++) set(t, Math.round(t * 0.7), 40);
    // The real grid, spanning the whole image, faint.
    for (let x = 6; x < W; x += pitch) for (let y = 0; y < H; y++) set(x, y, 150);
    for (let y = 6; y < H; y += pitch) for (let x = 0; x < W; x++) set(x, y, 150);

    const d = detectGrid({ data, width: W, height: H });
    expect(d).not.toBeNull();
    expect(d!.pxPerCell).toBeCloseTo(pitch, 0);
  });

  it("keeps a coarse grid against dense hatching (hand-drawn maps)", () => {
    // A Dyson-style dungeon: a coarse (~40px) grid competes with broad blocks of
    // dense "solid rock" hatching. A raw luma-gradient signal is dominated by the
    // hatching (and, on real maps, thick walls and drawn drop-shadows), which
    // biased both pitch and phase; the gridline-specific valley detector must see
    // through it and recover the true coarse pitch, not a finer sub-multiple.
    const W = 600;
    const H = 600;
    const pitch = 40;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    const set = (px: number, py: number, v: number): void => {
      if (px < 0 || px >= W || py < 0 || py >= H) return;
      const i = (py * W + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    };
    // Deterministic PRNG so the fixture is stable across runs.
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    // Broad blocks of dense 1px speckle: contiguous high-energy regions (the ACF
    // shoulder) with no stroke-length periodicity that could masquerade as a grid.
    const block = (bx: number, by: number, bw: number, bh: number): void => {
      const dots = bw * bh * 0.45;
      for (let n = 0; n < dots; n++)
        set(bx + Math.floor(rnd() * bw), by + Math.floor(rnd() * bh), 30 + Math.floor(rnd() * 50));
    };
    for (let n = 0; n < 20; n++) {
      const bw = 70 + Math.floor(rnd() * 50);
      const bh = 70 + Math.floor(rnd() * 50);
      block(Math.floor(rnd() * (W - bw)), Math.floor(rnd() * (H - bh)), bw, bh);
    }
    // The real grid at pitch 40, faint, spanning the whole image.
    for (let x = 7; x < W; x += pitch) for (let y = 0; y < H; y++) set(x, y, 150);
    for (let y = 7; y < H; y += pitch) for (let x = 0; x < W; x++) set(x, y, 150);

    const d = detectGrid({ data, width: W, height: H });
    expect(d).not.toBeNull();
    // Must keep ~40, not fold to a shoulder sub-multiple (~13 or ~20).
    expect(d!.pxPerCell).toBeCloseTo(pitch, 0);
  });
});
