# ADR-0011: Warhammer terrain-layout import — a separate ingest flow emitting height-carrying TerrainPiece via loadState

## Status
Proposed

## Context
[ADR-0010](adr-0010-image-calibration-by-game-type.md) forked calibration by game
type and built out the **D&D** arm (grid detect → align). Its **40k** arm is a
stub: pick a battlefield-size preset, scale the raster, drop it as a decorative
[ADR-0008](adr-0008-image-terrain-placement.md) image. That is not an *import* of
a Warhammer terrain layout — it captures no terrain, no cover, and no height.

The reference material (`test-fixtures/Warhammer Maps/wh_terrain_layout_rules.pdf`,
the official GW **Terrain Layouts** doc) shows what a real WH layout is:

- Eight matched-play layouts built from **three fixed area-terrain footprint
  sizes** — `6"×4"`, `10"×5"`, `12"×6"` — placed (often **rotated at arbitrary
  angles**) on a gridless battlefield, dimensioned by **red placement arrows**
  (edge-to-piece offsets, piece-to-piece gaps) relative to the board edge and the
  dashed centre-cross.
- A **height convention that is discrete and already colour-coded**: a two-value
  key — **grey diagonal hatch = "more than 4""**, **teal dot fill = "2" or less"**
  — driving Plunging Fire and true line-of-sight. Some single outlines are split
  (dashed divider) into a tall half and a low half.

Forcing this through the D&D pipeline fails on every stage:
[`mapAnalyzer.ts`](../../src/ingest/mapAnalyzer.ts) masks floor-vs-background and
traces wall loops (the opposite image class — a photographed battlemat with colour
swatches would yield garbage); [`gridDetect.ts`](../../src/ingest/gridDetect.ts)
and `alignEdgeToGrid` snap an image grid to the **board grid**, but WH is gridless
(`rules().grid === null`), so there is nothing to align to; and the D&D output is
`Wall` segments, whereas a WH layout is **area terrain with cover/LoS/height**,
i.e. `TerrainPiece`. There is also **no height field anywhere in the domain**
today ([`terrain.ts`](../../src/domain/terrain.ts) `TerrainPiece`), so height
cannot be captured without a schema change.

## Decision

**Build the 40k arm of ADR-0010 into a dedicated terrain-layout import flow that
emits `TerrainPiece[]` (carrying height), not walls, committed via the ADR-0009
`loadState` seam.** WH and D&D share only the game-agnostic ingest primitives.

### 1. Height is a first-class domain property, in millimetres
Add `heightMm: number` to `TerrainPiece` and `TerrainOption`
([`terrain.ts`](../../src/domain/terrain.ts)); `0` = flush/ground. Per
[ADR-0001](adr-0001-millimetres-only-domain-unit.md) this stores **real mm**, not
a `"tall" | "low"` enum — the two GW buckets are a *presentation derivation*
(`>4"` and `≤2"`), and mm keeps the door open for continuous height and Plunging
Fire without another schema change. `normalize()`
([`boardStore.ts`](../../src/persist/boardStore.ts)) back-fills `heightMm` on old
snapshots — additive, non-breaking, riding the
[ADR-0007](adr-0007-board-state-persistence.md) seam. Height is **captured and
visualized now; it does not feed geometry yet** — true-height LoS / Plunging Fire
is a future rules concern and out of scope here.

**Split-height outlines** — a single physical footprint shaded half tall (grey) /
half low (blue) — are modelled as **two adjacent `TerrainPiece`s** (decision "A"),
not a per-piece height gradient: it keeps `heightMm` scalar and needs no domain
change. Because segmentation is colour-first, the flow *already* emits the grey
and blue halves as separate pieces; the open gap is **sizing** them — each half is
a sub-rectangle (e.g. a split 12×6 → two 12×3 halves), which is not a catalog
size, so catalog-snapping mis-sizes them. Correcting split halves (and any
off-catalog / merged detection) is deferred to a planned **interactive footprint
editor** in the review gate: select / move / delete pieces, resize to custom
dimensions in 0.5" steps, and draw new footprints over the image. Until then,
split halves import at an approximate snapped size and are hand-adjusted.

