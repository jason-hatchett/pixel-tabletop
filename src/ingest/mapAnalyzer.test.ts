import { describe, it, expect } from "vitest";
import { analyzeMap } from "./mapAnalyzer.js";
import type { PixelBuffer } from "./decode.js";
import { hasLineOfSight } from "../domain/los.js";

/** Build a blueprint-style buffer: blue background with white room rectangles
 * (and optional blue specks inside a room to test interior-hole filling). */
function blueprint(
  w: number,
  h: number,
  rooms: [number, number, number, number][],
  holes: [number, number, number, number][] = [],
): PixelBuffer {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    data[p] = 43;
    data[p + 1] = 143;
    data[p + 2] = 214; // saturated blue background
    data[p + 3] = 255;
  }
  const paint = (x0: number, y0: number, rw: number, rh: number, r: number, g: number, b: number): void => {
    for (let y = y0; y < y0 + rh; y++)
      for (let x = x0; x < x0 + rw; x++) {
        const p = (y * w + x) * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
      }
  };
  for (const [x, y, rw, rh] of rooms) paint(x, y, rw, rh, 255, 255, 255);
  for (const [x, y, rw, rh] of holes) paint(x, y, rw, rh, 43, 143, 214);
  return { data, width: w, height: h };
}

describe("analyzeMap", () => {
  it("extracts a single room as its four boundary walls", () => {
    const img = blueprint(80, 80, [[20, 20, 40, 30]]);
    const { walls } = analyzeMap(img, { mmPerPx: 2 });
    expect(walls).toHaveLength(4);

    // In mm: left x=40, right x=120 (px 20,60 × 2); top y=40, bottom y=100.
    const vertical = walls.filter((w) => w.a.x === w.b.x).map((w) => w.a.x).sort((a, b) => a - b);
    const horizontal = walls.filter((w) => w.a.y === w.b.y).map((w) => w.a.y).sort((a, b) => a - b);
    expect(vertical).toEqual([40, 120]);
    expect(horizontal).toEqual([40, 100]);
    // Walls block LoS and movement.
    expect(walls.every((w) => w.blocksLoS && w.blocksMove)).toBe(true);
  });

  it("fills interior holes so numbers/gridlines don't spawn walls", () => {
    const img = blueprint(80, 80, [[20, 20, 40, 30]], [[35, 30, 4, 4]]); // a blue speck inside
    const { walls } = analyzeMap(img, { mmPerPx: 1 });
    expect(walls).toHaveLength(4); // still just the room outline
  });

  it("extracts two rooms as eight walls", () => {
    const img = blueprint(120, 80, [
      [10, 10, 30, 30],
      [70, 40, 30, 25],
    ]);
    const { walls } = analyzeMap(img, { mmPerPx: 1 });
    expect(walls).toHaveLength(8);
  });

  it("extracted walls block line of sight (ADR-0009 DoD)", () => {
    const img = blueprint(80, 80, [[20, 20, 40, 30]]); // room mm x[40,120] y[40,100]
    const { walls } = analyzeMap(img, { mmPerPx: 2 });
    const obs = { pos: { x: 80, y: 70 }, base: { kind: "circle", radiusMm: 5 } as const, facing: 0 };
    const tgt = { pos: { x: 200, y: 70 }, base: { kind: "circle", radiusMm: 5 } as const, facing: 0 };
    // Clear with no walls; blocked once the extracted room wall stands between them.
    expect(hasLineOfSight(obs, tgt, [], [])).toBe(true);
    expect(hasLineOfSight(obs, tgt, [], walls)).toBe(false);
  });
});
