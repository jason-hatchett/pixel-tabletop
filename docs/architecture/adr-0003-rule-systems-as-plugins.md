# ADR-0003: Rule systems as plugins implementing a RuleSystem contract

## Status
Accepted

## Context
Warhammer and D&D disagree about almost everything a VTT touches: whether there's
a grid, how a dropped model snaps, how distance is measured, and how cover works.
The naive approach — `if (system === "dnd") … else …` scattered through the
engine — makes the core learn every game's numbers, and every new game edits
shared code (merge conflicts, regressions, an ever-growing switch).

We want "add a game = add a file," with the core staying game-agnostic.

## Decision
A game is a plugin implementing the `RuleSystem` interface
(`src/domain/rules/types.ts:37`). The core never branches on game identity; it
holds a `RuleSystem` and asks it questions. The contract is deliberately small —
it answers exactly the questions where games genuinely differ:

- `grid: GridConfig | null` — `null` means gridless (`types.ts:40`).
- `snap(pos, base)` — where a dropped token lands; freeform systems return it
  as-is (`types.ts:44`).
- `measure(a, b)` — edge-to-edge distance in native units, returning both raw
  `mm` and display `text` (`types.ts:47`).
- `cover(from, to, walls)` — cover the target gains (`types.ts:50`).

Implementations live one-per-file: `rules/warhammer.ts` (gridless, inches,
none/benefit/out-of-LoS cover) and `rules/dnd5e.ts` (5-ft grid, footprint
snapping, corner-method cover). Registration is a single map in `rules/index.ts`,
and `BoardState.systemId` (`state.ts:31`) selects the active one. Every system
gets a case in `rules/rules.test.ts`.

Shape-aware geometry (clearance, LoS, shadows) lives in the shared domain
(`geometry.ts`, `walls.ts`, `los.ts`) — not in the plugins. A `RuleSystem`
*interprets* physical results (labels an inch, picks a cover threshold); it does
not re-implement the math.

## Consequences
- Adding a game is additive: new file + one line in `index.ts` + a test case.
  The core does not change (game-design.md §3).
- The contract's narrowness is the point: it forces game-specific knowledge to
  the edge and keeps mm geometry universal.
- Cost: genuinely cross-system mechanics that don't fit the three-method
  contract (e.g. AoS "wholly within", 40k unit coherency, movement budgets) need
  a deliberate decision — extend the interface, or add a shared helper the
  systems opt into. This is tracked as an open question (game-design.md §9) and a
  roadmap item, precisely so it isn't decided silently by bolting logic onto one
  plugin.
- Because `systemId` is serializable state, switching systems is an `Action`
  (`setSystem`; `state.ts:48`) and rides the same deterministic reducer as
  everything else.
