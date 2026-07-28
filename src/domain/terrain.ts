/**
 * Terrain: placeable area features (ruins, craters, forests, buildings, ...).
 *
 * Terrain deliberately does NOT get its own line-of-sight or cover engine.
 * Instead:
 *  - For orientation-agnostic segment checks (cover's `blockedCornerCount`,
 *    template hit/covered), LoS-blocking terrain decomposes into `Wall`-shaped
 *    polygon edges (`terrainVirtualWalls`) fed through the same primitives real
 *    walls use. A sightline crossing ANY edge of a solid block is genuinely
 *    blocked, so all four edges are correct there.
 *  - For DRAWING a shadow (template shading, unit LoS visualization), the block
 *    is instead treated as ONE convex occluder polygon and handed to
 *    `umbraOfOccluder` (walls.ts). It must NOT be shadowed edge-by-edge: a
 *    block's umbra is not the union of its per-edge umbrae (that leaves a lit
 *    gap directly behind the block), and per-edge front-face culling drops the
 *    side edges a wide source sees through. `umbraOfOccluder` avoids both by
 *    using the block's silhouette per source vertex.
 *  - Terrain that doesn't block LoS but still grants cover (a crater's lip, a
 *    rubble pile) can't be modelled as a hard edge — a shallow depression
 *    doesn't occlude corners the way a wall does. That's `terrainCoverAt`: an
 *    intrinsic "on/touching this terrain = cover" check, independent of the
 *    attacker's position, which is how tabletop rules usually phrase area
 *    terrain cover anyway.
 *
 * Per-system catalogs exist because "terrain" means different things:
 * Warhammer terrain is about cover and LoS-blocking on an open battlefield;
 * D&D terrain adds a descriptive `surface` (earth / stone / building interior)
 * since 5E terrain is as much about narration as it is about hard rules.
 */

import type { BaseShape, Vec2 } from "./geometry.js";
import { basePolygon, convexIntersect } from "./geometry.js";
import type { Wall } from "./walls.js";
import { inchesToMm, feetToMm } from "./units.js";

export type LosBlocking = "none" | "blocks";
export type TerrainCoverLevel = "none" | "light" | "heavy";
export type TerrainPattern = "hatch" | "dots" | "solid";

/**
 * Suggested terrain height, following the Games Workshop "Terrain Layouts" key:
 * a two-bucket scale — "more than 4\"" (tall) vs "2\" or less" (low) — plus
 * ground level. Stored as real millimetres (ADR-0001); the buckets are a
 * presentation derivation (`heightClass`), so a future continuous-height slider
 * or true-height LoS needs no schema change. See ADR-0011.
 */
export type HeightClass = "ground" | "low" | "tall";

/** Representative heights for the two GW buckets, in mm. */
export const HEIGHT_LOW_MM = inchesToMm(2);
export const HEIGHT_TALL_MM = inchesToMm(5);
/** GW's key splits "tall" at strictly more than 4". */
const HEIGHT_TALL_THRESHOLD_MM = inchesToMm(4);

/** Bucket a real height (mm) into the GW ground/low/tall key. */
export function heightClass(heightMm: number): HeightClass {
  if (heightMm <= 0) return "ground";
  return heightMm > HEIGHT_TALL_THRESHOLD_MM ? "tall" : "low";
}

/**
 * Height → the GW legend's fill/pattern: grey hatch (tall), teal dots (low),
 * flat earth (ground). Baked onto a piece at import so height reads at a glance
 * and the colour travels in BoardState (ADR-0011) — the renderer, which already
 * draws from a piece's fill/pattern, needs no change.
 */
export function heightColor(heightMm: number): { fill: number; border: number; pattern: TerrainPattern } {
  switch (heightClass(heightMm)) {
    case "tall":
      return { fill: 0x8a8f9c, border: 0xd8dde3, pattern: "hatch" };
    case "low":
      return { fill: 0x5878a8, border: 0x33445e, pattern: "dots" };
    case "ground":
      return { fill: 0x6b5842, border: 0x4a3b2a, pattern: "solid" };
  }
}

/** A placed terrain instance — self-contained, like `Token`, for serialization. */
export interface TerrainPiece {
  id: string;
  label: string;
  pos: Vec2;
  base: BaseShape;
  facing: number;
  losBlocking: LosBlocking;
  cover: TerrainCoverLevel;
  difficult: boolean;
  /** Descriptive ground type (D&D only: "earth" | "stone" | "building"). */
  surface: string | null;
  /** Real terrain height in mm; 0 = flush/ground. Denoted visually via `heightColor`. */
  heightMm: number;
  pattern: TerrainPattern;
  fill: number;
  border: number;
}