### 2. Height → colour is a legend baked at import
The GW key is reproduced by a pure `heightColor(heightMm) → { fill, pattern }`
(grey + hatch for tall, teal + dots for low, a mid band between). Because
[`Board.drawTerrainPiece`](../../src/render/Board.ts) already draws from the
piece's `fill`/`pattern` fields, the importer **bakes the legend colour/pattern
into those fields** — the renderer needs **zero change** and colour is portable in
`BoardState`. A small grey/teal legend makes the mapping discoverable (UX-only).

### 3. A separate ingest flow, reusing only game-agnostic primitives
Keep ADR-0010's "ask game type first" fork; the 40k branch now leads into:

- **Scale by preset, not detection.** `mmPerPx = battlefieldWidthMm / imgWidthPx`
  from the chosen `BATTLEFIELD_SIZES` preset (ADR-0010). The printed inch arrows
  are **not** OCR'd — they are placement dimensions, not a scale bar, and the
  player already knows the table size.
- **Auto-detect the terrain, discard the image.** A new pure
  [`terrainLayoutAnalyzer.ts`](../../src/ingest/terrainLayoutAnalyzer.ts)
  (mirroring `mapAnalyzer.ts`'s DOM-free contract) reads the layout image and
  emits `TerrainPiece`s: detect the board rectangle (bbox of battlemat ∪ fills)
  for scale/origin, segment the two GW fill classes (grey-hatch ⇒ tall,
  teal-dot ⇒ low), morphologically close/open to erase the grid, red dimension
  arrows and eye badges, label connected components, and fit an oriented box per
  blob by **PCA** (centre, size, rotation). The imported raster is **not** kept —
  the detected terrain replaces it; the fresh board is sized to the chosen
  battlefield and holds only the pieces.
- **Footprint sizes snap to the official catalog, per edition.** Layouts are built
  from a fixed set of area-terrain outline sizes that differ by edition
  (`AREA_TERRAIN_FOOTPRINTS_MM`, keyed `10e` = 6×4/10×5/12×6, `11e` =
  11.5×8/11.5×7/10×2.5/6×4/6×2 — the shared source of truth). The user **picks the
  edition at import** (a modal before battlefield size), and each detected box
  snaps to the nearest size in that edition's roster rather than its raw measured
  pixels. This removes measurement noise and edge/outline-inset bias (teal low
  fills read a touch small), and guarantees import never invents an off-catalog
  size. Snapping to the wrong edition visibly misfits the boxes — which is why the
  edition is an explicit choice, not a guess. Height (tall/low) is still read
  independently from the fill colour. Adding an edition is one entry in that map.
- **Sub-size blobs are dropped.** With a minimum footprint below the smallest real
  outline but above map icons (eye/plunging-fire badges ≈ 5 in²), the icons are
  discarded instead of being snapped up into phantom terrain.
- **A blob that doesn't fill its oriented box** (pixels ÷ box area below a
  threshold) is two touching pieces or an L-shape, not one rectangle — it is
  **flagged**, drawn red, and left out unless the user opts in, rather than
  placed as a wrong giant rectangle.
- **Facing is snapped to the nearest 45°.** Official layouts only place terrain
  straight or skewed, so PCA angle noise (e.g. 86°, 5°) is rounded to
  0/±45/90° — every piece lands square to the board or on a clean diagonal.
  Configurable (`snapAngleStepDeg`, 0 disables).
- **Overlaps are relaxed to clean contact.** Small detection overlaps are pushed
  apart by their Separating-Axis minimum-translation vector, split between the
  pair and iterated until nothing penetrates (`resolveOverlaps` /
  `separateOverlaps`, on by default). Because facings are already 45°-snapped, the
  push axis is axis-aligned or diagonal, so pieces settle **edge-to-edge or
  corner-to-corner** rather than slightly overlapping — matching how terrain is
  physically laid. Runs on the clean rectangles; flagged blobs are left in place.
