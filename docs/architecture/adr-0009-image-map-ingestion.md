# ADR-0009: Image-map ingestion — CV extraction at import emits first-class Wall/TerrainPiece via loadState; runtime geometry unchanged

## Status
Accepted (2026-07-26) — Slice B greenlit by owner. v1 builds up in cuts: pure
wall-extraction analyzer first, then the staged-preview review gate + `loadState`
wiring; icon classification (doors/statues/stairs) and merge-into-current-board
remain deferred (B2).

## Context
The owner re-scoped image-terrain beyond a decorative skin
([ADR-0008](adr-0008-image-terrain-placement.md)): given a top-down map image
(e.g. a stylized "blueprint" D&D dungeon — solid-colour background, white rooms
outlined by clean straight walls, a fine in-room grid, numbered rooms, a
door/secret-door/statue/stairs legend), **analyze it and reconstruct the board**
— rooms, walls, and terrain — as the *existing* first-class domain objects that
already drive LoS/cover, so occlusion maps to real geometry rather than pixels.

This directly reverses the image-terrain spec's former "out of scope" line
("occlusion geometry inferred from image pixels"). It therefore has to be
reconciled with the five pillars — especially pillar 4, **geometry is verified,
never asserted** ([ADR-0004](adr-0004-occlusion-by-intersection-over-source-vertices.md)),
since CV is inherently heuristic — plus mm-only (ADR-0001), the pure reducer
(ADR-0002), and plain-JSON portability (ADR-0007). The domain is pure and
DOM-free; pixel analysis is impure.

## Decision

**The reconciling invariant (pillar 4).** CV/heuristics are confined to an
**import-time authoring step** that emits ordinary, editable `Wall`
(`src/domain/walls.ts:11`) and `TerrainPiece` (`src/domain/terrain.ts:41`)
records — architecturally identical to what a human produces by dragging in the
UI. Runtime occlusion (`hasLineOfSight` `src/domain/los.ts:44`,
`umbraOfOccluder`/`umbraQuad` `src/domain/walls.ts`) runs over those records
**unchanged**. The image is **never consulted at runtime** — it is a seed for
authoring, not an occlusion source. Pillar 4 constrains the occlusion *algorithm*,
not the *provenance* of a wall's endpoints; a CV-placed wall and a hand-placed
wall are the same thing. The extraction step introduces **no new geometry
primitive**, so it needs **no new brute-force scan** — the emitted objects are
already covered by the existing LoS/umbra tests.

**Human-review gate (honours pillar 4's spirit).** Because detection can be
*wrong*, extracted geometry is presented as a **staged preview** to accept or
reject *before* it enters board state. It is never silently auto-committed as
ground truth.

**Module boundary — analyzer lives outside the domain.** A new top-level
`src/ingest/` (peer of `src/persist/`, `src/render/`), never imported by
`src/domain/`:
- `src/ingest/decode.ts` — the *only* DOM-touching code: `File → { data, width,
  height }` via `createImageBitmap`/OffscreenCanvas.
- `src/ingest/mapAnalyzer.ts` — a **pure** function `({ data, width, height },
  calibration) → BoardState`. Thresholding/contour/simplify live here; a synthetic
  buffer in, walls out — deterministically unit-testable, no DOM.

**No new domain types.** Detected features map onto existing records:

| Detected | Maps to |
|----------|---------|
| Room/corridor outline | `Wall[]` segments, LoS- and move-blocking. Octagon/round chambers = their edge segments (no polygon `BaseShape` needed; rooms are wall runs, not footprints). |
| Doorway (opening) | **absence** of a wall segment (a gap). |
| Statue | `TerrainPiece` instance (circle, LoS-blocking, heavy cover), fields mirroring the nearest `DND_TERRAIN` archetype — no catalog entry added. |
| Stairs | `TerrainPiece` instance (rect, difficult, non-blocking). |
| Closed/secret door as a *stateful barrier* | **Deferred** — `Wall` has no open/closed/secret state; a stateful `Door` is new domain surface, out of scope for v1. |

**Enters state via existing `loadState` — no new Action.** v1 semantics = *import
builds a **new** board*: the analyzer assembles a full `BoardState` and dispatches
`{ type: "loadState", state }` (`src/domain/state.ts:51`), the ADR-0007 hydration
primitive — already **one undoable step**, already multiplayer-correct, **zero**
new domain/wire surface. "Merge into current board" (a batch action wrapped as one
undo entry) is deferred.

**mm-only (pillar 1).** Detected pixel coordinates convert to mm at the analyzer
boundary using ADR-0008's calibration (grid-pitch detection bound to the active
`RuleSystem` cell, manual-span confirm as fallback). Walls/terrain are emitted
already in mm; board extent = image px extent × scale. No pixel field enters
`BoardState`.

**Source image retained as a skin.** The original image is kept as an ADR-0008
image placement *beneath* the reconstructed geometry, so the user sees map art
with honest geometry over it.

**v1 input class is constrained.** High-contrast, vector-like blueprint rasters
only (solid background, white rooms, clean straight walls). Photos and hand-drawn
maps are a different, much harder problem and are explicitly **out of scope**.

**No CV dependency.** The rectilinear pipeline (threshold → connected components →
contour trace → Douglas–Peucker simplify → axis-aligned wall outlines) is ~200
lines of hand-rolled pure TS. Do **not** pull in `opencv.js` (multi-MB WASM); a
hand-rolled pipeline stays small and deterministically testable.

## Consequences
- First `src/ingest/` module boundary is set; CV heuristics are quarantined
  outside the pure domain and are unit-testable against synthetic buffers.
- **Zero** new domain or wire surface if v1 reuses `loadState`; extracted boards
  persist and replay for free via ADR-0007.
- Pillar 4 is preserved **in letter** (runtime math unchanged, brute-force scan
  still governs it) and **in spirit only if the review gate is honoured** — the
  staged preview is load-bearing, not optional polish.
- Detection quality (did we find the *right* walls?) is explicitly a heuristic,
  best-effort concern, not a geometry-correctness guarantee; editable output +
  undo is the safety net, not detector perfection.
- Curved chambers become faceted many-segment wall runs (acceptable for LoS);
  icon classification (doors/statues/stairs) is the brittle part and is gated
  behind review, with door/secret-door state deferred entirely.

## Open questions for the owner
1. **Review-gate UX** — where and how the staged preview lets the user
   accept/correct extracted geometry before commit (a render/UX call for slice B).
2. **Stateful doors** — will v1's "doorway = gap" suffice indefinitely, or does a
   first-class `Door` (open/closed/secret) land later? A `BoardState`-shape
   question to settle **before** the Phase-7 wire freeze.
3. **Icon fidelity** — how far v1 goes on statue/stairs classification vs. walls
   only for the first proof-of-concept slice.

## Relationships
Depends on [ADR-0008](adr-0008-image-terrain-placement.md). Extends and honours
[ADR-0001](adr-0001-millimetres-only-domain-unit.md),
[ADR-0002](adr-0002-deterministic-reducer-multiplayer-seam.md),
[ADR-0004](adr-0004-occlusion-by-intersection-over-source-vertices.md), and
[ADR-0007](adr-0007-board-state-persistence.md). Supersedes the "no
pixel-inferred geometry" scope line in
[../specs/image-terrain.md](../specs/image-terrain.md) (which needs a matching
update once this ADR is Accepted).
