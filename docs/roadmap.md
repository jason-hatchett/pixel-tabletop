# Roadmap — Pixel Tabletop

Where we're going and in what order. This turns the README "Next steps" into
phased work with a goal, concrete deliverables, a definition of done, and
dependencies. It is grounded in the current code — path references point at what
exists today.

See also: [vision.md](vision.md) (why this exists, the pillars) ·
[game-design.md](game-design.md) (what it does in game terms) ·
[architecture/adr-index.md](architecture/adr-index.md) (decisions already made).

## How we decide what's next

1. **Pillars first, features second.** A candidate must advance a design pillar
   (see the mapping table below). We don't add breadth that dilutes the moat
   (mm-honesty, determinism, verified geometry).
2. **Depth before breadth per game.** Get 40k and D&D each *correct* on a
   mechanic before adding a third game. Adding a game is cheap by design
   (ADR-0003); adding a *shipped-quality* mechanic is not.
3. **Nothing bypasses the reducer.** Any feature that touches board state ships
   as an `Action` through `applyAction` (ADR-0002). If it can't, that's a design
   smell to resolve before building.
4. **Geometry ships with a brute-force test** (ADR-0004, pillar 4). No occlusion
   or clearance math lands without a ground-truth scan agreeing.
5. **Multiplayer-readiness is a running constraint, not a phase gate.** Because
   state stays serializable and deterministic from Phase 0, Phase 7
   (multiplayer) stays a *new `BoardSync`*, not a rewrite — so we don't defer
   discipline to "later." Persistence (Phase 2) is the client-side proof of this:
   the saved envelope is exactly what the server will hydrate a room from.
6. **Sequence by dependency, then by user-visible payoff.** Terrain movement
   rules unblock coherency and budgets, so the rules chain (movement →
   coherency) keeps its order. **North-star change (DRAFT):** flat image-file
   terrain (JPEG/PNG maps and terrain art) is now the near-term priority — it is
   the highest-payoff "looks like our table" wedge and is independent of the
   rules chain (Phase 0 only). It is pulled forward to **Phase 1**; the former
   Phase 1 (template/interaction polish) and the rules chain shift down. It
   **displaces procedural pixel-art tiles & sprites** (the former Phase 4), which
   drop later to Phase 6 — image files give players a real map now, procedural
   tilesets are the slower art-pipeline follow-up. Fog of war (Phase 8) is
   sequenced right after image terrain conceptually but still depends on a
   viewpoint model; see its spec. Spec drafts:
   [specs/image-terrain.md](specs/image-terrain.md),
   [specs/fog-of-war.md](specs/fog-of-war.md) — both DRAFT, pending owner
   approval.
7. **Settle the state shape before the wire freezes.** Anything that changes
   `BoardState` or the `BoardSync`/`BoardStore` seams lands *before* multiplayer
   (Phase 7) so the wire format and persisted envelope aren't churned. This is
   why **board-state persistence is pulled forward to Phase 2** — the versioned
   envelope and migration seam are expensive to retrofit once the shape grows
   (units, players, budgets, image terrain); see
   [architecture/adr-0007-board-state-persistence.md](architecture/adr-0007-board-state-persistence.md).

## Phases at a glance

| Phase | Theme | Depends on |
|-------|-------|-----------|
| 0 | Current scaffold (done) | — |
| 1 | **Image-file terrain (JPEG/PNG maps & terrain)** (DRAFT priority) | 0 (independent) |
| 2 | **Board-state persistence (save / load)** (priority) | 0 (independent) |
| 3 | Template & movement-interaction polish | 0 |
| 4 | Movement & terrain rules | 0, 3 |
| 5 | Unit coherency (40k) + AoS "wholly within" | 4 |
| 6 | Pixel-art tiles & tileset loader | 0 (independent) |
| 7 | Multiplayer (WebSocketSync + authoritative server) | 0, 2, 3, 4 (states must be settled) |
| 8 | Fog of war / vision + initiative + dice | 7 (fog), 0 (initiative/dice) |
| 9+ | Rules-automation stretch | 5, 8 |

---

## Phase 0 — Current scaffold (done)

**Goal.** A single-machine engine that positions, measures, and reasons about
LoS/cover honestly across both games.

