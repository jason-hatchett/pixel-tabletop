import { describe, it, expect } from "vitest";
import { hasLineOfSight, whollyWithin, type Sighted } from "./los.js";
import { basePolygon, type BaseShape } from "./geometry.js";
import type { TerrainPiece } from "./terrain.js";
import type { Wall } from "./walls.js";

const unit = (x: number, y: number, r = 10): Sighted => ({
  pos: { x, y },
  base: { kind: "circle", radiusMm: r },
  facing: 0,
});

const ruin = (
  id: string,
  x: number,
  y: number,
  halfW = 30,
  halfH = 60,
  losBlocking: "blocks" | "none" = "blocks",
): TerrainPiece => ({
  id,
  label: id,
  pos: { x, y },
  base: { kind: "rect", halfWidthMm: halfW, halfHeightMm: halfH },
  facing: 0,
  losBlocking,
  cover: "heavy",
  difficult: true,
  surface: null,
  heightMm: 0,
  pattern: "hatch",
  fill: 0,
  border: 0,
});

describe("hasLineOfSight — Warhammer terrain rules", () => {
  it("has LoS across open ground", () => {
    expect(hasLineOfSight(unit(0, 0), unit(200, 0), [], [])).toBe(true);
  });

  it("is blocked by a ruin standing between the two units", () => {
    expect(hasLineOfSight(unit(0, 0), unit(200, 0), [ruin("r", 100, 0)], [])).toBe(false);
  });

  it("is NOT blocked by non-LoS terrain (a crater) in the way", () => {
    const crater = ruin("c", 100, 0, 40, 40, "none");
    expect(hasLineOfSight(unit(0, 0), unit(200, 0), [crater], [])).toBe(true);
  });

  it("seeing out: a unit wholly within a ruin sees out of it normally", () => {
    const r = ruin("r", 100, 0);
    const observer = unit(100, 0); // wholly inside r
    expect(whollyWithin(basePolygon(observer.pos, observer.base, observer.facing), r)).toBe(true);
    expect(hasLineOfSight(observer, unit(300, 0), [r], [])).toBe(true);
  });

  it("seeing in: a unit can see a target that is inside a ruin", () => {
    const r = ruin("r", 100, 0);
    const target = unit(100, 0); // inside r
    expect(hasLineOfSight(unit(-100, 0), target, [r], [])).toBe(true);
  });

  it("a second ruin between the observer and the target's ruin still blocks", () => {
    const targetRuin = ruin("A", 300, 0);
    const blockingRuin = ruin("B", 150, 0);
    const target = unit(300, 0); // inside ruin A
    // Ruin A doesn't block (target is inside it), but ruin B in the way does.
    expect(hasLineOfSight(unit(0, 0), target, [targetRuin, blockingRuin], [])).toBe(false);
  });

  it("a real LoS-blocking wall between the units blocks sight", () => {
    const wall: Wall = { id: "w", a: { x: 100, y: -80 }, b: { x: 100, y: 80 }, blocksLoS: true, blocksMove: true };
    expect(hasLineOfSight(unit(0, 0), unit(200, 0), [], [wall])).toBe(false);
  });

  it("a wide oval can see past a narrow ruin its center can't", () => {
    // Broadside oval reaching well past a thin ruin: some point of the base has
    // a clear line even though the center-to-center line is blocked.
    const oval: Sighted = { pos: { x: 0, y: 0 }, base: { kind: "oval", radiusXMm: 20, radiusYMm: 120 }, facing: 0 };
    const target = unit(200, 0);
    const thinRuin: BaseShape = { kind: "rect", halfWidthMm: 5, halfHeightMm: 30 };
    const r: TerrainPiece = { ...ruin("r", 100, 0), base: thinRuin };
    expect(hasLineOfSight(oval, target, [r], [])).toBe(true);
  });
});
