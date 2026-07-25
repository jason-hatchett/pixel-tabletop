/**
 * D&D 5E: square grid, center-snapped tokens, distance by counting squares.
 *
 * Diagonal rule is pluggable:
 *  - "5-5-5"  (PHB default): every square = 5 ft, so distance = Chebyshev * 5.
 *  - "5-10-5" (DMG variant):  every 2nd diagonal costs 10 ft.
 */

import type { RuleSystem, MeasureTarget, Measurement, CoverResult } from "./types.js";
import type { Vec2, BaseShape } from "../geometry.js";
import { footprint } from "../geometry.js";
import { DEFAULT_CELL_MM, DEFAULT_FEET_PER_CELL } from "../units.js";
import type { Wall } from "../walls.js";
import { blockedCornerCount } from "../walls.js";

export type DiagonalRule = "5-5-5" | "5-10-5";

function feetForCells(dxCells: number, dyCells: number, rule: DiagonalRule): number {
  const diagonals = Math.min(dxCells, dyCells);
  const straights = Math.abs(dxCells - dyCells);
  if (rule === "5-5-5") {
    return (diagonals + straights) * DEFAULT_FEET_PER_CELL;
  }
  // 5-10-5: alternate diagonals cost double.
  const diagFeet = (Math.floor(diagonals / 2) * 3 + (diagonals % 2)) * DEFAULT_FEET_PER_CELL;
  return diagFeet + straights * DEFAULT_FEET_PER_CELL;
}

export function makeDnd5e(
  cellMm: number = DEFAULT_CELL_MM,
  diagonal: DiagonalRule = "5-5-5",
): RuleSystem {
  return {
    id: "dnd5e",
    name: "D&D 5E",
    grid: { cellMm },

    // Snap so the token's footprint aligns to the grid. A footprint that is an
    // odd number of cells wide sits centered on a cell; an even number sits on a
    // grid line (vertex). That's why a Medium (1x1) and a Large (2x2) snap
    // differently — the base size drives the placement.
    snap(pos: Vec2, base: BaseShape): Vec2 {
      const fp = footprint(base);
      const snapAxis = (p: number, sizeMm: number): number => {
        const cells = sizeMm / cellMm;
        if (cells <= 0.5 + 1e-9) {
          // Genuinely sub-cell (Tiny, 2.5 ft): two slots per cell so four can
          // share one square. Larger bases round to a whole-cell footprint below.
          const step = cellMm / 2;
          return (Math.floor(p / step) + 0.5) * step;
        }
        const n = Math.max(1, Math.round(cells));
        return n % 2 === 1
          ? (Math.floor(p / cellMm) + 0.5) * cellMm // odd footprint -> cell center
          : Math.round(p / cellMm) * cellMm; // even footprint -> grid vertex
      };
      return { x: snapAxis(pos.x, fp.w), y: snapAxis(pos.y, fp.h) };
    },

    measure(a: MeasureTarget, b: MeasureTarget): Measurement {
      const dxCells = Math.round(Math.abs(a.pos.x - b.pos.x) / cellMm);
      const dyCells = Math.round(Math.abs(a.pos.y - b.pos.y) / cellMm);
      const feet = feetForCells(dxCells, dyCells, diagonal);
      // Report raw mm as straight-line for the ruler graphic.
      const mm = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      return { mm, text: `${feet} ft` };
    },

    // 5E corner method (DMG): trace from the attacker to the target's corners;
    // 1-2 blocked => half, 3 => three-quarters, 4 => total cover.
    cover(from: MeasureTarget, to: MeasureTarget, walls: Iterable<Wall>): CoverResult {
      const blocked = blockedCornerCount(from.pos, to.pos, to.base, to.facing, walls);
      if (blocked <= 0) return { level: "none", text: "No cover" };
      if (blocked <= 2) return { level: "half", text: "Half cover (+2 AC)" };
      if (blocked === 3) return { level: "three-quarters", text: "Three-quarters cover (+5 AC)" };
      return { level: "total", text: "Total cover (can't be targeted)" };
    },
  };
}

export const dnd5e: RuleSystem = makeDnd5e();