**What already works** (see README "What works now" for the full list):
- mm-only domain with a pure reducer (`src/domain/state.ts:51`) behind a
  `BoardSync` seam (`src/net/sync.ts:20`); `LocalSync` with undo via history
  coalescing.
- Two rule systems as plugins (`src/domain/rules/warhammer.ts`, `dnd5e.ts`)
  behind the `RuleSystem` contract (`rules/types.ts:37`).
- True convex-polygon clearance (`geometry.ts`); tokens with round/oval/rect
  bases, selection, free rotation, facing.
- Walls + terrain as persistent state; verified occlusion/LoS
  (`walls.ts`, `los.ts`), template hit/cover resolution with blocked-space
  shading.
- System-specific base and terrain catalogs; footprint-aware D&D snapping;
  gridless 40k drop.

**Definition of done:** *met.* This is the baseline the phases below build on.

---

## Phase 1 — Image-file terrain (JPEG/PNG maps & terrain) — DRAFT priority

**Goal.** Let players drop a flat raster image (JPEG/PNG) onto the board — a
battlemap background or a terrain image — at true physical scale, so the table
*looks like their table* while mm stay ground truth. Near-term north star. Full
brief: [specs/image-terrain.md](specs/image-terrain.md) (**DRAFT — pending owner
approval**).

**Deliverables** (framed as product outcomes; the *how* is the architect's).
- **Import & place a JPEG/PNG** as terrain art or a full-board map background.
- **Real-world scale mapping** — the image is placed so a known real-world span on
  it measures correctly under the active `RuleSystem` ruler (mm-anchored, not
  pixel-anchored; ADR-0001). Raster→mm mapping is an open architect question (see
  spec).
- **Skin, not geometry** — the image renders under domain layers in
  `src/render/Board.ts` (mm-space, dispatches via `BoardSync`); LoS/cover come
  only from an associated procedural footprint, never inferred from pixels
  (pillar 4). Whether/how image terrain carries a footprint is an open architect
  question (see spec).
- **Serializable placement** — any new state (image reference, scale, placement)
  rides `applyAction` as an `Action` (ADR-0002); `BoardState` stays plain-JSON
  and portable — likely a *reference*, not embedded bytes (architect call).

**Definition of done.** A JPEG/PNG imports and places; a known span measures right
under both rulers; the placement round-trips through `applyAction`; **no** domain
type gains a pixel field (mm-only invariant intact, ADR-0001); LoS/cover over an
image-backed footprint match the same footprint without an image. Serves 40k/AoS
and D&D equally (spec §"Value to each audience").

**Dependencies.** Phase 0 only — independent of the rules chain, purely a new
serializable placement + render-layer skin. **Displaces** the former "pixel-art
tiles & tileset loader" phase, which moves to Phase 6 (procedural tilesets are
the slower art-pipeline follow-up; image files ship the map now).

---

## Phase 2 — Board-state persistence (save / load) — priority

**Goal.** Stop losing work: a solo user's board survives a browser reload, and can
be exported as a portable scenario file to back up or share — with no server. The
durable format is *exactly* what the Phase-7 authoritative server will hydrate a
room from, so nothing here is thrown away when multiplayer lands. Full decision:
[architecture/adr-0007-board-state-persistence.md](architecture/adr-0007-board-state-persistence.md).

