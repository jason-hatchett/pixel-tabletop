import { describe, it, expect } from "vitest";
import {
  analyzeTerrainLayout,
  detectedTerrainToPiece,
  snapFacing,
  snapToCatalogSize,
  overlapMTV,
  resolveOverlaps,
  type DetectedTerrain,
} from "./terrainLayoutAnalyzer.js";
import { HEIGHT_TALL_MM, HEIGHT_LOW_MM, AREA_TERRAIN_FOOTPRINTS_MM } from "../domain/terrain.js";
import { inchesToMm } from "../domain/units.js";
import { basePolygon, convexIntersect } from "../domain/geometry.js";
import type { PixelBuffer } from "./decode.js";

const rectPiece = (x: number, y: number, hw: number, hh: number, facing = 0): DetectedTerrain => ({
  pos: { x, y },
  base: { kind: "rect", halfWidthMm: hw, halfHeightMm: hh },
  facing,
  heightMm: HEIGHT_TALL_MM,
  rect: true,
});
const poly = (p: DetectedTerrain): { x: number; y: number }[] => basePolygon(p.pos, p.base, p.facing);

// --- synthetic layout builder -------------------------------------------------
const BATTLEMAT: [number, number, number] = [210, 210, 210];
const GREY: [number, number, number] = [105, 107, 110]; // tall ruins
const BLUE: [number, number, number] = [0, 93, 132]; // low terrain

function canvas(w: number, h: number, bg: [number, number, number]): PixelBuffer {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function fillRect(img: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * img.width + x) * 4;
      img.data[p] = c[0];
      img.data[p + 1] = c[1];
      img.data[p + 2] = c[2];
      img.data[p + 3] = 255;
    }
  }
}

const halfW = (p: DetectedTerrain): number => (p.base.kind === "rect" ? p.base.halfWidthMm : 0);
const halfH = (p: DetectedTerrain): number => (p.base.kind === "rect" ? p.base.halfHeightMm : 0);

