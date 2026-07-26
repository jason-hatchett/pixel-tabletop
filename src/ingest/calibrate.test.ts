import { describe, it, expect } from "vitest";
import { mmExtentFromSpan, alignEdgeToGrid } from "./calibrate.js";
import { inchesToMm } from "../domain/units.js";

describe("mmExtentFromSpan", () => {
  it("bakes a full-width span into a mm extent, preserving aspect ratio", () => {
    // A 1000x500 px map stated to be 44" wide across its full width.
    const { widthMm, heightMm } = mmExtentFromSpan(1000, 500, 1000, inchesToMm(44));
    expect(widthMm).toBeCloseTo(inchesToMm(44));
    expect(heightMm).toBeCloseTo(inchesToMm(22)); // half the width → half the mm
  });

  it("handles a partial span (e.g. six 1-inch grid squares across part of the image)", () => {
    // 600px image; a 300px stretch is known to be 6 inches → 50 px/inch.
    const { widthMm } = mmExtentFromSpan(600, 600, 300, inchesToMm(6));
    expect(widthMm).toBeCloseTo(inchesToMm(12)); // full 600px = 12"
  });

  it("rejects a non-positive span", () => {
    expect(() => mmExtentFromSpan(100, 100, 0, 50)).toThrow(/positive/);
    expect(() => mmExtentFromSpan(100, 100, 10, -1)).toThrow(/positive/);
  });
});

describe("alignEdgeToGrid", () => {
  const cell = 50; // mm

  it("shifts the edge so the gridline lands on a board gridline", () => {
    // Edge at 12mm, gridline 8mm into the image → gridline at 20mm; nearest board
    // gridline is 0 → edge moves to -8mm so the gridline sits at 0.
    expect(alignEdgeToGrid(12, 8, cell)).toBeCloseTo(-8);
  });

  it("is a no-op when the gridline is already aligned", () => {
    expect(alignEdgeToGrid(50, 0, cell)).toBeCloseTo(50);
    expect(alignEdgeToGrid(30, 20, cell)).toBeCloseTo(30); // gridline at 50
  });

  it("snaps to the nearest gridline, not always down", () => {
    // gridline at 45 → nearest is 50 → edge moves +5.
    expect(alignEdgeToGrid(40, 5, cell)).toBeCloseTo(45);
  });

  it("rejects a non-positive cell", () => {
    expect(() => alignEdgeToGrid(0, 0, 0)).toThrow(/positive/);
  });
});
