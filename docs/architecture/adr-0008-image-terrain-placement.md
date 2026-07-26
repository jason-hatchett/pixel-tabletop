# ADR-0008: Image-terrain placement primitive — a mm-anchored, reference-not-bytes image layer

## Status
Proposed

## Context
Players want to drop their own battlemap or terrain art (a flat JPEG/PNG) onto
the board so it *looks like their table*, while mm stay ground truth
([../specs/image-terrain.md](../specs/image-terrain.md)). Terrain today is
procedural — a `TerrainPiece` drawn as vector `Graphics` from a per-system
catalog (`src/domain/terrain.ts:41`) — with no way to show a raster image.

This ADR settles the **placement primitive** only: how a raster image is scaled,
positioned, referenced, and rendered. It is the substrate for
[ADR-0009](adr-0009-image-map-ingestion.md) (deriving geometry from a map image),
which reuses this ADR's calibration and asset-reference model. It resolves the
image-terrain spec's open questions Q1 (raster→mm), Q2 (map background vs.
placeable), and Q4 (asset storage), and must not violate mm-only
([ADR-0001](adr-0001-millimetres-only-domain-unit.md)) or plain-JSON portability
([ADR-0002](adr-0002-deterministic-reducer-multiplayer-seam.md),
[ADR-0007](adr-0007-board-state-persistence.md)).

## Decision

**One primitive, two roles.** A "map background" and a "placeable image terrain"
are the *same* record — an image placed at a mm position with a mm extent. A
background is simply a placement whose extent is the whole board; there is no
separate background field.

**Reference, not bytes.** `BoardState` gains a serializable image-placement
record holding an **opaque `assetRef` string** (an id/URL into an out-of-domain
asset store), never the raster bytes. This keeps `BoardState` plain-JSON and
keeps the persisted envelope small (`src/persist/boardStore.ts`), so the
localStorage quota holds and the multiplayer wire stays lean. How a peer that
lacks the asset fetches or falls back is a loading-contract detail left to the
render/net layers; the domain only carries the reference.

**mm-only placement, mm-anchored scale.** The record stores `pos` (mm), a mm
extent (`widthMm`/`heightMm`), and rotation — no pixel or DPI field ever enters
the domain (ADR-0001). The image's real-world scale is derived at import and
*baked into the mm extent*; the stored value is mm, not pixels. Calibration:
auto-detect the source grid pitch and bind one grid cell to the active
`RuleSystem` cell (`rules/types.ts`), with a manual "drag a known span" gesture
(reusing the existing ruler) as the confirming fallback.

**Rides the reducer.** Placement is mutated only by new `Action`s
(`add`/`update`/`remove` an image placement) through `applyAction`
(`src/domain/state.ts:51`) — nothing bypasses the reducer (ADR-0002), so it
serializes and replays for multiplayer like any other state.

**Render is a skin under the domain.** The image draws *beneath* the mm domain
layers in `src/render/Board.ts`, which already draws in mm and dispatches through
`BoardSync` without mutating state. Positioning never moves into pixels.

**Decorative by default.** An image placement carries **no** occlusion. LoS/cover
come only from real `Wall`/`TerrainPiece` geometry associated with it — hand
authored, or (ADR-0009) extracted from the image at import — **never** inferred
from pixels at runtime (pillar 4). This is the invariant ADR-0009 depends on.

## Consequences
- Ships the near-term "looks like our table" wedge (roadmap Phase 1) for both
  audiences: a 40k battlemat and a D&D published map both sit at true scale under
  one ruler, with mm still ground truth.
- Establishes the asset-reference model and px→mm calibration that ADR-0009
  reuses; the source map image is retained as this skin *beneath* the geometry it
  produces.
- The persisted envelope grows by a small reference record, not megabytes of
  raster — the versioned-envelope/migration seam (ADR-0007) absorbs it as an
  additive field via `normalize()`.
- New render surface (image layer) but **no** new geometry and **no** change to
  LoS/umbra math — pillar 4 untouched.
- Open: the precise asset-store backend (object URL cache vs. IndexedDB vs. server
  blob) and the peer-missing-asset fallback are loading-contract calls for the
  render/net layers, tracked with ADR-0009's open questions.

## Relationships
Depended on by [ADR-0009](adr-0009-image-map-ingestion.md). Extends
[ADR-0001](adr-0001-millimetres-only-domain-unit.md),
[ADR-0002](adr-0002-deterministic-reducer-multiplayer-seam.md), and
[ADR-0007](adr-0007-board-state-persistence.md). Implements
[../specs/image-terrain.md](../specs/image-terrain.md) Q1/Q2/Q4.
