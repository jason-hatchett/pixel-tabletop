# ADR-0004: Occlusion/LoS by intersection-over-source-vertices, verified against brute force

## Status
Accepted

## Context
A unit's line of sight is base-**area** to base-**area**, not center-to-center: a
broadside oval can see around a thin obstruction that a point at its center
cannot. So the drawn shadow of an obstruction is the region hidden from **every**
point of the viewing base, not just its center. We need to compute, and draw,
that umbra for two obstruction kinds — a single wall segment and a whole convex
terrain block — and we need to trust it.

The engine had two earlier, "clever" attempts, both wrong:

1. **Analytic tangent-pick** — choose the pair of silhouette tangents from the
   source and shadow between them. Wrong for asymmetric configurations; it picked
   the wrong tangents and misplaced the umbra.
2. **Per-edge `umbraQuad` + front-face culling** — shadow each occluder edge
   independently and union the results, culling back faces. This leaves a **lit
   gap directly behind a solid block**: a point can be hidden from the source's
   left half by one edge and from its right half by another — hidden from every
   source point, but by *no single edge alone*, so the per-edge union never marks
   it. Front-face culling also drops the side edges a wide (area) source sees
   past.

## Decision
Compute umbrae by **intersection over the source's vertices**, using generic
convex-polygon clipping (Sutherland-Hodgman), with **no angular/tangent
heuristics**. A point is in shadow only if it is hidden from *every* vertex of
the source base — so the umbra is the **intersection** of the per-source-vertex
point-shadows.

Two builders in `src/domain/walls.ts`:

- `umbraQuad(source, a, b)` (`walls.ts:95`) — one wall **segment**: intersection,
  over source vertices, of each vertex's `shadowQuad` (`walls.ts:25`) of the
  segment.
- `umbraOfOccluder(source, occluder)` (`walls.ts:171`) — a whole convex **block**
  as a *single* occluder: intersection, over source vertices, of each vertex's
  point-shadow of the entire silhouette. A block is shadowed as one occluder,
  **never edge-by-edge**, which is what closes the lit-gap bug above.

This is a **hard verification rule**, not an assertion: every occlusion result is
checked against a brute-force ground truth — `lineOfSightBlocked` (`walls.ts:181`)
sampled from every source vertex — in `src/domain/walls-templates.test.ts`
(`hiddenFromAll` / `inUmbra`, `walls-templates.test.ts:128`). New occlusion math
that a brute-force scan won't corroborate does not ship (vision.md pillar 4;
game-design.md §5).

LoS-blocking terrain therefore has two representations, by purpose: as four
`Wall`-shaped **edges** (`terrainVirtualWalls`) for orientation-agnostic
segment-intersection checks (cover corners, template hit/covered resolution), and
as one whole convex **occluder polygon** for the *drawn* shadow via
`umbraOfOccluder`.

## Consequences
- Correct umbrae for area sources and solid blocks, including the asymmetric and
  behind-the-block cases the heuristics got wrong.
- The approach is uniform: segments and blocks use the same intersection-over-
  source-vertices primitive plus generic convex clipping, so there's one mental
  model and one place bugs hide.
- Cost: intersection over N source vertices is more work than a single analytic
  shadow, and the source/occluder must be convex for Sutherland-Hodgman.
  Non-convex terrain must be decomposed into convex pieces before shadowing.
- The rejected heuristics are recorded here on purpose (and in README/CLAUDE.md):
  they *looked* right and passed eyeball tests, which is exactly why the
  brute-force scan is mandatory rather than optional.
