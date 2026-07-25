---
name: verify-geometry
description: Mandatory verification workflow for ANY line-of-sight, shadow, umbra, occlusion, or clearance geometry change. Use WHENEVER you touch LoS, shadows, umbra/penumbra, occlusion, cover geometry, or base-to-base clearance in src/domain/ — before claiming the math is correct.
---

Geometry is **verified, never asserted**. The repo history is littered with
"clever" heuristics that were wrong (analytic tangent-pick; per-edge umbrae +
front-face culling that left a lit gap behind a block). Never trust
angular/tangent heuristics — prove the new math against a brute-force scan.

## The rule

Every occlusion/LoS/clearance change gets a vitest that compares the new math
against ground truth computed from the primitive `lineOfSightBlocked(from, to,
walls)` (`walls.ts`) — the same primitive the real code samples.

## Ground truth for a point-in-umbra claim

A point is **in umbra** iff it is hidden from **every** vertex of the source:

```ts
const inUmbraTruth = source.every((v) => lineOfSightBlocked(v, point, occluders));
// equivalently: NOT visible from any source vertex.
const clearFromSome = source.some((v) => !lineOfSightBlocked(v, point, occluders));
```

Assert the shadow polygon agrees: `inPoly(umbra, point)` must match
`inUmbraTruth` for points inside and outside. For a region, scan a grid of
points and compare `inPoly(...)` against the brute-force check at each.

## What to exercise

- `umbraQuad(source, a, b)` — a single wall **segment**.
- `umbraOfOccluder(source, occluder)` — a whole convex **terrain block** as one
  occluder. Explicitly test the point **directly behind the block**: it can be
  hidden from everyone yet by no single edge alone — the per-edge-union bug.
- Clearance changes: compare `edgeToEdge` / `polygonDistance` against an
  independent sampled/analytic distance.

## Where to put it

Extend `src/domain/los.test.ts` (LoS) or `src/domain/walls-templates.test.ts`
(umbra/shadow/templates) — follow their existing brute-force patterns.

## Verify

`npm run typecheck` && `npm test` (WSL PATH prefix: see
`docs/context/dev-environment.md`).
