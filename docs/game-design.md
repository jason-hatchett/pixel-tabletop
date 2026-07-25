# Game Design Document — Pixel Tabletop

This is the living design reference. It describes *what the product does and why*
in game terms. Implementation lives in code; this doc explains intent so a new
contributor (human or agent) can make changes that respect the design.

---

## 1. Core model: the physical surface

The board is a rectangle of real tabletop, measured in **millimetres**
(`BoardState.widthMm/heightMm`, default 44"×30" for 40k). Everything placed on
it stores mm positions. Three coordinate lenses exist:

```
screen pixels  ──(camera zoom)──►  world millimetres  ──(rule system)──►  6" / 30 ft / cells
```

- **Pixels** are a camera concern only (`src/render/`). Never in the domain.
- **Millimetres** are the domain's only length unit.
- **Game units** (inches, feet, grid cells) are produced *on demand* by the
  active `RuleSystem`.

## 2. Objects on the table

| Object | Domain type | Key properties | Notes |
|--------|-------------|----------------|-------|
| Token (miniature) | `Token` (`state.ts`) | `pos` (mm), `base` (shape), `facing` (rad), `color`, `ownerId` | Round / oval / rect bases. Facing matters for AoS + oval/rect clearance. |
| Wall | `Wall` (`walls.ts`) | segment endpoints | LoS-blocking barrier. Drawn as a drag. |
| Terrain | `TerrainPiece` (`terrain.ts`) | footprint, `losBlocking`, cover, `difficult` | Ruins, craters, woods, buildings, surfaces. |

**Bases** carry real-world sizes. Warhammer uses GW's actual base sizes
(25–100 mm round, 60×35–120×92 mm oval). D&D uses creature footprints that snap
to the 5-ft grid (Tiny tiles four-to-a-square; even footprints land on a vertex).

## 3. Rule systems (the plugin seam)

A `RuleSystem` (`rules/types.ts`) teaches the engine how *one* game measures and
moves. It answers exactly three questions:

- `snap(pos, base)` — where does a dropped token land? (Gridless → unchanged.)
- `measure(a, b)` — distance between two placed models, in native units,
  edge-to-edge.
- `cover(from, to, walls)` — what cover does the target gain?

### Warhammer 40k / AoS (`rules/warhammer.ts`)
- **Gridless.** Drop anywhere. Ruler reads inches, edge-to-edge.
- Cover: `none` / `benefit-of-cover` / `out-of-LoS`.
- Facing matters (AoS coherency, oval clearance).

### D&D 5E (`rules/dnd5e.ts`)
- **5-ft square grid.** Footprint-aware snapping.
- Cover: corner method → `half` / `three-quarters` / `total`.
- Ruler reads feet by square-count.

**Adding a system** = one new file implementing `RuleSystem` + registration in
`rules/index.ts` + a `rules.test.ts` case. The core does not change.

## 4. Measurement & clearance geometry

Distance is **true convex-polygon clearance** (`geometry.ts`):
- circle–circle: exact/analytic.
- oval / rect / any rotated base: Separating-Axis + closest-feature distance.
- An oval measures shorter along its long axis than its short axis — as on a
  real table.

## 5. Line of sight & shadows

LoS is base-*area* to base-*area* (sampled), not center-to-center — a broadside
oval can see around a thin obstruction its center couldn't. Two shadow builders,
both by **intersection-over-source-vertices with convex clipping**
(Sutherland-Hodgman), never angular/tangent heuristics:

- `umbraQuad(source, a, b)` — one wall **segment**.
- `umbraOfOccluder(source, occluderPolygon)` — a whole convex **terrain block**
  as a single occluder (unioning per-edge shadows leaves a lit gap directly
  behind the block — a documented bug this avoids).

Two terrain LoS rules (`los.ts`):
- **Seeing out** — a unit *wholly within* a feature sees out normally; that
  feature casts no shadow for it.
- **Seeing in** — a feature blocks sight *through* itself but never *to* models
  inside it. You can always see a model within a ruin.

**Every new piece of occlusion math must be checked against a brute-force grid
scan** (`lineOfSightBlocked` from every source vertex) in a test. This is a hard
rule — see design pillar 4.

## 6. Templates (transient analysis overlays)

Blasts (3"/5"), Fireball (20 ft), cones (15/30 ft). Aimed by dragging. Models
under a template are ringed **green (hit)** or **grey (in cover)**; a model
hidden from the template origin by a wall gets **total cover** and is not hit.
The blocked portion of a template is shaded darker (shadow-cast + Pixi mask) so
the bright area is exactly the affected space. Templates are *transient*: picking
a Mode cancels them.

## 7. Cover model

`RuleSystem.cover` + terrain:
- LoS-blocking terrain reuses wall machinery two ways: as four `Wall`-shaped
  **edges** for segment-intersection checks (cover corners, template hits), and
  as one whole convex **occluder polygon** for the drawn shadow.
- Non-blocking-but-cover terrain (craters, rubble) can't be a hard edge, so
  `terrainCoverAt` grants it by contact regardless of angle, shown additively on
  the ruler.

## 8. State & multiplayer seam

`applyAction(state, action)` (`state.ts`) is the single pure reducer. The net
layer (`net/sync.ts`) is a `BoardSync` interface — `LocalSync` today (with undo
via history coalescing), `WebSocketSync` later. An authoritative server validates
intents against the `RuleSystem` and broadcasts sequenced actions; every client
replays the same stream and converges. **No new game feature should bypass
`applyAction`.**

## 9. Open design questions (track, don't silently decide)
- Movement budgets: spent-vs-remaining, difficult terrain cost — how surfaced?
- AoS "wholly within" objective/coherency checks — shared helper or per-system?
- Redo stack to complement undo.
- Fog of war / per-player vision — derived from LoS, but whose viewpoint?
- Pixel-art tileset format & loader.

See [roadmap.md](roadmap.md) for how these are sequenced.
