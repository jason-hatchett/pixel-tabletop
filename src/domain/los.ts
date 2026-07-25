/**
 * True line of sight between based models, under Warhammer terrain rules.
 *
 * Two special rules on top of "any blocker between them obscures":
 *  - Seeing OUT: a model wholly within a terrain feature's footprint sees out
 *    of it normally — that feature does not block ITS line of sight.
 *  - Seeing IN (objects inside terrain): a feature blocks sight THROUGH itself
 *    to the far side, but not TO models within its own footprint — you can see
 *    models inside a ruin. So a feature doesn't block LoS to a target within it;
 *    other features in the way still do.
 *
 * "True LoS" is sampled: a clear sightline is any unobstructed segment between a
 * point on the observer's base and a point on the target's base. Bases are
 * down-sampled to a handful of points so this stays cheap enough to run every
 * frame while a token is dragged.
 */

import type { Vec2, BaseShape } from "./geometry.js";
import { basePolygon, pointInBase } from "./geometry.js";
import type { Wall } from "./walls.js";
import { lineOfSightBlocked } from "./walls.js";
import type { TerrainPiece } from "./terrain.js";

export interface Sighted {
  pos: Vec2;
  base: BaseShape;
  facing: number;
}

/** At most `max` roughly-even points around a polygon. */
function sample(poly: Vec2[], max: number): Vec2[] {
  if (poly.length <= max) return poly;
  const out: Vec2[] = [];
  for (let i = 0; i < max; i++) out.push(poly[Math.floor((i * poly.length) / max)]!);
  return out;
}

/** Is every vertex of `poly` inside terrain `piece` (⇒ the convex base is
 * wholly within the convex footprint)? */
export function whollyWithin(poly: Vec2[], piece: TerrainPiece): boolean {
  return poly.every((v) => pointInBase(v, piece.pos, piece.base, piece.facing));
}

export function hasLineOfSight(
  observer: Sighted,
  target: Sighted,
  terrain: Iterable<TerrainPiece>,
  walls: Iterable<Wall>,
): boolean {
  const obs = basePolygon(observer.pos, observer.base, observer.facing);
  const tgt = basePolygon(target.pos, target.base, target.facing);

  const occluders: Wall[] = [];
  for (const w of walls) if (w.blocksLoS) occluders.push(w);
  for (const piece of terrain) {
    if (piece.losBlocking !== "blocks") continue;
    // Seeing out (observer inside) or seeing in (target inside): this feature
    // does not block THIS particular line of sight.
    if (whollyWithin(obs, piece) || whollyWithin(tgt, piece)) continue;
    const poly = basePolygon(piece.pos, piece.base, piece.facing);
    for (let i = 0; i < poly.length; i++) {
      occluders.push({
        id: `los-${piece.id}-${i}`,
        a: poly[i]!,
        b: poly[(i + 1) % poly.length]!,
        blocksLoS: true,
        blocksMove: false,
      });
    }
  }

  const obsPts = sample(obs, 8);
  const tgtPts = sample(tgt, 8);
  for (const a of obsPts) {
    for (const b of tgtPts) {
      if (!lineOfSightBlocked(a, b, occluders)) return true;
    }
  }
  return false;
}
