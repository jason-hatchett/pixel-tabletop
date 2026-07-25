/**
 * Per-system base catalogs. The available bases are deliberately different for
 * each game, because "a unit's footprint" means different things:
 *
 *  - Warhammer 40k / AoS: real Games Workshop base sizes in mm. Round and oval
 *    bases; distance is measured edge-to-edge, so the exact shape matters.
 *  - D&D 5E: creature-size categories, whose footprint is a whole number of
 *    5-ft squares. Placement snaps to the grid by footprint (see dnd5e.snap).
 */

import type { BaseShape } from "./geometry.js";
import { DEFAULT_CELL_MM } from "./units.js";

export interface BaseOption {
  id: string;
  label: string;
  shape: BaseShape;
}

const round = (id: string, diameterMm: number, label = `${diameterMm} mm round`): BaseOption => ({
  id,
  label,
  shape: { kind: "circle", radiusMm: diameterMm / 2 },
});

const oval = (id: string, wMm: number, hMm: number): BaseOption => ({
  id,
  label: `${wMm}×${hMm} mm oval`,
  shape: { kind: "oval", radiusXMm: wMm / 2, radiusYMm: hMm / 2 },
});

/** Games Workshop's standard base sizes. */
export const WARHAMMER_BASES: BaseOption[] = [
  round("r25", 25),
  round("r28", 28.5, "28.5 mm round"),
  round("r32", 32),
  round("r40", 40),
  round("r50", 50),
  round("r60", 60),
  round("r80", 80),
  round("r100", 100),
  oval("o60x35", 60, 35),
  oval("o75x42", 75, 42),
  oval("o90x52", 90, 52),
  oval("o105x70", 105, 70),
  oval("o120x92", 120, 92),
];

/** D&D 5E creature sizes as round tokens whose diameter spans their footprint. */
const cell = DEFAULT_CELL_MM;
const sizeToken = (id: string, label: string, cells: number): BaseOption => ({
  id,
  label,
  shape: { kind: "circle", radiusMm: (cells * cell) / 2 },
});

export const DND_BASES: BaseOption[] = [
  // Tiny occupies 2.5 ft (a quarter square); up to four share one 5-ft square.
  sizeToken("tiny", "Tiny (2.5 ft)", 0.5),
  // Small AND Medium both occupy a full 5-ft square — same footprint.
  sizeToken("medium", "Small / Medium (5 ft)", 1),
  sizeToken("large", "Large (2×2)", 2),
  sizeToken("huge", "Huge (3×3)", 3),
  sizeToken("gargantuan", "Gargantuan (4×4)", 4),
];

export function getBaseOptions(systemId: string): BaseOption[] {
  return systemId === "dnd5e" ? DND_BASES : WARHAMMER_BASES;
}

export function findBaseOption(systemId: string, id: string): BaseOption | undefined {
  return getBaseOptions(systemId).find((o) => o.id === id);
}
