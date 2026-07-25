/**
 * A RuleSystem is a plugin that teaches the engine how ONE game measures and
 * moves. Adding a game = adding a file here, not editing the core. This is the
 * whole reason to build this app instead of using a generic VTT.
 */

import type { Vec2, BaseShape } from "../geometry.js";
import type { Wall } from "../walls.js";

export interface GridConfig {
  /** Cell size in mm. null grid => gridless (freeform) system. */
  cellMm: number;
}

export interface MeasureTarget {
  pos: Vec2;
  base: BaseShape;
  /** Base orientation in radians (matters for oval/rect edge-to-edge). */
  facing: number;
}

export interface Measurement {
  /** Raw physical distance in mm (for the ruler graphics). */
  mm: number;
  /** Human-facing string in the system's native unit, e.g. `6.0"` or `30 ft`. */
  text: string;
}

export type CoverLevel = "none" | "half" | "three-quarters" | "total";

export interface CoverResult {
  level: CoverLevel;
  /** System-specific label, e.g. `Half cover (+2 AC)` or `Benefit of cover`. */
  text: string;
}

export interface RuleSystem {
  readonly id: string;
  readonly name: string;
  /** null => gridless. Non-null => snap-to-grid system. */
  readonly grid: GridConfig | null;

  /** Snap a proposed center position for a token. Freeform systems return it as-is. */
  snap(pos: Vec2, base: BaseShape): Vec2;

  /** Distance between two placed models, in this system's terms. */
  measure(a: MeasureTarget, b: MeasureTarget): Measurement;

  /** Cover the target (`to`) gains from `from`, given the walls in play. */
  cover(from: MeasureTarget, to: MeasureTarget, walls: Iterable<Wall>): CoverResult;
}