**Deliverables** (product outcomes; the *how* is the architect's — ADR-0007).
- **Resume on reload** — the working board autosaves (debounced) to browser
  storage and is restored at boot; a fresh install falls back to `seed()`
  (`main.ts:41`). Serves both audiences equally: a mid-game 40k table or a D&D
  encounter you can walk away from and come back to.
- **Save & share a scenario file** — export the current board to a JSON file and
  re-import it on any device, round-tripping to an identical `BoardState`. The only
  cross-device story before the server, and a backup independent of browser storage.
- **Load through the reducer** — loading replaces whole state via a new
  `loadState` `Action` (nothing bypasses `applyAction`, ADR-0002); it records one
  undo step so an accidental load is recoverable. This is the same primitive the
  server later uses to hydrate a late joiner or load a scenario into a room.
- **Versioned envelope + migration seam** — every persisted board is a
  `{ schemaVersion, savedAt, state }` envelope, never a bare `BoardState`; import
  validates, refuses a version newer than the code, treats a missing version as v1,
  and defaults additive fields via `normalize()`. This is the piece that is
  expensive to retrofit once the shape grows (units, players, budgets, image
  terrain).

**Definition of done.** A board survives reload; export → import round-trips to an
identical `BoardState`; load flows through `applyAction` as `loadState` and is one
undoable step, covered by a vitest per the domain-change checklist; a malformed or
too-new file is refused cleanly with **no** partial state; **no** domain type gains
a pixel field (mm-only invariant intact, ADR-0001) and image-terrain envelopes stay
*references*, not embedded raster bytes, so the localStorage quota holds. Deferred
out of this slice (ADR-0007 §7): named multi-board management, IndexedDB, asset
caching, and server persistence (Phase 7).

**Dependencies.** Phase 0 only — the pure reducer and the `BoardSync` seam already
exist; persistence sits *beside* the seam as a `BoardStore` collaborator (ADR-0007),
not a new `BoardSync`. Independent of the rules chain, like Phase 1. Sequenced here —
right after image terrain and **before** the rules chain grows `BoardState` (units,
budgets) and before Phase 7 freezes the wire format — so later state additions arrive
as ordered migrations against an existing versioned envelope rather than a retrofit
(decide-rule 7). Complements Phase 1: image terrain adds the first new serializable
placement state, and persistence makes it survive reload and become shareable — kept
as a reference so the envelope stays small.

---

## Phase 3 — Template & movement-interaction polish

**Goal.** Finish the analysis-overlay toolset and the small interaction gaps so
the single-player experience feels complete before deeper rules land.

**Deliverables.**
- **Line template** — a straight-line/rectangular template alongside the existing
  blasts and cones (`src/domain/templates.ts`), with the same hit/cover
  resolution and blocked-space shading.
- **Snap blast center to a target** — dropping a blast near a token snaps its
  origin to that token's center (mirrors `snap()` ergonomics).
- **AoS "wholly within" check (measurement form)** — a helper answering "is base
  A wholly within R inches of point/region P" using existing clearance geometry;
  surfaced as a template/measurement readout. (The coherency *rule* use lands in
  Phase 5; this delivers the geometric primitive first.)
- **Redo stack** — complement `LocalSync.undo()` (`sync.ts:64`) with `redo()`;
  extend the `BoardSync` interface and history model. Tracked open question
  (game-design.md §9).

**Definition of done.** Line template resolves hits/cover/shading identically to
blasts in tests; blast-snap works in both systems; "wholly within" has a
brute-force-checked unit test; undo/redo round-trips a drag as one step and is
exposed in the toolbar.

**Dependencies.** Phase 0. Redo touches the `BoardSync` interface, so land it
before Phase 7 hardens that seam.

---

## Phase 4 — Movement & terrain rules

**Goal.** Make walls and terrain affect *movement*, not just sight and cover —
the first rules that constrain where a token may go.

**Deliverables.**
- **Honour `blocksMove`** — dragging/snapping respects wall `blocksMove`
  (`walls.ts:11`) and terrain that impedes movement; a path crossing a
  move-blocking edge is rejected or clamped.
- **Difficult terrain** — respect terrain's `difficult` flag
  (`terrain.ts:49`): entering it costs extra movement.
- **Movement-budget validation** — spent-vs-remaining per token in native units,
  surfaced live (like the ruler). Requires a per-token movement allowance and a
  path-cost accumulator. Open question: how a budget is surfaced and whether it
  is enforced or advisory (game-design.md §9).

**Definition of done.** A token cannot be dragged through a `blocksMove` wall;
difficult terrain doubles path cost in the readout; the budget readout shows
spent/remaining and updates as you drag; all path-cost math has tests. New
state (e.g. a token's move allowance / spent) rides `applyAction` as `Action`s
(ADR-0002).

**Dependencies.** Phase 0 (terrain/wall state), Phase 3 (measurement primitives
reused for path cost).

---

## Phase 5 — Unit coherency (40k) + AoS "wholly within"

**Goal.** First multi-model *unit* rules: keep a 40k unit legally coherent, and
apply AoS "wholly within" to coherency/objectives.

**Deliverables.**
- **40k unit coherency** — a notion of a unit (a group of tokens) and a
  coherency check (each model within 2" of another, larger units needing two
  neighbours). Live warn/violation readout.
- **AoS "wholly within"** — reuse the Phase 3 "wholly within" geometric
  primitive for coherency and objective-range checks.
- **Decision: shared helper vs per-system.** Resolve the open question
  (game-design.md §9) on whether coherency lives as a shared domain helper the
  `RuleSystem`s opt into, or per-plugin. Likely a shared geometric helper +
  per-system thresholds, consistent with ADR-0003 (geometry shared, numbers in
  the plugin). Record the outcome as a new ADR.

**Definition of done.** Selecting/forming a unit shows coherency status; moving a
model that breaks coherency warns; "wholly within" checks are brute-force tested;
the shared-vs-per-system decision is captured as an ADR.

**Dependencies.** Phase 4 (movement, so coherency is checked as models move);
Phase 3 ("wholly within" primitive). Introduces unit grouping into
`BoardState` — a state-shape change to settle **before** Phase 7.

---

## Phase 6 — Pixel-art tiles & tileset loader

**Goal.** Deliver the *procedural* "pixel-art" in the name: swap vector
`Graphics` for nearest-neighbour textures and load procedural tilesets.
Independent of the rules work. **Displaced from the former Phase 4** by image-file
terrain (Phase 1): flat JPEG/PNG maps already give players a real board, so the
slower procedural tileset pipeline follows rather than leads.

**Relation to Phase 1.** Phase 1 ships *flat image files* (a whole JPEG/PNG as
map/terrain); this phase adds *procedural tilesets* (authored tile grids) and
nearest-neighbour sprite rendering of tokens/terrain. Both keep art as a lens
over mm (ADR-0001).

**Deliverables.**
- **Nearest-neighbour token/terrain sprites** — replace vector draws in
  `src/render/` with pixel-art textures at crisp integer scaling; preserve
  rotation/facing.
- **Tileset format & loader** — a defined tileset asset format and a loader
  producing a map background. Open question: the format itself (game-design.md
  §9).
- **Map background** — render a tiled map under the domain layers without moving
  any positioning into pixels (ADR-0001: art is a lens, mm stays ground truth).

**Definition of done.** A token renders as a pixel-art sprite that stays crisp at
all zooms and rotates correctly; a sample tileset loads into a map background;
**no** domain type gains a pixel field (mm-only invariant intact, ADR-0001).

**Dependencies.** Phase 0 only. Can run in parallel with the rules chain
(Phases 3–5); sequence by art availability. Purely render-layer, so it never
touches the domain or `BoardSync`. Shares the "art is a lens" render approach
with Phase 1 (image terrain).

---

## Phase 7 — Multiplayer (WebSocketSync + authoritative server)

**Goal.** Real-time shared play on an authoritative server — the payoff ADR-0002
was built for.

**Deliverables.**
- **`WebSocketSync`** implementing `BoardSync` (sketch at `sync.ts:82`):
  optimistic local apply, send intent, rebase on server-accepted actions
  carrying a sequence number.
- **Authoritative server** — validates each intent against the active
  `RuleSystem`, assigns a sequence number, broadcasts the accepted `Action`.
  Every client replays the same stream and converges (ADR-0002).
- **Server-side persistence** — the room baseline is the same `SavedBoard`
  envelope solo save/load ships in Phase 2 (ADR-0007); `loadState` hydrates a late
  joiner or loads a scenario into a room. Reuses the Phase-2 envelope + migration
  path verbatim — a `BoardStore` swap, not a rewrite.
- **Reconciliation & ownership** — rebase the optimistic layer on divergence;
  enforce `Token.ownerId` (`state.ts:23`) for who may move what.
- **Ephemeral state stays local** — selection, transient overlays, camera are UI
  state and are **not** synced.

**Definition of done.** Two clients on one board converge to identical
`BoardState` under concurrent edits; a rejected intent rolls back cleanly on the
originating client; ownership is enforced server-side; the domain and render
layers are **unchanged** except for wiring the new `BoardSync` (proving the seam).

**Dependencies.** Phases 0, 2, 3, 4, and ideally 5 — the persistence envelope +
`loadState` primitive (Phase 2) and the `BoardState` shape (units, movement
allowances) and `BoardSync` interface (redo) should be settled so the wire
protocol isn't churned. This is why state-shape phases precede it.

---

## Phase 8 — Fog of war / vision + initiative + dice

**Goal.** Per-player vision, turn order, and shared randomness — the table
utilities that make sessions playable end-to-end.

Full fog brief: [specs/fog-of-war.md](specs/fog-of-war.md) (**DRAFT — pending
owner approval**).

**Deliverables.**
- **Fog of war / per-player vision** — derive visibility from the existing LoS
  engine: `hasLineOfSight` (`los.ts:44`) and the umbra builders (`umbraQuad`,
  `umbraOfOccluder` in `walls.ts`), *per viewpoint* — no new geometry engine
  (pillar 4). Open questions (see spec): whose viewpoint (no player/session model
  exists — only `Token.ownerId`, `state.ts:23`); GM-sees-all vs. per-seat reveal;
  whether revealed-area memory is domain state (serializable/replayed) or a
  render-only overlay.
- **Initiative tracker** — turn order as board state (an ordered list + active
  index), advanced by `Action`s.
- **Dice** — shared, server-authoritative rolls so every client sees the same
  result (a seeded/broadcast roll rides the action stream, consistent with
  determinism).

**Definition of done.** A player sees only what their side has LoS to; the
initiative order is shared and advances via the reducer; a roll broadcasts one
agreed result to all clients.

**Dependencies.** Fog of war depends on Phase 7 (whose viewpoint only means
something with multiple players/seats) and reuses Phase 0 LoS. Initiative and
dice are mostly `Action` additions and could land earlier if desired, but are
grouped here as the "playable session" bundle.

---

## Phase 9+ — Rules-automation stretch

**Goal.** Move from *positioning and measuring* toward *automating sequences* —
explicitly a non-goal today (vision.md non-goals), revisited only once the
foundation above is solid.

**Candidate deliverables** (each becomes its own scoped phase when picked up):
- Guided 40k shooting/charge sequences (measure → LoS → cover → resolve).
- D&D action economy helpers (movement + action + bonus tracking).
- Objective/mission scoring per system.
- Third rule system, to re-validate the plugin seam under a new game (ADR-0003).

**Definition of done.** Deferred — scoped per feature when the phase is opened.

**Dependencies.** Phase 5 (units/coherency) and Phase 8 (initiative), plus a
stable multiplayer core.

---

## Phases → design pillars

Which pillar (vision.md) each phase advances. Every phase must advance at least
one without violating any.

| Phase | mm ground truth (P1) | Pure/deterministic (P2) | Rules as plugins (P3) | Verified geometry (P4) | Honest edge-to-edge (P5) |
|-------|:---:|:---:|:---:|:---:|:---:|
| 1 Image-file terrain | ✓ (art is a lens; mm stay ground truth) | ✓ (placement as Actions) | · | ✓ (no pixel-inferred occlusion) | · |
| 2 Board-state persistence | ✓ (mm serialized verbatim; no pixel field) | ✓ (load through the reducer; pure migrations) | · | · | · |
| 3 Template/interaction polish | · | ✓ (redo on the reducer) | · | ✓ (wholly-within test) | ✓ (line template, blast snap) |
| 4 Movement & terrain rules | ✓ (path cost in mm) | ✓ (budgets as Actions) | ✓ (per-system move rules) | ✓ (path-crossing tests) | ✓ (difficult terrain cost) |
| 5 Coherency + wholly-within | · | ✓ (unit state via reducer) | ✓ (shared-vs-per-system ADR) | ✓ (coherency brute-force) | ✓ (2" edge-aware checks) |
| 6 Pixel-art tiles | ✓ (art is a lens, not mm) | · | · | · | · |
| 7 Multiplayer | ✓ (portable mm state) | ✓ (convergence is the point) | ✓ (server validates via RuleSystem) | · | · |
| 8 Fog/initiative/dice | · | ✓ (initiative/dice as Actions) | ✓ (per-system vision rules) | ✓ (fog derived from tested LoS) | ✓ (LoS is area-to-area) |
| 9+ Automation | · | ✓ | ✓ (new games/mechanics) | ✓ | ✓ |

## Design gaps worth tracking

Surfaced while mapping the code to this roadmap; several extend
game-design.md §9:

- **No serializable model for image terrain.** Image-file terrain (Phase 1)
  needs a decided way to reference an image, its real-world scale, and its
  placement in plain-JSON `BoardState` (ADR-0001/0002). Whether it extends
  `TerrainPiece` (`terrain.ts:41`) or is a new type, and how LoS/cover relate to
  it, are open architect calls — see [specs/image-terrain.md](specs/image-terrain.md).
- **WH terrain-layout import — interactive footprint editor (ADR-0011).** The
  Warhammer terrain-layout importer (`src/ingest/terrainLayoutAnalyzer.ts` +
  review gate `src/ui/terrainLayoutConfirm.ts`) auto-detects area terrain and
  snaps to the chosen edition's sizes, but two cases need hand-correction and are
  deferred to a planned editor in the review gate: **(a)** split grey/blue
  footprints — one physical footprint shaded half tall / half low — decompose into
  two adjacent pieces (ADR-0011 decision "A"), but each half is a sub-rectangle
  (e.g. 12×6 → two 12×3) that is off-catalog and so mis-sized by snapping; and
  **(b)** any merged / off-edition detection. The editor should let users select /
  move / delete pieces, **resize to custom dimensions in 0.5" increments**, and
  draw new footprints over the image. Fold in the related want for terrain to snap
  **edge-to-edge / corner-to-corner** with neighbours. See
  [architecture/adr-0011-warhammer-terrain-layout-import.md](architecture/adr-0011-warhammer-terrain-layout-import.md).
- **40k image import is terrain-extraction-only (decided).** The 40k image path
  (`main.ts` `reconstructTerrainLayout`) runs terrain detection and **discards the
  image** — there is no plain "battlemat background *skin*" for 40k (D&D still has
  one via `placeImage`). This was a deliberate call, not a gap: 40k play wants
  honest area-terrain footprints, not a decorative raster. Recorded here so the
  Phase-1 "40k background image" outcome isn't mistaken for missing work.
- **WH terrain-layout import — capture ruins walls as LoS blockers.** The internal
  "recommended ruins placement" L-mark inside each grey footprint is the true
  line-of-sight blocker. Import now *contains* it (folds it into the solid
  footprint) and it is cleanly detectable by colour, but it is **not captured**.
  Future work: extract each footprint's L as wall segments (mm, board-relative) and
  feed them to the LoS engine (`walls.ts`/`los.ts`) so ruins block sight correctly.
  See ADR-0011 ("Internal ruins walls").
- **Persistence open questions (ADR-0007).** The envelope/migration home, whether
  `loadState` is a logged wire action or a control frame, board identity for
  multi-board, and how a persisted `players` registry re-binds to live seats are
  tracked in ADR-0007 §"Open questions" and must be settled before Phase 7 freezes
  the wire format.
- **`BoardState` has no unit grouping.** Coherency (Phase 5) needs a first-class
  "unit" (a set of token ids). Settle this shape before Phase 7 freezes the wire
  format.
- **No movement allowance on `Token`.** Budgets (Phase 4) need a per-token
  allowance/spent field — new serializable state, new `Action`s.
- **`BoardSync` has no `redo`.** The interface exposes `undo` only
  (`sync.ts:20`); redo (Phase 3) is an interface change to make before the seam
  hardens.
- **No player/session model.** `Token.ownerId` exists (`state.ts:23`) but there
  is no notion of players, seats, or a GM. Multiplayer (Phase 7) and fog
  (Phase 8) both need one; whose-viewpoint for fog is unresolved — see
  [specs/fog-of-war.md](specs/fog-of-war.md).
- **Tileset format undefined.** Phase 6 needs a decided asset format + loader
  contract; capture it as an ADR when chosen.
- **Non-convex terrain and `umbraOfOccluder`.** The occluder path assumes convex
  polygons (ADR-0004); concave terrain must be decomposed. Worth an explicit
  decomposition step or a documented authoring constraint before richer terrain
  shapes land.
- **Coherency: shared helper vs per-system** is still an open decision
  (game-design.md §9) that Phase 5 must resolve and record as an ADR.
