# Spec (DRAFT) — Image-file terrain

Status: **DRAFT — not approved.** Owner works "propose, I approve"; nothing here
is decided. Open architecture calls are routed below, not resolved.

See also: [roadmap.md](../roadmap.md) · [game-design.md](../game-design.md) §2
(objects) · [vision.md](../vision.md) (pillar 1: mm are ground truth).

## Problem statement

Terrain today is procedural: a `TerrainPiece` (`src/domain/terrain.ts:41`) is a
based footprint drawn as vector `Graphics` with a `pattern`/`fill`/`border`, from
a per-system catalog (`WARHAMMER_TERRAIN`, `DND_TERRAIN`). That is honest and
verified but visually generic, and it can't represent the artefact players
actually bring to the table: **a flat raster image — a JPEG/PNG map or a terrain
photo/tile**. Users cannot drop their own battlemap or terrain art onto the
board. This is the near-term wedge for "looks like our table," and it is now the
priority ahead of procedural pixel-art tiles.

Scope is **flat image files (JPEG/PNG)** used as terrain and as full-board map
backgrounds. Not procedural tilesets, not animated sprites, not 3D.

## Value to each audience (equal priority)

- **40k / AoS players.** Drop a printed/painted battlemat or a terrain-piece photo
  and have it sit at true physical scale, so a 6" edge-to-edge measurement over
  the image reads correctly. The image is a *visual skin*; mm positioning,
  clearance, and LoS/cover stay ground-truth (pillar 1). A ruin image can share a
  footprint with a LoS-blocking `TerrainPiece` so measurement stays honest.
- **D&D 5E tables.** Drop a published/exported battlemap as the board background
  and have the 5-ft grid line up — image scaled so one printed square equals one
  rule-system square. Footprint-aware snapping (`rules/dnd5e.ts`) keeps working
  because snapping reads mm, not the image.

Both get the same primitive; the difference is only which system's measurement
lens reads over it. Neither is favoured.

## In scope

- Import a JPEG/PNG and place it on the board at a real-world scale.
- Two placement roles (final shape is an architect call — see open questions):
  a full-board **map background** and a **placeable image terrain** with a
  footprint.
- Image render sits under the domain layers and never moves positioning into
  pixels (pillar 1, ADR-0001) — mirrors how `src/render/Board.ts` already draws
  mm and dispatches through `BoardSync`, never mutating state.
- Any new board state (an image reference, its scale, its placement) rides
  `applyAction` as an `Action` (ADR-0002) so it serializes and replays for
  multiplayer.

## Out of scope (defer / not this slice)

- Procedural pixel-art tiles & tileset loader — the *former* Phase 4; now
  displaced later (see roadmap). Nearest-neighbour sprite rendering of
  tokens/terrain is not required to ship image terrain.
- Animated / multi-frame art, lighting, elevation.
- Authoring tools (drawing maps in-app).
- Editing occlusion geometry to be inferred from image pixels (a JPEG has no
  geometry — see open questions).

## Acceptance criteria (user-observable, testable)

1. A user can import a JPEG or PNG and see it on the board.
2. The image is placed at a **stated real-world scale** such that a known
   real-world span on the image measures that span with the active
   `RuleSystem`'s ruler (e.g. a map marked "1 square = 1 inch" reads 6" across
   six squares in 40k; a D&D map's 5-ft squares line up under grid snapping).
3. Rotating/moving the placement updates the render but **no domain type gains a
   pixel field** — the mm-only invariant holds (ADR-0001); a test asserts the
   state stays plain-JSON and pixel-free.
4. The placement round-trips through `applyAction` (serialize → replay →
   identical state), consistent with the deterministic reducer (ADR-0002).
5. If the image is associated with a LoS-blocking footprint, existing LoS/cover
   results over that footprint are **unchanged** vs. the same footprint without
   an image — the image is a skin, not new geometry (verified against current
   `hasLineOfSight` behaviour).

## Pillar & phase fit

Advances **pillar 1 (mm are ground truth)** — the whole point is that art is a
lens and mm stay the source of truth — without diluting **pillar 4 (verified
geometry)**, because image terrain contributes no new occlusion math. Belongs in
the pulled-forward image-terrain phase (see roadmap re-prioritization).

## Open questions for the architect (PM does NOT decide these)

1. **Raster → mm mapping.** How is an image's real-world scale established and
   stored? Candidates: an explicit "N px = M mm" / DPI entry, a calibrate-by-
   dragging-a-known-span gesture, or a per-image mm-per-pixel scalar. Whatever the
   answer, the *stored* value must be mm-anchored, not pixel-anchored (pillar 1).
2. **Map background vs. placeable `TerrainPiece` with a footprint.** Are these one
   concept or two? Is a background a distinct board field, or a `TerrainPiece`
   variant whose `base` is the whole board? Does image terrain reuse `base` /
   `facing` / `pos` from `TerrainPiece` (`terrain.ts:41`), or need a new type?
3. **Does image terrain participate in LoS/cover?** A JPEG has no occlusion
   geometry. Options: (a) image is purely decorative and LoS/cover come only from
   an associated procedural footprint (`losBlocking` / `cover` /
   `terrainVirtualWalls`); (b) an authored footprint is required alongside any
   LoS-relevant image; (c) image terrain is decorative-only and never blocks.
   Pillar 4 forbids inferring occlusion from pixels — so this is about *what
   footprint, if any, backs the image*, not about reading the image.
4. **Asset storage & loading.** Where do image bytes live and how are they
   referenced in serializable state? (URL/path reference vs. embedded data;
   caching; how a peer that lacks the asset renders in multiplayer.) The domain
   must stay plain-JSON and portable (ADR-0002) — so likely a *reference*, not
   bytes, in `BoardState`; the loading contract is the architect's call.
