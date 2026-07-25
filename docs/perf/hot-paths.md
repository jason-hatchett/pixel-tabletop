# Perf hot paths — analysis & proposals

Measure-before-optimize. **No code changed here** — this is a ranked map of the
geometry/render hot spots and low-risk cuts to try, each gated on a benchmark and
the brute-force ground-truth scan. Cite `path:line`.

## How the frame gets spent

Dragging a token dispatches `moveToken` every `pointermove`
(`src/render/Board.ts:451`); every dispatch runs the full subscriber
(`Board.ts:148` → `redraw()` at `Board.ts:664`). So the **whole** redraw — grid,
terrain, walls, tokens, LoS, template — reruns per drag frame, even though only
one token moved. That framing dominates everything below.

## 1. Ranked hot paths

| # | Hot path | Location | Why expensive | Fires | Complexity |
|---|----------|----------|---------------|-------|------------|
| 1 | Sampled area-to-area LoS (`hasLineOfSight`) | `src/domain/los.ts:44`, inner loop `los.ts:74`, per-target call `Board.ts:986` | 8×8 = up to 64 sightlines, each `lineOfSightBlocked` scans every wall **and** every terrain edge (each blocking terrain piece expands to `poly.length` virtual walls, `los.ts:61`). Called once **per other token**. Occluder list is rebuilt from scratch every call (`los.ts:53-70`). | Per drag frame, once per non-selected token (`Board.ts:983`) | O(tokens · obs · tgt · (walls + Σ terrainVerts)) ≈ tokens·64·occluders |
| 2 | LoS shadow rebuild (`drawLoS`) | `Board.ts:938`, umbra loops `Board.ts:962-978` | Per wall: `umbraQuad` runs `clipConvex` once per source vertex (`walls.ts:98`); source is a 32-gon base (`geometry.ts:77`), so ~32 convex clips/wall. Per terrain block: `umbraOfOccluder` (`walls.ts:171`) = 32 point-shadows + 31 clips. Rebuilt fully every frame; no occluder culling. | Per drag frame while a unit is selected | O((walls + terrainBlocks) · CURVE_SEGMENTS · clipVerts) |
| 3 | Template shadow + resolve (`drawTemplate`) | `Board.ts:866`, umbra loop `Board.ts:896` | Point-source (origin) so cheaper per occluder than #2, but still rebuilds every occluder's `umbraOfOccluder` each frame and re-runs `resolveTemplate` (`Board.ts:903`). | Per frame while building/moving a template | O(walls + terrainBlocks·CURVE_SEGMENTS) |
| 4 | `drawGrid` full re-stroke | `Board.ts:699`, line loops `Board.ts:714-716` | `clear()` + re-`moveTo/lineTo` every grid line across the whole board every frame. Independent of what actually changed; only zoom (`px`) or board size affects it. | Every `redraw()`, i.e. every drag frame | O(widthMm/cell + heightMm/cell) |
| 5 | SAT polygon clearance (`polygonDistance`) | `src/domain/geometry.ts:197`, SAT `geometry.ts:169`, vertex×edge `geometry.ts:203-212` | Vertex-vs-edge both ways on 32-gon bases = ~2·32·32 `pointSegmentDistance`. Circle-circle short-circuits analytically (`geometry.ts:229`); the polygon branch is the cost. | Per measure / ruler / cover check (`Board.ts:1005`), not per drag frame today | O(n·m) in base vertices |

Ranking rationale: #1 is superlinear in **both** token count and occluder count
and runs N times per frame — the dominant cost at scale. #2 is the render-side
twin (heavy convex clipping, once per occluder). #4 is cheap per line but
unconditional. #5 only bites on measurement, not drag.

## 2. Low-risk optimization proposals

Each is correctness-preserving (equivalence-testable) or a pure hoist.

1. **Broad-phase AABB cull of occluders before LoS / umbra clipping.**
   For #1: before the sample loop, drop any occluder whose segment AABB doesn't
   intersect the observer-base ∪ target-base AABB (they can't cross any
   sightline). For #2/#3: drop any wall/terrain block whose AABB doesn't overlap
   the LoS circle / template area. This only *removes provably non-participating*
   occluders — the brute-force scan over the survivors is unchanged, so the
   result is identical. Biggest single win on maps where most terrain is far from
   the mover.

