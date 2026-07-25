import { describe, it, expect } from "vitest";
import {
  WARHAMMER_BASES,
  DND_BASES,
  getBaseOptions,
  findBaseOption,
} from "./bases.js";
import { DEFAULT_CELL_MM } from "./units.js";

describe("getBaseOptions", () => {
  it("returns the D&D catalog for dnd5e", () => {
    expect(getBaseOptions("dnd5e")).toBe(DND_BASES);
  });

  it("defaults to the Warhammer catalog for warhammer and any other system", () => {
    expect(getBaseOptions("warhammer")).toBe(WARHAMMER_BASES);
    // Unknown systems fall back to Warhammer rather than throwing.
    expect(getBaseOptions("aos")).toBe(WARHAMMER_BASES);
  });
});

describe("findBaseOption", () => {
  it("finds a Warhammer round base and exposes its radius as half the diameter", () => {
    const r32 = findBaseOption("warhammer", "r32");
    expect(r32?.shape).toEqual({ kind: "circle", radiusMm: 16 });
  });

  it("finds a Warhammer oval base with half-extent radii", () => {
    const oval = findBaseOption("warhammer", "o60x35");
    expect(oval?.shape).toEqual({ kind: "oval", radiusXMm: 30, radiusYMm: 17.5 });
  });

  it("returns undefined for an id absent from the selected system", () => {
    // "medium" only exists in the D&D catalog, not Warhammer.
    expect(findBaseOption("warhammer", "medium")).toBeUndefined();
    expect(findBaseOption("dnd5e", "nope")).toBeUndefined();
  });
});

describe("DND_BASES footprints", () => {
  it("sizes a token diameter to span its cell footprint", () => {
    const medium = findBaseOption("dnd5e", "medium");
    // Small/Medium occupy one 5-ft square => radius is half a cell.
    expect(medium?.shape).toEqual({ kind: "circle", radiusMm: DEFAULT_CELL_MM / 2 });

    const tiny = findBaseOption("dnd5e", "tiny");
    // Tiny is 2.5 ft => a quarter square => half the Medium radius.
    expect(tiny?.shape).toEqual({ kind: "circle", radiusMm: DEFAULT_CELL_MM / 4 });

    const gargantuan = findBaseOption("dnd5e", "gargantuan");
    expect(gargantuan?.shape).toEqual({ kind: "circle", radiusMm: 2 * DEFAULT_CELL_MM });
  });
});
