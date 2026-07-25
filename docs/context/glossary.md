# Domain glossary

One line each, grounded in `src/domain/`.

- **mm (ground truth)** — millimetres of real tabletop are the domain's only
  length unit; pixels are camera/zoom, inches/feet/cells are a rule-system view.
- **Base** — a model's physical footprint (`BaseShape` in `geometry.ts`):
  `circle` / `oval` / `rect`, half-extents in mm, local frame rotated by `facing`.
- **Token** — a placed miniature (`state.ts`): `pos` (mm center), `base`,
  `facing` (rad), `color`, `ownerId`.
- **Wall** — a LoS-blocking segment (`walls.ts`): endpoints `a`/`b`, flags
  `blocksLoS` / `blocksMove`. Drawn as a drag.
- **Terrain** — a placed feature (`TerrainPiece`, `terrain.ts`): footprint,
  `losBlocking`, cover, `difficult` (ruins, craters, woods, buildings, surfaces).
- **RuleSystem** — a per-game plugin (`rules/types.ts`) answering exactly
  `snap` / `measure` / `cover`; adding a game is adding a file, not core edits.
- **snap** — `RuleSystem.snap(pos, base)`: where a dropped token lands
  (gridless → unchanged; D&D → footprint-aware grid snap).
- **measure** — `RuleSystem.measure(a, b)`: edge-to-edge distance in native
  units (40k inches; D&D feet by square-count).
- **cover** — `RuleSystem.cover(from, to, walls)`: cover the target gains
  (40k none/benefit/out-of-LoS; D&D corner method half/¾/total).
- **clearance / edge-to-edge** — true base-to-base distance (`edgeToEdge`,
  `geometry.ts`): circle–circle is analytic; else convex-polygon clearance.
- **SAT** — Separating-Axis test (`hasSeparatingAxis`/`convexIntersect`,
  `geometry.ts`) for overlap; disjoint clearance is vertex-to-edge distance.
- **umbraQuad** — `umbraQuad(source, a, b)`: shadow of one wall **segment** from
  an area source, as the intersection over source vertices of each vertex's quad.
- **umbraOfOccluder** — `umbraOfOccluder(source, occluder)`: shadow of a whole
  convex **terrain block** as one occluder — never edge-by-edge (that leaves a
  lit gap directly behind the block).
- **LoS "seeing in / seeing out"** — `los.ts`: a model wholly within a feature
  sees *out* normally (feature casts no shadow for it); a feature blocks sight
  *through* itself but never *to* a model *inside* it.
- **Template** — transient analysis overlay (blast/fireball/cone); models under
  it are ringed hit/covered; blocked space is shaded via shadow-casting + mask.
- **BoardSync / applyAction** — `applyAction(state, action)` (`state.ts`) is the
  pure, deterministic reducer; `BoardSync` (`net/sync.ts`) is the multiplayer
  seam (`LocalSync` today). All mutations route through `applyAction`.
