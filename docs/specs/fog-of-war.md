# Spec (DRAFT) — Fog of war / vision

Status: **DRAFT — not approved.** Owner works "propose, I approve"; nothing here
is decided. Open architecture calls are routed below, not resolved.

See also: [roadmap.md](../roadmap.md) · [game-design.md](../game-design.md) §5
(LoS & shadows), §9 (open questions) · [vision.md](../vision.md) (pillar 4:
verified geometry).

## Problem statement

The engine already computes true line of sight — `hasLineOfSight`
(`src/domain/los.ts:44`), with shadow builders `umbraQuad` (segments) and
`umbraOfOccluder` (whole terrain blocks) in `walls.ts`, all verified against a
brute-force scan (`lineOfSightBlocked`). But every player sees the whole board.
There is no **fog of war**: no way to hide what a side cannot currently see.
Both games want it — a GM revealing a dungeon as the party moves; a wargame
hiding the far side of a ruin. This is the near-term feature after image terrain.

Scope is **deriving a hidden/revealed overlay from the existing LoS engine**, not
building any new geometry engine (pillar 4 — new occlusion math is forbidden
without a ground-truth test, and we don't need any here).

## User value

- **40k / AoS players.** Space behind LoS-blocking terrain (ruins, woods) is
  fogged for a side that can't see it, matching the "true LoS with terrain
  shadows" promise — the same umbra math already drawn for templates, now used to
  hide rather than shade.
- **D&D 5E tables.** A GM reveals the map as characters gain sight of it; players
  see only what their tokens can see. The corner/wall machinery already in place
  drives the reveal.

## In scope

- A visibility overlay computed **from `hasLineOfSight` / the umbra builders**,
  not a new engine.
- A hidden region that updates as tokens move (reuses per-frame LoS, as the
  template shading already does).
- Overlay rendered in `src/render/Board.ts` in mm-space, dispatching nothing that
  bypasses the reducer.

## Out of scope (defer / not this slice)

- A full player/session/seat model. None exists today — only `Token.ownerId`
  (`state.ts:23`). Whose viewpoint fog uses is an **open question**, not a
  decision this spec makes (see below).
- Initiative tracker and dice (roadmap groups these nearby, but they are
  independent of fog).
- New occlusion geometry (pillar 4 — reuse `los.ts`, invent nothing).

## Acceptance criteria (user-observable, testable)

1. Given a viewpoint (whose — see open questions), the board shows a hidden region
   that is exactly the complement of what that viewpoint has line of sight to,
   using the existing `hasLineOfSight` result — a test asserts the revealed set
   matches `hasLineOfSight` for the same inputs (no divergent second engine).
2. Moving a token updates the revealed region live, consistent with how template
   shading recomputes.
3. Fog respects the existing terrain LoS rules already in `los.ts` (seeing-out of
   a feature you're within; seeing-in to a model inside a feature) — no new
   special-casing.
4. Whatever "revealed memory" model is chosen (see open questions), its behaviour
   is testable: if it is domain state, it round-trips through `applyAction`
   (ADR-0002); if it is render-only, a test asserts it adds **no** field to
   `BoardState`.

## Pillar & phase fit

Advances **pillar 4 (verified geometry)** by *reusing* the verified LoS engine
rather than adding math, and **pillar 2 (deterministic reducer)** only if revealed
memory becomes domain state. Belongs in the fog phase (see roadmap). Depends on
resolving the player/viewpoint question, which also blocks multiplayer.

## Open questions for the architect (PM does NOT decide these)

1. **Whose viewpoint?** No player/session model exists — only `Token.ownerId`
   (`state.ts:23`). Fog needs a subject: per-`ownerId` side, per-selected-token,
   per-seat, or GM. This is the same missing player/session model multiplayer
   needs; fog forces the question. PM flags it; the shape is the architect's call.
2. **GM-sees-all vs. per-seat reveal.** Is there a privileged "sees everything"
   role, and do non-GM seats each get their own fog? This depends on (1) and on
   whether a seat concept lands at all before multiplayer.
3. **Revealed-area memory: domain state vs. render-only overlay.** Two shapes:
   (a) revealed area is **domain state** — serializable, replayed, so once-seen
   area stays remembered across an action stream and is consistent for all
   clients (rides `applyAction`, ADR-0002); or (b) it is a **render-only** overlay
   recomputed each frame from current LoS with no memory (nothing added to
   `BoardState`). "Explored but not currently visible" only exists under (a). This
   is a state-shape decision with multiplayer wire-format consequences — settle
   before the format freezes.
4. **Derivation seam.** Fog derives from `hasLineOfSight` / `umbraOfOccluder`
   (`los.ts`, `walls.ts`) — confirm the exact reuse point and that no parallel
   occlusion path is introduced (pillar 4). PM asserts the constraint; the API
   surface is the architect's.
