# ADR-0005: First-class units as an ordered set of token ids

## Status
Proposed

## Context
40k/AoS coherency (roadmap coherency phase) operates on a **unit** — an ordered
set of models that must stay within a threshold distance of one another. The
domain has no such concept. `BoardState` carries a flat `tokens: Record<string,
Token>` (`src/domain/state.ts:32`) and each `Token` knows only its own
`ownerId` (`state.ts:23`); nothing groups tokens or records membership order.

Coherency checks, unit-wide move/select, and "this model left the unit" all
need a stable, serializable group identity that survives the action stream and
reads identically on every client. Because coherency lands before multiplayer
freezes the wire format (design gaps, `docs/roadmap.md:343`), the shape of that
group is a wire-format commitment we must make now, not after Phase 6.

The group must stay pure/serializable/mm-agnostic (ADR-0001) and mutate only
through `applyAction` (ADR-0002). It carries **no geometry** — coherency
distance is computed from member `Token.pos`, not stored.

## Decision
Add a first-class `units` collection to `BoardState`, parallel to `tokens`:

```ts
interface Unit {
  id: string;
  tokenIds: string[];   // ordered; membership + leader/anchor order
  ownerId: string;      // the owning side (see ADR-0006)
}
// BoardState:
units: Record<string, Unit>;
```

Membership is a plain array of token ids (ordered — the first is the coherency
anchor / leader), not a set object, to stay JSON-native and deterministic.
`Token` gains **no** `unitId` back-reference; the `units` collection is the
single source of truth for grouping, and a token's membership is derived by
lookup.

New `Action` variants extend the union at `state.ts:37`:

- `{ type: "addUnit"; unit: Unit }`
- `{ type: "removeUnit"; id: string }`
- `{ type: "assignToken"; unitId: string; tokenId: string }` (append to `tokenIds`)
- `{ type: "unassignToken"; unitId: string; tokenId: string }`
- `{ type: "reorderUnit"; id: string; tokenIds: string[] }`

`applyAction` enforces the invariants: a token id appears in at most one unit;
`assignToken`/`addUnit` referencing an unknown token or already-assigned token
is a no-op or rejected (consistent with existing reducer guards); `removeToken`
also strips the id from any owning unit. Coherency itself is **not** a reducer
concern — it is a `RuleSystem`-provided check over member positions (ADR-0003),
reusing shared distance geometry with per-system thresholds.

## Consequences
- Coherency, unit-select, and unit-move have a stable serializable subject that
  round-trips through `applyAction` and replays identically on every client
  (ADR-0002).
- The wire format gains one keyed collection and five actions, decided **before**
  multiplayer freezes it — no retrofit into a hardened format.
- Membership integrity (no token in two units, dangling ids on `removeToken`)
  becomes a reducer invariant with its own vitest coverage, per the
  domain-change checklist.
- The reducer stays mm-agnostic: `Unit` holds no positions or distances;
  coherency reads `Token.pos` on demand.
- Cost: two collections can drift if an action forgets to touch both (e.g.
  `removeToken` must also unassign). This is the price of a single source of
  truth for membership and is contained to the reducer, where it is tested.

## Alternatives
- **Tag tokens with `unitId: string | null` instead of a separate collection.**
  Simpler to add (one field on `Token`, no new top-level key) and membership is
  local to the token. Rejected as the primary model because: (a) it loses
  **order** — coherency's leader/anchor and stable iteration need an ordered
  list, which scattered back-references can't express without a second index;
  (b) unit-level attributes (`ownerId`, later name/stats) have nowhere to live
  except duplicated across members; (c) "list this unit's models" becomes an
  O(n) scan of all tokens rather than a lookup. A `unitId` tag is a valid
  *derived* convenience but not the source of truth.
- **Store coherency results/distances on the unit.** Rejected — violates
  ADR-0001's "no derived geometry in the domain"; distances are recomputed from
  `Token.pos` by the active `RuleSystem`.
- **Defer until multiplayer.** Rejected — the wire format freezes at multiplayer
  (`roadmap.md:343`); adding a grouping collection afterward is a breaking
  format change. Decide the shape now, implement when coherency ships.
