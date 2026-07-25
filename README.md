# Pixel Tabletop

A digital pixel-art tabletop with **exact unit positioning**, designed to serve
both **Warhammer 40k / Age of Sigmar** (gridless, edge-to-edge inches) and
**D&D 5E** (5-ft square grid) from one engine.

## The core idea

The domain stores everything in **millimetres of real tabletop surface** — never
pixels, never grid squares. Pixels are a camera/zoom concern; grids and
inches/feet are a *rule-system interpretation* of physical distance. That one
decision is what lets a single engine serve both games.

```
screen pixels  <--(camera zoom)-->  world millimetres  <--(rule system)-->  6" / 30 ft
```

## Architecture

| Layer | Location | Depends on | Notes |
|-------|----------|-----------|-------|
| Domain core | `src/domain/` | nothing | Pure, serializable, deterministic. Unit-tested. |
| Rule systems | `src/domain/rules/` | domain core | One plugin per game. Add a game = add a file. |
| Net / sync | `src/net/` | domain core | Actions in, state out. `LocalSync` today, `WebSocketSync` later. |
| Render | `src/render/` | domain + net | PixiJS. Draws in mm; never mutates state directly. |

**Why it's built this way:** `applyAction` (in `src/domain/state.ts`) is a pure,
deterministic reducer over a serializable state. That is exactly what an
authoritative multiplayer server needs — every client replaying the same accepted
action stream converges to identical state. So multiplayer is a new `BoardSync`
implementation, not a rewrite.

## Run it

Requires **Node.js 22+** (pinned in `.nvmrc`; `engines` blocks older). With nvm:
`nvm use` (or `nvm install 22`). See [docs/context/dev-environment.md](docs/context/dev-environment.md).

```bash
nvm use           # → Node 22 (from .nvmrc)
npm install
npm run dev       # http://localhost:5173
npm test          # domain unit tests (vitest)
npm run typecheck # tsc --noEmit
```

## What works now (scaffold)

- **Toolbar** organised into three sections that wrap as whole units:
  1. **Setup** — System (rule set) and Mode (*Move objects* vs *Place objects*).
  2. **Objects** — in Place mode, a Type picker (Token / Terrain / Wall) plus an
     Item dropdown; in Move mode, a one-line interaction hint. "Objects" covers
     tokens, terrain, and walls under one Place flow.
  3. **View & tools** — Grid visibility, Grid snap, Measure, Template. Measure
     and Template are transient *analysis overlays* that momentarily override the
     Mode's pointer behaviour; picking a Mode cancels them. Active toggles are
     highlighted. All board state is derived in one `apply()` in `main.ts` from
     just {Mode, object Type, analysis overlay}.
- Pan (drag empty table), zoom (scroll, cursor-anchored), pixel-crisp canvas.
  The grid re-strokes on zoom with a width of `1 / world.scale` so its lines stay
  a constant ~1px on screen instead of going sub-pixel and shimmering when zoomed
  out (they live in the camera-scaled `world` container).
- Draggable tokens with round, **oval**, and **rect** bases — rendered with rotation (facing).
- **True convex-polygon clearance** for edge-to-edge measurement (geometry.ts):
  circle-circle is exact/analytic; oval, rect, and any rotated base fall back to
  Separating-Axis + closest-feature distance. An oval measures shorter along its
  long axis than its short axis — exactly as on a real table.
- **Selection + rotation**: click a token to select it (ring + handle appear);
  drag the handle to rotate freely (hold Shift to snap to 15°), or press `[` / `]`
  for 15° nudges. `Delete` removes, `Esc` deselects. Rotating an oval/rect changes
  its edge-to-edge clearance in real time.
- **Walls** (persistent board state): draw LoS-blocking barriers with the Wall
  tool (drag a segment). With **Grid snap** on, endpoints snap to grid vertices
  whenever a grid is active (D&D). Click a wall (outside Wall mode) to select it,
  then **Delete** to remove it. **Ctrl+Z** undoes any change (a drag counts as one
  step, via history coalescing in `LocalSync`).
- **Measurement templates** (transient, like the ruler): Blast 3"/5", Fireball
  (20 ft), and 15/30 ft cones. Aim a cone by dragging. Models under a template are
  ringed **green (hit)** or **grey (in cover)** — a model in the area but hidden
  from the template's origin by a wall is shielded (total cover) and not hit.
- **Blocked-space shading**: the parts of a blast/cone a wall hides from the
  origin are drawn darker, so the bright red area is exactly the space actually
  affected. Implemented by shadow-casting (`shadowQuad`) clipped to the template
  area with a Pixi mask.
