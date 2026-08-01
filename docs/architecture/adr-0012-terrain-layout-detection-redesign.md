# ADR-0012: Terrain-layout detection — outline-box detection, best-effort across arbitrary images, human editor as finisher

## Status
Accepted — implemented in `src/ingest/terrainLayoutAnalyzer.ts` (outline-box pipeline)
and `src/ui/terrainLayoutConfirm.ts` (review-gate detection controls). Two
deviations from the draft, both validated live: split auto-decomposition ships
**off** by default (it mis-fires on adjacent grey/blue pieces, producing misaligned
stacked halves; a split reads as one piece and the editor splits it), and the
per-image threshold is exposed as a two-mode control — adaptive (auto, the default)
tuned by a sensitivity slider, or a fixed brightness cutoff — rather than
adaptive-only, since neither algorithm dominates across fixtures.

## Context
[ADR-0011](adr-0011-warhammer-terrain-layout-import.md) established the import
*flow* (a separate ingest path emitting height-carrying `TerrainPiece`s via
`loadState`) and a first detection implementation in
[`terrainLayoutAnalyzer.ts`](../../src/ingest/terrainLayoutAnalyzer.ts): segment
two **colour-fill** classes (grey hatch = tall, blue dots = low), morphologically
close them into blobs, fit a PCA oriented box per blob, snap to the catalog.

Validating that implementation against **real** images — not the pristine GW pack
it was tuned on — broke the assumptions. Two fixtures that a user would plausibly
import (`test-fixtures/Warhammer Maps/comp_terrain.webp`, a community composite;
`wh_terrain_1.png`, a lower-contrast render) have **wildly different visual
conventions**: overlaid grids, green/red deployment-zone tints, objective-marker
circles, hatch vs dots, dark-navy internal ruins walls, and outlines that range
from crisp black to faint dark-grey. The fill-based analyzer with fixed thresholds
detected ~10/12 on one and ~4/12 on the other, and its tuning did not transfer.

The operating target is now explicit: **the importer must accept arbitrary
community images, so detection is permanently best-effort** and a human confirms/
corrects in the review gate (pillar 4). The question this ADR answers: *what
detection approach is robust enough to be worth shipping as the seed?*

This decision is grounded in an extensive live investigation (recorded per-finding
in the team memory) using a purpose-built interactive tuner (now committed as
[`tools/terrain-threshold-tuner.html`](../../tools/terrain-threshold-tuner.html)).

## Decision

### 1. Detect footprints from the **dark outline**, not the colour fill
Every area-terrain piece is drawn as a **dark rectangle outline**. The outline is
a far more stable signal across renders than the fill, and it dissolves the
problems that sank the fill approach at once:
- **Grid** — a decorative grid is dark-*grey* (~85 luma); the outline threshold
  (`isDark`, luma < ~75) excludes it. No grid removal needed.
- **Splits** — a grey/blue "split" piece is **one** outline (the internal
  grey↔blue boundary has no dark line), so it detects as one footprint; height is
  read afterwards.
- **Internal ruins walls** — live *inside* the outline; they never spawn a piece.
- **Tint** — the outline is neutral dark ink, so hue-tinted zones don't confuse it.

Height (tall / low / split) is classified **after**, by sampling the grey/blue
fill *inside* each detected box.

### 2. Structural robustness fixes (universal — bake in as-is)
Each was validated to help on real images and not regress the others:
- **Exclude blue-hued fill from the outline mask** — blue is terrain *fill*, not
  ink; at loose thresholds it otherwise pollutes rectangles.
- **Strip the frame *border band*, not the frame component** — take scale from the
  board's **bounding box** (a distorted PCA over-measures), and zero only a thin
  band at the board edge. A piece touching the frame survives as a 3-sided outline
  instead of being fused into the discarded frame. (Recovered both edge pieces on
  `wh_terrain_1`; corrected a 20% scale error.)
- **Accept *partial* rectangles by perimeter coverage** — a rectangle is
  over-determined; a ~3-sided outline (≈75% of its perimeter backed by ink) yields
  the full inferred rectangle. Bridge small gaps first (morphological close).
- **Centre boxes on the extent *midpoint*, not the pixel centroid** — a partial
  outline pulls the centroid off-centre, mis-placing an otherwise-correct box.
- **Robust circular-marker removal** — remove any marker-sized round shape
  (a bright centre **enclosed by a dark ring**, or a dark ring of marker size),
  not just white skulls, so a light background doesn't read as thousands of
  "markers" and a marker overlapping a piece can't corrupt its outline.

### 3. The brightness threshold is the one **per-image** knob → make it adaptive
With the structural fixes in place, a **single configuration** works across both
fixtures; only the outline brightness cutoff varied (comp ≈ 75, wh1 ≈ 100). The
source must therefore **auto-threshold per image** (Otsu / adaptive), and/or expose
the cutoff as a slider in the review gate, rather than hard-code a constant.

### 4. Detection is best-effort; the **footprint editor is the guaranteed finisher**
No threshold set generalises to *every* community image. The ADR-0011 footprint
editor — select / move / resize (0.5" increments) / draw pieces over the image,
snap edge-to-edge — is the path that is correct for any image. "Detection gets
most, the human places the rest in seconds" is the shipped workflow, and it makes
the editor the priority, with detection as a strong seed.

## What we ruled out (so we don't repeat it)
- **Fixed colour-fill thresholds** — overfit; do not transfer between renders.
- **Intensity thresholding to beat the grid** (global, Otsu, or adaptive
  local-contrast) — *cannot* separate a faint outline from an overlaid grid: near
  the centre the grid is as dark/contrasty as the faint outlines. The separating
  signal is **structure** (a closed piece-sized rectangle vs a board-spanning
  periodic line), not intensity.
- **Structural periodic grid removal** (refined per-line subtraction) — traces the
  grid accurately but *worsens* detection: gridlines cross piece outlines, so
  subtracting the grid punches gaps in the outlines and fragments them.

## Future (not required to ship the above)
- **Catalog-constrained Hough partial-rectangle fitting** — detect line *segments*
  (gap-tolerant), assemble rectangles from 2–3 sides, and fit to the known finite
  catalog `{size, position, rotation}`. The strongest form of "infer the shape from
  partial evidence"; the durable core when morphology-coverage is not enough
  (fragmented outlines that morphology can't bridge without merging neighbours).

## Validation
Full pipeline (all §2 fixes + partial-rectangle coverage + extent-centred boxes),
same structural settings, brightness the only per-image change:

| Fixture | Pieces detected | Placement |
|---|---|---|
| `comp_terrain.webp` (bright < 75) | **12 / 12** | correct |
| `wh_terrain_1.png` (bright < 100) | **10 / ~10–12** | correct (both edge blue pieces recovered) |

## Consequences
- The current `terrainLayoutAnalyzer.ts` (fill-based) will be **rewritten** to the
  outline-box pipeline. This is a substantial change to a pure, well-tested module;
  it keeps the ADR-0011 flow, `DetectedTerrain` shape, catalog snapping, split
  decomposition, and review gate.
- Detection quality is explicitly *best-effort*; correctness is guaranteed by the
  editor, consistent with pillar 4 (import output is an authoring seed, never
  trusted geometry).
- The tuner (`tools/terrain-threshold-tuner.html`) is retained as the calibration
  instrument for future image styles.
