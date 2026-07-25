---
name: add-rule-system
description: Step-by-step to add a new game/ruleset/system as a plugin under src/domain/rules/. Use WHENEVER the user wants to add, support, or implement a new game, ruleset, or rule system (e.g. "add Kill Team", "support Pathfinder", "new system").
---

Rule systems are plugins: one file per game, no core edits. The engine only ever
asks a `RuleSystem` three questions.

## The contract (`src/domain/rules/types.ts`)

```ts
interface RuleSystem {
  readonly id: string;
  readonly name: string;
  readonly grid: GridConfig | null;   // { cellMm } or null (gridless)
  snap(pos: Vec2, base: BaseShape): Vec2;
  measure(a: MeasureTarget, b: MeasureTarget): Measurement;   // { mm, text }
  cover(from: MeasureTarget, to: MeasureTarget, walls: Iterable<Wall>): CoverResult;
}
```

`MeasureTarget = { pos, base, facing }`. `CoverResult = { level, text }`,
`level ∈ "none"|"half"|"three-quarters"|"total"`.

## Steps

1. **Create `src/domain/rules/<game>.ts`.** Export a `const <game>: RuleSystem`.
   - `grid`: `null` if gridless (like `warhammer.ts`), else `{ cellMm }`
     (like `dnd5e.ts`).
   - `snap`: gridless returns `pos` as-is; grid systems align by `footprint(base)`
     (`geometry.ts`) — see `dnd5e.ts` for the odd/even/sub-cell logic.
   - `measure`: use `edgeToEdge(...)` (`geometry.ts`) for the mm, then format
     `text` in native units via `units.ts` (`mmToInches`, etc.).
   - `cover`: reuse `blockedCornerCount(...)` (`walls.ts`); map the count to your
     system's cover levels.
   - Keep it pure/deterministic — no pixels, Pixi, DOM, or randomness.

2. **Register it** in `src/domain/rules/index.ts`: import it and add
   `[<game>.id]: <game>` to `RULE_SYSTEMS`. `getRuleSystem` picks it up.

3. **Add a case to `src/domain/rules/rules.test.ts`** — cover snap (a known
   drop → expected landing), measure (a known distance → expected text), and
   cover (a wall config → expected level).

4. **Verify:** `npm run typecheck` and `npm test` (see
   `docs/context/dev-environment.md` for the WSL PATH prefix).

Don't touch the toolbar/UI unless the task asks — registering the system is
enough for the engine.
