/**
 * Warhammer 40k / Age of Sigmar: gridless, freeform placement, distances
 * measured edge-to-edge (base-to-base) in inches. No diagonal rules — the table
 * is continuous Euclidean space.
 */

import type { RuleSystem, MeasureTarget, Measurement, CoverResult } from "./types.js";
import type { Vec2 } from "../geometry.js";
import { edgeToEdge } from "../geometry.js";
import { mmToInches } from "../units.js";
import type { Wall } from "../walls.js";
import { blockedCornerCount } from "../walls.js";

export const warhammer: RuleSystem = {
  id: "warhammer",
  name: "Warhammer 40k / AoS",
  grid: null,

  // Freeform: no snapping.
  snap(pos: Vec2): Vec2 {
    return pos;
  },

  measure(a: MeasureTarget, b: MeasureTarget): Measurement {
    const mm = edgeToEdge(a.pos, a.base, a.facing, b.pos, b.base, b.facing);
    return { mm, text: `${mmToInches(mm).toFixed(1)}"` };
  },

  // 40k has a simpler cover model: the target is either visible, has the benefit
  // of cover (partly obscured), or is fully out of line of sight.
  cover(from: MeasureTarget, to: MeasureTarget, walls: Iterable<Wall>): CoverResult {
    const blocked = blockedCornerCount(from.pos, to.pos, to.base, to.facing, walls);
    if (blocked === 0) return { level: "none", text: "No cover" };
    if (blocked >= 4) return { level: "total", text: "Out of line of sight" };
    return { level: "half", text: "Benefit of cover" };
  },
};