describe("analyzeTerrainLayout", () => {
  it("detects a tall grey and a low blue footprint and snaps each to a catalog size", () => {
    // boardWidthMm = image width → mmPerPx = 1, so mm ≈ px.
    const img = canvas(700, 500, BATTLEMAT);
    // grey ≈ 6×4in (Medium), blue ≈ 11.5×7in (Large) — drawn a couple px off
    // exact, to prove snapping to the nearest official footprint.
    fillRect(img, 124, 99, 124 + 151, 99 + 103, GREY); // centre ≈ (199.5, 150.5)
    fillRect(img, 323, 236, 323 + 291, 236 + 177, BLUE); // centre ≈ (468.5, 324.5)

    const res = analyzeTerrainLayout(img, { boardWidthMm: 700 });
    expect(res.mmPerPx).toBeCloseTo(1, 5);
    const clean = res.pieces.filter((p) => p.rect);
    expect(clean.length).toBe(2);

    const tall = clean.find((p) => p.heightMm === HEIGHT_TALL_MM)!;
    const low = clean.find((p) => p.heightMm === HEIGHT_LOW_MM)!;

    // Sizes are the exact official footprints, not the raw pixel measurement.
    expect(halfW(tall)).toBeCloseTo(inchesToMm(6) / 2, 5);
    expect(halfH(tall)).toBeCloseTo(inchesToMm(4) / 2, 5);
    expect(halfW(low)).toBeCloseTo(inchesToMm(11.5) / 2, 5);
    expect(halfH(low)).toBeCloseTo(inchesToMm(7) / 2, 5);
    expect(tall.pos.x).toBeCloseTo(200, -0.9);
    expect(tall.pos.y).toBeCloseTo(150, -0.9);
    expect(tall.facing).toBe(0); // axis-aligned, angle-snapped
  });

  it("merges a split footprint (grey+blue halves) into two correctly-sized adjacent pieces", () => {
    const img = canvas(400, 350, BATTLEMAT);
    // A 10×5in outline split down the middle: grey 5×5 + blue 5×5, touching.
    fillRect(img, 70, 100, 197, 227, GREY); // 127×127px = 5×5in
    fillRect(img, 197, 100, 324, 227, BLUE); // 127×127px = 5×5in, adjacent to grey

    const res = analyzeTerrainLayout(img, { boardWidthMm: 400, edition: "10e" });
    const clean = res.pieces.filter((p) => p.rect);
    expect(clean.length).toBe(2);
    const tall = clean.find((p) => p.heightMm === HEIGHT_TALL_MM)!;
    const low = clean.find((p) => p.heightMm === HEIGHT_LOW_MM)!;
    expect(tall).toBeDefined();
    expect(low).toBeDefined();

    // Each half is 5×5in (half of the 10×5 footprint), NOT snapped up to a full 6×4.
    expect(halfW(tall) * 2).toBeCloseTo(inchesToMm(5), 0);
    expect(halfH(tall) * 2).toBeCloseTo(inchesToMm(5), 0);
    // The halves tile the footprint: centres one half-length (5in) apart.
    const gap = Math.hypot(tall.pos.x - low.pos.x, tall.pos.y - low.pos.y);
    expect(gap).toBeCloseTo(inchesToMm(5), 0);
  });

  it("drops sub-minimum blobs (map icons) rather than snapping them up to terrain", () => {
    const img = canvas(400, 300, BATTLEMAT);
    fillRect(img, 180, 130, 220, 170, BLUE); // 40×40px ≈ 2.5 in² — an eye-badge-sized icon
    const res = analyzeTerrainLayout(img, { boardWidthMm: 400 });
    expect(res.pieces).toEqual([]);
  });

  it("detects the board as the dark border frame, ignoring margin outside it", () => {
    const CONCRETE: [number, number, number] = [165, 168, 166]; // outside the board
    const DARK: [number, number, number] = [28, 28, 30];
    const img = canvas(500, 400, CONCRETE);
    // Dark frame at [50..450, 40..360], battlemat inside, a piece within.
    fillRect(img, 50, 40, 450, 43, DARK); // top
    fillRect(img, 50, 357, 450, 360, DARK); // bottom
    fillRect(img, 50, 40, 53, 360, DARK); // left
    fillRect(img, 447, 40, 450, 360, DARK); // right
    fillRect(img, 53, 43, 447, 357, BATTLEMAT);
    fillRect(img, 200, 150, 300, 220, GREY);

    const res = analyzeTerrainLayout(img, { boardWidthMm: 400 });
    // Board hugs the frame interior, not the full 500×400 image (margin excluded).
    expect(res.boardPx.x).toBeGreaterThanOrEqual(50);
    expect(res.boardPx.x).toBeLessThan(60);
    expect(res.boardPx.width).toBeGreaterThan(380);
    expect(res.boardPx.width).toBeLessThan(400);
    expect(res.pieces.filter((p) => p.rect).length).toBe(1);
  });

  it("snapToCatalogSize picks the nearest footprint in the given edition roster", () => {
    const r11 = AREA_TERRAIN_FOOTPRINTS_MM["11e"];
    const r10 = AREA_TERRAIN_FOOTPRINTS_MM["10e"];
    const snap = (lIn: number, sIn: number, roster: typeof r11): { longMm: number; shortMm: number } =>
      snapToCatalogSize(inchesToMm(lIn), inchesToMm(sIn), roster);
    // 11th edition
    expect(snap(11, 6.8, r11)).toEqual({ longMm: inchesToMm(11.5), shortMm: inchesToMm(7) });
    expect(snap(10.2, 2.6, r11)).toEqual({ longMm: inchesToMm(10), shortMm: inchesToMm(2.5) });
    // 10th edition — the same measurements snap to that roster instead
    expect(snap(11.9, 5.9, r10)).toEqual({ longMm: inchesToMm(12), shortMm: inchesToMm(6) });
    expect(snap(9.6, 4.8, r10)).toEqual({ longMm: inchesToMm(10), shortMm: inchesToMm(5) });
    expect(snap(5.8, 3.8, r10)).toEqual({ longMm: inchesToMm(6), shortMm: inchesToMm(4) });
  });

  it("flags an L-shaped blob as not a clean rectangle (does not silently place it)", () => {
    const img = canvas(400, 300, BATTLEMAT);
    // An L: horizontal arm + vertical arm sharing a corner — one blob, ~50% fill.
    fillRect(img, 60, 60, 200, 110, GREY);
    fillRect(img, 60, 60, 110, 220, GREY);

    const res = analyzeTerrainLayout(img, { boardWidthMm: 400 });
    expect(res.pieces.length).toBe(1);
    expect(res.pieces[0]!.rect).toBe(false);
  });

  it("snapFacing rounds to the nearest step and folds into the rectangle range", () => {
    const deg = (d: number): number => (d * Math.PI) / 180;
    const back = (r: number): number => Math.round((r * 180) / Math.PI);
    // 15° step (the default) keeps intended rotations, not just straight/45.
    expect(back(snapFacing(deg(4), 15))).toBe(0);
    expect(back(snapFacing(deg(13), 15))).toBe(15);
    expect(back(snapFacing(deg(22), 15))).toBe(15);
    expect(back(snapFacing(deg(38), 15))).toBe(45);
    expect(back(snapFacing(deg(86), 15))).toBe(90);
    // −89° and 91° are both ≈ vertical → fold to +90° in the canonical range.
    expect(back(snapFacing(deg(-89), 15))).toBe(90);
    // step 0 disables snapping (raw angle preserved).
    expect(snapFacing(deg(37), 0)).toBeCloseTo(deg(37), 6);
  });

  it("overlapMTV returns null for separated boxes and a minimal push for overlapping ones", () => {
    const a = rectPiece(0, 0, 50, 50);
    const far = rectPiece(200, 0, 50, 50);
    expect(overlapMTV(poly(a), poly(far))).toBeNull();

    // b overlaps a by 20mm along x (centres 80 apart, half-widths 50+50=100).
    const b = rectPiece(80, 0, 50, 50);
    const mtv = overlapMTV(poly(b), poly(a))!;
    expect(mtv).not.toBeNull();
    expect(Math.hypot(mtv.x, mtv.y)).toBeCloseTo(20, 5); // penetration depth
    expect(mtv.x).toBeGreaterThan(0); // pushes b (right of a) further right
    expect(Math.abs(mtv.y)).toBeCloseTo(0, 5);
  });

  it("resolveOverlaps nudges overlapping pieces apart until they only touch", () => {
    const pieces = [rectPiece(0, 0, 50, 50), rectPiece(80, 0, 50, 50)];
    expect(convexIntersect(poly(pieces[0]!), poly(pieces[1]!))).toBe(true);

    const out = resolveOverlaps(pieces);
    // Symmetric split: each moved 10mm outward, gap closed to a touching seam.
    expect(out[0]!.pos.x).toBeCloseTo(-10, 3);
    expect(out[1]!.pos.x).toBeCloseTo(90, 3);
    expect(out[0]!.pos.y).toBeCloseTo(0, 3);
    // No longer penetrating (touching edges is allowed, interiors don't overlap).
    const gap = out[1]!.pos.x - out[0]!.pos.x - 100;
    expect(gap).toBeGreaterThanOrEqual(-1e-6);
  });

  it("resolveOverlaps leaves already-separated pieces untouched", () => {
    const pieces = [rectPiece(0, 0, 30, 30), rectPiece(200, 0, 30, 30)];
    const out = resolveOverlaps(pieces);
    expect(out[0]!.pos).toEqual({ x: 0, y: 0 });
    expect(out[1]!.pos).toEqual({ x: 200, y: 0 });
  });

  it("detectedTerrainToPiece maps tall→blocking/heavy and low→none/light", () => {
    const tall = detectedTerrainToPiece(
      { pos: { x: 0, y: 0 }, base: { kind: "rect", halfWidthMm: 10, halfHeightMm: 5 }, facing: 0, heightMm: HEIGHT_TALL_MM, rect: true },
      0,
    );
    const low = detectedTerrainToPiece(
      { pos: { x: 0, y: 0 }, base: { kind: "rect", halfWidthMm: 10, halfHeightMm: 5 }, facing: 0, heightMm: HEIGHT_LOW_MM, rect: true },
      1,
    );
    expect(tall.losBlocking).toBe("blocks");
    expect(tall.cover).toBe("heavy");
    expect(tall.pattern).toBe("hatch"); // grey hatch from heightColor
    expect(low.losBlocking).toBe("none");
    expect(low.cover).toBe("light");
    expect(low.pattern).toBe("dots"); // teal dots from heightColor
    expect(tall.id).not.toBe(low.id);
  });
});
