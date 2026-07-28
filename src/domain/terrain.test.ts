import { describe, it, expect } from "vitest";
import {
  getTerrainOptions,
  findTerrainOption,
  terrainVirtualWalls,
  terrainCoverAt,
  heightClass,
  heightColor,
  HEIGHT_LOW_MM,
  HEIGHT_TALL_MM,
  type TerrainPiece,
} from "./terrain.js";
import { lineOfSightBlocked } from "./walls.js";
import { inchesToMm } from "./units.js";
import type { BaseShape } from "./geometry.js";

const piece = (overrides: Partial<TerrainPiece> = {}): TerrainPiece => ({
  id: "p1",
  label: "Ruins",
  pos: { x: 0, y: 0 },
  base: { kind: "rect", halfWidthMm: 40, halfHeightMm: 60 },
  facing: 0,
  losBlocking: "blocks",
  cover: "heavy",
  difficult: true,
  surface: null,
  heightMm: 0,
  pattern: "hatch",
  fill: 0x8a8f9c,
  border: 0xd8dde3,
  ...overrides,
});

describe("terrain catalogs", () => {
  it("returns different, non-empty option sets per system", () => {
    const wh = getTerrainOptions("warhammer");
    const dnd = getTerrainOptions("dnd5e");
    expect(wh.length).toBeGreaterThan(0);
    expect(dnd.length).toBeGreaterThan(0);
    expect(wh.map((o) => o.id)).not.toEqual(dnd.map((o) => o.id));
  });

  it("has unique ids within each system's catalog", () => {
    for (const systemId of ["warhammer", "dnd5e"]) {
      const ids = getTerrainOptions(systemId).map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("includes the requested Warhammer kinds: Ruins, Craters, Rubble, dense/forest terrain", () => {
    const labels = getTerrainOptions("warhammer")
      .map((o) => o.label.toLowerCase())
      .join(" | ");
    expect(labels).toMatch(/ruins/);
    expect(labels).toMatch(/crater/);
    expect(labels).toMatch(/rubble/);
    expect(labels).toMatch(/forest|dense/);
  });

  it("tags D&D terrain with a descriptive surface (earth / stone / building)", () => {
    const dnd = getTerrainOptions("dnd5e");
    const surfaces = new Set(dnd.map((o) => o.surface).filter((s) => s !== null));
    expect(surfaces).toContain("earth");
    expect(surfaces).toContain("stone");
    expect(surfaces).toContain("building");
  });

  it("findTerrainOption resolves within the right system and rejects a foreign id", () => {
    const opt = getTerrainOptions("warhammer")[0]!;
    expect(findTerrainOption("warhammer", opt.id)).toEqual(opt);
    expect(findTerrainOption("dnd5e", opt.id)).toBeUndefined();
  });

  it("every option in every system carries a numeric heightMm", () => {
    for (const systemId of ["warhammer", "dnd5e"]) {
      for (const o of getTerrainOptions(systemId)) {
        expect(typeof o.heightMm).toBe("number");
        expect(o.heightMm).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("exposes both editions' area-terrain footprints (deduped), tall", () => {
    const wh = getTerrainOptions("warhammer");
    for (const [id, wIn, hIn] of [
      ["area-12x6", 12, 6], // 10th
      ["area-10x5", 10, 5], // 10th
      ["area-6x4", 6, 4], // shared
      ["area-11p5x8", 11.5, 8], // 11th
      ["area-11p5x7", 11.5, 7], // 11th
      ["area-10x2p5", 10, 2.5], // 11th
      ["area-6x2", 6, 2], // 11th
    ] as const) {
      const o = wh.find((x) => x.id === id);
      expect(o, id).toBeDefined();
      expect(o!.base).toEqual({ kind: "rect", halfWidthMm: inchesToMm(wIn) / 2, halfHeightMm: inchesToMm(hIn) / 2 });
      expect(heightClass(o!.heightMm)).toBe("tall");
    }
  });
});

describe("terrain height", () => {
  it("buckets heights into the GW ground/low/tall key", () => {
    expect(heightClass(0)).toBe("ground");
    expect(heightClass(-5)).toBe("ground");
    expect(heightClass(HEIGHT_LOW_MM)).toBe("low");
    expect(heightClass(inchesToMm(4))).toBe("low"); // "4\" or less" is not tall
    expect(heightClass(inchesToMm(4) + 0.1)).toBe("tall"); // strictly more than 4"
    expect(heightClass(HEIGHT_TALL_MM)).toBe("tall");
  });

  it("maps each height class to a distinct fill/pattern (grey hatch / teal dots / earth)", () => {
    const tall = heightColor(HEIGHT_TALL_MM);
    const low = heightColor(HEIGHT_LOW_MM);
    const ground = heightColor(0);
    expect(tall.pattern).toBe("hatch");
    expect(low.pattern).toBe("dots");
    expect(ground.pattern).toBe("solid");
    const fills = new Set([tall.fill, low.fill, ground.fill]);
    expect(fills.size).toBe(3);
  });

  it("area-terrain footprints are coloured to match their height class", () => {
    const o = findTerrainOption("warhammer", "area-12x6")!;
    expect({ fill: o.fill, border: o.border, pattern: o.pattern }).toEqual(heightColor(o.heightMm));
  });
});

describe("terrainVirtualWalls", () => {
  it("decomposes a blocking piece into edges that actually block a sightline through it", () => {
    const walls = terrainVirtualWalls([piece()]); // 40x60mm half-extents rect at origin
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every((w) => w.blocksLoS)).toBe(true);
    // A line straight through the rect's center should cross an edge.
    expect(lineOfSightBlocked({ x: -100, y: 0 }, { x: 100, y: 0 }, walls)).toBe(true);
  });

  it("carries the piece's difficult flag onto blocksMove", () => {
    const walls = terrainVirtualWalls([piece({ difficult: false })]);
    expect(walls.every((w) => w.blocksMove === false)).toBe(true);
  });

  it("contributes nothing for non-blocking terrain (craters, rubble)", () => {
    const walls = terrainVirtualWalls([piece({ losBlocking: "none" })]);
    expect(walls).toEqual([]);
  });

  it("a sightline that passes well outside the piece is unaffected", () => {
    const walls = terrainVirtualWalls([piece()]);
    expect(lineOfSightBlocked({ x: -100, y: 500 }, { x: 100, y: 500 }, walls)).toBe(false);
  });
});

describe("terrainCoverAt", () => {
  const rubble = piece({
    id: "rubble1",
    label: "Rubble",
    losBlocking: "none",
    cover: "light",
    pos: { x: 0, y: 0 },
    base: { kind: "rect", halfWidthMm: 30, halfHeightMm: 30 },
  });
  const zeroBase: BaseShape = { kind: "circle", radiusMm: 0 };

  it("grants cover to a model whose base overlaps the terrain footprint", () => {
    const result = terrainCoverAt({ x: 0, y: 0 }, zeroBase, 0, [rubble]);
    expect(result.level).toBe("light");
    expect(result.source).toBe("Rubble");
  });

  it("grants no cover to a model far from any terrain", () => {
    const result = terrainCoverAt({ x: 1000, y: 1000 }, zeroBase, 0, [rubble]);
    expect(result.level).toBe("none");
    expect(result.source).toBeNull();
  });

  it("picks the highest cover level when multiple pieces overlap", () => {
    const ruins = piece({ id: "ruins1", label: "Ruins", cover: "heavy", pos: { x: 0, y: 0 } });
    const result = terrainCoverAt({ x: 0, y: 0 }, zeroBase, 0, [rubble, ruins]);
    expect(result.level).toBe("heavy");
    expect(result.source).toBe("Ruins");
  });
});