/** A catalog entry: kind + preset size bundled into one placeable option. */
export interface TerrainOption {
  id: string;
  label: string;
  base: BaseShape;
  losBlocking: LosBlocking;
  cover: TerrainCoverLevel;
  difficult: boolean;
  surface: string | null;
  heightMm: number;
  pattern: TerrainPattern;
  fill: number;
  border: number;
}

/** Which edition's area-terrain size roster to use (they differ). */
export type AreaTerrainEdition = "10e" | "11e";

export const AREA_TERRAIN_EDITIONS: { id: AreaTerrainEdition; label: string; sizesLabel: string }[] = [
  { id: "10e", label: "10th edition", sizesLabel: '6×4, 10×5, 12×6' },
  { id: "11e", label: "11th edition", sizesLabel: '11.5×8, 11.5×7, 10×2.5, 6×4, 6×2' },
];
export const DEFAULT_AREA_TERRAIN_EDITION: AreaTerrainEdition = "11e";

interface AreaSize {
  longIn: number;
  shortIn: number;
}

/**
 * Official Warhammer 40k area-terrain outline sizes (long × short, inches) per
 * edition. 10th's "Terrain Layouts" pack uses 6×4, 10×5, 12×6; 11th uses
 * 11.5×8 (right-angle, two make a square), 11.5×7, 10×2.5, 6×4, 6×2.
 */
const AREA_TERRAIN_SIZES_IN: Record<AreaTerrainEdition, AreaSize[]> = {
  "10e": [
    { longIn: 12, shortIn: 6 },
    { longIn: 10, shortIn: 5 },
    { longIn: 6, shortIn: 4 },
  ],
  "11e": [
    { longIn: 11.5, shortIn: 8 },
    { longIn: 11.5, shortIn: 7 },
    { longIn: 10, shortIn: 2.5 },
    { longIn: 6, shortIn: 4 },
    { longIn: 6, shortIn: 2 },
  ],
};

/**
 * Snapping roster (long × short, mm) per edition — the source of truth for
 * snapping detected terrain to a real footprint (ADR-0011), so import never
 * invents an off-catalog size. Keyed by edition; the user picks at import.
 */
export const AREA_TERRAIN_FOOTPRINTS_MM: Record<AreaTerrainEdition, { longMm: number; shortMm: number }[]> = {
  "10e": AREA_TERRAIN_SIZES_IN["10e"].map((s) => ({ longMm: inchesToMm(s.longIn), shortMm: inchesToMm(s.shortIn) })),
  "11e": AREA_TERRAIN_SIZES_IN["11e"].map((s) => ({ longMm: inchesToMm(s.longIn), shortMm: inchesToMm(s.shortIn) })),
};

const rectIn = (wIn: number, hIn: number): BaseShape => ({
  kind: "rect",
  halfWidthMm: inchesToMm(wIn) / 2,
  halfHeightMm: inchesToMm(hIn) / 2,
});
const circleIn = (diameterIn: number): BaseShape => ({
  kind: "circle",
  radiusMm: inchesToMm(diameterIn) / 2,
});
const rectFt = (wFt: number, hFt: number): BaseShape => ({
  kind: "rect",
  halfWidthMm: feetToMm(wFt) / 2,
  halfHeightMm: feetToMm(hFt) / 2,
});

/** Placeable area-terrain outlines for both editions, deduped by size (6×4 is
 * shared). Tall ruins, height-coloured via `heightColor` (ADR-0011). */
