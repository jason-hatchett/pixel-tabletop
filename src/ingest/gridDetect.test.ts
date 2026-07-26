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
    expect(d!.offsetX).toBe(10);
    expect(d!.offsetY).toBe(10);
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
});
