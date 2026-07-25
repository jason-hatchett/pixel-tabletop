import { describe, it, expect } from "vitest";
import { warhammer } from "./warhammer.js";
import { makeDnd5e } from "./dnd5e.js";
import { inchesToMm, mmToInches } from "../units.js";
import type { BaseShape } from "../geometry.js";

const target = (x: number, y: number, base: BaseShape, facing = 0) => ({
  pos: { x, y },
  base,
  facing,
});
const pt = (x: number, y: number) => target(x, y, { kind: "circle", radiusMm: 0 });

describe("warhammer measurement (edge-to-edge inches)", () => {
  it("measures center distance minus radii for round bases", () => {
    const a = target(0, 0, { kind: "circle", radiusMm: 16 });
    const b = target(inchesToMm(6) + 32, 0, { kind: "circle", radiusMm: 16 });
    // centers are 6" + 32mm apart, minus two 16mm radii => exactly 6".
    expect(warhammer.measure(a, b).text).toBe('6.0"');
  });

  it("clamps overlapping bases to 0", () => {
    const a = target(0, 0, { kind: "circle", radiusMm: 20 });
    const b = target(10, 0, { kind: "circle", radiusMm: 20 });
    expect(warhammer.measure(a, b).mm).toBe(0);
  });

  it("uses the oval's long axis when measuring horizontally", () => {
    // Oval 105x70 (radii 52.5 x 35) vs a point 100mm to the right of center.
    const oval = target(0, 0, { kind: "oval", radiusXMm: 52.5, radiusYMm: 35 });
    const gapX = warhammer.measure(oval, pt(100, 0)).mm;
    const gapY = warhammer.measure(oval, pt(0, 100)).mm;
    // Along the long (x) axis the base reaches ~52.5mm => smaller gap than the
    // short (y) axis where it only reaches ~35mm. This is the whole point of
    // modelling the oval instead of a bounding circle.
    expect(gapX).toBeLessThan(gapY);
    expect(gapX).toBeCloseTo(100 - 52.5, 0);
    expect(gapY).toBeCloseTo(100 - 35, 0);
  });

  it("respects facing: rotating the oval 90° swaps its reach", () => {
    const flat = target(0, 0, { kind: "oval", radiusXMm: 52.5, radiusYMm: 35 }, 0);
    const turned = target(0, 0, { kind: "oval", radiusXMm: 52.5, radiusYMm: 35 }, Math.PI / 2);
    const flatX = warhammer.measure(flat, pt(100, 0)).mm;
    const turnedX = warhammer.measure(turned, pt(100, 0)).mm;
    // Turned 90°, the short axis now faces +x => a larger horizontal gap.
    expect(turnedX).toBeGreaterThan(flatX);
    expect(turnedX).toBeCloseTo(100 - 35, 0);
  });

  it("handles rectangular bases edge-to-edge", () => {
    const rect = target(0, 0, { kind: "rect", halfWidthMm: 40, halfHeightMm: 20 });
    const gap = warhammer.measure(rect, pt(100, 0)).mm;
    expect(mmToInches(gap)).toBeCloseTo(mmToInches(60), 3); // 100 - 40
  });
});

describe("dnd5e measurement (square counting)", () => {
  const dnd = makeDnd5e(50, "5-5-5");
  it("counts straight-line squares as 5 ft each", () => {
    expect(dnd.measure(pt(0, 0), pt(150, 0)).text).toBe("15 ft");
  });
  it("counts a pure diagonal as 5 ft per step under 5-5-5", () => {
    expect(dnd.measure(pt(0, 0), pt(150, 150)).text).toBe("15 ft");
  });
  it("charges the DMG variant 10 ft on the second diagonal", () => {
    const variant = makeDnd5e(50, "5-10-5");
    expect(variant.measure(pt(0, 0), pt(100, 100)).text).toBe("15 ft");
  });
});

describe("dnd5e size-aware snapping", () => {
  const dnd = makeDnd5e(50);
  const medium: BaseShape = { kind: "circle", radiusMm: 25 }; // 1x1 => odd
  const large: BaseShape = { kind: "circle", radiusMm: 50 }; // 2x2 => even

  it("snaps a 1x1 (odd) footprint to a cell center", () => {
    expect(dnd.snap({ x: 12, y: 12 }, medium)).toEqual({ x: 25, y: 25 });
  });

  it("snaps a 2x2 (even) footprint to a grid vertex", () => {
    expect(dnd.snap({ x: 130, y: 130 }, large)).toEqual({ x: 150, y: 150 });
  });

  it("gives Tiny a smaller footprint than Medium and lets four share a square", () => {
    const tiny: BaseShape = { kind: "circle", radiusMm: 12.5 }; // 2.5 ft, exactly ½ cell
    // A Tiny is not the same as a Medium.
    expect(tiny).not.toEqual(medium);
    // Within cell [0,50), Tiny snaps to quadrant centers (12.5 / 37.5), so two
    // Tinies at different corners of one square land on distinct slots.
    expect(dnd.snap({ x: 5, y: 5 }, tiny)).toEqual({ x: 12.5, y: 12.5 });
    expect(dnd.snap({ x: 40, y: 40 }, tiny)).toEqual({ x: 37.5, y: 37.5 });
  });

  it("snaps a non-grid base (e.g. a 32mm Warhammer round) to a cell center, not a quarter-slot", () => {
    const wh32: BaseShape = { kind: "circle", radiusMm: 16 }; // 32mm = 0.64 cell
    // Regression: 0.64-cell bases used to fall into the sub-cell tiling and land
    // on 12.5/37.5. They should round to a 1x1 footprint and center on the cell.
    expect(dnd.snap({ x: 12, y: 12 }, wh32)).toEqual({ x: 25, y: 25 });
    expect(dnd.snap({ x: 60, y: 90 }, wh32)).toEqual({ x: 75, y: 75 });
  });
});