2. **Cache LoS results outside state, keyed by an input version.**
   The N `hasLineOfSight` calls in `Board.ts:983-991` recompute from scratch each
   frame even for tokens that didn't move. Key a module-level (render-side) memo
   on `(observerId+pos+facing, otherId+pos+facing, wallsVersion, terrainVersion)`;
   invalidate on any change. Cache lives in `src/render/`, **never** on
   `BoardState` (keeps it serializable/deterministic). During a single-token drag
   only pairs involving the moved token recompute.

3. **Rebuild LoS/template shadows only on change, not every frame.**
   Split `redraw()` so `drawLoS`/`drawTemplate` (and their umbra rebuilds) run
   only when their inputs changed — selected token moved, or walls/terrain
   changed — not on every unrelated dispatch. Track a cheap dirty flag / version
   per subsystem. Pure render-side; no geometry math changes.

4. **Hoist / cache `drawGrid`.** The grid geometry depends only on board size,
   cell size, and zoom (`px`, `Board.ts:707`). Redraw it only when one of those
   changes, or bake it into a `TilingSprite` / cached `Graphics`. Removes a full
   grid re-stroke from every drag frame.

5. **Memoize `basePolygon` per (shape,facing).** `los.ts:50-51`, `Board.ts:957`,
   `Board.ts:974`, and `edgeToEdge` (`geometry.ts:232-235`) all rebuild the same
   32-gon repeatedly. A small module-level memo keyed on shape+facing (position is
   just a translation — apply after) avoids the trig. Determinism preserved: same
   inputs → same polygon.

6. **Consider CURVE_SEGMENTS for clip sources (measure first).** Umbra cost (#2)
   scales linearly with source-vertex count (`geometry.ts:77` = 32). A separate,
   coarser polygon *for shadow casting only* would cut clips proportionally — but
   this changes shadow shape, so it is **not** correctness-preserving and needs
   its own brute-force tolerance test. Lowest priority; only if 1–5 fall short.

7. **Early-out clearance before SAT (#5).** Guard `polygonDistance` with a
   bounding-radius reject: if `dist(centerA,centerB) > rA+rB+wanted`, skip the SAT
   scan. Circle-circle already short-circuits (`geometry.ts:229`); this extends
   the cheap reject to oval/rect. Exact, no heuristic.

## 3. Hard invariants (any optimization MUST hold these)

- **Domain stays pure / deterministic / serializable / mm-only.** No caches,
  `Map`/`Set`, versions, or derived geometry on `BoardState`. Every memo or
  spatial index lives in `src/render/` or at module scope, keyed by inputs — same
  action stream → identical state. (CLAUDE.md; `docs/architecture` ADR-0004.)
- **Still passes the brute-force ground-truth scan** (`walls-templates.test.ts`).
  Proposals 1–5 and 7 are *equivalence-preserving* (they only skip provably
  non-participating work or hoist identical results) and must be proven so with a
  test asserting old == new over randomized scenes. The umbra math stays exactly
  the intersection-over-source-vertices definition (`walls.ts:88-93`,
  `walls.ts:161-169`).
- **No angular / tangent heuristics.** The rejected single-best-tangent-per-edge
  approach (`walls.ts:92-93`) is off the table — speed never buys an unverified
  geometry path. Proposal 6 is the only one that changes output and is gated on
  its own tolerance test.
- **No pixels/zoom in the domain.** Grid/`px` caching (proposal 4) stays entirely
  render-side.
- **No behaviour change without a test.** Correctness-preserving speedups still
  get an equivalence test.

## 4. Measure first

Do not optimize on this ranking alone. Establish baselines, then re-measure per
CLAUDE.md commands (`npm run typecheck`, `npm test`; Node via the pinned path).

Benchmark scenarios (scale is the point):
- **Many tokens:** 5 / 20 / 50 tokens, one selected, LoS on. Time one `redraw()`
  / `drawLoS()` and one `hasLineOfSight` call. Watch #1 grow ~quadratically.
- **Many walls / dense terrain:** 10 / 50 / 200 wall segments and several 32-gon
  terrain blocks. Time `drawLoS` umbra loop (#2) and `hasLineOfSight` (#1, via
  the per-edge virtual-wall expansion at `los.ts:61`).
- **Drag frame budget:** timestamp start→end of `redraw()` during a sustained
  token drag; confirm which subsystem (grid / LoS / template) owns the frame
  before cutting it. Target 60 fps (~16 ms).
- **Clearance (#5):** micro-bench `edgeToEdge` for circle-circle vs oval/rect to
  size proposal 7.

Quote each baseline number and the dominant `path:line`, apply the highest-leverage
cut, then quote the before/after delta. An optimization with no measured delta
does not ship.
