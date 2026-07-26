# ADR-0010: Image calibration by game type — grid detection for D&D, battlefield-size presets for 40k

## Status
Proposed

## Context
[ADR-0008](adr-0008-image-terrain-placement.md) shipped image placement and
decided calibration "in principle" (auto-detect the source grid pitch, bound to
the active `RuleSystem` cell, with a manual known-span fallback). Building it out
surfaced that the two games calibrate differently and that a single flow serves
neither well:

- **D&D 5E** maps are drawn on a square grid, so the grid *is* the scale
  reference and, more importantly, the thing to **align to** — a battlemap is
  only useful if its squares line up with the board grid so snap-to-place lands a
  token in an image square.
- **Warhammer 40k/AoS** is gridless (`rules().grid === null`); there is nothing
  to detect or align to. But 40k battlefields come in a few **standard physical
  sizes**, which the player knows up front — a far more reliable scale source than
  hunting for an indicator on the image.

So calibration must branch on game type. This ADR records that decision and the
grid-detection approach, extending ADR-0008's deferred calibration question. It
must respect pillar 4 (geometry verified, never asserted;
[ADR-0004](adr-0004-occlusion-by-intersection-over-source-vertices.md)) even
though grid detection is heuristic CV.

## Decision

**Ask game type first, then calibrate per game.** Import prompts D&D vs 40k, then:

- **D&D — detect, infer, align.** A pure detector in `src/ingest/gridDetect.ts`
  (`decodeImageData` → gradient-energy peak spacing) returns `{ pxPerCell,
  offsetX, offsetY }`. Scale: one image cell = one board cell (`cellMm`), so
  `mmPerPx = cellMm / pxPerCell`. Alignment: `alignEdgeToGrid`
  (`src/ingest/calibrate.ts`) nudges the placement so a detected gridline lands
  on the board grid (anchored at 0, pitch `cellMm`). Manual known-width is the
  fallback when detection fails or is rejected.
- **40k — battlefield-size preset.** No detection. The player picks a standard
  size — Incursion 44×30, Strike Force 60×44, Onslaught 90×44 (inches) — and the
  image is scaled to that physical rectangle.

**Detection is heuristic and confined to `src/ingest/` (pillar 4).** It emits mm
scale + placement only — no occlusion, no new domain type. Consistent with
[ADR-0009](adr-0009-image-map-ingestion.md): CV is an import-time authoring aid,
never a runtime geometry source. The detected result is **shown to the user to
confirm/adjust before it is trusted** (no silent auto-commit).

**mm-only (pillar 1).** All pixel math stops at the ingest boundary; only mm
(`widthMm`, `heightMm`, `pos`) enters `BoardState` via the ADR-0008 `addImage`
action.

## Consequences
- Each game gets a calibration path matched to how it actually thinks about
  scale; neither is bent to the other's model.
- The grid detector is pure and unit-tested against synthetic grids; it is the
  first shared CV building block and prefigures ADR-0009's map ingestion.
- 40k's presets are a fixed list; non-standard tables still use the manual
  known-width path (D&D's fallback is the general escape hatch).
- Deferred: a *visual* grid-overlay preview (the confirm step is currently a
  text summary — detected square size + cell count — with accept/adjust);
  auto-resizing the board to match a chosen battlefield size (needs a board-size
  action); rotation/skew correction for photographed maps.

## Relationships
Extends [ADR-0008](adr-0008-image-terrain-placement.md) (resolves its calibration
open question) and shares the ingest/CV boundary with
[ADR-0009](adr-0009-image-map-ingestion.md). Honours
[ADR-0001](adr-0001-millimetres-only-domain-unit.md) and
[ADR-0004](adr-0004-occlusion-by-intersection-over-source-vertices.md).
