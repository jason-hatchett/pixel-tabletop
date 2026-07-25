# ADR-0006: Minimal player/seat model with an explicit GM role

## Status
Proposed

## Context
Two upcoming features need to answer "**whose viewpoint?**": multiplayer
(roadmap multiplayer phase) must know which client owns which tokens and what it
may act on; fog of war (fog phase) must compute a hidden region for a *subject*
(`docs/specs/fog-of-war.md:75`). The domain has no such subject. `Token.ownerId:
string | null` (`src/domain/state.ts:23`) is an opaque string with no backing
registry — nothing says what an owner id *is*, whether it is a person or a side,
or that a privileged "sees everything" role exists.

Fog forces the question first: its acceptance criterion 1 needs a viewpoint to
take the LoS complement against (`fog-of-war.md:54`), and its open question 3 —
revealed-area memory as domain state vs. render overlay (`fog-of-war.md:84`) —
can't be framed until we know whether viewpoints are first-class serializable
state. Multiplayer needs the same registry to route ownership. Deciding it once,
before the wire format freezes, serves both.

Constraints: pure/serializable (ADR-0001), mutated only via `applyAction`
(ADR-0002), no rendering or transport concern in the domain. This ADR defines
**identity and role**, not authorization/transport (that is `src/net/`).

## Decision
Add a `players` registry to `BoardState` and bind `ownerId` to it:

```ts
type Role = "gm" | "player";
interface Player {
  id: string;
  name: string;
  role: Role;
}
// BoardState:
players: Record<string, Player>;
```

- **`Token.ownerId` is a foreign key into `players`** (or `null` for
  unowned/neutral). Its type is unchanged (`state.ts:23`), so existing serialized
  boards stay valid — an id that resolves to no player is treated as unowned. A
  unit's `ownerId` (ADR-0005) is the same key.
- **Seat = player id.** We use one flat concept (a player with a role), not a
  separate seat/session layer. Sessions and connections are a `src/net/` concern
  and never enter `BoardState`; the domain knows only durable players.
- **Role decides scope of sight.** `role: "gm"` sees the whole board (GM-sees-all).
  `role: "player"` has a per-viewpoint fog computed from the tokens it owns.
  A viewpoint is therefore *a player id*; fog for a player is the LoS union over
  tokens whose `ownerId === playerId`.

New `Action` variants extend the union at `state.ts:37`:

- `{ type: "addPlayer"; player: Player }`
- `{ type: "removePlayer"; id: string }` (nulls out `ownerId` on its tokens/units)
- `{ type: "renamePlayer"; id: string; name: string }`
- `{ type: "setPlayerRole"; id: string; role: Role }`

This unblocks fog's open question 3 (`fog-of-war.md:84`): with a serializable
viewpoint subject in hand, revealed-area **memory** becomes a well-posed
choice — either (a) domain state keyed by player id, replayed through
`applyAction` so "explored but not currently visible" persists per player, or
(b) a render-only overlay recomputed each frame. This ADR does **not** decide
(a) vs (b); it provides the subject that decision requires and defers the memory
model to fog implementation.

## Consequences
- Fog and multiplayer share one viewpoint definition — a player id — decided
  before the wire format freezes; no second ownership notion appears in `net/`.
- Ownership is now referentially meaningful: `ownerId` resolves to a named
  player with a role, enabling GM-sees-all vs. per-player fog without new state.
- Backward compatible: `ownerId` keeps its type and unresolved ids degrade to
  unowned, so existing boards load unchanged.
- The reducer gains a referential-integrity duty (`removePlayer` must null
  dependent `ownerId`s on tokens and units), covered by vitest per the
  domain-change checklist.
- The domain stays transport-agnostic: no sessions, sockets, or auth in
  `BoardState`; `src/net/` maps a live connection to a player id outside the
  reducer.
- Cost: a two-role enum may be too coarse later (spectators, co-GMs). It is a
  serializable field, so widening `Role` is a forward-compatible additive change
  — acceptable for a minimal model.

## Alternatives
- **Keep only `ownerId`, add no registry.** Zero new state, but leaves "whose
  viewpoint?" undefined for fog and unroutable for multiplayer, and there is
  nowhere to hang the GM role. Rejected — the missing subject is exactly what
  both features need (`fog-of-war.md:77`).
- **A separate `seats`/`sessions` layer distinct from players.** Models transient
  connections in the domain. Rejected — sessions are a `net/` transport concern;
  putting them in serializable `BoardState` couples the pure core to networking
  and pollutes the wire format with ephemeral data. Player is durable; seat is
  the runtime binding.
- **Role as a boolean `isGm`.** Rejected in favour of a string enum — future
  roles (spectator, co-GM) extend an enum additively but would each need a new
  boolean, and a `Role` string is self-documenting in serialized state.
- **Per-token viewpoint instead of per-player.** Fog open question 1 lists
  per-selected-token as an option (`fog-of-war.md:77`). Rejected as the *model*:
  a token-scoped view is a UI filter over the player's owned set, not a separate
  identity; keeping the subject at player granularity keeps multiplayer and fog
  on one concept.
