import { describe, it, expect } from "vitest";
import {
  analyzeTerrainLayout,
  detectedTerrainToPiece,
  snapFacing,
  snapToCatalogSize,
  overlapMTV,
  resolveOverlaps,
  type DetectedTerrain,
  type AnalyzeLayoutOptions,
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
const GREY: [number, number, number] = [105, 107, 110]; // tall ruins fill
const BLUE: [number, number, number] = [0, 93, 132]; // low terrain fill
const DARK: [number, number, number] = [25, 25, 27]; // piece outline ink

// Detection is outline-based (ADR-0012): pieces are drawn as a dark rectangle
// outline. A fixed brightness cutoff is passed so tests are deterministic
// (the default is an adaptive threshold tuned for real photos, not tiny canvases).
const OPT = (extra: Partial<AnalyzeLayoutOptions> & { boardWidthMm: number }): AnalyzeLayoutOptions => ({
  outlineBrightnessMax: 90,
  ...extra,
});

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

/** A filled rect ringed by a dark outline, as real GW layout pieces are drawn. */
function outlinedRect(img: PixelBuffer, x0: number, y0: number, x1: number, y1: number, ol: number, c: [number, number, number]): void {
  fillRect(img, x0, y0, x1, y1, DARK);
  fillRect(img, x0 + ol, y0 + ol, x1 - ol, y1 - ol, c);
}

/** A dark rectangle outline drawn open on one side (only 3 of 4 edges). */
function threeSidedRect(img: PixelBuffer, x0: number, y0: number, x1: number, y1: number, ol: number): void {
  fillRect(img, x0, y0, x1, y0 + ol, DARK); // top
  fillRect(img, x0, y0, x0 + ol, y1, DARK); // left
  fillRect(img, x1 - ol, y0, x1, y1, DARK); // right
  // bottom omitted → 3-sided
}

describe("analyzeTerrainLayout", () => {
  it("detects a tall grey and a low blue outlined footprint and snaps each to a catalog size", () => {
    // Full-canvas battlemat → board = full image → mmPerPx = 1, so mm ≈ px.
    const img = canvas(700, 500, BATTLEMAT);
    // grey ≈ 6×4in (Medium), blue ≈ 11.5×7in (Large) — drawn a couple px off exact.
    outlinedRect(img, 124, 99, 124 + 151, 99 + 103, 3, GREY); // centre ≈ (199.5, 150.5)
    outlinedRect(img, 323, 236, 323 + 291, 236 + 177, 3, BLUE); // centre ≈ (468.5, 324.5)

    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 700, edition: "11e" }));
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

  it("decomposes a split outline (one rect, half grey / half blue) into two correctly-sized adjacent pieces", () => {
    const img = canvas(400, 350, BATTLEMAT);
    // ONE 10×5in outline (254×127px @ mmPerPx=1), filled grey on the left half,
    // blue on the right half — the internal colour boundary has no dark line.
    const x0 = 70;
    const y0 = 100;
    const x1 = x0 + 254;
    const y1 = y0 + 127;
    const ol = 3;
    fillRect(img, x0, y0, x1, y1, DARK);
    const mid = (x0 + x1) >> 1;
    fillRect(img, x0 + ol, y0 + ol, mid, y1 - ol, GREY);
    fillRect(img, mid, y0 + ol, x1 - ol, y1 - ol, BLUE);

    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 400, edition: "10e", mergeSplits: true }));
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

  it("reads a split outline as ONE piece when mergeSplits is off (the default)", () => {
    // Same split image as above, but without opting into decomposition: one clean
    // box, classified by dominant height — the editor splits it if needed (ADR-0012).
    const img = canvas(400, 350, BATTLEMAT);
    const x0 = 70, y0 = 100, x1 = x0 + 254, y1 = y0 + 127, ol = 3;
    fillRect(img, x0, y0, x1, y1, DARK);
    const mid = (x0 + x1) >> 1;
    fillRect(img, x0 + ol, y0 + ol, mid, y1 - ol, GREY);
    fillRect(img, mid, y0 + ol, x1 - ol, y1 - ol, BLUE);

    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 400, edition: "10e" })); // mergeSplits defaults off
    expect(res.pieces.filter((p) => p.rect).length).toBe(1);
  });

  it("keeps two footprints separated by a battlemat seam as two pieces", () => {
    // boardWidthMm = canvas width → mmPerPx = 1, and pieces stay a small fraction
    // of the canvas so a piece outline isn't mistaken for the board frame.
    const img = canvas(1400, 900, BATTLEMAT);
    const pw = Math.round(inchesToMm(6)); // 152px
    const ph = Math.round(inchesToMm(4)); // 102px
    const seam = 10; // 10mm of battlemat between them
    outlinedRect(img, 100, 300, 100 + pw, 300 + ph, 4, GREY);
    outlinedRect(img, 100 + pw + seam, 300, 100 + 2 * pw + seam, 300 + ph, 4, GREY);

    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 1400, edition: "10e" }));
    const clean = res.pieces.filter((p) => p.rect);
    expect(clean.length).toBe(2);
    for (const p of clean) {
      expect(halfW(p) * 2).toBeCloseTo(inchesToMm(6), 0);
      expect(halfH(p) * 2).toBeCloseTo(inchesToMm(4), 0);
    }
  });

  it("reads a single outline with an internal ruins wall as one clean rectangle", () => {
    // A 12×6 grey outline with an enclosed internal L-wall (not touching the outer
    // outline) must read as ONE 12×6 — the wall lives inside and never spawns a piece.
    const img = canvas(1400, 900, BATTLEMAT);
    const lw = Math.round(inchesToMm(12)); // 305px @ mmPerPx = 1
    const lh = Math.round(inchesToMm(6)); // 152px
    outlinedRect(img, 100, 300, 100 + lw, 300 + lh, 4, GREY);
    const t = 6;
    fillRect(img, 100 + Math.round(lw * 0.4), 300 + Math.round(lh * 0.2), 100 + Math.round(lw * 0.4) + t, 300 + Math.round(lh * 0.8), DARK);
    fillRect(img, 100 + Math.round(lw * 0.4), 300 + Math.round(lh * 0.8), 100 + Math.round(lw * 0.7), 300 + Math.round(lh * 0.8) + t, DARK);

    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 1400, edition: "10e" }));
    const clean = res.pieces.filter((p) => p.rect);
    expect(clean.length).toBe(1);
    expect(halfW(clean[0]!) * 2).toBeCloseTo(inchesToMm(12), 0);
    expect(halfH(clean[0]!) * 2).toBeCloseTo(inchesToMm(6), 0);
  });

  it("does not detect a bare fill that has no dark outline (outline-based, ADR-0012)", () => {
    // A tinted deployment zone or a stray fill with no piece outline must not
    // spawn a phantom footprint — detection keys on the dark outline, not the fill.
    const img = canvas(700, 500, BATTLEMAT);
    outlinedRect(img, 100, 100, 100 + 152, 100 + 102, 3, GREY); // a real, outlined piece
    fillRect(img, 420, 100, 420 + 152, 100 + 102, GREY); // bare grey fill, no outline

    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 700, edition: "10e" }));
    expect(res.pieces.length).toBe(1);
    expect(res.pieces[0]!.heightMm).toBe(HEIGHT_TALL_MM);
    expect(res.pieces[0]!.pos.x).toBeLessThan(300); // the outlined (left) one survives
  });

  it("accepts a 3-sided (partial) outline and flags it for review", () => {
    const img = canvas(700, 500, BATTLEMAT);
    // A 6×4in outline missing its bottom edge — a rectangle is over-determined, so
    // 3 sides still infer the full box (flagged, not clean).
    threeSidedRect(img, 150, 150, 150 + 152, 150 + 102, 3);
    fillRect(img, 153, 153, 150 + 149, 150 + 99, GREY);

    // rectCoverage pinned high so a 3-sided outline (~75%) exercises the flagged
    // path regardless of the default clean-vs-flagged bar.
    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 700, edition: "10e", rectCoverage: 0.9 }));
    expect(res.pieces.length).toBe(1);
    expect(res.pieces[0]!.rect).toBe(false); // partial coverage → flagged
    // Extent-midpoint centring keeps the box on the piece despite the open side.
    expect(res.pieces[0]!.pos.x).toBeCloseTo(226, -1.2);
    expect(res.pieces[0]!.pos.y).toBeCloseTo(201, -1.2);
  });

  it("removes a circular objective marker so it does not spawn a phantom piece", () => {
    const img = canvas(700, 500, BATTLEMAT);
    outlinedRect(img, 100, 120, 100 + 152, 120 + 102, 3, GREY);
    // A solid dark objective disc (~1.5in ⌀) elsewhere on the mat.
    const cx = 480;
    const cy = 250;
    const r = Math.round(inchesToMm(0.75)); // mmPerPx=1
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) fillRect(img, x, y, x + 1, y + 1, DARK);

    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 700, edition: "10e" }));
    expect(res.pieces.length).toBe(1); // only the outlined piece; the disc is gone
    expect(res.pieces[0]!.rect).toBe(true);
  });

  it("drops sub-minimum / wrong-sized blobs (map icons) rather than detecting them", () => {
    const img = canvas(400, 300, BATTLEMAT);
    outlinedRect(img, 170, 130, 170 + 40, 130 + 40, 2, BLUE); // 40×40px ≈ 2.5in — too small
    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 400 }));
    expect(res.pieces).toEqual([]);
  });

  it("detects the board as the dark border frame and a piece within it, ignoring margin", () => {
    const CONCRETE: [number, number, number] = [165, 168, 166]; // outside the board
    const FRAME: [number, number, number] = [28, 28, 30];
    const img = canvas(500, 400, CONCRETE);
    fillRect(img, 50, 40, 450, 43, FRAME); // top
    fillRect(img, 50, 357, 450, 360, FRAME); // bottom
    fillRect(img, 50, 40, 53, 360, FRAME); // left
    fillRect(img, 447, 40, 450, 360, FRAME); // right
    fillRect(img, 53, 43, 447, 357, BATTLEMAT);
    outlinedRect(img, 200, 150, 355, 253, 3, GREY); // a ~6×4 piece inside

    const res = analyzeTerrainLayout(img, OPT({ boardWidthMm: 400, edition: "10e" }));
    // Board bbox hugs the frame (±1px from the dilation used to connect it),
    // not the full 500×400 image (concrete margin excluded).
    expect(res.boardPx.x).toBeGreaterThanOrEqual(48);
    expect(res.boardPx.x).toBeLessThan(60);
    expect(res.boardPx.width).toBeGreaterThan(380);
    expect(res.boardPx.width).toBeLessThanOrEqual(404);
    expect(res.pieces.filter((p) => p.rect).length).toBe(1);
  });

  it("snapToCatalogSize picks the nearest footprint in the given edition roster", () => {
    const r11 = AREA_TERRAIN_FOOTPRINTS_MM["11e"];
    const r10 = AREA_TERRAIN_FOOTPRINTS_MM["10e"];
    const snap = (lIn: number, sIn: number, roster: typeof r11): { longMm: number; shortMm: number } =>
      snapToCatalogSize(inchesToMm(lIn), inchesToMm(sIn), roster);
    expect(snap(11, 6.8, r11)).toEqual({ longMm: inchesToMm(11.5), shortMm: inchesToMm(7) });
    expect(snap(10.2, 2.6, r11)).toEqual({ longMm: inchesToMm(10), shortMm: inchesToMm(2.5) });
    expect(snap(11.9, 5.9, r10)).toEqual({ longMm: inchesToMm(12), shortMm: inchesToMm(6) });
    expect(snap(9.6, 4.8, r10)).toEqual({ longMm: inchesToMm(10), shortMm: inchesToMm(5) });
    expect(snap(5.8, 3.8, r10)).toEqual({ longMm: inchesToMm(6), shortMm: inchesToMm(4) });
  });

  it("snapFacing rounds to the nearest step and folds into the rectangle range", () => {
    const deg = (d: number): number => (d * Math.PI) / 180;
    const back = (r: number): number => Math.round((r * 180) / Math.PI);
    expect(back(snapFacing(deg(4), 15))).toBe(0);
    expect(back(snapFacing(deg(13), 15))).toBe(15);
    expect(back(snapFacing(deg(22), 15))).toBe(15);
    expect(back(snapFacing(deg(38), 15))).toBe(45);
    expect(back(snapFacing(deg(86), 15))).toBe(90);
    expect(back(snapFacing(deg(-89), 15))).toBe(90);
    expect(snapFacing(deg(37), 0)).toBeCloseTo(deg(37), 6);
  });

  it("overlapMTV returns null for separated boxes and a minimal push for overlapping ones", () => {
    const a = rectPiece(0, 0, 50, 50);
    const far = rectPiece(200, 0, 50, 50);
    expect(overlapMTV(poly(a), poly(far))).toBeNull();

    const b = rectPiece(80, 0, 50, 50);
    const mtv = overlapMTV(poly(b), poly(a))!;
    expect(mtv).not.toBeNull();
    expect(Math.hypot(mtv.x, mtv.y)).toBeCloseTo(20, 5);
    expect(mtv.x).toBeGreaterThan(0);
    expect(Math.abs(mtv.y)).toBeCloseTo(0, 5);
  });

  it("resolveOverlaps nudges overlapping pieces apart until they only touch", () => {
    const pieces = [rectPiece(0, 0, 50, 50), rectPiece(80, 0, 50, 50)];
    expect(convexIntersect(poly(pieces[0]!), poly(pieces[1]!))).toBe(true);

    const out = resolveOverlaps(pieces);
    expect(out[0]!.pos.x).toBeCloseTo(-10, 3);
    expect(out[1]!.pos.x).toBeCloseTo(90, 3);
    expect(out[0]!.pos.y).toBeCloseTo(0, 3);
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
    expect(tall.pattern).toBe("hatch");
    expect(low.losBlocking).toBe("none");
    expect(low.cover).toBe("light");
    expect(low.pattern).toBe("dots");
    expect(tall.id).not.toBe(low.id);
  });
});