- **Line of sight** (Warhammer): select a unit to see what it can see out to 80"
  and how many other units it has LoS to — a live **`N/M units visible`** readout
  with every other unit ringed green (visible) or grey (blocked), like the blast
  template's hit count. LoS respects two terrain rules (`src/domain/los.ts`):
  - **Seeing out** — a unit *wholly within* a feature's footprint sees out of it
    normally, so that feature casts no shadow for it and doesn't block its LoS.
  - **Seeing in** — a feature blocks sight *through* itself but not *to* models
    inside it; you can always see a model within a ruin. (The LoS overlay renders
    *under* the terrain layer, so a feature's footprint is never darkened.)
  The visibility count uses true (base-to-base, sampled) LoS; a wide oval can see
  a target past a thin ruin its center couldn't. The lit circle is darkened
  wherever an obstruction casts a shadow — the bright area is the unit's true
  LoS. Unlike templates (a genuine point origin), a
  unit's base is an *area*, so its shadow is the region hidden from **every**
  point of the base, not just its center — a broadside oval can see a bit around
  an obstruction a point at its center couldn't. Two shadow builders, both
  computed by intersection-over-source-vertices with generic convex-polygon
  clipping (Sutherland-Hodgman), never angular heuristics:
  - `umbraQuad(source, a, b)` for a single wall **segment** — intersection over
    source vertices of each vertex's `shadowQuad` of the segment.
  - `umbraOfOccluder(source, occluderPolygon)` for a whole convex **block**
    (terrain) — intersection over source vertices of each vertex's point-shadow
    of the *entire* block (via its silhouette from that vertex). A block must be
    shadowed as one occluder, **not** edge-by-edge: the union of per-edge umbrae
    leaves a lit gap directly behind the block (a point can be hidden from the
    source's left half by one edge and its right half by another — hidden from
    everyone, but by no single edge alone). Verified against a ground-truth grid
    scan (`lineOfSightBlocked` from every source vertex) in the tests. (History:
    an early version used an analytic tangent-pick heuristic — wrong for
    asymmetric configs; then per-edge `umbraQuad` + front-face culling — which
    left the gap this replaces.)
- **Cover** (`RuleSystem.cover`, shown on the ruler when walls are in play):
  D&D 5E uses the corner method (half / three-quarters / total); Warhammer uses
  none / benefit-of-cover / out-of-LoS.
- **Place** tool + a **system-specific base catalog**:
  - **Warhammer** — real GW sizes (25–100 mm round, 60×35–120×92 mm oval).
  - **D&D 5E** — creature sizes that snap by footprint: Small/Medium (5 ft) fill
    a cell, odd footprints center on a cell, even footprints (Large/Gargantuan)
    land on a grid vertex, and **Tiny** (2.5 ft) tiles into quarter-square slots
    so up to four share one 5-ft square.
- **Grid snap** toggle (default on) governs both wall drawing and token drops.
  Drop/drag a token with it **off** and the token stays exactly where you
  release it, in every system. With it **on** in D&D, `RuleSystem.snap` rounds
  the drop to the grid by footprint — fixed a bug where non-grid-sized bases
  (e.g. a 32mm Warhammer round, 0.64 of a cell) fell into the Tiny sub-cell
  tiling branch and appeared to jump to a quarter-square offset; the threshold
  for that branch is now exactly ≤½ cell, matching Tiny's real 2.5 ft footprint.
- Switch rule system in the toolbar:
  - **Warhammer** — gridless; drop anywhere; ruler reads inches, edge-to-edge.
  - **D&D 5E** — 5-ft grid overlay; footprint-aware snapping; ruler reads feet by square-count.
- **Measure** tool: click-drag to measure; endpoints snap to token bases so you
  get true base-to-base distance in the active system's units.
- **Terrain** (`src/domain/terrain.ts`), placed with the Terrain tool from a
  system-specific catalog, click-to-select, drag to move, rotate/delete exactly
  like a token:
  - **Warhammer** — Ruins, Craters, Rubble, and Dense Terrain (a copse/woods),
    two preset sizes each.
  - **D&D 5E** — Buildings and Dense Foliage (LoS-blocking), Rubble
    (non-blocking, difficult), plus descriptive ground **surfaces** (Earth,
    Stone, Building Interior) that carry no mechanical effect — just labels a
    zone's terrain type.
  - Terrain doesn't get its own LoS/cover engine. LoS-blocking terrain
    (`losBlocking: "blocks"`) reuses the wall machinery, but represented **two
    different ways** depending on what's being computed:
    - As `Wall`-shaped **edges** (`terrainVirtualWalls`, all four) for
      orientation-agnostic segment-intersection checks — cover's corner count,
      template hit/covered resolution. A sightline crossing any edge of a solid
      block really is blocked, regardless of which side that edge is on.
    - As one whole convex **occluder polygon** for constructing the *drawn*
      shadow (`umbraOfOccluder`; template shading, a unit's LoS). A block must
      **not** be shadowed edge-by-edge: unioning per-edge shadows leaves a lit
      gap directly behind the block, and per-edge front-face culling drops the
      side edges a wide source sees through. Handing the whole silhouette to
      `umbraOfOccluder` (see the Line of sight section above) fixes both.
    - Non-blocking terrain that still grants cover (Craters, Rubble) can't be
      modelled as a hard edge, so `terrainCoverAt` grants it separately:
      standing on/touching the feature grants its cover level regardless of
      the attacker's angle — shown on the ruler alongside (and in addition to)
      wall-based cover, e.g. `26.5" · Out of line of sight · Light cover
      (Rubble (Large))`.

## Next steps (suggested order)

1. **Template polish** — a "line" template, snap blast center to a target, the AoS "wholly within" check, and a redo stack to complement undo.
2. **Movement + walls/terrain** — respect `blocksMove`/terrain's `difficult` flag when dragging/snapping; movement-budget validation (spent vs remaining).
3. **Unit coherency** (40k).
4. **Pixel-art tiles & sprites** — swap vector Graphics for nearest-neighbour textures; add a map/tileset loader.
5. **Multiplayer** — implement `WebSocketSync`; stand up an authoritative server that validates intents against the rule system and broadcasts sequenced actions.
6. **Fog of war / vision**, initiative tracker, dice.

## Key files to read first

- `src/domain/units.ts` — why everything is millimetres.
- `src/domain/rules/types.ts` — the plugin contract that makes cross-system support possible.
- `src/domain/state.ts` — the deterministic reducer (the multiplayer foundation).
- `src/render/Board.ts` — camera, input, drawing.
