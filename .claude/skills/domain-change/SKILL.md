---
name: domain-change
description: Checklist for ANY change under src/domain/ — state, reducers, rules, geometry, walls, terrain, LoS. Use WHENEVER you edit domain/state/reducer/action logic or any file in src/domain/, to keep it pure, serializable, deterministic, and tested.
---

`src/domain/` is the moat: pure, serializable, deterministic, **millimetres
only**. Break these and multiplayer/determinism break silently.

## Checklist

1. **mm only.** No pixels, grid squares, Pixi, or DOM in the domain. Positions
   and sizes are millimetres; inches/feet/cells are produced on demand by a
   `RuleSystem`, never stored.

2. **Pure & serializable.** State is plain JSON. No class instances, functions,
   `Date`, `Map`/`Set`, or non-JSON values on state. Prefer `x | null` over
   optional props (`exactOptionalPropertyTypes` is on).

3. **Deterministic.** No `Math.random`, `Date.now`, or ambient I/O in reducers —
   the same action stream must always produce identical state.

4. **Route mutations through `applyAction`** (`state.ts`). No feature mutates
   state directly or out-of-band. Adding a mutation = a new `Action` variant +
   a case in the reducer; the reducer **never mutates its input** (spread/clone).

5. **Add a vitest.** Every domain change gets a test (`src/domain/*.test.ts`).
   Geometry/LoS/occlusion/clearance changes additionally require the brute-force
   verification workflow — see the `verify-geometry` skill.

6. **Strict TS conventions.** `.js` extensions on relative imports;
   `noUncheckedIndexedAccess` (guard `arr[i]!` / undefined); match surrounding
   style and comment density.

7. **Verify:** `npm run typecheck` && `npm test` before claiming done (WSL PATH
   prefix: see `docs/context/dev-environment.md`).
