import { describe, it, expect } from "vitest";
import { mmExtentFromSpan } from "./calibrate.js";
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
