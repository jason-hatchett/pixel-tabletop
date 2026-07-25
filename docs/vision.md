# Vision — Pixel Tabletop

## One sentence
A pixel-art virtual tabletop with **exact physical positioning** that serves
multiple miniature-wargame and RPG rulesets — Warhammer 40k / Age of Sigmar and
D&D 5E today — from a single deterministic engine.

## The wedge (why this exists, why now)
Generic VTTs (Roll20, Foundry) model the table as a grid or a bag of tokens and
bolt rules on top per-system. They are excellent at D&D-shaped games and poor at
gridless, edge-to-edge, millimetre-honest wargames. Pixel Tabletop inverts the
model: **the table is a continuous physical surface measured in millimetres**,
and each ruleset is a *plugin* that interprets that surface (a grid, an inch, a
cover rule). One engine, honest geometry, many games.

## Design pillars (do not violate)
1. **Millimetres are ground truth.** The domain never stores pixels or grid
   squares. Pixels are camera/zoom; inches/feet/cells are a *rule-system
   interpretation*. This single decision is the moat — it's what lets one engine
   be correct for both a gridless 40k measurement and a 5-ft D&D square.
2. **The domain is pure, serializable, deterministic.** `applyAction(state,
   action)` is a total reducer over plain-JSON state. Same action stream →
   identical state. This is what makes authoritative multiplayer a *new
   `BoardSync`*, not a rewrite.
3. **Rules are plugins, not core edits.** Adding a game is adding a file under
   `src/domain/rules/`. The core never learns a specific game's numbers.
4. **Geometry is verified, never asserted.** Occlusion/LoS math is proven against
   ground-truth grid scans in tests, not argued from prose. History in the repo
   is littered with "clever" heuristics that were wrong (tangent-pick, per-edge
   umbrae). New geometry gets a test that a brute-force scan agrees with.
5. **Honest edge-to-edge.** Distance, cover, and LoS are base-to-base and
   shape-aware. A rotated oval measures shorter along its long axis — like the
   real table. We never approximate a base as its center point where the shape
   matters.

## Who it's for
- **40k / AoS players** who want exact, gridless, edge-to-edge measurement,
  true LoS with terrain shadows, and templates that respect cover.
- **D&D 5E tables** who want footprint-aware grid snapping and corner-method
  cover — without the engine pretending everything is a 5-ft square.
- Eventually: **any ruleset** whose distance/cover/LoS can be expressed against a
  physical surface.

## Non-goals (for now)
- Not a rules *automation* engine (we position and measure; we don't roll a
  full 40k combat sequence for you — yet; see roadmap Phase 5+).
- Not a character-sheet / campaign manager.
- Not a 3D tabletop. Top-down pixel art is the aesthetic and the scope.

## What "done enough to love" looks like (near-term)
A group can: pick a system, lay terrain and walls, place correctly-sized
miniatures, measure and check LoS/cover honestly, use templates that shade
blocked space — and (Phase: Multiplayer) do it together in real time on an
authoritative server.

## Related
- Game design detail → [game-design.md](game-design.md)
- Where we're going → [roadmap.md](roadmap.md)
- Why the architecture is shaped this way → [architecture/adr-index.md](architecture/adr-index.md)
