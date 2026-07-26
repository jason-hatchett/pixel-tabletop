import { describe, it, expect } from "vitest";
import { analyzeMap, layoutMapBoard } from "./mapAnalyzer.js";
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

  it("keeps a solid column inside a room as walls", () => {
    // A solid 8×8 blob (thicker than a gridline) is a column — kept as a wall loop.
    const img = blueprint(100, 100, [[20, 20, 60, 60]], []);
    for (let y = 46; y < 54; y++)
      for (let x = 46; x < 54; x++) {
        const p = (y * 100 + x) * 4;
        img.data[p] = 30;
        img.data[p + 1] = 90;
        img.data[p + 2] = 200; // dark blue column pixel
      }
    const { walls } = analyzeMap(img, { mmPerPx: 1 });
    expect(walls.length).toBeGreaterThan(4); // room outline + a loop around the column
    const columnWall = walls.some((wl) => wl.a.x === wl.b.x && wl.a.x >= 44 && wl.a.x <= 56);
    expect(columnWall).toBe(true);
  });

  it("erases thin floor-bounded gridlines but keeps the room walls", () => {
    const w = 100;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      data[p] = 43;
      data[p + 1] = 143;
      data[p + 2] = 214; // blue background
      data[p + 3] = 255;
    }
    for (let y = 20; y < 80; y++)
      for (let x = 20; x < 80; x++) {
        const p = (y * w + x) * 4;
        data[p] = data[p + 1] = data[p + 2] = 255; // white room
      }
    // Thin gridlines whose min channel (30) reads as non-floor — the failing case.
    const dark = (x: number, y: number): void => {
      const p = (y * w + x) * 4;
      data[p] = 30;
      data[p + 1] = 90;
      data[p + 2] = 200;
    };
    for (let gx = 30; gx < 80; gx += 10) for (let y = 20; y < 80; y++) dark(gx, y);
    for (let gy = 30; gy < 80; gy += 10) for (let x = 20; x < 80; x++) dark(x, gy);

    const { walls } = analyzeMap({ data, width: w, height: h }, { mmPerPx: 1 });
    expect(walls).toHaveLength(4); // closed → just the room outline, not a wall per gridline
  });

  it("extracts two rooms as eight walls", () => {
    const img = blueprint(120, 80, [
      [10, 10, 30, 30],
      [70, 40, 30, 25],
    ]);
    const { walls } = analyzeMap(img, { mmPerPx: 1 });
    expect(walls).toHaveLength(8);
  });

  it("lays walls out on a board sized to the image, grid-aligned", () => {
    const analysis = { walls: [{ id: "w0", a: { x: 10, y: 10 }, b: { x: 10, y: 60 }, blocksLoS: true, blocksMove: true }] };
    const layout = layoutMapBoard(analysis, {
      imgWidth: 200,
      imgHeight: 150,
      mmPerPx: 2,
      cellMm: 50,
      gridOffsetXpx: 0, // first gridline already at the image's left edge
      gridOffsetYpx: 0,
    });
    expect(layout.widthMm).toBe(400); // 200 * 2
    expect(layout.heightMm).toBe(300);
    // Offset 0 → image sits at board origin; walls unchanged.
    expect(layout.imageTopLeftMm).toEqual({ x: 0, y: 0 });
    expect(layout.walls[0]!.a).toEqual({ x: 10, y: 10 });
  });

  it("shifts the board so a detected gridline lands on the board grid", () => {
    const analysis = { walls: [{ id: "w0", a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, blocksLoS: true, blocksMove: true }] };
    // gridOffset 5px × 2mm = 10mm; nearest board gridline (cell 50) is 0 → shift -10.
    const layout = layoutMapBoard(analysis, {
      imgWidth: 100,
      imgHeight: 100,
      mmPerPx: 2,
      cellMm: 50,
      gridOffsetXpx: 5,
      gridOffsetYpx: 5,
    });
    expect(layout.imageTopLeftMm).toEqual({ x: -10, y: -10 });
    expect(layout.walls[0]!.a).toEqual({ x: -10, y: -10 });
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
