import { describe, it, expect } from "vitest";
import {
  lineOfSightBlocked,
  blockedCornerCount,
  shadowQuad,
  umbraQuad,
  umbraOfOccluder,
  type Wall,
} from "./walls.js";
import { convexIntersect, basePolygon, type Vec2 } from "./geometry.js";
import { resolveTemplate, type Placed } from "./templates.js";
import { warhammer } from "./rules/warhammer.js";
import { makeDnd5e } from "./rules/dnd5e.js";
import type { MeasureTarget } from "./rules/types.js";
import type { BaseShape } from "./geometry.js";

const wall = (ax: number, ay: number, bx: number, by: number): Wall => ({
  id: `${ax},${ay},${bx},${by}`,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  blocksLoS: true,
  blocksMove: true,
});

describe("walls / line of sight", () => {
  it("blocks a sightline the wall crosses", () => {
    expect(lineOfSightBlocked({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall(50, -50, 50, 50)])).toBe(true);
  });
  it("does not block a sightline the wall misses", () => {
    expect(lineOfSightBlocked({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall(50, 20, 50, 60)])).toBe(false);
  });
  it("ignores walls flagged as not blocking LoS", () => {
    const w: Wall = { ...wall(50, -50, 50, 50), blocksLoS: false };
    expect(lineOfSightBlocked({ x: 0, y: 0 }, { x: 100, y: 0 }, [w])).toBe(false);
  });

  it("projects a wall's shadow away from the origin", () => {
    const quad = shadowQuad({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, 1000);
    // starts at the wall endpoints...
    expect(quad[0]).toEqual({ x: 10, y: 0 });
    expect(quad[3]).toEqual({ x: 10, y: 10 });
    // ...and extends the first endpoint straight out along +x to `far`.
    expect(quad[1]!.x).toBeCloseTo(1000, 3);
    expect(quad[1]!.y).toBeCloseTo(0, 3);
  });
});

describe("umbraQuad (area-source shadow — used for a unit's line of sight)", () => {
  // Wall AB is vertical at x=10, from A=(10,5) [top] to B=(10,-5) [bottom].
  const A = { x: 10, y: 5 };
  const B = { x: 10, y: -5 };

  it("matches the point-source shadow when the source collapses to one point", () => {
    const point = [{ x: 0, y: 0 }];
    const umbra = umbraQuad(point, A, B, 100);
    const point_ = shadowQuad({ x: 0, y: 0 }, A, B, 100);
    expect(umbra).toEqual(point_);
  });

  it("is narrower than the shadow cast from the source's center (a wide base sees around the wall)", () => {
    // A two-point "source" straddling the wall's center line, standing in for a
    // token base with real width.
    const source = [
      { x: 0, y: 2 },
      { x: 0, y: -2 },
    ];
    const umbra = umbraQuad(source, A, B, 1000);
    const pointShadow = shadowQuad({ x: 0, y: 0 }, A, B, 1000);
    const inPoly = (poly: { x: number; y: number }[], p: { x: number; y: number }) =>
      convexIntersect(poly, [p, p, p, p]);

    // Hand-derived (see PR discussion): at x=50 the true umbra spans y in
    // [-17, 17], while the point-source shadow (cast from the source's
    // centroid) spans y in [-25, 25]. So y=20 is a point the wide source can
    // see around the wall to reach, even though a point light at the centroid
    // would call it shadowed.
    expect(inPoly(pointShadow, { x: 50, y: 20 })).toBe(true);
    expect(inPoly(umbra, { x: 50, y: 20 })).toBe(false);

    // Deep behind the wall, on the centerline: genuinely hidden from the whole
    // source, so both the umbra and the point-source shadow contain it.
    expect(inPoly(umbra, { x: 50, y: 0 })).toBe(true);
    expect(inPoly(pointShadow, { x: 50, y: 0 })).toBe(true);
  });

  it("regression: never shadows a point some part of the source can actually see", () => {
    // Exact real-world configuration that broke the old tangent-picking
    // heuristic: a large rotated oval (the "Ogre" base) below a rectangular
    // terrain block, checked against a point up and to the left. Ground truth,
    // established independently via lineOfSightBlocked sampled across the
    // source's own polygon: several of the oval's own vertices have a clear
    // line to the point, so the point must NOT be in the umbra (umbra means
    // hidden from the WHOLE source, not just its center).
    const oval = { pos: { x: 406.4, y: 558.8 }, base: { kind: "oval" as const, radiusXMm: 52.5, radiusYMm: 35 }, facing: 0.6 };
    const source = basePolygon(oval.pos, oval.base, oval.facing);
    // The forest rect's left edge — the specific edge that produced the bug.
    const edgeA = { x: 349.9, y: 267.2 };
    const edgeB = { x: 349.9, y: 495.8 };
    const point = { x: 254, y: 203.2 };

    const inPoly = (poly: { x: number; y: number }[], p: { x: number; y: number }) =>
      convexIntersect(poly, [p, p, p, p]);

    // Ground truth via the same primitive lineOfSightBlocked uses: is `point`
    // visible from EVERY vertex of the source (i.e. genuinely NOT in umbra)?
    const wallSeg: Wall = { id: "w", a: edgeA, b: edgeB, blocksLoS: true, blocksMove: false };
    const clearFromSomeVertex = source.some((v) => !lineOfSightBlocked(v, point, [wallSeg]));
    expect(clearFromSomeVertex).toBe(true); // sanity: confirms this is a real test of the "narrow" case

    const umbra = umbraQuad(source, edgeA, edgeB, 100000);
    expect(inPoly(umbra, point)).toBe(false);
  });
});

describe("umbraOfOccluder (a whole terrain block, not per-edge)", () => {
  // A wide oval unit source below a rectangular block. Ground truth for whether
  // a point is in the umbra: is it hidden from EVERY vertex of the source, i.e.
  // does the segment from each source vertex to the point cross the block?
  const source = basePolygon({ x: 0, y: 0 }, { kind: "oval", radiusXMm: 60, radiusYMm: 35 }, 0);
  const occluder = basePolygon({ x: 0, y: -160 }, { kind: "rect", halfWidthMm: 40, halfHeightMm: 40 }, 0);
  const edges: Wall[] = occluder.map((a, i) => ({
    id: `e${i}`,
    a,
    b: occluder[(i + 1) % occluder.length]!,
    blocksLoS: true,
    blocksMove: false,
  }));
  const hiddenFromAll = (p: Vec2): boolean => source.every((v) => lineOfSightBlocked(v, p, edges));
  const inUmbra = (p: Vec2): boolean => convexIntersect(umbraOfOccluder(source, occluder), [p, p, p, p]);
  const inBlock = (p: Vec2): boolean => p.x >= -41 && p.x <= 41 && p.y >= -201 && p.y <= -119;

  it("shadows the gap directly behind the block that per-edge umbrae used to miss", () => {
    // Points on the centerline right behind the block are hidden from the whole
    // oval — but from the oval's LEFT vertices the sightline is cut by the
    // block's RIGHT edge and vice-versa, so no single edge's umbra covered them.
    for (const p of [
      { x: 0, y: -400 },
      { x: -15, y: -400 },
      { x: 15, y: -400 },
    ]) {
      expect(hiddenFromAll(p)).toBe(true); // ground-truth sanity
      expect(inUmbra(p)).toBe(true); // fixed: now correctly shadowed
    }
  });

  it("matches ground truth across a grid of points outside the block", () => {
    let mismatches = 0;
    for (let x = -160; x <= 160; x += 8) {
      for (let y = -560; y <= -130; y += 8) {
        const p = { x, y };
        if (inBlock(p)) continue; // chord approximation intentionally ignores the block's own interior
        // Skip the razor-thin umbra boundary where >= vs epsilon can disagree.
        if (hiddenFromAll(p) !== inUmbra(p)) {
          // Re-test nudged inward/outward; a true mismatch persists, a boundary
          // artifact flips. Count only persistent ones.
          const persists =
            hiddenFromAll({ x: x + 2, y }) !== inUmbra({ x: x + 2, y }) &&
            hiddenFromAll({ x: x - 2, y }) !== inUmbra({ x: x - 2, y });
          if (persists) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it("leaves a point genuinely visible to part of the source unshadowed", () => {
    // Far up and to the side: the sightline clears the block for the whole
    // source, so it must not be in the umbra.
    const p = { x: 300, y: -300 };
    expect(hiddenFromAll(p)).toBe(false);
    expect(inUmbra(p)).toBe(false);
  });
});

describe("templates resolve against walls", () => {
  const tokens: Placed[] = [
    { id: "A", pos: { x: 20, y: 0 }, base: { kind: "circle", radiusMm: 10 }, facing: 0 },
    { id: "B", pos: { x: 300, y: 0 }, base: { kind: "circle", radiusMm: 10 }, facing: 0 },
  ];
  const blast = { kind: "circle" as const, center: { x: 0, y: 0 }, radiusMm: 50 };

  it("hits bases inside the area and ignores those outside", () => {
    const r = resolveTemplate(blast, tokens, []);
    expect(r.hit).toEqual(["A"]);
    expect(r.covered).toEqual([]);
  });

  it("moves a shielded base into 'covered' when a wall blocks the origin", () => {
    const r = resolveTemplate(blast, tokens, [wall(10, -40, 10, 40)]);
    expect(r.hit).toEqual([]);
    expect(r.covered).toEqual(["A"]);
  });

  it("includes a target within a cone's angle", () => {
    const cone = {
      kind: "cone" as const,
      apex: { x: 0, y: 0 },
      dirRad: 0,
      lengthMm: 100,
      halfAngleRad: Math.atan(0.5),
    };
    const onAxis: Placed[] = [{ id: "C", pos: { x: 50, y: 0 }, base: { kind: "circle", radiusMm: 5 }, facing: 0 }];
    expect(resolveTemplate(cone, onAxis, []).hit).toEqual(["C"]);
  });
});

describe("cover rules", () => {
  const attacker: MeasureTarget = { pos: { x: 0, y: 0 }, base: { kind: "circle", radiusMm: 0 }, facing: 0 };
  const rectTarget: BaseShape = { kind: "rect", halfWidthMm: 10, halfHeightMm: 10 };
  const target: MeasureTarget = { pos: { x: 100, y: 0 }, base: rectTarget, facing: 0 };
  const dnd = makeDnd5e();

  it("reports no cover with no walls", () => {
    expect(dnd.cover(attacker, target, []).level).toBe("none");
    expect(warhammer.cover(attacker, target, []).level).toBe("none");
  });

  it("half cover when two corners are blocked", () => {
    const walls = [wall(105, -100, 105, 100)]; // hides the two far (x=110) corners
    expect(blockedCornerCount(attacker.pos, target.pos, rectTarget, 0, walls)).toBe(2);
    expect(dnd.cover(attacker, target, walls).level).toBe("half");
    expect(warhammer.cover(attacker, target, walls).text).toBe("Benefit of cover");
  });

  it("three-quarters cover (5E) when three corners are blocked", () => {
    const walls = [wall(40, 5, 200, 5), wall(40, -5, 50, -5)]; // both top + one bottom
    expect(blockedCornerCount(attacker.pos, target.pos, rectTarget, 0, walls)).toBe(3);
    expect(dnd.cover(attacker, target, walls).level).toBe("three-quarters");
  });

  it("total cover when a wall fully blocks the target", () => {
    const walls = [wall(50, -100, 50, 100)];
    expect(dnd.cover(attacker, target, walls).level).toBe("total");
    expect(warhammer.cover(attacker, target, walls).level).toBe("total");
  });
});