const areaTerrainOptions: TerrainOption[] = (() => {
  const seen = new Set<string>();
  const opts: TerrainOption[] = [];
  for (const ed of ["10e", "11e"] as const) {
    for (const s of AREA_TERRAIN_SIZES_IN[ed]) {
      const key = `${s.longIn}x${s.shortIn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      opts.push({
        id: `area-${key.replace(".", "p")}`,
        label: `Area Terrain ${s.longIn}"×${s.shortIn}"`,
        base: rectIn(s.longIn, s.shortIn),
        losBlocking: "blocks",
        cover: "heavy",
        difficult: true,
        surface: null,
        heightMm: HEIGHT_TALL_MM,
        ...heightColor(HEIGHT_TALL_MM),
      });
    }
  }
  return opts;
})();

/** Games Workshop-flavoured battlefield terrain. */
export const WARHAMMER_TERRAIN: TerrainOption[] = [
  {
    id: "ruins-small",
    label: "Ruins (Small)",
    base: rectIn(3, 6),
    losBlocking: "blocks",
    cover: "heavy",
    difficult: true,
    surface: null,
    heightMm: HEIGHT_TALL_MM,
    pattern: "hatch",
    fill: 0x8a8f9c,
    border: 0xd8dde3,
  },
  {
    id: "ruins-large",
    label: "Ruins (Large)",
    base: rectIn(5, 9),
    losBlocking: "blocks",
    cover: "heavy",
    difficult: true,
    surface: null,
    heightMm: HEIGHT_TALL_MM,
    pattern: "hatch",
    fill: 0x8a8f9c,
    border: 0xd8dde3,
  },
  {
    id: "crater-small",
    label: "Crater (Small)",
    base: circleIn(4),
    losBlocking: "none",
    cover: "light",
    difficult: true,
    surface: null,
    heightMm: 0,
    pattern: "solid",
    fill: 0x6b5842,
    border: 0x4a3b2a,
  },
  {
    id: "crater-large",
    label: "Crater (Large)",
    base: circleIn(6),
    losBlocking: "none",
    cover: "light",
    difficult: true,
    surface: null,
    heightMm: 0,
    pattern: "solid",
    fill: 0x6b5842,
    border: 0x4a3b2a,
  },
  {
    id: "rubble-small",
    label: "Rubble (Small)",
    base: rectIn(3, 4),
    losBlocking: "none",
    cover: "light",
    difficult: true,
    surface: null,
    heightMm: HEIGHT_LOW_MM,
    pattern: "dots",
    fill: 0x5878a8,
    border: 0x33445e,
  },
  {
    id: "rubble-large",
    label: "Rubble (Large)",
    base: rectIn(5, 6),
    losBlocking: "none",
    cover: "light",
    difficult: true,
    surface: null,
    heightMm: HEIGHT_LOW_MM,
    pattern: "dots",
    fill: 0x5878a8,
    border: 0x33445e,
  },
  {
    id: "forest-small",
    label: "Dense Terrain (Copse)",
    base: rectIn(4, 4),
    losBlocking: "blocks",
    cover: "heavy",
    difficult: true,
    surface: null,
    heightMm: HEIGHT_TALL_MM,
    pattern: "dots",
    fill: 0x3f6b48,
    border: 0x25402c,
  },
  {
    id: "forest-large",
    label: "Dense Terrain (Woods)",
    base: rectIn(7, 9),
    losBlocking: "blocks",
    cover: "heavy",
    difficult: true,
    surface: null,
    heightMm: HEIGHT_TALL_MM,
    pattern: "dots",
    fill: 0x3f6b48,
    border: 0x25402c,
  },
  // Official area-terrain outlines for both editions (deduped) — see
  // `areaTerrainOptions`. Tall ruins by default; fill/pattern come from
  // `heightColor` so the grey (tall) / teal (low) height key reads on the board
  // (ADR-0011). Height class can be re-coloured after placement.
  ...areaTerrainOptions,
];

/** D&D 5E terrain: LoS-blocking features plus descriptive ground surfaces. */
export const DND_TERRAIN: TerrainOption[] = [
  {
    id: "building-small",
    label: "Building (Small)",
    base: rectFt(15, 15),
    losBlocking: "blocks",
    cover: "heavy",
    difficult: false,
    surface: "building",
    heightMm: HEIGHT_TALL_MM,
    pattern: "hatch",
    fill: 0x9c8a6f,
    border: 0xd8c9a3,
  },
  {
    id: "building-large",
    label: "Building (Large)",
    base: rectFt(30, 20),
    losBlocking: "blocks",
    cover: "heavy",
    difficult: false,
    surface: "building",
    heightMm: HEIGHT_TALL_MM,
    pattern: "hatch",
    fill: 0x9c8a6f,
    border: 0xd8c9a3,
  },
  {
    id: "foliage-small",
    label: "Dense Foliage (Thicket)",
    base: rectFt(10, 10),
    losBlocking: "blocks",
    cover: "heavy",
    difficult: true,
    surface: "earth",
    heightMm: HEIGHT_TALL_MM,
    pattern: "dots",
    fill: 0x3f6b48,
    border: 0x25402c,
  },
  {
    id: "foliage-large",
    label: "Dense Foliage (Grove)",
    base: rectFt(20, 15),
    losBlocking: "blocks",
    cover: "heavy",
    difficult: true,
    surface: "earth",
    heightMm: HEIGHT_TALL_MM,
    pattern: "dots",
    fill: 0x3f6b48,
    border: 0x25402c,
  },
  {
    id: "rubble-small",
    label: "Rubble (Small)",
    base: rectFt(10, 10),
    losBlocking: "none",
    cover: "light",
    difficult: true,
    surface: "stone",
    heightMm: HEIGHT_LOW_MM,
    pattern: "dots",
    fill: 0x5878a8,
    border: 0x33445e,
  },
  {
    id: "rubble-large",
    label: "Rubble (Large)",
    base: rectFt(15, 15),
    losBlocking: "none",
    cover: "light",
    difficult: true,
    surface: "stone",
    heightMm: HEIGHT_LOW_MM,
    pattern: "dots",
    fill: 0x5878a8,
    border: 0x33445e,
  },
  {
    id: "surface-earth",
    label: "Ground: Earth",
    base: rectFt(10, 10),
    losBlocking: "none",
    cover: "none",
    difficult: false,
    surface: "earth",
    heightMm: 0,
    pattern: "solid",
    fill: 0x6b5842,
    border: 0x4a3b2a,
  },
  {
    id: "surface-stone",
    label: "Ground: Stone",
    base: rectFt(10, 10),
    losBlocking: "none",
    cover: "none",
    difficult: false,
    surface: "stone",
    heightMm: 0,
    pattern: "solid",
    fill: 0x7c8290,
    border: 0x555b66,
  },
  {
    id: "surface-building",
    label: "Ground: Building Interior",
    base: rectFt(15, 15),
    losBlocking: "none",
    cover: "none",
    difficult: false,
    surface: "building",
    heightMm: 0,
    pattern: "solid",
    fill: 0x8a7458,
    border: 0x6b5a42,
  },
];

export function getTerrainOptions(systemId: string): TerrainOption[] {
  return systemId === "dnd5e" ? DND_TERRAIN : WARHAMMER_TERRAIN;
}

export function findTerrainOption(systemId: string, id: string): TerrainOption | undefined {
  return getTerrainOptions(systemId).find((o) => o.id === id);
}

/**
 * LoS-blocking terrain decomposed into ALL of its `Wall`-shaped polygon edges.
 * Correct for orientation-agnostic segment-intersection checks (cover's corner
 * count, template hit/covered, a plain LoS point check) — a sightline crossing
 * any edge of a solid block really is blocked, regardless of which side of the
 * block that edge is on. NOT for drawing a shadow polygon: a shadow must treat
 * the block as one whole convex occluder (see `umbraOfOccluder` in walls.ts),
 * because unioning independent per-edge shadows leaves lit gaps behind the
 * block. Non-blocking terrain (craters, rubble, plain ground surfaces)
 * contributes nothing here — see `terrainCoverAt` for how those grant cover.
 */
export function terrainVirtualWalls(terrain: Iterable<TerrainPiece>): Wall[] {
  const walls: Wall[] = [];
  for (const piece of terrain) {
    if (piece.losBlocking !== "blocks") continue;
    const poly = basePolygon(piece.pos, piece.base, piece.facing);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      walls.push({
        id: `terrain-${piece.id}-${i}`,
        a,
        b,
        blocksLoS: true,
        blocksMove: piece.difficult,
      });
    }
  }
  return walls;
}

/**
 * Intrinsic cover from standing on/touching area terrain (craters, rubble),
 * independent of the attacker's position — this is how "cover terrain" is
 * usually phrased in tabletop rules ("a model on this feature has cover"),
 * as distinct from the corner/wall-blocking cover computed elsewhere.
 */
export function terrainCoverAt(
  pos: Vec2,
  base: BaseShape,
  facing: number,
  terrain: Iterable<TerrainPiece>,
): { level: TerrainCoverLevel; source: string | null } {
  const order: TerrainCoverLevel[] = ["none", "light", "heavy"];
  let best: TerrainCoverLevel = "none";
  let source: string | null = null;
  const targetPoly = basePolygon(pos, base, facing);
  for (const piece of terrain) {
    if (order.indexOf(piece.cover) <= order.indexOf(best)) continue;
    const piecePoly = basePolygon(piece.pos, piece.base, piece.facing);
    if (convexIntersect(targetPoly, piecePoly)) {
      best = piece.cover;
      source = piece.label;
    }
  }
  return { level: best, source };
}