- **Never auto-commit CV.** Detected pieces render coloured by height over the
  source image in a review gate
  ([`terrainLayoutConfirm.ts`](../../src/ui/terrainLayoutConfirm.ts), cloned from
  `wallsConfirm.ts`); the user checks the fit and chooses whether to include the
  flagged blobs before the single `loadState` commit. Post-commit the pieces are
  ordinary editable terrain — pillar 4 and ADR-0009's discipline (CV is an
  import-time authoring aid, never trusted geometry).

The `WARHAMMER_TERRAIN` catalog is still extended with the official area-terrain
outlines (`AREA_TERRAIN_FOOTPRINTS_MM`, with `heightMm`) so the same height-coded
pieces can be placed or corrected by hand after import.

### 4. Placement model changes are minimal
Rotated, unsnapped placement **already works** — `TerrainPiece.facing` and
`basePolygon`/`terrainVirtualWalls` honour arbitrary angles, and `warhammer.snap`
is identity, so angled WH pieces are already representable and LoS-correct. The
only additions are the `heightMm` field and the catalog outlines;
`getTerrainOptions` already routes by system. LoS/cover set the existing
`losBlocking`/`cover`/`difficult` fields from piece type. The eye / crossed-eye
"area terrain section" LoS-grouping semantic has no domain surface and is
**deferred**.

**mm-only boundary (pillar 1).** All pixel math stops at the ingest boundary; only
mm (`widthMm`, `heightMm`, `pos`, terrain `heightMm`) enters `BoardState`.

## Consequences
- Warhammer gets a real import — terrain, cover, LoS, and height — instead of a
  decorative backdrop; the domain gains a height property usable by future rules.
- One schema change (`heightMm`) with a `normalize()` back-fill; everything else is
  additive wiring. No breaking change to saved boards.
- Detection is confined to `src/ingest/` (pure, PCA/morphology, unit-tested),
  gated behind a preview, and tuned for the **clean official-layout image class**
  (flat colour fills). Validated against a rendered layout page: pieces recovered
  as **exact catalog sizes** at clean 0/45/90° angles with the correct height
  class, positioned to the board border, icons dropped, ambiguous touching pieces
  flagged rather than mis-placed.
- The fill-ratio flag turns the hardest case (two touching rotated pieces) into a
  visible, user-resolvable decision instead of a silent wrong rectangle.
- **Split footprints** (one outline shaded half tall / half low) are detected and
  emitted as two correctly-sized adjacent halves of the whole (a grey + blue pair
  that snaps as one catalog rectangle but not as two); facing snaps to a **15°**
  grid so intended rotations survive.
- **Internal ruins walls** (the "recommended ruins placement" L-mark) are
  *contained* — folded into the grey footprint by a morphological close so the
  outline reads as a solid rectangle, not one notched by its own walls. The walls
  are cleanly detectable by colour (light-grey inside the outline); **capturing
  them as true LoS blockers is deferred** (roadmap).
- Deferred: height feeding geometry (Plunging Fire / true-height LoS, a future
  ADR); per-piece sub-zones (split height uses two pieces instead); the
  single-vs-separate "area terrain section" LoS grouping; **capturing the internal
  ruins walls as LoS blockers**; robust detection on **photographed** real tables
  (lighting/perspective); per-piece in-gate editing beyond include/exclude.

## Relationships
Builds out the 40k arm of
[ADR-0010](adr-0010-image-calibration-by-game-type.md) and reuses the
ingest/review-gate/`loadState` pattern of
[ADR-0009](adr-0009-image-map-ingestion.md) over the
[ADR-0008](adr-0008-image-terrain-placement.md) image layer. Honours
[ADR-0001](adr-0001-millimetres-only-domain-unit.md) (height in mm),
[ADR-0003](adr-0003-rule-systems-as-plugins.md) (WH-specific vocabulary stays in
the rules plugin), [ADR-0004](adr-0004-occlusion-by-intersection-over-source-vertices.md)
/ pillar 4 (CV verified via preview, never asserted), and
[ADR-0007](adr-0007-board-state-persistence.md) (additive field back-fill).
